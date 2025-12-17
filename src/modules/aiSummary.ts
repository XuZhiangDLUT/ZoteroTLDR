import { marked } from "marked";
import { getPrefs, type AddonPrefs } from "../utils/prefs";
import { summarize, summarizeWithRemotePdf, testAPI, type SummarizeResult } from "../llm/providers";

/**
 * 速率限制器 - 滑动窗口实现
 */
class RateLimiter {
  private timestamps: number[] = [];

  /**
   * 等待直到可以执行下一个请求
   * @param maxRequests 时间窗口内最大请求数
   * @param windowMs 时间窗口（毫秒）
   */
  async waitForSlot(maxRequests: number, windowMs: number): Promise<void> {
    const now = Date.now();
    // 清理过期的时间戳
    this.timestamps = this.timestamps.filter(t => now - t < windowMs);

    if (this.timestamps.length >= maxRequests) {
      // 计算需要等待的时间
      const oldestTimestamp = this.timestamps[0];
      const waitTime = oldestTimestamp + windowMs - now + 100; // 额外100ms缓冲
      if (waitTime > 0) {
        await new Promise(resolve => setTimeout(resolve, waitTime));
        // 递归检查，确保可以执行
        return this.waitForSlot(maxRequests, windowMs);
      }
    }

    // 记录当前请求时间
    this.timestamps.push(Date.now());
  }

  /**
   * 重置限制器
   */
  reset(): void {
    this.timestamps = [];
  }
}

// 全局速率限制器实例
const rateLimiter = new RateLimiter();

/**
 * 任务状态
 */
type TaskStatus = "pending" | "running" | "completed" | "failed" | "cancelled";

/**
 * 任务信息（内部使用）
 */
interface QueueTask<T> {
  id: number;
  data: T;
  status: TaskStatus;
  displayName: string;
  resolve: () => void;
  reject: (error: Error) => void;
  error?: string;
  startTime?: number;
  endTime?: number;
  output: string; // 任务输出内容
  thoughtOutput: string; // 思考过程输出
}

/**
 * 任务信息（外部查看）
 */
interface TaskInfo {
  id: number;
  displayName: string;
  status: TaskStatus;
  error?: string;
  startTime?: number;
  endTime?: number;
  output: string;
  thoughtOutput: string;
}

/**
 * 队列事件监听器
 */
type QueueEventListener = () => void;

/**
 * 显示名称提取函数
 */
type DisplayNameExtractor<T> = (data: T) => string;

/**
 * 全局任务队列 - 跨调用的并发控制
 */
class GlobalTaskQueue<T> {
  private queue: QueueTask<T>[] = [];
  private runningTasks: Map<number, QueueTask<T>> = new Map();
  private completedTasks: QueueTask<T>[] = [];
  private taskIdCounter = 0;
  private concurrency = 1;
  private worker: ((task: T, taskId: number) => Promise<void>) | null = null;
  private displayNameExtractor: DisplayNameExtractor<T> = () => "任务";
  private eventListeners: Set<QueueEventListener> = new Set();
  private maxCompletedHistory = 50; // 最多保留的已完成任务历史

  /**
   * 设置显示名称提取函数
   */
  setDisplayNameExtractor(fn: DisplayNameExtractor<T>): void {
    this.displayNameExtractor = fn;
  }

  /**
   * 添加事件监听器
   */
  addEventListener(listener: QueueEventListener): void {
    this.eventListeners.add(listener);
  }

  /**
   * 移除事件监听器
   */
  removeEventListener(listener: QueueEventListener): void {
    this.eventListeners.delete(listener);
  }

  /**
   * 触发事件
   */
  private emitEvent(): void {
    for (const listener of this.eventListeners) {
      try {
        listener();
      } catch (e) {
        // 忽略监听器错误
      }
    }
  }

  /**
   * 获取当前队列状态
   */
  getStatus(): { queued: number; running: number; concurrency: number; completed: number; failed: number } {
    const completed = this.completedTasks.filter(t => t.status === "completed").length;
    const failed = this.completedTasks.filter(t => t.status === "failed" || t.status === "cancelled").length;
    return {
      queued: this.queue.length,
      running: this.runningTasks.size,
      concurrency: this.concurrency,
      completed,
      failed,
    };
  }

  /**
   * 获取所有任务列表
   */
  getAllTasks(): TaskInfo[] {
    const tasks: TaskInfo[] = [];

    // 运行中的任务
    for (const task of this.runningTasks.values()) {
      tasks.push({
        id: task.id,
        displayName: task.displayName,
        status: task.status,
        startTime: task.startTime,
        output: task.output,
        thoughtOutput: task.thoughtOutput,
      });
    }

    // 等待中的任务
    for (const task of this.queue) {
      tasks.push({
        id: task.id,
        displayName: task.displayName,
        status: task.status,
        output: task.output,
        thoughtOutput: task.thoughtOutput,
      });
    }

    // 已完成的任务（倒序，最近的在前）
    for (let i = this.completedTasks.length - 1; i >= 0; i--) {
      const task = this.completedTasks[i];
      tasks.push({
        id: task.id,
        displayName: task.displayName,
        status: task.status,
        error: task.error,
        startTime: task.startTime,
        endTime: task.endTime,
        output: task.output,
        thoughtOutput: task.thoughtOutput,
      });
    }

    return tasks;
  }

