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
 * 并发控制执行
 */
async function runWithConcurrency<T>(
  inputs: T[],
  limit: number,
  worker: (x: T) => Promise<void>,
): Promise<void> {
  let i = 0;
  const pool: Promise<void>[] = [];

  const spawn = () => {
    if (i >= inputs.length) return;
    const idx = i++;
    const p = worker(inputs[idx]).finally(spawn);
    pool.push(p);
  };

  for (let k = 0; k < Math.min(limit, inputs.length); k++) {
    spawn();
  }

  await Promise.all(pool);
}

/**
 * AI 摘要模块
 */
export class AISummaryModule {
  /**
   * 注册右键菜单
   */
  static registerContextMenu(): void {
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

    // 并发处理每个 PDF
    await runWithConcurrency(tasks, prefs.concurrency, async (task) => {
      const displayName = task.attachment.fileName || task.item.getDisplayTitle();
      const pw = new ztoolkit.ProgressWindow(addon.data.config.addonName)
        .createLine({
          text: `处理：${displayName}`,
          progress: 10,
        })
        .show();

      try {
        await summarizeSinglePdf(task.item, task.attachment, prefs);
        pw.changeLine({ text: `完成：${displayName}`, progress: 100 });
      } catch (e: any) {
        pw.changeLine({
          text: `失败：${displayName} - ${e?.message || e}`,
          progress: 100,
          type: "error",
        });
      } finally {
        pw.startCloseTimer(2000);
      }
    });
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
