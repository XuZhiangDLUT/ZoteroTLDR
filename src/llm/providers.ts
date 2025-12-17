import { getPref, type AddonPrefs } from "../utils/prefs";

export interface SummarizeOptions {
  title: string;
  abstract?: string;
  prompt: string; // final prompt text
  attachments: Zotero.Item[]; // filtered attachments
  prefs: AddonPrefs;
}

export interface SummarizeResult {
  markdown: string; // main summary in Markdown
  thoughtsMarkdown?: string; // optional thinking summary in Markdown
}

export interface LLMProvider {
  summarizeWithTextIndex(opts: SummarizeOptions): Promise<SummarizeResult>;
  summarizeWithPdfNative?(opts: SummarizeOptions): Promise<SummarizeResult>;
}

function getApiKey(): string {
  const key = (getPref("apiKey" as any) as string) || "";
  if (!key) {
    throw new Error("未配置 API Key，请在偏好设置中填写。");
  }
  return key;
}

export class OpenAICompatProvider implements LLMProvider {
  async summarizeWithTextIndex(opts: SummarizeOptions): Promise<SummarizeResult> {
    const { prefs, prompt } = opts;
    const url = `${prefs.openaiApiBase.replace(/\/$/, "")}/chat/completions`;

    const body: any = {
      model: prefs.model,
      messages: [
        { role: "system", content: "You are an academic assistant." },
        { role: "user", content: prompt },
      ],
      temperature: prefs.temperature ?? 0.2,
    };

    // Some OpenAI-compatible proxies (like x666.me) support forwarding
    // Gemini-specific options via an extra_body field.
    if (prefs.enableThoughts) {
      body.extra_body = body.extra_body ?? {};
      body.extra_body.generationConfig = {
        thinkingConfig: { thinkingBudget: prefs.thinkingBudget ?? -1 },
      };
    }

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${getApiKey()}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      throw new Error(
        `OpenAI-compatible error: ${res.status} ${await res.text()}`,
      );
    }
    const data: any = await res.json();
    const text = data?.choices?.[0]?.message?.content?.trim() ?? "";
    return { markdown: text };
  }
}