  /**
   * 追加任务输出
   */
  appendOutput(taskId: number, chunk: string, isThought: boolean): void {
    // 查找运行中的任务
    const task = this.runningTasks.get(taskId);
    if (task) {
      if (isThought) {
        task.thoughtOutput += chunk;
      } else {
        task.output += chunk;
      }
      this.emitEvent();
    }
  }

  /**
   * 获取当前运行中任务的 ID 列表
   */
  getRunningTaskIds(): number[] {
    return Array.from(this.runningTasks.keys());
  }

  /**
   * 更新并发数
   */
  setConcurrency(n: number): void {
    this.concurrency = Math.max(1, n);
    // 尝试启动更多任务
    this.tryRunNext();
  }

  /**
   * 设置工作函数
   */
  setWorker(fn: (task: T, taskId: number) => Promise<void>): void {
    this.worker = fn;
  }

  /**
   * 提交任务到队列
   */
  submit(data: T): Promise<void> {
    return new Promise((resolve, reject) => {
      const task: QueueTask<T> = {
        id: ++this.taskIdCounter,
        data,
        status: "pending",
        displayName: this.displayNameExtractor(data),
        resolve,
        reject,
        output: "",
        thoughtOutput: "",
      };
      this.queue.push(task);
      this.emitEvent();
      this.tryRunNext();
    });
  }

  /**
   * 批量提交任务
   */
  submitBatch(items: T[]): Promise<void>[] {
    return items.map(item => this.submit(item));
  }

  /**
   * 取消指定任务（只能取消等待中的任务）
   */
  cancelTask(taskId: number): boolean {
    const index = this.queue.findIndex(t => t.id === taskId);
    if (index !== -1) {
      const task = this.queue.splice(index, 1)[0];
      task.status = "cancelled";
      task.endTime = Date.now();
      this.completedTasks.push(task);
      this.trimCompletedHistory();
      task.reject(new Error("Task cancelled"));
      this.emitEvent();
      return true;
    }
    return false;
  }

  /**
   * 尝试运行下一个任务
   */
  private tryRunNext(): void {
    while (this.runningTasks.size < this.concurrency && this.queue.length > 0) {
      const task = this.queue.shift();
      if (task) {
        this.runTask(task);
      }
    }
  }

  /**
   * 执行单个任务
   */
  private async runTask(task: QueueTask<T>): Promise<void> {
    if (!this.worker) {
      task.reject(new Error("Worker not set"));
      return;
    }

    task.status = "running";
    task.startTime = Date.now();
    this.runningTasks.set(task.id, task);
    this.emitEvent();

    try {
      await this.worker(task.data, task.id);
      task.status = "completed";
      task.resolve();
    } catch (e) {
      task.status = "failed";
      task.error = e instanceof Error ? e.message : String(e);
      task.reject(e instanceof Error ? e : new Error(String(e)));
    } finally {
      task.endTime = Date.now();
      this.runningTasks.delete(task.id);
      this.completedTasks.push(task);
      this.trimCompletedHistory();
      this.emitEvent();
      this.tryRunNext();
    }
  }

  /**
   * 限制已完成任务历史数量
   */
  private trimCompletedHistory(): void {
    while (this.completedTasks.length > this.maxCompletedHistory) {
      this.completedTasks.shift();
    }
  }

  /**
   * 清空队列（不影响正在运行的任务）
   */
  clear(): void {
    for (const task of this.queue) {
      task.status = "cancelled";
      task.endTime = Date.now();
      this.completedTasks.push(task);
      task.reject(new Error("Queue cleared"));
    }
    this.queue = [];
    this.trimCompletedHistory();
    this.emitEvent();
  }

  /**
   * 清空已完成任务历史
   */
  clearHistory(): void {
    this.completedTasks = [];
    this.emitEvent();
  }
}

/**
 * 摘要任务数据
 */
interface SummaryTaskData {
  item: Zotero.Item;
  attachment: AttachmentInfo;
  prefs: AddonPrefs;
}

// 全局任务队列实例
const globalTaskQueue = new GlobalTaskQueue<SummaryTaskData>();

/**
 * 将 Markdown 转换为 HTML
 */
function markdownToHTML(md: string): string {
  if (!md) return "<p>(无内容)</p>";
  return marked.parse(md) as string;
}

/**
 * HTML 转义
 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * 将 glob 模式转换为正则表达式
 * 支持 * 和 ? 通配符
 */
function globToRegExp(glob: string): RegExp | null {
  const trimmed = glob.trim();
  if (!trimmed) return null;
  const escaped = trimmed
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".");
  return new RegExp(`^${escaped}$`, "i");
}

/**
 * 解析过滤规则
 * 支持：
 *   - 单个规则: *.pdf
 *   - 排除规则: !*-mono.pdf
 *   - OR 规则 (逗号分隔): *.pdf, *.PDF
 *   - AND 规则 (分号分隔): !*-mono.pdf; !*-dual.pdf
 *   - 混合: *.pdf, *.PDF; !*-mono.pdf
 *
 * 逻辑：
 *   1. 分号分隔的部分是 AND 关系（都必须满足）
 *   2. 逗号分隔的部分是 OR 关系（满足任一即可）
 *   3. ! 开头表示排除（NOT）
 */
