// Zotero: Tools > Developer > Run JavaScript
// 目的：测试 Gemini 原生 SSE（streamGenerateContent）是否会“实时返回思考/思维链(thought)”
// 以及首包（TTFB）是否足够快，从而规避 Cloudflare 524（120s 无首包）。
//
// 重要：不要把 API Key 写进脚本文件。运行时会用 prompt 让你临时输入。
//
// 默认配置（按你的测试模型）：
// - apiBase: https://x666.me
// - model: gemini-2.5-pro-1m
// - enableThinking: true
// - thinkingBudget: -1
//
// 使用：
// 1) （可选）在 Zotero 里选中一个 PDF 附件（想测“上传 PDF + 流式思考”就选）
// 2) 打开 Tools > Developer > Run JavaScript
// 3) 复制本文件全部内容并运行
// 4) 到 Tools > Developer > Error Console 查看实时输出

(async () => {
  const API_BASE = "https://x666.me";
  const MODEL = "gemini-2.5-pro-1m";
  const ENABLE_THINKING = true;
  const THINKING_BUDGET = -1;

  const apiKey = prompt("请输入 api_key（不会保存，别发到聊天里）");
  if (!apiKey) {
    alert("未输入 api_key，已取消");
    return;
  }

  const includeThoughtsRaw = prompt(
    "是否尝试请求返回思维链？\n1 = thinkingConfig.includeThoughts=true（如果服务端支持）\n0 = 不加该字段",
    "1",
  );
  const INCLUDE_THOUGHTS = String(includeThoughtsRaw ?? "1").trim() !== "0";

  const mode = prompt(
    "选择测试模式：\n1 = 仅文本 prompt\n2 = 上传“当前选中 PDF” + prompt\n\n请输入 1 或 2",
    "1",
  );
  const usePdf = String(mode || "1").trim() === "2";

  const userPrompt = prompt(
    "请输入测试 prompt（建议选一个需要推理的任务，便于观察 thought 是否出现）",
    "请解决：给定 1..100 的整数，哪些数能被 3 或 7 整除但不能同时被二者整除？请给出结论并解释。",
  );
  if (!userPrompt) {
    alert("未输入 prompt，已取消");
    return;
  }

  const normalizeBase = (s) => String(s || "").replace(/\/v1\/?$/, "").replace(/\/$/, "");
  const baseUrl = normalizeBase(API_BASE);
  const url = `${baseUrl}/v1/models/${MODEL}:streamGenerateContent?alt=sse`;

  const binaryStringToUint8Array = (binStr) => {
    const bytes = new Uint8Array(binStr.length);
    for (let i = 0; i < binStr.length; i++) bytes[i] = binStr.charCodeAt(i) & 0xff;
    return bytes;
  };

  async function readSelectedPdfAsBase64() {
    const pane = Zotero.getActiveZoteroPane();
    const selectedItems = pane.getSelectedItems();
    if (!selectedItems.length) {
      throw new Error("未选择任何条目/附件");
    }

    // 找到第一个 PDF 附件
    let attachment = null;
    for (const item of selectedItems) {
      if (item.isAttachment && item.isAttachment()) {
        attachment = item;
        break;
      }
      if (item.isRegularItem && item.isRegularItem()) {
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

    if (!attachment) throw new Error("未找到附件");

    const contentType =
      attachment.attachmentContentType ||
      (attachment.getField && attachment.getField("contentType")) ||
      "";
    if (!String(contentType).includes("application/pdf")) {
      throw new Error("选中的不是 PDF 附件（contentType 非 application/pdf）");
    }

    const getFilePath =
      attachment.getFilePath ||
      (attachment._getFilePath && attachment._getFilePath.bind(attachment));
    const filePath = getFilePath ? getFilePath.call(attachment) : "";
    if (!filePath) throw new Error("无法获取 PDF 文件路径");

    const fileName = filePath.split(/[/\\]/).pop() || "(未命名)";
    const fileObj = Zotero.File.pathToFile(filePath);
    const fileSize = fileObj && fileObj.exists() ? fileObj.fileSize : 0;
    const sizeMB = (fileSize / 1024 / 1024).toFixed(2);

    console.log("[PDF] 文件:", fileName);
    console.log("[PDF] 路径:", filePath);
    console.log("[PDF] 大小:", `${sizeMB} MB`);

    // 读取二进制字符串并 base64
    // 注意：大文件 base64 会占用内存；这里只用于测试
    const bin = await Zotero.File.getBinaryContentsAsync(filePath);
    // Zotero 返回的二进制字符串可直接 btoa，但先转 Uint8Array 再转回字符串更稳妥
    const bytes = binaryStringToUint8Array(bin);
    let binary = "";
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    const pdfBase64 = btoa(binary);

    return { pdfBase64, fileName };
  }

  let parts = [{ text: userPrompt }];
  let pdfInfo = null;
  if (usePdf) {
    try {
      pdfInfo = await readSelectedPdfAsBase64();
      parts = [
        { text: userPrompt },
        {
          inlineData: {
            mimeType: "application/pdf",
            data: pdfInfo.pdfBase64,
          },
        },
      ];
    } catch (e) {
      alert("读取选中 PDF 失败: " + (e?.message || String(e)));
      throw e;
    }
  }

  const body = {
    contents: [
      {
        parts,
      },
    ],
    generationConfig: {
      temperature: 0.2,
      maxOutputTokens: 8192,
    },
  };

  if (ENABLE_THINKING) {
    body.generationConfig.thinkingConfig = { thinkingBudget: THINKING_BUDGET };
    if (INCLUDE_THOUGHTS) {
      body.generationConfig.thinkingConfig.includeThoughts = true;
    }
  }

  const controller = new AbortController();
  const hardTimeoutMs = 6 * 60 * 1000; // 最多跑 6 分钟（防止卡死）
  const hardTimer = setTimeout(() => controller.abort(), hardTimeoutMs);

  const t0 = Date.now();
  let firstChunkMs = null;
  let thoughts = "";
  let text = "";
  let sawThoughtField = false;

  console.log("=== Gemini SSE 思考流测试开始 ===");
  console.log("URL:", url);
  console.log("model:", MODEL);
  console.log(
    "enableThinking:",
    ENABLE_THINKING,
    "thinkingBudget:",
    THINKING_BUDGET,
    "includeThoughts:",
    INCLUDE_THOUGHTS,
  );
  console.log("mode:", usePdf ? "PDF+prompt" : "prompt-only");
  if (pdfInfo?.fileName) console.log("pdf:", pdfInfo.fileName);

  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (e) {
    clearTimeout(hardTimer);
    alert("请求发送失败: " + (e?.message || String(e)));
    return;
  }

  console.log("HTTP:", res.status, res.statusText);
  if (!res.ok) {
    const errText = await res.text();
    clearTimeout(hardTimer);
    console.log("响应内容(截断):", errText.slice(0, 2000));
    alert(`请求失败：${res.status}\n\n${errText.slice(0, 500)}`);
    return;
  }

  const reader = res.body && res.body.getReader ? res.body.getReader() : null;
  if (!reader) {
    const allText = await res.text();
    clearTimeout(hardTimer);
    console.log("非流式响应(前 2000 字符):", allText.slice(0, 2000));
    alert("没有拿到可读流(res.body.getReader 不可用)，请看控制台输出");
    return;
  }

  const decoder = new TextDecoder();
  let buffer = "";

  const extractChunk = (part) => {
    if (typeof part?.text === "string" && part.text) return part.text;
    if (typeof part?.thought === "string" && part.thought) return part.thought;
    if (part?.thought && typeof part.thought === "object" && typeof part.thought.text === "string" && part.thought.text) {
      return part.thought.text;
    }
    return "";
  };

  const isThoughtPart = (part) => {
    return (
      part?.thought === true ||
      typeof part?.thought === "string" ||
      (part?.thought && typeof part.thought === "object" && typeof part.thought.text === "string")
    );
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
          console.log("[SSE] JSON 解析失败:", payload.slice(0, 200));
          continue;
        }

        const partsArr = data?.candidates?.[0]?.content?.parts;
        if (!Array.isArray(partsArr)) continue;

        for (const part of partsArr) {
          if (!sawThoughtField && part && Object.prototype.hasOwnProperty.call(part, "thought")) {
            sawThoughtField = true;
            console.log("[DEBUG] 首次看到 part.thought 字段，part keys:", Object.keys(part));
          }

          const chunk = extractChunk(part);
          if (!chunk) continue;

          // 关键：如果服务端真的返回“思考/思维链”，通常会带 thought=true（你的插件也按这个解析）
          const isThought = isThoughtPart(part);

          if (isThought) {
            thoughts += chunk;
            console.log("[THOUGHT]", chunk);
          } else {
            text += chunk;
            console.log("[TEXT]", chunk);
          }
        }
      }
    }

    // 处理最后残留一行
    if (buffer.startsWith("data:")) {
      const payload = buffer.slice(5).trim();
      if (payload && payload !== "[DONE]") {
        try {
          const data = JSON.parse(payload);
          const partsArr = data?.candidates?.[0]?.content?.parts;
          if (Array.isArray(partsArr)) {
            for (const part of partsArr) {
              const chunk = extractChunk(part);
              if (!chunk) continue;
              const isThought = isThoughtPart(part);
              if (isThought) thoughts += chunk;
              else text += chunk;
            }
          }
        } catch (_e) {}
      }
    }
  } catch (e) {
    console.log("流式读取中断/报错:", e);
  } finally {
    clearTimeout(hardTimer);
    try { reader.releaseLock(); } catch (_e) {}
  }

  const totalMs = Date.now() - t0;
  console.log("=== 完成 ===");
  console.log("总耗时(ms):", totalMs);
  console.log("thought length:", thoughts.length);
  console.log("text length:", text.length);
  console.log("=== THOUGHTS(完整) ===\n" + thoughts);
  console.log("=== TEXT(完整) ===\n" + text);

  alert(
    "完成。\n" +
      `TTFB(ms): ${firstChunkMs === null ? "NULL(未收到首包)" : firstChunkMs}\n` +
      `总耗时(ms): ${totalMs}\n` +
      `thought长度: ${thoughts.length}\n` +
      `text长度: ${text.length}\n\n` +
      "请到 Tools > Developer > Error Console 查看 [THOUGHT]/[TEXT] 实时输出。",
  );
})();