export class GeminiV1BetaProvider implements LLMProvider {
  private headers(prefs: AddonPrefs) {
    // If the proxy expects OpenAI-style auth, we use Authorization: Bearer
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${getApiKey()}`,
    } as Record<string, string>;
  }

  async summarizeWithTextIndex(opts: SummarizeOptions): Promise<SummarizeResult> {
    const { prefs, prompt } = opts;
    const url = `${prefs.geminiApiBase.replace(/\/$/, "")}/v1beta/models/${prefs.model}:generateContent`;

    const body: any = {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {},
    };
    if (prefs.enableThoughts) {
      body.generationConfig.thinkingConfig = {
        thinkingBudget: prefs.thinkingBudget ?? -1,
        includeThoughts: true,
      };
    }

    const res = await fetch(url, {
      method: "POST",
      headers: this.headers(prefs),
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(
        `Gemini v1beta error: ${res.status} ${await res.text()}`,
      );
    }
    const data: any = await res.json();

    const { answer, thoughts } = extractTextAndThoughtsFromGeminiResponse(data);
    return { markdown: answer, thoughtsMarkdown: thoughts };
  }

  async summarizeWithPdfNative(opts: SummarizeOptions): Promise<SummarizeResult> {
    const { prefs, prompt, attachments } = opts;
    const base = prefs.geminiApiBase.replace(/\/$/, "");
    const genUrl = `${base}/v1beta/models/${prefs.model}:generateContent`;
    const contents: any[] = [{ parts: [{ text: prompt }] }];

    const parts: any[] = [];
    for (const att of attachments) {
      const fileInfo = await readPdfFile(att);
      if (!fileInfo) continue;

      if (fileInfo.sizeMB <= prefs.maxInlineMB) {
        parts.push({
          inline_data: {
            mime_type: fileInfo.mimeType,
            data: fileInfo.base64,
          },
        });
      } else if (fileInfo.sizeMB <= prefs.maxFileMB) {
        const { file_uri, mime_type } = await this.uploadViaFilesApi(
          base,
          fileInfo,
        );
        parts.push({ file_data: { file_uri, mime_type } });
      } else {
        ztoolkit.log?.(`Skip too-large file: ${fileInfo.path}`);
      }
    }

    if (parts.length) {
      if (contents[0].parts) contents[0].parts.push(...parts);
      else contents[0].parts = parts;
    }

    const body: any = { contents, generationConfig: {} };
    if (prefs.enableThoughts) {
      body.generationConfig.thinkingConfig = {
        thinkingBudget: prefs.thinkingBudget ?? -1,
        includeThoughts: true,
      };
    }

    const res = await fetch(genUrl, {
      method: "POST",
      headers: this.headers(prefs),
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(
        `Gemini v1beta (pdf-native) error: ${res.status} ${await res.text()}`,
      );
    }
    const data: any = await res.json();
    const { answer, thoughts } = extractTextAndThoughtsFromGeminiResponse(data);
    return { markdown: answer, thoughtsMarkdown: thoughts };
  }

  private async uploadViaFilesApi(
    base: string,
    fileInfo: {
      bytes: Uint8Array;
      sizeBytes: number;
      mimeType: string;
      displayName: string;
    },
  ) {
    const startUrl = `${base}/upload/v1beta/files`;
    const start = await fetch(startUrl, {
      method: "POST",
      headers: {
        "X-Goog-Upload-Protocol": "resumable",
        "X-Goog-Upload-Command": "start",
        "X-Goog-Upload-Header-Content-Length": String(fileInfo.sizeBytes),
        "X-Goog-Upload-Header-Content-Type": fileInfo.mimeType,
        "Content-Type": "application/json",
        Authorization: `Bearer ${getApiKey()}`,
      },
      body: JSON.stringify({ file: { display_name: fileInfo.displayName } }),
    });
    const uploadUrl = start.headers.get("x-goog-upload-url");
    if (!uploadUrl) {
      throw new Error("No resumable upload URL returned by Files API proxy");
    }

    const finalize = await fetch(uploadUrl, {
      method: "POST",
      headers: {
        "Content-Length": String(fileInfo.sizeBytes),
        "X-Goog-Upload-Offset": "0",
        "X-Goog-Upload-Command": "upload, finalize",
        Authorization: `Bearer ${getApiKey()}`,
      },
      body: fileInfo.bytes,
    });
    if (!finalize.ok) {
      throw new Error(
        `Files API upload failed: ${finalize.status} ${await finalize.text()}`,
      );
    }
    const file: any = await finalize.json();
    return { file_uri: file?.file?.uri, mime_type: fileInfo.mimeType };
  }
}

function extractTextAndThoughtsFromGeminiResponse(resp: any) {
  let answer = "";
  let thoughts = "";

  try {
    const parts = resp?.candidates?.[0]?.content?.parts ?? [];
    for (const p of parts) {
      const t = p?.text ?? "";
      if (!t) continue;
      if (p?.thought) thoughts += `${t}\n`;
      else answer += `${t}\n`;
    }
  } catch (_e) {
    // ignore parse errors
  }

  return { answer: answer.trim(), thoughts: thoughts.trim() };
}

async function readPdfFile(att: Zotero.Item) {
  try {
    const getFilePath = (att as any).getFilePath || att.getFilePath;
    const path = getFilePath ? getFilePath.call(att) : "";
    if (!path) return null;

    const mimeType =
      (att.getField?.("contentType") as string) || "application/pdf";

    // Only handle PDF-like attachments for pdf-native path
    if (!mimeType.toLowerCase().includes("pdf")) return null;

    // Use Zotero.File to read the binary contents
    const binary: any = await Zotero.File.getBinaryContentsAsync(path);
    let bytes: Uint8Array;
    if (binary instanceof Uint8Array) {
      bytes = binary;
    } else if (typeof binary === "string") {
      // Interpret the string as binary data
      const encoder = new TextEncoder();
      bytes = encoder.encode(binary);
    } else if (binary instanceof ArrayBuffer) {
      bytes = new Uint8Array(binary);
    } else {
      return null;
    }

    const sizeBytes = bytes.byteLength;
    const sizeMB = sizeBytes / (1024 * 1024);

    // Convert to base64 for inline_data
    let binaryString = "";
    for (let i = 0; i < bytes.length; i++) {
      binaryString += String.fromCharCode(bytes[i]);
    }
    const base64 = btoa(binaryString);

    const displayName =
      ((att as any).attachmentFilename as string) ||
      (att.getField?.("title") as string) ||
      "attachment.pdf";

    return {
      path,
      bytes,
      sizeBytes,
      sizeMB,
      mimeType,
      base64,
      displayName,
    };
  } catch (e) {
    ztoolkit.log?.(`Failed to read PDF file for Gemini: ${e}`);
    return null;
  }
}