function shouldProcessFile(fileName: string, filterRule: string): boolean {
  if (!filterRule || !filterRule.trim()) {
    return true; // 没有过滤规则，处理所有文件
  }

  // 按分号分割为 AND 组
  const andGroups = filterRule.split(";").map(s => s.trim()).filter(Boolean);

  for (const group of andGroups) {
    // 按逗号分割为 OR 规则
    const orRules = group.split(",").map(s => s.trim()).filter(Boolean);

    if (orRules.length === 0) continue;

    // 分离包含规则和排除规则
    const includePatterns: string[] = [];
    const excludePatterns: string[] = [];

    for (const rule of orRules) {
      if (rule.startsWith("!")) {
        excludePatterns.push(rule.slice(1).trim());
      } else {
        includePatterns.push(rule);
      }
    }

    // 检查排除规则（任一匹配则排除）
    for (const pattern of excludePatterns) {
      const re = globToRegExp(pattern);
      if (re && re.test(fileName)) {
        return false; // 匹配排除规则，不处理
      }
    }

    // 检查包含规则（如果有包含规则，必须匹配其中之一）
    if (includePatterns.length > 0) {
      let matched = false;
      for (const pattern of includePatterns) {
        const re = globToRegExp(pattern);
        if (re && re.test(fileName)) {
          matched = true;
          break;
        }
      }
      if (!matched) {
        return false; // 有包含规则但没匹配，不处理
      }
    }
  }

  return true; // 所有 AND 组都通过
}

/**
 * 附件信息
 */
interface AttachmentInfo {
  item: Zotero.Item;
  fileName: string;
  filePath: string; // PDF 文件完整路径（用于远端解析）
  text: string; // 本地提取的文本（用于本地解析）
}

/**
 * 获取条目的所有符合条件的 PDF 附件及其信息
 */
async function getEligibleAttachments(
  item: Zotero.Item,
  prefs: AddonPrefs,
): Promise<AttachmentInfo[]> {
  const attIDs = item.getAttachments ? item.getAttachments() : [];
  const results: AttachmentInfo[] = [];

  for (const id of attIDs) {
    const att = Zotero.Items.get(id) as Zotero.Item;
    const contentType =
      (att.getField?.("contentType") as string) ||
      ((att as any).attachmentContentType as string | undefined) ||
      "";

    // 只处理 PDF
    if (!contentType.includes("application/pdf")) {
      continue;
    }

    // 获取文件路径和文件名
    const getFilePath = (att as any).getFilePath || att.getFilePath;
    const filePath = getFilePath ? getFilePath.call(att) : "";
    const fileName = filePath ? filePath.split(/[\\/]/).pop() ?? "" : "";

    // 检查是否符合过滤规则
    if (!shouldProcessFile(fileName, prefs.attachmentFilter)) {
      continue;
    }

    // 根据解析模式决定是否需要提取本地文本
    let text = "";
    if (prefs.pdfParseMode === "local") {
      try {
        const txt = await (att as any).attachmentText;
        if (txt) {
          const fullText = String(txt);
          text = fullText.length > prefs.maxChars
            ? fullText.slice(0, prefs.maxChars)
            : fullText;
        }
      } catch (_e) {
        // 本地解析模式下，无法获取文本则跳过
        continue;
      }
      // 本地模式下，没有文本则跳过
      if (!text) {
        continue;
      }
    }

    results.push({
      item: att,
      fileName,
      filePath,
      text,
    });
  }

  return results;
}

/**
 * 构建提示词，替换模板变量
 */
function buildPrompt(
  template: string,
  data: { title: string; abstract: string; content: string; fileName?: string },
): string {
  return template
    .split("{title}").join(data.title || "")
    .split("{abstract}").join(data.abstract || "")
    .split("{content}").join(data.content || "")
    .split("{fileName}").join(data.fileName || "");
}

const DEFAULT_PROMPT_TEMPLATE =
  "请阅读以下论文信息与内容片段，并输出结构化中文摘要：\n" +
  "- 题目：{title}\n" +
  "- 摘要：{abstract}\n" +
  "- 正文片段（可能被截断）：\n{content}\n\n" +
  "请用要点列出：研究问题、方法、数据/实验、主要结论、贡献与局限。";

const DEFAULT_REMOTE_PROMPT_TEMPLATE =
  "请仔细阅读这个 PDF 文档，输出结构化中文摘要。\n" +
  "论文题目：{title}\n" +
  "摘要：{abstract}\n\n" +
  "请用要点列出：研究问题、方法、数据/实验、主要结论、贡献与局限。\n" +
  "如果文档中包含图表，请简要描述关键图表的内容。";

/**
 * 读取文件并转换为 base64
 */
async function readFileAsBase64(filePath: string): Promise<string> {
  // 使用 Zotero 的文件 API 读取文件
  const file = Zotero.File.pathToFile(filePath);
  if (!file.exists()) {
    throw new Error(`文件不存在: ${filePath}`);
  }

  // 读取文件为 ArrayBuffer
  const data = await Zotero.File.getBinaryContentsAsync(filePath);

  // 转换为 base64
  // 在 Zotero 环境中，data 是字符串形式的二进制数据
  const bytes = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i++) {
    bytes[i] = data.charCodeAt(i);
  }

  // 使用 btoa 将二进制数据转换为 base64
  let binary = "";
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * 保存摘要结果为子笔记
 */
