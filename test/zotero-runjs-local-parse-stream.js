// Zotero: Tools > Developer > Run JavaScript
// Purpose: verify local-parse (text-only) can stream output and thought chunks
// Usage:
// 1) (Optional) select a parent item or a PDF attachment in Zotero.
// 2) Run this script; watch Tools > Developer > Error Console for [THOUGHT]/[TEXT].
(async () => {
  const API_BASE = "https://x666.me/v1";
  const MODEL = "gemini-2.5-pro-1m";
  const ENABLE_THINKING = true;
  const THINKING_BUDGET = -1;
  const INCLUDE_SYSTEM = true;
  const TEMPERATURE = 0.2;
  const MAX_CHARS = 20000;

  const apiKey = prompt("Enter api_key (not stored):");
  if (!apiKey) {
    alert("No api_key; abort.");
    return;
  }

  const includeThoughtsRaw = prompt(
    "Request thought chunks?\n1 = includeThoughts\n0 = disable",
    "1",
  );
  const INCLUDE_THOUGHTS = String(includeThoughtsRaw ?? "1").trim() !== "0";

  const useSelectionRaw = prompt(
    "Use selected item's attachment text?\n1 = yes\n0 = manual paste",
    "1",
  );
  const USE_SELECTION = String(useSelectionRaw ?? "1").trim() !== "0";

  const buildPrompt = (template, data) =>
    template
      .split("{title}")
      .join(data.title || "")
      .split("{abstract}")
      .join(data.abstract || "")
      .split("{content}")
      .join(data.content || "")
      .split("{fileName}")
      .join(data.fileName || "");

  const DEFAULT_PROMPT =
    "Please read the following paper information and text excerpt, then " +
    "output a structured summary:\n" +
    "- Title: {title}\n" +
    "- Abstract: {abstract}\n" +
    "- Text excerpt (may be truncated):\n{content}\n\n" +
    "List in bullet points: research question, method, data/experiments, " +
    "main findings, contributions, and limitations.";

  const normalizeBase = (s) =>
    String(s || "")
      .replace(/\/v1\/?$/, "")
      .replace(/\/$/, "");

  async function getSelectedAttachmentText() {
    const pane = Zotero.getActiveZoteroPane();
    const selected = pane.getSelectedItems();
    if (!selected || !selected.length) {
      throw new Error("No selected items.");
    }

    let attachment = null;
    let parentItem = null;
    for (const item of selected) {
      if (item.isAttachment && item.isAttachment()) {
        attachment = item;
        parentItem = item.parentItem || null;
        break;
      }
      if (item.isRegularItem && item.isRegularItem()) {
        parentItem = item;
        const attIds = item.getAttachments ? item.getAttachments() : [];
        for (const attId of attIds) {
          const att = Zotero.Items.get(attId);
          if (att) {
            attachment = att;
            break;
          }
        }
      }
      if (attachment) break;
    }

    if (!attachment) {
      throw new Error("No attachment found in selection.");
    }

    const filePath =
      (attachment.getFilePath && attachment.getFilePath()) ||
      (attachment._getFilePath && attachment._getFilePath());
    const fileName = filePath ? filePath.split(/[/\\]/).pop() || "" : "";

    const txt = await attachment.attachmentText;
    if (!txt) {
      throw new Error("attachmentText is empty. Ensure full-text indexing.");
    }

    const fullText = String(txt);
    const content =
      fullText.length > MAX_CHARS ? fullText.slice(0, MAX_CHARS) : fullText;

    const title =
      (parentItem && parentItem.getDisplayTitle && parentItem.getDisplayTitle()) ||
      (attachment.getDisplayTitle && attachment.getDisplayTitle()) ||
      "";
    const abstract =
      (parentItem && parentItem.getField && parentItem.getField("abstractNote")) ||
      "";

    return { title, abstract: String(abstract || ""), content, fileName };
  }

  let title = "";
  let abstract = "";
  let content = "";
  let fileName = "";

  if (USE_SELECTION) {
    try {
      const data = await getSelectedAttachmentText();
      title = data.title;
      abstract = data.abstract;
      content = data.content;
      fileName = data.fileName;
    } catch (e) {
      console.log("[WARN] Failed to load selection:", e?.message || String(e));
    }
  }

  if (!content) {
    const manual = prompt(
      "Paste local text content to summarize (empty to cancel):",
      "",
    );
    if (!manual) {
      alert("No content provided; abort.");
      return;
    }
    content = manual;
  }

  const promptText = buildPrompt(DEFAULT_PROMPT, {
    title,
    abstract,
    content,
    fileName,
  });

  const base = normalizeBase(API_BASE);
  const url = base.endsWith("/v1")
    ? `${base}/chat/completions`
    : `${base}/v1/chat/completions`;

  const body = {
    model: MODEL,
    messages: [
      ...(INCLUDE_SYSTEM
        ? [{ role: "system", content: "You are an academic assistant." }]
        : []),
      { role: "user", content: promptText },
    ],
    stream: true,
    temperature: TEMPERATURE,
  };

  if (ENABLE_THINKING) {
    body.extra_body = {
      generationConfig: {
        thinkingConfig: {
          thinkingBudget: THINKING_BUDGET,
          ...(INCLUDE_THOUGHTS ? { includeThoughts: true } : {}),
        },
      },
    };
  }

  const controller = new AbortController();
  const hardTimeoutMs = 6 * 60 * 1000;
  const hardTimer = setTimeout(() => controller.abort(), hardTimeoutMs);

  const t0 = Date.now();
  let firstChunkMs = null;
  let thoughts = "";
  let text = "";
  let sawThoughtField = false;
  let loggedDeltaKeys = false;

  console.log("=== Local-Parse Stream Test (OpenAI-compatible SSE) ===");
  console.log("URL:", url);
  console.log("model:", MODEL);
  console.log("title:", title);
  console.log("fileName:", fileName);
  console.log("content length:", content.length);

  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (e) {
    clearTimeout(hardTimer);
    alert("Request failed: " + (e?.message || String(e)));
    return;
  }

  console.log("HTTP:", res.status, res.statusText);
  if (!res.ok) {
    const errText = await res.text();
    clearTimeout(hardTimer);
    console.log("Error preview:", errText.slice(0, 2000));
    alert(`Request failed: ${res.status}\n\n${errText.slice(0, 500)}`);
    return;
  }

  const reader = res.body && res.body.getReader ? res.body.getReader() : null;
  if (!reader) {
    const allText = await res.text();
    clearTimeout(hardTimer);
    console.log("Non-stream response preview:", allText.slice(0, 2000));
    alert("No readable stream. See Error Console for details.");
    return;
  }

  const decoder = new TextDecoder();
  let buffer = "";

  const pickThoughtChunk = (delta) => {
    const v =
      delta?.reasoning_content ??
      delta?.reasoningContent ??
      delta?.reasoning ??
      delta?.thought ??
      delta?.thoughts ??
      delta?.thinking ??
      delta?.analysis;
    return typeof v === "string" ? v : "";
  };

  const pickTextChunk = (delta) => {
    const v = delta?.content ?? delta?.text;
    return typeof v === "string" ? v : "";
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      if (firstChunkMs === null) {
        firstChunkMs = Date.now() - t0;
        console.log("TTFB(ms):", firstChunkMs);
      }

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;

        let data;
        try {
          data = JSON.parse(payload);
        } catch (_e) {
          console.log("[SSE] JSON parse failed:", payload.slice(0, 200));
          continue;
        }

        const choice = data?.choices?.[0];
        const delta = choice?.delta || {};

        if (!loggedDeltaKeys && delta && Object.keys(delta).length) {
          loggedDeltaKeys = true;
          console.log("[DEBUG] delta keys:", Object.keys(delta));
          console.log("[DEBUG] delta sample:", JSON.stringify(delta).slice(0, 800));
        }

        const r = pickThoughtChunk(delta);
        if (r) {
          thoughts += r;
          sawThoughtField = true;
          console.log("[THOUGHT]", r);
        }

        const c = pickTextChunk(delta);
        if (c) {
          text += c;
          console.log("[TEXT]", c);
        }
      }
    }
  } catch (e) {
    console.log("Stream read error:", e?.message || String(e));
  } finally {
    clearTimeout(hardTimer);
    try {
      reader.releaseLock();
    } catch (_e) {}
  }

  const totalMs = Date.now() - t0;
  console.log("=== Done ===");
  console.log("Total(ms):", totalMs);
  console.log("thought length:", thoughts.length);
  console.log("text length:", text.length);
  console.log("saw thought field:", sawThoughtField);

  alert(
    "Done.\n" +
      `TTFB(ms): ${firstChunkMs === null ? "NULL" : firstChunkMs}\n` +
      `Total(ms): ${totalMs}\n` +
      `Thought length: ${thoughts.length}\n` +
      `Text length: ${text.length}\n\n` +
      "Check Tools > Developer > Error Console for live [THOUGHT]/[TEXT].",
  );
})();
