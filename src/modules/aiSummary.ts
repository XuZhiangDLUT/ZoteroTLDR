import { marked } from "marked";
import { getPrefs, type AddonPrefs } from "../utils/prefs";
import {
  OpenAICompatProvider,
  GeminiV1BetaProvider,
  type LLMProvider,
  type SummarizeResult,
} from "../llm/providers";

function markdownToHTML(md: string): string {
  if (!md) return "<p>(无内容)</p>";
  // Use marked for full Markdown support (tables, lists, headings, code, etc.)
  return marked.parse(md) as string;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function globToRegExp(glob: string): RegExp | null {
  const trimmed = glob.trim();
  if (!trimmed) return null;
  const escaped = trimmed
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`, "i");
}

function getEligibleAttachments(item: Zotero.Item, prefs: AddonPrefs): Zotero.Item[] {
  const attIDs = item.getAttachments ? item.getAttachments() : [];
  const blocked = prefs.attachmentFilterGlob?.trim();
  const blockedRe = blocked ? globToRegExp(blocked) : null;

  const results: Zotero.Item[] = [];
  for (const id of attIDs) {
    const att = Zotero.Items.get(id) as Zotero.Item;

    const getFilePath = (att as any).getFilePath || att.getFilePath;
    const path = getFilePath ? getFilePath.call(att) : "";
    const fileName = path ? path.split(/[\\/]/).pop() ?? "" : "";

    if (blockedRe && fileName && blockedRe.test(fileName)) {
      // Skip blocked attachments, e.g. *-dual.pdf
      continue;
    }

    results.push(att);
  }

  return results;
}

async function collectItemContextForTextIndex(
  item: Zotero.Item,
  attachments: Zotero.Item[],
  prefs: AddonPrefs,
): Promise<{
  title: string;
  abstractNote: string;
  content: string;
}> {
  const title = item.getDisplayTitle();
  const abstractNote = (item.getField("abstractNote") as string) || "";

  const texts: string[] = [];
  try {
    for (const att of attachments) {
      const ct =
        (att.getField?.("contentType") as string) ||
        ((att as any).attachmentContentType as string | undefined) ||
        "";
      if (
        ct.includes("application/pdf") ||
        ct.includes("text/html") ||
        ct.includes("text/plain")
      ) {
        try {
          const txt = await (att as any).attachmentText;
          if (txt) texts.push(String(txt));
        } catch (_e) {
          // Ignore single attachment failures
        }
      }
    }
  } catch (_e) {
    // Ignore full-text extraction failure
  }

  const maxChars = prefs.maxChars ?? 800000;
  const joined = texts.join("\n\n");
  const content = joined.length > maxChars ? joined.slice(0, maxChars) : joined;
  return { title, abstractNote, content };
}

function replaceAll(str: string, search: string, replacement: string): string {
  return str.split(search).join(replacement);
}

function buildPrompt(
  tpl: string,
  data: { title: string; abstractNote: string; content: string },
): string {
  let out = tpl;
  out = replaceAll(out, "{title}", data.title || "");
  out = replaceAll(out, "{abstract}", data.abstractNote || "");
  out = replaceAll(out, "{content}", data.content || "");
  return out;
}

const DEFAULT_PROMPT_TEMPLATE =
  "请阅读以下论文信息与内容片段，并输出结构化中文摘要：\n" +
  "- 题目：{title}\n" +
  "- 摘要：{abstract}\n" +
  "- 正文片段（可能被截断）：\n{content}\n\n" +
  "请用要点列出：研究问题、方法、数据/实验、主要结论、贡献与局限、可复现要点、与我研究的相关性（若未知可留空）。";

function createProvider(prefs: AddonPrefs): LLMProvider {
  if (prefs.provider === "gemini-v1beta") {
    return new GeminiV1BetaProvider();
  }
  return new OpenAICompatProvider();
}

async function saveChildNote(
  item: Zotero.Item,
  markdown: string,
  thoughts: string | undefined,
  prefs: AddonPrefs,
) {
  const html = markdownToHTML(markdown);
  const thoughtHtml =
    thoughts && prefs.saveThoughtsToNote
      ? `<details><summary>思考摘要（点击展开）</summary><pre>${escapeHtml(
          thoughts,
        )}</pre></details>`
      : "";

  const note = new Zotero.Item("note");
  const nowStr = new Date().toLocaleString();
  const providerLabel =
    prefs.provider === "gemini-v1beta" ? "Gemini" : "OpenAI-compatible";

  const headerTitle = `[AI 摘要] ${item.getDisplayTitle?.() ?? ""} (${prefs.model} / ${providerLabel} @ ${nowStr})`;
  const headerHtml = `<p><b>${escapeHtml(headerTitle)}</b></p><hr>`;

  note.parentID = item.id;
  note.setNote(headerHtml + html + thoughtHtml);
  await note.saveTx();
}

async function summarizeItem(item: Zotero.Item): Promise<void> {
  const prefs = getPrefs();
  const attachments = getEligibleAttachments(item, prefs);

  const ctx = await collectItemContextForTextIndex(item, attachments, prefs);
  const tpl = prefs.prompt && prefs.prompt.trim().length
    ? prefs.prompt
    : DEFAULT_PROMPT_TEMPLATE;
  const prompt = buildPrompt(tpl, ctx);

  const provider = createProvider(prefs);

  let result: SummarizeResult;

  if (
    prefs.provider === "gemini-v1beta" &&
    prefs.summarizeMode === "pdf-native" &&
    attachments.length &&
    provider.summarizeWithPdfNative
  ) {
    try {
      result = await provider.summarizeWithPdfNative({
        title: ctx.title,
        abstract: ctx.abstractNote,
        prompt,
        attachments,
        prefs,
      });
    } catch (e) {
      // Fallback to text-index mode if PDF-native fails
      ztoolkit.log?.(
        `Gemini v1beta pdf-native failed, fallback to text-index: ${e}`,
      );
      result = await provider.summarizeWithTextIndex({
        title: ctx.title,
        abstract: ctx.abstractNote,
        prompt,
        attachments,
        prefs,
      });
    }
  } else {
    result = await provider.summarizeWithTextIndex({
      title: ctx.title,
      abstract: ctx.abstractNote,
      prompt,
      attachments,
      prefs,
    });
  }

  await saveChildNote(item, result.markdown, result.thoughtsMarkdown, prefs);
}

export async function testAPIConnectivity(): Promise<string> {
  try {
    const prefs = getPrefs();
    const provider = createProvider(prefs);

    const pingPrompt =
      prefs.provider === "gemini-v1beta"
        ? "ping"
        : "请直接回复：pong";

    const result = await provider.summarizeWithTextIndex({
      title: "Ping",
      abstract: "",
      prompt: pingPrompt,
      attachments: [],
      prefs,
    });

    const text = (result.markdown || "").trim();
    return `连接成功：${text}`;
  } catch (e: any) {
    return `连接失败：${e?.message || e}`;
  }
}

async function runWithConcurrency<T>(
  inputs: T[],
  limit: number,
  worker: (x: T, idx: number) => Promise<void>,
) {
  let i = 0;
  const pool: Promise<void>[] = [];

  const spawn = () => {
    if (i >= inputs.length) return;
    const idx = i++;
    const p = worker(inputs[idx], idx).finally(spawn);
    pool.push(p);
  };

  for (let k = 0; k < Math.min(limit, inputs.length); k++) {
    spawn();
  }

  await Promise.all(pool);
}

export class AISummaryModule {
  static registerContextMenu() {
    const label = "AI 总结到子笔记";
    ztoolkit.Menu.register("item", {
      tag: "menuitem",
      id: `zotero-itemmenu-${addon.data.config.addonRef}-ai-summarize`,
      label,
      commandListener: async () => {
        try {
          await AISummaryModule.summarizeSelected();
        } catch (e: any) {
          ztoolkit.getGlobal("alert")(`AI 总结失败：${e?.message || e}`);
        }
      },
    });
  }

  static async summarizeSelected() {
    const prefs = getPrefs();
    const pane = ztoolkit.getGlobal("ZoteroPane");
    const items = (pane.getSelectedItems() as Zotero.Item[]).filter((it) =>
      it.isRegularItem(),
    );
    if (!items.length) {
      ztoolkit.getGlobal("alert")(
        "请先在中间列表选择至少一个条目（非笔记/非附件）。",
      );
      return;
    }

    await runWithConcurrency(items, prefs.concurrency, async (it, idx) => {
      const pw = new ztoolkit.ProgressWindow(addon.data.config.addonName)
        .createLine({
          text: `处理：${it.getDisplayTitle()}`,
          progress: 10,
        })
        .show();
      try {
        await summarizeItem(it);
        pw.changeLine({ text: "完成", progress: 100 });
      } catch (e: any) {
        pw.changeLine({
          text: `失败：${it.getDisplayTitle()} - ${e?.message || e}`,
          progress: 100,
          type: "error",
        });
      } finally {
        pw.startCloseTimer(1200);
      }
    });
  }

  static async testAPI() {
    const result = await testAPIConnectivity();
    ztoolkit.getGlobal("alert")(result);
  }
}