async function saveChildNote(
  item: Zotero.Item,
  markdown: string,
  pdfFileName: string,
  prefs: AddonPrefs,
): Promise<void> {
  const html = markdownToHTML(markdown);
  const note = new Zotero.Item("note");
  const nowStr = new Date().toLocaleString();

  const title = item.getDisplayTitle?.() ?? "";
  const headerTitle = pdfFileName
    ? `[AI 摘要] ${title} - ${pdfFileName} (${prefs.model} @ ${nowStr})`
    : `[AI 摘要] ${title} (${prefs.model} @ ${nowStr})`;
  const headerHtml = `<p><b>${escapeHtml(headerTitle)}</b></p><hr>`;

  note.parentID = item.id;
  note.setNote(headerHtml + html);
  await note.saveTx();
}

/**
 * 处理单个条目的单个 PDF
 */
async function summarizeSinglePdf(
  item: Zotero.Item,
  attachment: AttachmentInfo,
  prefs: AddonPrefs,
  onStreamChunk?: (chunk: string, isThought: boolean) => void,
): Promise<void> {
  const title = item.getDisplayTitle();
  const abstract = (item.getField("abstractNote") as string) || "";

  // 应用速率限制
  const windowMs = prefs.rateLimitWindowMinutes * 60 * 1000;
  await rateLimiter.waitForSlot(prefs.rateLimitCount, windowMs);

  let result: SummarizeResult;

  if (prefs.pdfParseMode === "remote") {
    // 远端解析模式：直接上传 PDF 文件
    const pdfBase64 = await readFileAsBase64(attachment.filePath);

    // 使用远端解析专用的提示词模板（如果用户没有自定义）
    const template = prefs.prompt?.trim() || DEFAULT_REMOTE_PROMPT_TEMPLATE;
    const prompt = buildPrompt(template, {
      title,
      abstract,
      content: "", // 远端模式下不使用本地文本
      fileName: attachment.fileName,
    });

    result = await summarizeWithRemotePdf({
      title,
      abstract,
      pdfBase64,
      prompt,
      prefs,
      onStreamChunk,
    });
  } else {
    // 本地解析模式：使用本地提取的文本
    const template = prefs.prompt?.trim() || DEFAULT_PROMPT_TEMPLATE;
    const prompt = buildPrompt(template, {
      title,
      abstract,
      content: attachment.text,
      fileName: attachment.fileName,
    });

    result = await summarize({
      title,
      abstract,
      content: attachment.text,
      prompt,
      prefs,
    });
  }

  await saveChildNote(item, result.markdown, attachment.fileName, prefs);
}

/**
 * 执行单个摘要任务（带进度显示）
 */
async function executeSummaryTask(taskData: SummaryTaskData, taskId: number): Promise<void> {
  const { item, attachment, prefs } = taskData;
  const displayName = attachment.fileName || item.getDisplayTitle();
  const status = globalTaskQueue.getStatus();

  const pw = new ztoolkit.ProgressWindow(addon.data.config.addonName)
    .createLine({
      text: `处理：${displayName}`,
      progress: 10,
    })
    .show();

  // 显示队列状态
  if (status.queued > 0) {
    pw.changeLine({
      text: `处理：${displayName} (队列中还有 ${status.queued} 个)`,
      progress: 10,
    });
  }

  // 流式输出回调
  const onStreamChunk = (chunk: string, isThought: boolean) => {
    globalTaskQueue.appendOutput(taskId, chunk, isThought);
  };

  try {
    await summarizeSinglePdf(item, attachment, prefs, onStreamChunk);
    pw.changeLine({ text: `完成：${displayName}`, progress: 100 });
  } catch (e: any) {
    pw.changeLine({
      text: `失败：${displayName} - ${e?.message || e}`,
      progress: 100,
      type: "error",
    });
    throw e; // 重新抛出以便调用方知道失败
  } finally {
    pw.startCloseTimer(2000);
  }
}

// 设置全局队列的 worker
globalTaskQueue.setWorker(executeSummaryTask);

// 设置显示名称提取函数
globalTaskQueue.setDisplayNameExtractor((data: SummaryTaskData) => {
  return data.attachment.fileName || data.item.getDisplayTitle() || "未知任务";
});

/**
 * 任务队列管理面板
 */
class TaskQueuePanel {
  private dialog: any = null;
  private dialogWindow: Window | null = null;
  private updateInterval: number | null = null;
  private eventListener: (() => void) | null = null;
  private expandedTasks: Set<number> = new Set(); // 跟踪展开的任务 ID

  /**
   * 打开或聚焦面板
   */
  open(): void {
    // 如果窗口已存在且有效，聚焦它
    if (this.dialogWindow && !this.dialogWindow.closed) {
      this.dialogWindow.focus();
      return;
    }

    this.createPanel();
  }

