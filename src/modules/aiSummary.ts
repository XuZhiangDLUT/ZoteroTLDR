import { marked } from "marked";
import { getPrefs, type AddonPrefs } from "../utils/prefs";
import {
  summarize,
  summarizeWithRemotePdf,
  testAPI,
  type SummarizeResult,
} from "../llm/providers";

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
    this.timestamps = this.timestamps.filter((t) => now - t < windowMs);

    if (this.timestamps.length >= maxRequests) {
      // 计算需要等待的时间
      const oldestTimestamp = this.timestamps[0];
      const waitTime = oldestTimestamp + windowMs - now + 100; // 额外100ms缓冲
      if (waitTime > 0) {
        await new Promise((resolve) => setTimeout(resolve, waitTime));
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
  private maxCompletedHistory = 1000; // 最多保留的已完成任务历史

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
  getStatus(): {
    queued: number;
    running: number;
    concurrency: number;
    completed: number;
    failed: number;
  } {
    const completed = this.completedTasks.filter(
      (t) => t.status === "completed",
    ).length;
    const failed = this.completedTasks.filter(
      (t) => t.status === "failed" || t.status === "cancelled",
    ).length;
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
   * 是否存在“等待中/运行中”的任务满足条件
   * 用于避免重复提交同一个任务（例如同一 PDF 被重复右键触发）
   */
  hasActiveTask(match: (data: T) => boolean): boolean {
    for (const task of this.queue) {
      if (task.status === "pending" && match(task.data)) return true;
    }
    for (const task of this.runningTasks.values()) {
      if (task.status === "running" && match(task.data)) return true;
    }
    return false;
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
    return items.map((item) => this.submit(item));
  }

  /**
   * 取消指定任务（只能取消等待中的任务）
   */
  cancelTask(taskId: number): boolean {
    const index = this.queue.findIndex((t) => t.id === taskId);
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
 * 安全关闭进度窗计时器，避免窗口已被销毁时抛出 NS_ERROR_NOT_INITIALIZED
 */
function safeStartCloseTimer(pw: any, delayMs: number): void {
  try {
    if (!pw || typeof pw.startCloseTimer !== "function") return;
    const win = (pw as any).win || (pw as any).window;
    if (win && win.closed) return;
    pw.startCloseTimer(delayMs);
  } catch (e) {
    try {
      ztoolkit.log("safeStartCloseTimer error", e);
    } catch (_ignored) {
      // ignore logging errors
    }
  }
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
  const andGroups = filterRule
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);

  for (const group of andGroups) {
    // 按逗号分割为 OR 规则
    const orRules = group
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

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
 * 获取文件大小（字节）
 */
async function getFileSize(filePath: string): Promise<number> {
  try {
    const file = Zotero.File.pathToFile(filePath);
    if (file.exists()) {
      return file.fileSize;
    }
  } catch (_e) {
    // 忽略错误
  }
  return 0;
}

/**
 * 获取 PDF 页数
 *
 * 说明：
 * - 优先读取 Zotero 数据库（fulltextItems.totalPages / fulltextItems.indexedPages）
 * - 其次尝试 pdf.js（如果可用）
 * - 最后回退到解析 PDF Header 中的 /Count N（对部分压缩/对象流 PDF 可能无效）
 */
async function getPdfPageCount(
  attachment: Zotero.Item,
  filePath: string,
): Promise<number | null> {
  const toPositiveInt = (value: unknown): number | null => {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? Math.trunc(n) : null;
  };

  const binaryStringToUint8Array = (binStr: string): Uint8Array => {
    const bytes = new Uint8Array(binStr.length);
    for (let i = 0; i < binStr.length; i++) {
      bytes[i] = binStr.charCodeAt(i) & 0xff;
    }
    return bytes;
  };

  // 方法 1: 读取 Zotero 数据库（最快、最稳定，Zotero UI 显示页数通常也来自这里）
  try {
    const db = (Zotero as any).DB;
    const query = db?.queryAsync || db?.query;
    if (query) {
      const rows = await query.call(
        db,
        "SELECT totalPages, indexedPages FROM fulltextItems WHERE itemID = ?",
        [attachment.id],
      );
      const row = rows?.[0];
      const totalPages = toPositiveInt(row?.totalPages);
      if (totalPages !== null) {
        return totalPages;
      }
      const indexedPages = toPositiveInt(row?.indexedPages);
      if (indexedPages !== null) {
        return indexedPages;
      }
    }
  } catch (e) {
    ztoolkit.log("getPdfPageCount: DB query error:", e);
  }

  // 方法 2: 尝试使用 pdf.js（如果可用）
  try {
    const pdfjsLib = (Zotero as any).PDFWorker?.pdfjsLib;
    if (pdfjsLib) {
      const bin = await Zotero.File.getBinaryContentsAsync(filePath);
      const data = binaryStringToUint8Array(bin);
      const loadingTask = pdfjsLib.getDocument({
        data,
        stopAtErrors: false,
        enableXfa: false,
      });
      const pdf = await loadingTask.promise;
      const numPages = pdf.numPages;
      pdf.destroy();
      return numPages;
    }
  } catch (e) {
    ztoolkit.log("getPdfPageCount: pdfjsLib error:", e);
  }

  // 方法 3: 解析 PDF 文件头获取页数（后备方案）
  try {
    const content = await Zotero.File.getBinaryContentsAsync(filePath);
    // PDF 中页数通常在 /Count N 格式中，找最大的 Count 值
    const countMatches = content.match(/\/Count\s+(\d+)/g);
    if (countMatches && countMatches.length > 0) {
      let maxCount = 0;
      for (const match of countMatches) {
        const num = parseInt(match.replace(/\/Count\s+/, ""), 10);
        if (num > maxCount) maxCount = num;
      }
      if (maxCount > 0) {
        return maxCount;
      }
    }
  } catch (e) {
    ztoolkit.log("getPdfPageCount: header parse error:", e);
  }

  return null;
}

/**
 * 检查父条目下是否已存在指定 PDF 的 AI 摘要笔记
 * 通过解析笔记标题中的 PDF 文件名来判断
 * 格式: [AI 摘要] Title - filename.pdf (model @ timestamp)
 */
function hasExistingSummary(
  parentItem: Zotero.Item,
  pdfFileName: string,
): boolean {
  try {
    // 获取父条目的所有子笔记
    const noteIDs = parentItem.getNotes ? parentItem.getNotes() : [];

    for (const noteID of noteIDs) {
      const note = Zotero.Items.get(noteID) as Zotero.Item;
      if (!note) continue;

      // 获取笔记内容
      const noteContent = note.getNote ? note.getNote() : "";
      if (!noteContent) continue;

      // 检查是否是 AI 摘要笔记（以 [AI 摘要] 开头）
      if (!noteContent.includes("[AI 摘要]")) continue;

      // 提取笔记标题（第一行）
      // 格式: <p><b>[AI 摘要] Title - filename.pdf (model @ timestamp)</b></p>
      const titleMatch = noteContent.match(/<p><b>\[AI 摘要\][^<]*<\/b><\/p>/);
      if (!titleMatch) continue;

      const titleText = titleMatch[0];

      // 检查标题中是否包含当前 PDF 文件名
      // 需要转义特殊字符进行匹配
      const escapedFileName = pdfFileName.replace(
        /[.*+?^${}()|[\]\\]/g,
        "\\$&",
      );
      const fileNameRegex = new RegExp(escapedFileName, "i");

      if (fileNameRegex.test(titleText)) {
        return true;
      }
    }

    return false;
  } catch (_e) {
    return false;
  }
}

/**
 * 附件信息
 */
interface AttachmentInfo {
  item: Zotero.Item;
  fileName: string;
  filePath: string; // PDF 文件完整路径（用于远端解析）
  text: string; // 本地提取的文本（用于本地解析）
  fileSize: number; // 文件大小（字节）
  pageCount: number | null; // PDF 页数
}

/**
 * 获取条目的所有符合条件的 PDF 附件及其信息
 */
async function getEligibleAttachments(
  item: Zotero.Item,
  prefs: AddonPrefs,
): Promise<{
  attachments: AttachmentInfo[];
  skipped: { fileName: string; reason: string }[];
}> {
  const attIDs = item.getAttachments ? item.getAttachments() : [];
  const results: AttachmentInfo[] = [];
  const skipped: { fileName: string; reason: string }[] = [];

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
    const fileName = filePath ? (filePath.split(/[\\/]/).pop() ?? "") : "";

    // 检查是否符合过滤规则
    if (!shouldProcessFile(fileName, prefs.attachmentFilter)) {
      continue;
    }

    // 检查是否已存在 AI 摘要
    if (prefs.skipExistingSummary && hasExistingSummary(item, fileName)) {
      skipped.push({
        fileName,
        reason: "已存在 AI 摘要",
      });
      continue;
    }

    // 检查文件大小
    const fileSize = await getFileSize(filePath);
    if (prefs.maxFileSizeMB > 0) {
      const maxBytes = prefs.maxFileSizeMB * 1024 * 1024;
      if (fileSize > maxBytes) {
        const sizeMB = (fileSize / 1024 / 1024).toFixed(1);
        skipped.push({
          fileName,
          reason: `文件过大 (${sizeMB}MB > ${prefs.maxFileSizeMB}MB)`,
        });
        continue;
      }
    }

    // 检查 PDF 页数
    let pageCount: number | null = null;
    if (prefs.maxPageCount > 0) {
      pageCount = await getPdfPageCount(att, filePath);
      if (pageCount === null) {
        skipped.push({
          fileName,
          reason: `无法获取页数 (已设置页数限制 ${prefs.maxPageCount}页)`,
        });
        continue;
      }
      if (pageCount > prefs.maxPageCount) {
        skipped.push({
          fileName,
          reason: `页数过多 (${pageCount}页 > ${prefs.maxPageCount}页)`,
        });
        continue;
      }
    }

    // 根据解析模式决定是否需要提取本地文本
    let text = "";
    if (prefs.pdfParseMode === "local") {
      try {
        const txt = await (att as any).attachmentText;
        if (txt) {
          const fullText = String(txt);
          text =
            fullText.length > prefs.maxChars
              ? fullText.slice(0, prefs.maxChars)
              : fullText;
        }
      } catch (_e) {
        // 本地解析模式下，无法获取文本则跳过
        skipped.push({ fileName, reason: "无法提取文本" });
        continue;
      }
      // 本地模式下，没有文本则跳过
      if (!text) {
        skipped.push({ fileName, reason: "文本为空" });
        continue;
      }
    }

    results.push({
      item: att,
      fileName,
      filePath,
      text,
      fileSize,
      pageCount,
    });
  }

  return { attachments: results, skipped };
}

/**
 * 构建提示词，替换模板变量
 */
function buildPrompt(
  template: string,
  data: { title: string; abstract: string; content: string; fileName?: string },
): string {
  return template
    .split("{title}")
    .join(data.title || "")
    .split("{abstract}")
    .join(data.abstract || "")
    .split("{content}")
    .join(data.content || "")
    .split("{fileName}")
    .join(data.fileName || "");
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
 * 带 524 重试的远端 PDF 摘要
 */
async function summarizeWithRemotePdfWithRetry(
  opts: Parameters<typeof summarizeWithRemotePdf>[0] & { prefs: AddonPrefs },
): Promise<SummarizeResult> {
  const { prefs, onStreamChunk, ...restOpts } = opts;
  const maxRetries = prefs.retryOn524;
  let lastError: Error | null = null;
  const isTransientStreamError = (msg: string): boolean => {
    const lowered = msg.toLowerCase();
    return (
      lowered.includes("error in input stream") ||
      lowered.includes("network error") ||
      lowered.includes("econnreset")
    );
  };

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await summarizeWithRemotePdf({
        ...restOpts,
        prefs,
        onStreamChunk,
      });
    } catch (e: any) {
      const errorMsg = e?.message || String(e);

      const shouldRetry =
        errorMsg.includes("524") || isTransientStreamError(errorMsg);

      // 如果是 524 或常见流错误且还有重试次数
      if (shouldRetry && attempt < maxRetries) {
        const retryNum = attempt + 1;
        const delayMs = Math.min(10000, 2000 * 2 ** attempt); // 指数退避，封顶 10s
        const reasonText = errorMsg.includes("524")
          ? "524 超时错误"
          : "流式连接中断 (input stream/network)";
        onStreamChunk?.(
          `\n[${reasonText}，正在进行第 ${retryNum}/${maxRetries} 次重试，等待 ${Math.round(delayMs / 1000)}s...]\n`,
          false,
        );
        lastError = e;
        // 等待一小段时间后重试
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        continue;
      }

      // 其他错误或重试次数用完，直接抛出
      throw e;
    }
  }

  // 不应该到达这里，但为了类型安全
  throw lastError || new Error("未知错误");
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
  let usedLocalFallback = false;

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

    try {
      result = await summarizeWithRemotePdfWithRetry({
        title,
        abstract,
        pdfBase64,
        prompt,
        prefs,
        onStreamChunk,
      });
    } catch (e: any) {
      // 检查是否是 413 错误（请求体过大），自动降级到本地模式
      const errorMsg = e?.message || String(e);
      if (errorMsg.includes("413")) {
        onStreamChunk?.(
          "\n[413 错误：PDF 过大，自动切换到本地解析模式...]\n",
          false,
        );

        // 尝试获取本地文本
        let localText = attachment.text;
        if (!localText) {
          try {
            const txt = await (attachment.item as any).attachmentText;
            if (txt) {
              const fullText = String(txt);
              localText =
                fullText.length > prefs.maxChars
                  ? fullText.slice(0, prefs.maxChars)
                  : fullText;
            }
          } catch (_e) {
            throw new Error(
              "413 错误且无法获取本地文本，请手动切换到本地解析模式",
            );
          }
        }

        if (!localText) {
          throw new Error(
            "413 错误且本地文本为空，请确保 PDF 已被 Zotero 索引",
          );
        }

        // 使用本地文本重试
        const localTemplate = prefs.prompt?.trim() || DEFAULT_PROMPT_TEMPLATE;
        const localPrompt = buildPrompt(localTemplate, {
          title,
          abstract,
          content: localText,
          fileName: attachment.fileName,
        });

        result = await summarize({
          title,
          abstract,
          content: localText,
          prompt: localPrompt,
          prefs,
        });
        usedLocalFallback = true;
      } else {
        // 其他错误直接抛出
        throw e;
      }
    }
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

  // 如果使用了 fallback，在结果中添加说明
  const finalMarkdown = usedLocalFallback
    ? `> ⚠️ 注意：由于 PDF 文件过大，已自动切换到本地解析模式\n\n${result.markdown}`
    : result.markdown;

  await saveChildNote(item, finalMarkdown, attachment.fileName, prefs);
}

/**
 * 执行单个摘要任务（带进度显示）
 */
async function executeSummaryTask(
  taskData: SummaryTaskData,
  taskId: number,
): Promise<void> {
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
    safeStartCloseTimer(pw, 2000);
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
  private expandedThoughtTasks: Set<number> = new Set(); // 跟踪展开“思考过程”的任务 ID
  private expandedOutputTasks: Set<number> = new Set(); // 跟踪展开“输出”的任务 ID
  private expandedErrorTasks: Set<number> = new Set(); // 跟踪展开“错误”的任务 ID

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
          properties: {
            innerHTML:
              "<div style='padding: 20px; text-align: center; color: #888;'>暂无任务</div>",
          },
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
      width: 600,
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
    const dialogBody = doc.querySelector(
      "dialog, .dialog-body, [data-dialog-content]",
    ) as HTMLElement;
    if (dialogBody) {
      dialogBody.style.display = "flex";
      dialogBody.style.flexDirection = "column";
      dialogBody.style.height = "100%";
    }

    // 尝试找到包含任务列表的表格单元格并使其可伸缩
    const taskListContainer = doc.getElementById(
      "task-list-container",
    ) as HTMLElement | null;
    if (taskListContainer) {
      const parentCell = taskListContainer.closest(
        "td, .dialog-cell",
      ) as HTMLElement | null;
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
    const taskListContainer = this.dialogWindow?.document.getElementById(
      "task-list-container",
    );
    if (taskListContainer) {
      taskListContainer.addEventListener("click", (e: Event) => {
        const target = e.target as HTMLElement;
        if (!target) return;

        // 检查是否点击了取消按钮
        const cancelButton = target.closest(
          "button[data-cancel-task]",
        ) as HTMLElement;
        if (cancelButton) {
          e.stopPropagation();
          const taskId = parseInt(cancelButton.dataset.cancelTask || "0", 10);
          if (taskId) {
            globalTaskQueue.cancelTask(taskId);
          }
          return;
        }

        // 展开/收起思考过程
        const thoughtToggle = target.closest(
          "[data-toggle-thought]",
        ) as HTMLElement;
        if (thoughtToggle) {
          const taskId = parseInt(
            thoughtToggle.dataset.toggleThought || "0",
            10,
          );
          if (taskId) {
            if (this.expandedThoughtTasks.has(taskId)) {
              this.expandedThoughtTasks.delete(taskId);
            } else {
              this.expandedThoughtTasks.add(taskId);
            }
            this.updateContent();
          }
          return;
        }

        // 展开/收起输出
        const outputToggle = target.closest(
          "[data-toggle-output]",
        ) as HTMLElement;
        if (outputToggle) {
          const taskId = parseInt(outputToggle.dataset.toggleOutput || "0", 10);
          if (taskId) {
            if (this.expandedOutputTasks.has(taskId)) {
              this.expandedOutputTasks.delete(taskId);
            } else {
              this.expandedOutputTasks.add(taskId);
            }
            this.updateContent();
          }
          return;
        }

        // 展开/收起错误
        const errorToggle = target.closest(
          "[data-toggle-error]",
        ) as HTMLElement;
        if (errorToggle) {
          const taskId = parseInt(errorToggle.dataset.toggleError || "0", 10);
          if (taskId) {
            if (this.expandedErrorTasks.has(taskId)) {
              this.expandedErrorTasks.delete(taskId);
            } else {
              this.expandedErrorTasks.add(taskId);
            }
            this.updateContent();
          }
          return;
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
      taskList.innerHTML =
        "<div style='padding: 20px; text-align: center; color: #888;'>暂无任务</div>";
      return;
    }

    let html = "";
    for (const task of tasks) {
      const statusInfo = this.getStatusInfo(task.status);
      const timeInfo = this.getTimeInfo(task);
      const hasThought = task.thoughtOutput.length > 0;
      const hasOutput = task.output.length > 0;
      const hasError = Boolean(task.error);
      const isThoughtExpanded = this.expandedThoughtTasks.has(task.id);
      const isOutputExpanded = this.expandedOutputTasks.has(task.id);
      const isErrorExpanded = this.expandedErrorTasks.has(task.id);
      const isRunning = task.status === "running";
      const errorInline =
        hasError && task.error
          ? task.error.replace(/\s+/g, " ").trim().slice(0, 160) +
            (task.error.replace(/\s+/g, " ").trim().length > 160 ? "…" : "")
          : "";

      // 任务主体
      html += `
        <div class="task-item" data-task-id="${task.id}" style="
          border-bottom: 1px solid #eee;
          ${isRunning ? "background-color: #e3f2fd;" : ""}
          ${task.status === "failed" ? "background-color: #ffebee;" : ""}
          ${task.status === "cancelled" ? "background-color: #fff3e0;" : ""}
        ">
          <div style="
            display: flex;
            align-items: center;
            padding: 8px 12px;
            cursor: default;
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
            <div style="flex: 1; min-width: 0; overflow: hidden; max-width: 480px;">
              <div style="
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
                font-weight: ${isRunning ? "bold" : "normal"};
                max-width: 100%;
              " title="${this.escapeHtml(task.displayName)}">
                ${this.escapeHtml(task.displayName)}
              </div>
              <div style="font-size: 11px; color: #666; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%;">
                ${statusInfo.text}${timeInfo}
                ${hasThought ? ` · <span data-toggle-thought="${task.id}" style="color: #7c4dff; cursor: pointer;">${isThoughtExpanded ? "▼ 收起思考" : "▶ 展开思考"}</span>` : ""}
                ${hasOutput ? ` · <span data-toggle-output="${task.id}" style="color: #1976d2; cursor: pointer;">${isOutputExpanded ? "▼ 收起输出" : "▶ 展开输出"}</span>` : ""}
                ${hasError ? ` · <span data-toggle-error="${task.id}" style="color: #c62828; cursor: pointer;">${isErrorExpanded ? "▼ 收起错误" : "▶ 展开错误"}</span>` : ""}
              </div>
              ${hasError ? `<div style="font-size: 11px; color: #c62828; margin-top: 2px; white-space: normal; word-break: break-word;">${this.escapeHtml(errorInline)}</div>` : ""}
            </div>
            ${
              task.status === "pending"
                ? `
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
            `
                : ""
            }
          </div>
          ${this.renderTaskDetails(task, isThoughtExpanded, isOutputExpanded, isErrorExpanded, isRunning)}
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
      const isThoughtExpanded = this.expandedThoughtTasks.has(task.id);
      const isOutputExpanded = this.expandedOutputTasks.has(task.id);

      if (task.status === "running" || isThoughtExpanded) {
        const thoughtEl = doc.getElementById(`thought-${task.id}`);
        if (thoughtEl) {
          thoughtEl.scrollTop = thoughtEl.scrollHeight;
        }
      }
      if (task.status === "running" || isOutputExpanded) {
        const outputEl = doc.getElementById(`output-${task.id}`);
        if (outputEl) {
          outputEl.scrollTop = outputEl.scrollHeight;
        }
      }
    }
  }

  /**
   * 渲染思考/输出区域
   */
  private renderTaskDetails(
    task: TaskInfo,
    isThoughtExpanded: boolean,
    isOutputExpanded: boolean,
    isErrorExpanded: boolean,
    isRunning: boolean,
  ): string {
    const thoughtOutput = task.thoughtOutput || "";
    const output = task.output || "";
    const errorText = task.error || "";

    const showThought =
      thoughtOutput.length > 0 && (isRunning || isThoughtExpanded);
    const showOutput = output.length > 0 && (isRunning || isOutputExpanded);
    const showError = errorText.length > 0 && isErrorExpanded;

    if (!showThought && !showOutput && !showError) return "";

    const bg = isRunning ? "#f8f9fa" : "#fafafa";
    let html = "";

    if (showThought) {
      const preview = this.buildStreamPreview(
        thoughtOutput,
        isThoughtExpanded,
        3,
      );
      const header = isThoughtExpanded
        ? `<div style="color: #7c4dff; margin-bottom: 4px;"><b>[思考过程]</b></div>`
        : "";
      html += `
        <div
          id="thought-${task.id}"
          class="output-preview ${isThoughtExpanded ? "output-expanded" : "output-collapsed"}"
          style="
            margin: 0 12px 8px 30px;
            padding: 8px;
            background-color: ${bg};
            border-radius: 4px;
            border-left: 3px solid #7c4dff;
          "
        >
          ${header}
          <div style="color: #666;">${this.escapeHtml(preview)}</div>
        </div>
      `;
    }

    if (showOutput) {
      const preview = this.buildStreamPreview(output, isOutputExpanded, 3);
      html += `
        <div
          id="output-${task.id}"
          class="output-preview ${isOutputExpanded ? "output-expanded" : "output-collapsed"}"
          style="
            margin: 0 12px 8px 30px;
            padding: 8px;
            background-color: ${bg};
            border-radius: 4px;
            border-left: 3px solid ${isRunning ? "#2196f3" : "#ddd"};
          "
        >${this.escapeHtml(preview)}</div>
      `;
    }

    if (showError) {
      html += `
        <div
          id="error-${task.id}"
          class="output-preview output-expanded"
          style="
            margin: 0 12px 8px 30px;
            padding: 8px;
            background-color: #fff5f5;
            border-radius: 4px;
            border-left: 3px solid #c62828;
          "
        >
          <div style="color: #c62828; margin-bottom: 4px;"><b>[错误信息]</b></div>
          <div style="color: #8e0000;">${this.escapeHtml(errorText)}</div>
        </div>
      `;
    }

    return html;
  }

  /**
   * 构建流式预览文本
   * - 默认取最后 N 行（按 \n 分割）
   * - 若换行太少（尤其是单行不断追加），则改为取最后 N 行 * 固定字符数 的尾部窗口
   *   并手动插入换行，保证在折叠态也能看到“尾部”实时更新
   */
  private buildStreamPreview(
    text: string,
    expanded: boolean,
    maxLines: number,
  ): string {
    const normalized = (text || "").replace(/\r\n/g, "\n");
    if (expanded) return normalized;

    const trimmed = normalized.replace(/\s+$/, "");
    if (!trimmed) return "";

    // 先按真实换行取最后 N 行（去掉末尾空行，避免预览出现空白）
    const lines = trimmed.split("\n");
    while (lines.length > 0 && lines[lines.length - 1] === "") {
      lines.pop();
    }
    if (lines.length >= maxLines) {
      return lines.slice(-maxLines).join("\n");
    }

    // 换行不足时：用尾部窗口 + 固定宽度分段，模拟“最后 N 行”
    const approxCharsPerLine = 80;
    const maxChars = approxCharsPerLine * maxLines;
    const tail = trimmed.length > maxChars ? trimmed.slice(-maxChars) : trimmed;

    const chunks: string[] = [];
    for (let end = tail.length; end > 0; end -= approxCharsPerLine) {
      const start = Math.max(0, end - approxCharsPerLine);
      chunks.unshift(tail.slice(start, end));
    }

    if (trimmed.length > maxChars && chunks.length > 0) {
      chunks[0] = "…" + chunks[0];
    }

    return chunks.slice(-maxLines).join("\n");
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
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
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
    // 记录跳过的文件
    const allSkipped: { fileName: string; reason: string }[] = [];

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
        const fileName = filePath ? (filePath.split(/[/\\]/).pop() ?? "") : "";

        if (!shouldProcessFile(fileName, prefs.attachmentFilter)) {
          continue;
        }

        // 获取父条目（用于检查已存在摘要）
        const parentID = item.parentItemID;
        const parent = parentID
          ? (Zotero.Items.get(parentID) as Zotero.Item)
          : item;

        // 检查是否已存在 AI 摘要
        if (prefs.skipExistingSummary && hasExistingSummary(parent, fileName)) {
          allSkipped.push({
            fileName,
            reason: "已存在 AI 摘要",
          });
          continue;
        }

        // 检查文件大小
        const fileSize = await getFileSize(filePath);
        if (prefs.maxFileSizeMB > 0) {
          const maxBytes = prefs.maxFileSizeMB * 1024 * 1024;
          if (fileSize > maxBytes) {
            const sizeMB = (fileSize / 1024 / 1024).toFixed(1);
            allSkipped.push({
              fileName,
              reason: `文件过大 (${sizeMB}MB > ${prefs.maxFileSizeMB}MB)`,
            });
            continue;
          }
        }

        // 检查 PDF 页数
        let pageCount: number | null = null;
        if (prefs.maxPageCount > 0) {
          pageCount = await getPdfPageCount(item, filePath);
          if (pageCount === null) {
            allSkipped.push({
              fileName,
              reason: `无法获取页数 (已设置页数限制 ${prefs.maxPageCount}页)`,
            });
            continue;
          }
          if (pageCount > prefs.maxPageCount) {
            allSkipped.push({
              fileName,
              reason: `页数过多 (${pageCount}页 > ${prefs.maxPageCount}页)`,
            });
            continue;
          }
        }

        // 根据解析模式决定是否需要获取文本
        let text = "";
        if (prefs.pdfParseMode === "local") {
          try {
            const txt = await (item as any).attachmentText;
            if (txt) {
              const fullText = String(txt);
              text =
                fullText.length > prefs.maxChars
                  ? fullText.slice(0, prefs.maxChars)
                  : fullText;
            }
          } catch (e) {
            // 本地模式下无法获取文本则跳过
            allSkipped.push({ fileName, reason: "无法提取文本" });
            continue;
          }
          if (!text) {
            allSkipped.push({ fileName, reason: "文本为空" });
            continue;
          }
        }

        tasks.push({
          item: parent,
          attachment: { item, fileName, filePath, text, fileSize, pageCount },
        });
      }
    }

    // 处理选中的常规条目（获取其所有 PDF）
    for (const item of selectedRegularItems) {
      const { attachments, skipped } = await getEligibleAttachments(
        item,
        prefs,
      );
      allSkipped.push(...skipped);
      for (const att of attachments) {
        // 避免重复：如果这个 PDF 已经被直接选中处理过，跳过
        if (!selectedAttachmentIds.has(att.item.id)) {
          tasks.push({ item, attachment: att });
        }
      }
    }

    // 显示跳过的文件信息
    if (allSkipped.length > 0) {
      const skippedInfo = allSkipped
        .slice(0, 10) // 最多显示10个
        .map((s) => `• ${s.fileName}: ${s.reason}`)
        .join("\n");
      const moreInfo =
        allSkipped.length > 10
          ? `\n... 还有 ${allSkipped.length - 10} 个文件被跳过`
          : "";

      const pw = new ztoolkit.ProgressWindow(addon.data.config.addonName)
        .createLine({
          text: `跳过 ${allSkipped.length} 个文件`,
          type: "default",
        })
        .show();
      safeStartCloseTimer(pw, 5000);

      // 在控制台输出详细信息
      ztoolkit.log(`跳过的文件:\n${skippedInfo}${moreInfo}`);
    }

    if (!tasks.length) {
      const modeHint =
        prefs.pdfParseMode === "local"
          ? "2. PDF 已被 Zotero 索引（有全文内容）\n"
          : "2. PDF 文件存在于本地\n";
      const sizeHint =
        prefs.maxFileSizeMB > 0
          ? `4. 文件大小不超过 ${prefs.maxFileSizeMB}MB\n`
          : "";
      const pageHint =
        prefs.maxPageCount > 0
          ? `5. PDF 页数不超过 ${prefs.maxPageCount}页\n`
          : "";
      ztoolkit.getGlobal("alert")(
        "未找到符合条件的 PDF 附件。\n" +
          "请确保：\n" +
          "1. 条目有 PDF 附件\n" +
          modeHint +
          "3. 文件名符合过滤规则\n" +
          sizeHint +
          pageHint,
      );
      return;
    }

    // 避免重复：同一个 PDF 已在等待/运行队列中时，不重复添加
    const uniqueTasks: Array<{
      item: Zotero.Item;
      attachment: AttachmentInfo;
    }> = [];
    const duplicateTasks: Array<{
      item: Zotero.Item;
      attachment: AttachmentInfo;
    }> = [];
    const seenAttachmentIds = new Set<number>();

    for (const task of tasks) {
      const attachmentId = task.attachment.item.id;
      if (seenAttachmentIds.has(attachmentId)) continue;
      seenAttachmentIds.add(attachmentId);

      const alreadyActive = globalTaskQueue.hasActiveTask(
        (data) => data.attachment.item.id === attachmentId,
      );
      if (alreadyActive) {
        duplicateTasks.push(task);
      } else {
        uniqueTasks.push(task);
      }
    }

    if (duplicateTasks.length > 0) {
      const names = duplicateTasks
        .slice(0, 5)
        .map(
          (t) =>
            t.attachment.fileName || t.item.getDisplayTitle() || "未知文件",
        )
        .join("、");
      const more =
        duplicateTasks.length > 5 ? ` 等 ${duplicateTasks.length} 个` : "";

      const pw = new ztoolkit.ProgressWindow(addon.data.config.addonName)
        .createLine({
          text: `已在队列中：${names}${more}（已忽略重复添加）`,
          type: "default",
        })
        .show();
      safeStartCloseTimer(pw, 3500);
    }

    if (!uniqueTasks.length) {
      // 全部都是重复任务：直接打开队列面板，方便用户查看进度
      AISummaryModule.openTaskQueuePanel();
      return;
    }

    // 更新全局队列的并发数
    globalTaskQueue.setConcurrency(prefs.concurrency);

    // 显示队列状态
    const currentStatus = globalTaskQueue.getStatus();
    const totalPending = currentStatus.queued + uniqueTasks.length;
    if (currentStatus.running > 0 || currentStatus.queued > 0) {
      // 已有任务在运行，显示提示
      const pw = new ztoolkit.ProgressWindow(addon.data.config.addonName)
        .createLine({
          text: `已添加 ${uniqueTasks.length} 个任务到队列 (当前队列: ${totalPending} 待处理, ${currentStatus.running} 运行中)`,
          progress: 100,
        })
        .show();
      safeStartCloseTimer(pw, 3000);
    }

    // 将任务提交到全局队列
    const taskDataList: SummaryTaskData[] = uniqueTasks.map((task) => ({
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