  /**
   * 创建面板
   */
  private createPanel(): void {
    const dialogData: Record<string, any> = {
      loadCallback: () => {
        // 设置对话框内容区域使用 flex 布局以填充可用空间
        this.applyFlexLayout();
        this.setupEventListeners();
        this.updateContent();
      },
      unloadCallback: () => {
        this.cleanup();
      },
    };

    // 创建 5 行 1 列的布局
    this.dialog = new ztoolkit.Dialog(5, 1);

    // 第 1 行：状态概览
    this.dialog.addCell(0, 0, {
      tag: "div",
      id: "queue-status",
      styles: {
        padding: "10px",
        backgroundColor: "#f5f5f5",
        borderRadius: "4px",
        marginBottom: "10px",
        fontFamily: "system-ui, sans-serif",
      },
      children: [
        {
          tag: "div",
          id: "status-text",
          properties: { innerHTML: "加载中..." },
        },
      ],
    });

    // 第 2 行：操作按钮
    this.dialog.addCell(1, 0, {
      tag: "div",
      styles: {
        display: "flex",
        gap: "8px",
        marginBottom: "10px",
      },
      children: [
        {
          tag: "button",
          properties: { innerHTML: "清空等待队列" },
          styles: {
            padding: "6px 12px",
            cursor: "pointer",
          },
          listeners: [
            {
              type: "click",
              listener: () => {
                globalTaskQueue.clear();
              },
            },
          ],
        },
        {
          tag: "button",
          properties: { innerHTML: "清空历史记录" },
          styles: {
            padding: "6px 12px",
            cursor: "pointer",
          },
          listeners: [
            {
              type: "click",
              listener: () => {
                globalTaskQueue.clearHistory();
              },
            },
          ],
        },
        {
          tag: "button",
          properties: { innerHTML: "刷新" },
          styles: {
            padding: "6px 12px",
            cursor: "pointer",
          },
          listeners: [
            {
              type: "click",
              listener: () => {
                this.updateContent();
              },
            },
          ],
        },
      ],
    });

    // 第 3 行：任务列表标题
    this.dialog.addCell(2, 0, {
      tag: "div",
      styles: {
        fontWeight: "bold",
        padding: "8px 0",
        borderBottom: "1px solid #ddd",
        fontFamily: "system-ui, sans-serif",
      },
      properties: { innerHTML: "任务列表" },
    });

    // 第 4 行：任务列表容器
    this.dialog.addCell(3, 0, {
      tag: "div",
      id: "task-list-container",
      styles: {
        flex: "1",
        minHeight: "200px",
        overflowY: "auto",
        border: "1px solid #ddd",
        borderRadius: "4px",
        fontFamily: "system-ui, sans-serif",
        fontSize: "13px",
      },
      children: [
        {
          tag: "div",
          id: "task-list",
          properties: { innerHTML: "<div style='padding: 20px; text-align: center; color: #888;'>暂无任务</div>" },
        },
      ],
    });

    // 第 5 行：底部说明
    this.dialog.addCell(4, 0, {
      tag: "div",
      styles: {
        padding: "10px 0",
        fontSize: "12px",
        color: "#666",
        fontFamily: "system-ui, sans-serif",
      },
      properties: {
        innerHTML: "提示：只能取消等待中的任务，运行中的任务无法取消",
      },
    });

    // 添加关闭按钮
    this.dialog.addButton("关闭", "close");

    // 设置对话框数据
    this.dialog.setDialogData(dialogData);

    // 打开对话框
    this.dialog.open("AI 摘要任务队列", {
      width: 500,
      height: 550,
      centerscreen: true,
      resizable: true,
      noDialogMode: true,
      alwaysRaised: false,
    });

    this.dialogWindow = this.dialog.window;
  }

  /**
   * 应用 flex 布局使内容填充可用空间
   */
  private applyFlexLayout(): void {
    if (!this.dialogWindow) return;
    const doc = this.dialogWindow.document;

    // 找到对话框的主要内容区域并应用 flex 布局
    // ztoolkit.Dialog 会创建一个 table 布局，我们需要找到它并设置样式
    const dialogBody = doc.querySelector("dialog, .dialog-body, [data-dialog-content]") as HTMLElement;
    if (dialogBody) {
      dialogBody.style.display = "flex";
      dialogBody.style.flexDirection = "column";
      dialogBody.style.height = "100%";
    }

    // 尝试找到包含任务列表的表格单元格并使其可伸缩
    const taskListContainer = doc.getElementById("task-list-container") as HTMLElement | null;
    if (taskListContainer) {
      const parentCell = taskListContainer.closest("td, .dialog-cell") as HTMLElement | null;
      if (parentCell) {
        parentCell.style.flex = "1";
        parentCell.style.display = "flex";
        parentCell.style.flexDirection = "column";
        parentCell.style.minHeight = "0";
        parentCell.style.overflow = "hidden";
      }
      // 确保容器本身可以伸缩并支持滚动
      taskListContainer.style.flex = "1";
      taskListContainer.style.minHeight = "100px";
      taskListContainer.style.maxHeight = "none";
      taskListContainer.style.height = "100%";
      taskListContainer.style.overflow = "auto";
    }

    // 设置对话框根元素的样式
    const body = doc.body;
    if (body) {
      body.style.height = "100%";
      body.style.margin = "0";
      body.style.display = "flex";
      body.style.flexDirection = "column";
    }

    // 找到表格并使其可伸缩
    const table = doc.querySelector("table") as HTMLElement;
    if (table) {
      table.style.flex = "1";
      table.style.display = "flex";
      table.style.flexDirection = "column";
      table.style.height = "100%";
      table.style.minHeight = "0";

      // 设置表格行的样式
      const rows = table.querySelectorAll("tr");
      rows.forEach((row: Element, index: number) => {
        const rowEl = row as HTMLElement;
        if (index === 3) {
          // 任务列表所在的行（第4行，索引3）- 填充剩余空间
          rowEl.style.flex = "1";
          rowEl.style.display = "flex";
          rowEl.style.flexDirection = "column";
          rowEl.style.minHeight = "0";
          rowEl.style.overflow = "hidden";

          const cell = rowEl.querySelector("td") as HTMLElement | null;
          if (cell) {
            cell.style.flex = "1";
            cell.style.display = "flex";
            cell.style.flexDirection = "column";
            cell.style.minHeight = "0";
            cell.style.height = "100%";
            cell.style.overflow = "hidden";
          }
        } else {
          // 其他行固定高度，不伸缩
          rowEl.style.flex = "0 0 auto";
          rowEl.style.height = "auto";
          rowEl.style.overflow = "visible";

          const cell = rowEl.querySelector("td") as HTMLElement | null;
          if (cell) {
            cell.style.flex = "0 0 auto";
            cell.style.height = "auto";
          }
        }
      });
    }
  }

  /**
   * 设置事件监听器
   */
  private setupEventListeners(): void {
    // 监听队列事件
    this.eventListener = () => {
      this.updateContent();
    };
    globalTaskQueue.addEventListener(this.eventListener);

    // 定时刷新运行中任务的耗时显示
    this.updateInterval = ztoolkit.getGlobal("setInterval")(() => {
      const status = globalTaskQueue.getStatus();
      if (status.running > 0) {
        this.updateContent();
      }
    }, 1000) as unknown as number;

    // 使用事件委托处理点击事件
    const taskListContainer = this.dialogWindow?.document.getElementById("task-list-container");
    if (taskListContainer) {
      taskListContainer.addEventListener("click", (e: Event) => {
        const target = e.target as HTMLElement;
        if (!target) return;

        // 检查是否点击了取消按钮
        const cancelButton = target.closest("button[data-cancel-task]") as HTMLElement;
        if (cancelButton) {
          e.stopPropagation();
          const taskId = parseInt(cancelButton.dataset.cancelTask || "0", 10);
          if (taskId) {
            globalTaskQueue.cancelTask(taskId);
          }
          return;
        }

        // 检查是否点击了任务行（展开/收起输出）
        const taskRow = target.closest("[data-toggle-task]") as HTMLElement;
        if (taskRow) {
          const taskId = parseInt(taskRow.dataset.toggleTask || "0", 10);
          if (taskId) {
            if (this.expandedTasks.has(taskId)) {
              this.expandedTasks.delete(taskId);
            } else {
              this.expandedTasks.add(taskId);
            }
            this.updateContent();
          }
        }
      });
    }
  }

  /**
   * 更新面板内容
   */
  private updateContent(): void {
    if (!this.dialogWindow || this.dialogWindow.closed) {
      return;
    }

    const doc = this.dialogWindow.document;
    const statusText = doc.getElementById("status-text");
    const taskList = doc.getElementById("task-list");

    if (!statusText || !taskList) return;

    // 更新状态
    const status = globalTaskQueue.getStatus();
    statusText.innerHTML = `
      <div style="display: flex; gap: 20px; flex-wrap: wrap;">
        <span><b>运行中:</b> ${status.running}/${status.concurrency}</span>
        <span><b>等待中:</b> ${status.queued}</span>
        <span style="color: #2e7d32;"><b>已完成:</b> ${status.completed}</span>
        <span style="color: #c62828;"><b>失败:</b> ${status.failed}</span>
      </div>
    `;

    // 更新任务列表
    const tasks = globalTaskQueue.getAllTasks();
    if (tasks.length === 0) {
      taskList.innerHTML = "<div style='padding: 20px; text-align: center; color: #888;'>暂无任务</div>";
      return;
    }

    let html = "";
    for (const task of tasks) {
      const statusInfo = this.getStatusInfo(task.status);
      const timeInfo = this.getTimeInfo(task);
      const hasOutput = task.output.length > 0 || task.thoughtOutput.length > 0;
      const isExpanded = this.expandedTasks.has(task.id);
      const isRunning = task.status === "running";

      // 任务主体
      html += `
        <div class="task-item" data-task-id="${task.id}" style="
          border-bottom: 1px solid #eee;
          ${isRunning ? "background-color: #e3f2fd;" : ""}
          ${task.status === "failed" ? "background-color: #ffebee;" : ""}
          ${task.status === "cancelled" ? "background-color: #fff3e0;" : ""}
        ">
          <div ${hasOutput ? `data-toggle-task="${task.id}"` : ""} style="
            display: flex;
            align-items: center;
            padding: 8px 12px;
            cursor: ${hasOutput ? "pointer" : "default"};
          ">
            <span style="
              display: inline-block;
              width: 8px;
              height: 8px;
              border-radius: 50%;
              background-color: ${statusInfo.color};
              margin-right: 10px;
              flex-shrink: 0;
              ${isRunning ? "animation: pulse 1s infinite;" : ""}
            "></span>
            <div style="flex: 1; min-width: 0; overflow: hidden;">
              <div style="
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
                font-weight: ${isRunning ? "bold" : "normal"};
              " title="${this.escapeHtml(task.displayName)}">
                ${this.escapeHtml(task.displayName)}
              </div>
              <div style="font-size: 11px; color: #666; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                ${statusInfo.text}${timeInfo}
                ${hasOutput ? ` · <span style="color: #1976d2; cursor: pointer;">${isExpanded ? "▼ 收起" : "▶ 展开输出"}</span>` : ""}
                ${task.error ? ` - <span style="color: #c62828;">${this.escapeHtml(task.error.substring(0, 50))}${task.error.length > 50 ? "..." : ""}</span>` : ""}
              </div>
            </div>
            ${task.status === "pending" ? `
              <button
                data-cancel-task="${task.id}"
                style="
                  padding: 4px 8px;
                  font-size: 12px;
                  cursor: pointer;
                  margin-left: 8px;
                  flex-shrink: 0;
                "
              >取消</button>
            ` : ""}
          </div>
          ${this.renderOutputArea(task, isExpanded, isRunning)}
        </div>
      `;
    }

    // 添加动画样式
    const styleId = "queue-panel-styles";
    if (!doc.getElementById(styleId) && doc.head) {
      const style = doc.createElement("style");
      style.id = styleId;
      style.textContent = `
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
        .output-preview {
          font-family: Consolas, Monaco, monospace;
          font-size: 11px;
          line-height: 1.4;
          white-space: pre-wrap;
          word-break: break-all;
        }
        .output-expanded {
          max-height: 300px;
          overflow-y: auto;
        }
        .output-collapsed {
          max-height: 60px;
          overflow: hidden;
        }
        .task-item:hover {
          background-color: #f5f5f5;
        }
        [data-toggle-task]:hover {
          background-color: rgba(0,0,0,0.02);
        }
      `;
      doc.head.appendChild(style);
    }

    taskList.innerHTML = html;

    // 对于运行中的任务，滚动输出区域到底部
    for (const task of tasks) {
      if (task.status === "running" || this.expandedTasks.has(task.id)) {
        const outputEl = doc.getElementById(`output-${task.id}`);
        if (outputEl) {
          outputEl.scrollTop = outputEl.scrollHeight;
        }
      }
    }
  }

  /**
   * 渲染输出区域
   */
  private renderOutputArea(task: TaskInfo, isExpanded: boolean, isRunning: boolean): string {
    const hasOutput = task.output.length > 0 || task.thoughtOutput.length > 0;
    if (!hasOutput) return "";

    // 运行中的任务默认显示最后几行，可展开查看全部
    // 已完成的任务默认收起，点击展开查看
    const showOutput = isRunning || isExpanded;
    if (!showOutput && !isRunning) {
      return "";
    }

    const output = task.output || "";
    const thoughtOutput = task.thoughtOutput || "";

    // 获取显示内容
    let displayContent = "";

    // 如果有思考输出，显示思考标签
    if (thoughtOutput) {
      const thoughtLines = thoughtOutput.split("\n");
      const thoughtPreview = isExpanded
        ? thoughtOutput
        : thoughtLines.slice(-3).join("\n");
      displayContent += `<div style="color: #7c4dff; margin-bottom: 4px;"><b>[思考过程]</b></div>`;
      displayContent += `<div style="color: #666; margin-bottom: 8px;">${this.escapeHtml(thoughtPreview)}</div>`;
    }

    // 显示主输出
    if (output) {
      const outputLines = output.split("\n");
      const outputPreview = isExpanded
        ? output
        : outputLines.slice(-3).join("\n");

      if (thoughtOutput) {
        displayContent += `<div style="color: #1976d2; margin-bottom: 4px;"><b>[输出]</b></div>`;
      }
      displayContent += this.escapeHtml(outputPreview);
    }

    return `
      <div
        id="output-${task.id}"
        class="output-preview ${isExpanded ? "output-expanded" : "output-collapsed"}"
        style="
          margin: 0 12px 8px 30px;
          padding: 8px;
          background-color: ${isRunning ? "#f8f9fa" : "#fafafa"};
          border-radius: 4px;
          border-left: 3px solid ${isRunning ? "#2196f3" : "#ddd"};
        "
      >${displayContent}</div>
    `;
  }

  /**
   * 获取状态信息
   */
  private getStatusInfo(status: TaskStatus): { text: string; color: string } {
    switch (status) {
      case "pending":
        return { text: "等待中", color: "#ffc107" };
      case "running":
        return { text: "运行中", color: "#2196f3" };
      case "completed":
        return { text: "已完成", color: "#4caf50" };
      case "failed":
        return { text: "失败", color: "#f44336" };
      case "cancelled":
        return { text: "已取消", color: "#ff9800" };
      default:
        return { text: "未知", color: "#9e9e9e" };
    }
  }

  /**
   * 获取时间信息
   */
  private getTimeInfo(task: TaskInfo): string {
    if (task.startTime && task.endTime) {
      const duration = Math.round((task.endTime - task.startTime) / 1000);
      return ` (${duration}秒)`;
    }
    if (task.startTime) {
      const elapsed = Math.round((Date.now() - task.startTime) / 1000);
      return ` (${elapsed}秒...)`;
    }
    return "";
  }

  /**
   * HTML 转义
   */
  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  /**
   * 清理资源
   */
  private cleanup(): void {
    if (this.updateInterval) {
      ztoolkit.getGlobal("clearInterval")(this.updateInterval);
      this.updateInterval = null;
    }
    if (this.eventListener) {
      globalTaskQueue.removeEventListener(this.eventListener);
      this.eventListener = null;
    }
    this.dialogWindow = null;
    this.dialog = null;
  }

  /**
   * 关闭面板
   */
  close(): void {
    if (this.dialogWindow && !this.dialogWindow.closed) {
      this.dialogWindow.close();
    }
    this.cleanup();
  }
}

// 全局面板实例
const taskQueuePanel = new TaskQueuePanel();

/**
 * AI 摘要模块
 */
export class AISummaryModule {
  /**
   * 注册右键菜单
   */
  static registerContextMenu(): void {
    // AI 总结菜单项
    ztoolkit.Menu.register("item", {
      tag: "menuitem",
      id: `zotero-itemmenu-${addon.data.config.addonRef}-ai-summarize`,
      label: "AI 总结到子笔记",
      commandListener: async () => {
        try {
          await AISummaryModule.summarizeSelected();
        } catch (e: any) {
          ztoolkit.getGlobal("alert")(`AI 总结失败：${e?.message || e}`);
        }
      },
    });

    // 任务队列菜单项
    ztoolkit.Menu.register("item", {
      tag: "menuitem",
      id: `zotero-itemmenu-${addon.data.config.addonRef}-task-queue`,
      label: "查看 AI 任务队列",
      commandListener: () => {
        AISummaryModule.openTaskQueuePanel();
      },
    });
  }

  /**
   * 打开任务队列面板
   */
  static openTaskQueuePanel(): void {
    taskQueuePanel.open();
  }

  /**
   * 处理选中的条目
   */
  static async summarizeSelected(): Promise<void> {
    const prefs = getPrefs();
    const pane = ztoolkit.getGlobal("ZoteroPane");
    const selectedItems = pane.getSelectedItems() as Zotero.Item[];

    // 收集要处理的任务
    const tasks: Array<{ item: Zotero.Item; attachment: AttachmentInfo }> = [];
    // 记录直接选中的 PDF 附件 ID
    const selectedAttachmentIds = new Set<number>();
    // 记录选中的常规条目
    const selectedRegularItems: Zotero.Item[] = [];

    // 第一遍：分类选中的项目
    for (const item of selectedItems) {
      if (item.isRegularItem()) {
        selectedRegularItems.push(item);
      } else if (item.isAttachment()) {
        selectedAttachmentIds.add(item.id);
      }
    }

    // 处理直接选中的 PDF 附件
    for (const item of selectedItems) {
      if (item.isAttachment() && selectedAttachmentIds.has(item.id)) {
        const contentType =
          (item.getField?.("contentType") as string) ||
          ((item as any).attachmentContentType as string | undefined) ||
          "";

        if (!contentType.includes("application/pdf")) {
          continue;
        }

        const getFilePath = (item as any).getFilePath || item.getFilePath;
        const filePath = getFilePath ? getFilePath.call(item) : "";
        const fileName = filePath ? filePath.split(/[/\\]/).pop() ?? "" : "";

        if (!shouldProcessFile(fileName, prefs.attachmentFilter)) {
          continue;
        }

        // 根据解析模式决定是否需要获取文本
        let text = "";
        if (prefs.pdfParseMode === "local") {
          try {
            const txt = await (item as any).attachmentText;
            if (txt) {
              const fullText = String(txt);
              text = fullText.length > prefs.maxChars
                ? fullText.slice(0, prefs.maxChars)
                : fullText;
            }
          } catch (e) {
            // 本地模式下无法获取文本则跳过
            continue;
          }
          if (!text) {
            continue;
          }
        }

        const parentID = item.parentItemID;
        const parent = parentID
          ? (Zotero.Items.get(parentID) as Zotero.Item)
          : item;

        tasks.push({
          item: parent,
          attachment: { item, fileName, filePath, text },
        });
      }
    }

    // 处理选中的常规条目（获取其所有 PDF）
    for (const item of selectedRegularItems) {
      const attachments = await getEligibleAttachments(item, prefs);
      for (const att of attachments) {
        // 避免重复：如果这个 PDF 已经被直接选中处理过，跳过
        if (!selectedAttachmentIds.has(att.item.id)) {
          tasks.push({ item, attachment: att });
        }
      }
    }

    if (!tasks.length) {
      const modeHint = prefs.pdfParseMode === "local"
        ? "2. PDF 已被 Zotero 索引（有全文内容）\n"
        : "2. PDF 文件存在于本地\n";
      ztoolkit.getGlobal("alert")(
        "未找到符合条件的 PDF 附件。\n" +
        "请确保：\n" +
        "1. 条目有 PDF 附件\n" +
        modeHint +
        "3. 文件名符合过滤规则",
      );
      return;
    }

    // 更新全局队列的并发数
    globalTaskQueue.setConcurrency(prefs.concurrency);

    // 显示队列状态
    const currentStatus = globalTaskQueue.getStatus();
    const totalPending = currentStatus.queued + tasks.length;
    if (currentStatus.running > 0 || currentStatus.queued > 0) {
      // 已有任务在运行，显示提示
      const pw = new ztoolkit.ProgressWindow(addon.data.config.addonName)
        .createLine({
          text: `已添加 ${tasks.length} 个任务到队列 (当前队列: ${totalPending} 待处理, ${currentStatus.running} 运行中)`,
          progress: 100,
        })
        .show();
      pw.startCloseTimer(3000);
    }

    // 将任务提交到全局队列
    const taskDataList: SummaryTaskData[] = tasks.map(task => ({
      item: task.item,
      attachment: task.attachment,
      prefs,
    }));

    // 提交所有任务（不等待完成，任务会在后台按队列执行）
    const promises = globalTaskQueue.submitBatch(taskDataList);

    // 等待所有任务完成（这些任务可能与其他调用的任务交错执行）
    await Promise.allSettled(promises);
  }

  /**
   * 测试 API 连接
   */
  static async testAPI(): Promise<void> {
    const prefs = getPrefs();
    try {
      const response = await testAPI(prefs);
      ztoolkit.getGlobal("alert")(`连接成功：${response}`);
    } catch (e: any) {
      ztoolkit.getGlobal("alert")(`连接失败：${e?.message || e}`);
    }
  }
}
