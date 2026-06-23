import type { AddonPrefs } from "../utils/prefs";

export interface SummarizeOptions {
  title: string;
  abstract?: string;
  content: string; // 从 PDF 提取的纯文本
  prompt: string;
  prefs: AddonPrefs;
}

/**
 * 远端 PDF 解析选项
 */
export interface RemotePdfSummarizeOptions {
  title: string;
  abstract?: string;
  pdfBase64: string; // PDF 文件的 base64 编码
  fileName?: string;
  prompt: string;
  prefs: AddonPrefs;
  onStreamChunk?: (chunk: string, isThought: boolean) => void; // 流式输出回调
}

export interface SummarizeResult {
  markdown: string;
  thoughtsMarkdown?: string;
}

function getApiKey(prefs: AddonPrefs): string {
  const key = prefs.apiKey || "";
  if (!key) {
    throw new Error(
      `未配置 ${prefs.providerLabel} API Key，请在偏好设置中填写。`,
    );
  }
  return key;
}

export function getChatCompletionsUrl(prefs: AddonPrefs): string {
  return `${prefs.apiBase.replace(/\/$/, "")}/chat/completions`;
}

function isOpenAIChatProvider(prefs: AddonPrefs): boolean {
  return (
    prefs.provider === "openai-compatible" ||
    prefs.provider === "mimo-token-plan"
  );
}

function getOpenAIChatAuthHeaders(prefs: AddonPrefs): Record<string, string> {
  const apiKey = getApiKey(prefs);
  if (prefs.provider === "mimo-token-plan") {
    return { "api-key": apiKey };
  }
  return { Authorization: `Bearer ${apiKey}` };
}

export function buildOpenAICompatibleChatRequest(opts: {
  prefs: AddonPrefs;
  messages: Array<Record<string, unknown>>;
  stream?: boolean;
  maxOutputTokens?: number;
  extraBody?: Record<string, unknown>;
  extraHeaders?: Record<string, string>;
}): {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
} {
  const { prefs, messages, extraBody, extraHeaders } = opts;
  const body: Record<string, unknown> = {
    model: prefs.model,
    messages,
    temperature: prefs.temperature ?? 0.2,
  };

  if (opts.stream !== undefined) {
    body.stream = opts.stream;
  }

  const maxOutputTokens = opts.maxOutputTokens ?? prefs.maxOutputTokens;
  if (maxOutputTokens !== undefined) {
    if (prefs.provider === "mimo-token-plan") {
      body.max_completion_tokens = maxOutputTokens;
    } else {
      body.max_tokens = maxOutputTokens;
    }
  }

  applyOpenAICompatibleThinkingConfig(body, prefs);
  Object.assign(body, extraBody);

  return {
    url: getChatCompletionsUrl(prefs),
    headers: {
      "Content-Type": "application/json",
      ...getOpenAIChatAuthHeaders(prefs),
      ...extraHeaders,
    },
    body,
  };
}

/**
 * 通过 OpenAI 兼容接口调用 Gemini
 * 支持 x666.me 等代理服务
 */
export async function summarize(
  opts: SummarizeOptions,
): Promise<SummarizeResult> {
  const { prefs, prompt } = opts;
  const request = buildOpenAICompatibleChatRequest({
    prefs,
    messages: [
      { role: "system", content: "You are an academic assistant." },
      { role: "user", content: prompt },
    ],
  });

  const res = await fetch(request.url, {
    method: "POST",
    headers: request.headers,
    body: JSON.stringify(request.body),
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`API 请求失败: ${res.status} ${errorText}`);
  }

  const data = (await res.json()) as {
    choices?: Array<{
      message?: {
        content?: string;
      };
    }>;
  };

  const text = data?.choices?.[0]?.message?.content?.trim() ?? "";
  return { markdown: text };
}

/**
 * 测试 API 连接
 */
export async function testAPI(prefs: AddonPrefs): Promise<string> {
  const request = buildOpenAICompatibleChatRequest({
    prefs: {
      ...prefs,
      temperature: 0.1,
    },
    messages: [{ role: "user", content: "请直接回复：pong" }],
    maxOutputTokens: 10,
  });

  const res = await fetch(request.url, {
    method: "POST",
    headers: request.headers,
    body: JSON.stringify(request.body),
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`${res.status} ${errorText}`);
  }

  const data = (await res.json()) as {
    choices?: Array<{
      message?: {
        content?: string;
      };
    }>;
  };

  return data?.choices?.[0]?.message?.content?.trim() ?? "(无响应)";
}

/**
 * 通过 Gemini 原生 API 进行远端 PDF 解析（流式响应）
 * 使用 inlineData 直接上传 PDF，由远端解析图片和文本
 * 使用流式响应避免 Cloudflare 超时
 */
export async function summarizeWithRemotePdf(
  opts: RemotePdfSummarizeOptions,
): Promise<SummarizeResult> {
  if (isOpenAIChatProvider(opts.prefs)) {
    return summarizeWithOpenAICompatibleRemotePdf(opts);
  }

  return summarizeWithGeminiRemotePdf(opts);
}

async function summarizeWithGeminiRemotePdf(
  opts: RemotePdfSummarizeOptions,
): Promise<SummarizeResult> {
  const { prefs, prompt, pdfBase64, onStreamChunk } = opts;

  // 构建 Gemini 原生 API 端点（流式）
  // 从 apiBase 中提取基础 URL（去掉 /v1 后缀如果有的话）
  const baseUrl = prefs.apiBase.replace(/\/v1\/?$/, "").replace(/\/$/, "");
  // 使用 streamGenerateContent 端点 + alt=sse 参数
  const url = `${baseUrl}/v1/models/${prefs.model}:streamGenerateContent?alt=sse`;

  // 构建 Gemini 原生格式的请求体
  const body: Record<string, unknown> = {
    contents: [
      {
        parts: [
          { text: prompt },
          {
            inlineData: {
              mimeType: "application/pdf",
              data: pdfBase64,
            },
          },
        ],
      },
    ],
    generationConfig: {
      temperature: prefs.temperature ?? 0.2,
      maxOutputTokens: prefs.maxOutputTokens ?? 65536,
    },
  };

  // 添加 thinking 配置（如果启用）
  if (prefs.enableThoughts) {
    (body.generationConfig as Record<string, unknown>).thinkingConfig = {
      thinkingBudget: prefs.thinkingBudget ?? -1,
      // 在部分代理/兼容层中，需要显式开启才会返回 thought 字段
      includeThoughts: true,
    };
  }

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${getApiKey(prefs)}`,
      "x-goog-api-key": getApiKey(prefs),
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(
      `远端 PDF 解析失败: ${res.status} ${errorText.substring(0, 500)}`,
    );
  }

  // 解析 SSE 流式响应
  const result = await parseSSEResponse(res, onStreamChunk);
  return result;
}

/**
 * Stream Gemini native API for text-only input (local parse).
 */
export async function summarizeWithGeminiTextStream(
  opts: SummarizeOptions & {
    onStreamChunk?: (chunk: string, isThought: boolean) => void;
  },
): Promise<SummarizeResult> {
  const { prefs, prompt, onStreamChunk } = opts;

  const baseUrl = prefs.apiBase.replace(/\/v1\/?$/, "").replace(/\/$/, "");
  const url = `${baseUrl}/v1/models/${prefs.model}:streamGenerateContent?alt=sse`;

  const body: Record<string, unknown> = {
    contents: [
      {
        parts: [{ text: prompt }],
      },
    ],
    generationConfig: {
      temperature: prefs.temperature ?? 0.2,
      maxOutputTokens: prefs.maxOutputTokens ?? 65536,
    },
  };

  if (prefs.enableThoughts) {
    (body.generationConfig as Record<string, unknown>).thinkingConfig = {
      thinkingBudget: prefs.thinkingBudget ?? -1,
      includeThoughts: true,
    };
  }

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${getApiKey(prefs)}`,
      "x-goog-api-key": getApiKey(prefs),
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(
      `本地解析失败: ${res.status} ${errorText.substring(0, 500)}`,
    );
  }

  return await parseSSEResponse(res, onStreamChunk);
}

export async function summarizeWithTextStream(
  opts: SummarizeOptions & {
    onStreamChunk?: (chunk: string, isThought: boolean) => void;
  },
): Promise<SummarizeResult> {
  if (isOpenAIChatProvider(opts.prefs)) {
    return summarizeWithOpenAICompatibleTextStream(opts);
  }
  return summarizeWithGeminiTextStream(opts);
}

function applyOpenAICompatibleThinkingConfig(
  body: Record<string, unknown>,
  prefs: AddonPrefs,
): void {
  if (!prefs.enableThoughts) return;
  if (prefs.provider === "mimo-token-plan") return;

  const thinking: Record<string, unknown> = { type: "enabled" };
  if (prefs.thinkingBudget > 0) {
    thinking.budget_tokens = prefs.thinkingBudget;
  }

  body.extra_body = { thinking };
}

async function summarizeWithOpenAICompatibleRemotePdf(
  opts: RemotePdfSummarizeOptions,
): Promise<SummarizeResult> {
  const { prefs, prompt, pdfBase64, fileName, onStreamChunk } = opts;
  if (prefs.provider === "mimo-token-plan") {
    throw new Error(
      "MiMo Token Plan 暂不支持远端 PDF 直传，请将 PDF 解析模式切换为本地（提取文本）。",
    );
  }

  const safeFileName = fileName || "document.pdf";
  const content = [
    {
      type: "text",
      text: [
        prompt,
        "",
        "# 文件清单",
        `以下 PDF 已作为同一条 chat 请求中的 input_file 附件提交，请优先读取附件原文：${safeFileName}`,
      ].join("\n"),
    },
    {
      type: "input_file",
      filename: safeFileName,
      mime_type: "application/pdf",
      file_data: pdfBase64,
    },
  ];

  return streamOpenAICompatibleChat({
    prefs,
    messages: [
      { role: "system", content: "You are an academic assistant." },
      { role: "user", content },
    ],
    onStreamChunk,
    errorPrefix: "OpenAI Compatible 远端 PDF 解析失败",
  });
}

async function summarizeWithOpenAICompatibleTextStream(
  opts: SummarizeOptions & {
    onStreamChunk?: (chunk: string, isThought: boolean) => void;
  },
): Promise<SummarizeResult> {
  const { prefs, prompt, onStreamChunk } = opts;
  return streamOpenAICompatibleChat({
    prefs,
    messages: [
      { role: "system", content: "You are an academic assistant." },
      { role: "user", content: prompt },
    ],
    onStreamChunk,
    errorPrefix: "OpenAI Compatible 本地解析失败",
  });
}

async function streamOpenAICompatibleChat(opts: {
  prefs: AddonPrefs;
  messages: Array<Record<string, unknown>>;
  extraBody?: Record<string, unknown>;
  extraHeaders?: Record<string, string>;
  onStreamChunk?: (chunk: string, isThought: boolean) => void;
  errorPrefix: string;
}): Promise<SummarizeResult> {
  const {
    prefs,
    messages,
    extraBody,
    extraHeaders,
    onStreamChunk,
    errorPrefix,
  } = opts;
  const request = buildOpenAICompatibleChatRequest({
    prefs,
    messages,
    stream: true,
    extraBody,
    extraHeaders,
  });

  const res = await fetch(request.url, {
    method: "POST",
    headers: request.headers,
    body: JSON.stringify(request.body),
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(
      `${errorPrefix}: ${res.status} ${errorText.substring(0, 500)}`,
    );
  }

  return parseOpenAICompatibleStreamResponse(res, onStreamChunk);
}

function extractTextLike(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value
      .map((part) => {
        if (typeof part === "string") return part;
        if (typeof part?.text === "string") return part.text;
        return "";
      })
      .join("");
  }
  if (
    value &&
    typeof value === "object" &&
    typeof (value as any).text === "string"
  ) {
    return (value as any).text;
  }
  return "";
}

function extractReasoningChunk(delta: Record<string, unknown>): string {
  return (
    extractTextLike(delta.reasoning_content) ||
    extractTextLike(delta.reasoning) ||
    extractTextLike(delta.thinking) ||
    extractTextLike(delta.thought)
  );
}

async function parseOpenAICompatibleStreamResponse(
  res: Response,
  onStreamChunk?: (chunk: string, isThought: boolean) => void,
): Promise<SummarizeResult> {
  const reader = res.body?.getReader() as
    | ReadableStreamDefaultReader<Uint8Array>
    | undefined;
  if (!reader) {
    const text = await res.text();
    return parseOpenAICompatibleSingleResponse(text, onStreamChunk);
  }

  let markdown = "";
  let thoughtsMarkdown = "";
  let streamError: string | null = null;
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const result = await (reader as any).read();
      const { done, value } = result as { done: boolean; value?: Uint8Array };
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line.startsWith("data:")) continue;
        const jsonStr = line.slice(5).trim();
        if (!jsonStr || jsonStr === "[DONE]") continue;

        try {
          const data = JSON.parse(jsonStr) as Record<string, unknown>;

          const sseError = extractSSEError(data);
          if (sseError) {
            streamError = sseError;
            continue;
          }

          const choices = data.choices as
            | Array<Record<string, unknown>>
            | undefined;
          const delta = choices?.[0]?.delta ?? choices?.[0]?.message ?? {};
          const thoughtChunk = extractReasoningChunk(
            delta as Record<string, unknown>,
          );
          const contentChunk = extractTextLike(
            (delta as Record<string, unknown>).content,
          );

          if (thoughtChunk) {
            thoughtsMarkdown += thoughtChunk;
            onStreamChunk?.(thoughtChunk, true);
          }
          if (contentChunk) {
            markdown += contentChunk;
            onStreamChunk?.(contentChunk, false);
          }
        } catch (_e) {
          continue;
        }
      }
    }

    if (buffer.trim().startsWith("data:")) {
      const jsonStr = buffer.trim().slice(5).trim();
      if (jsonStr && jsonStr !== "[DONE]") {
        try {
          const data = JSON.parse(jsonStr) as Record<string, unknown>;
          const sseError = extractSSEError(data);
          if (sseError) {
            streamError = sseError;
          } else {
            const choices = data.choices as
              | Array<Record<string, unknown>>
              | undefined;
            const delta = choices?.[0]?.delta ?? choices?.[0]?.message ?? {};
            const thoughtChunk = extractReasoningChunk(
              delta as Record<string, unknown>,
            );
            const contentChunk = extractTextLike(
              (delta as Record<string, unknown>).content,
            );
            if (thoughtChunk) {
              thoughtsMarkdown += thoughtChunk;
              onStreamChunk?.(thoughtChunk, true);
            }
            if (contentChunk) {
              markdown += contentChunk;
              onStreamChunk?.(contentChunk, false);
            }
          }
        } catch (_e) {
          // ignore trailing partial chunk
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  // 如果收到了服务端错误事件且没有生成正文内容，抛出异常以触发重试
  if (!markdown.trim() && streamError) {
    throw new Error(`SSE stream error: ${streamError}`);
  }

  return {
    markdown: markdown.trim(),
    thoughtsMarkdown: thoughtsMarkdown.trim() || undefined,
  };
}

function parseOpenAICompatibleSingleResponse(
  text: string,
  onStreamChunk?: (chunk: string, isThought: boolean) => void,
): SummarizeResult {
  try {
    const data = JSON.parse(text);
    const message = data.choices?.[0]?.message ?? {};
    const thoughtsMarkdown = extractReasoningChunk(message).trim();
    const markdown = extractTextLike(message.content).trim();
    if (thoughtsMarkdown) onStreamChunk?.(thoughtsMarkdown, true);
    if (markdown) onStreamChunk?.(markdown, false);
    return { markdown, thoughtsMarkdown: thoughtsMarkdown || undefined };
  } catch (_e) {
    return { markdown: "", thoughtsMarkdown: undefined };
  }
}

/**
 * 从 SSE 事件 JSON 中提取错误信息
 */
function extractSSEError(data: Record<string, unknown>): string | null {
  if (!data.error) return null;
  if (typeof data.error === "string") return data.error;
  if (typeof data.error === "object") {
    const err = data.error as Record<string, unknown>;
    return String(err.message || err.msg || err.code || JSON.stringify(err));
  }
  return String(data.error);
}

/**
 * 解析 SSE 流式响应（真正的流式读取）
 */
async function parseSSEResponse(
  res: Response,
  onStreamChunk?: (chunk: string, isThought: boolean) => void,
): Promise<SummarizeResult> {
  let markdown = "";
  let thoughtsMarkdown = "";
  let streamError: string | null = null;

  const extractChunk = (part: any): string => {
    if (typeof part?.text === "string" && part.text) return part.text;
    if (typeof part?.thought === "string" && part.thought) return part.thought;
    if (
      part?.thought &&
      typeof part.thought === "object" &&
      typeof part.thought.text === "string" &&
      part.thought.text
    ) {
      return part.thought.text;
    }
    return "";
  };

  const isThoughtPart = (part: any): boolean => {
    return (
      part?.thought === true ||
      typeof part?.thought === "string" ||
      (part?.thought &&
        typeof part.thought === "object" &&
        typeof part.thought.text === "string")
    );
  };

  // 使用 ReadableStream 进行真正的流式读取
  const reader = res.body?.getReader() as
    | ReadableStreamDefaultReader<Uint8Array>
    | undefined;
  if (!reader) {
    // 降级到一次性读取
    const text = await res.text();
    return parseSingleResponse(text, onStreamChunk);
  }

  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const result = await (reader as any).read();
      const { done, value } = result as { done: boolean; value?: Uint8Array };
      if (done) break;

      // 解码并追加到缓冲区
      buffer += decoder.decode(value, { stream: true });

      // 按行处理
      const lines = buffer.split("\n");
      // 保留最后一行（可能不完整）
      buffer = lines.pop() || "";

      for (const line of lines) {
        // SSE 格式：data: {...json...}
        if (line.startsWith("data: ")) {
          const jsonStr = line.slice(6).trim();
          if (!jsonStr || jsonStr === "[DONE]") continue;

          try {
            const data = JSON.parse(jsonStr) as Record<string, unknown>;

            // 检查是否为服务端错误事件
            const sseError = extractSSEError(data);
            if (sseError) {
              streamError = sseError;
              continue;
            }

            // 解析每个响应片段
            if (
              Array.isArray(data.candidates) &&
              (data.candidates[0] as any)?.content?.parts
            ) {
              for (const part of (data.candidates[0] as any).content.parts) {
                const chunk = extractChunk(part);
                if (!chunk) continue;
                if (isThoughtPart(part)) {
                  thoughtsMarkdown += chunk;
                  onStreamChunk?.(chunk, true);
                } else {
                  markdown += chunk;
                  onStreamChunk?.(chunk, false);
                }
              }
            }
          } catch (e) {
            // 忽略解析错误，继续处理下一行
            continue;
          }
        }
      }
    }

    // 处理剩余的缓冲区
    if (buffer.startsWith("data: ")) {
      const jsonStr = buffer.slice(6).trim();
      if (jsonStr && jsonStr !== "[DONE]") {
        try {
          const data = JSON.parse(jsonStr) as Record<string, unknown>;
          const sseError = extractSSEError(data);
          if (sseError) {
            streamError = sseError;
          } else if (
            Array.isArray(data.candidates) &&
            (data.candidates[0] as any)?.content?.parts
          ) {
            for (const part of (data.candidates[0] as any).content.parts) {
              const chunk = extractChunk(part);
              if (!chunk) continue;
              if (isThoughtPart(part)) {
                thoughtsMarkdown += chunk;
                onStreamChunk?.(chunk, true);
              } else {
                markdown += chunk;
                onStreamChunk?.(chunk, false);
              }
            }
          }
        } catch (e) {
          // 忽略
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  // 如果流式解析没有获取到内容，尝试直接解析
  if (!markdown && !thoughtsMarkdown) {
    // 可能是非 SSE 格式的响应
    return { markdown: "", thoughtsMarkdown: undefined };
  }

  // 如果收到了服务端错误事件且没有生成正文内容，抛出异常以触发重试
  if (!markdown.trim() && streamError) {
    throw new Error(`SSE stream error: ${streamError}`);
  }

  return {
    markdown: markdown.trim(),
    thoughtsMarkdown: thoughtsMarkdown.trim() || undefined,
  };
}

/**
 * 解析单次响应（非流式或降级）
 */
function parseSingleResponse(
  text: string,
  onStreamChunk?: (chunk: string, isThought: boolean) => void,
): SummarizeResult {
  let markdown = "";
  let thoughtsMarkdown = "";

  const extractChunk = (part: any): string => {
    if (typeof part?.text === "string" && part.text) return part.text;
    if (typeof part?.thought === "string" && part.thought) return part.thought;
    if (
      part?.thought &&
      typeof part.thought === "object" &&
      typeof part.thought.text === "string" &&
      part.thought.text
    ) {
      return part.thought.text;
    }
    return "";
  };

  const isThoughtPart = (part: any): boolean => {
    return (
      part?.thought === true ||
      typeof part?.thought === "string" ||
      (part?.thought &&
        typeof part.thought === "object" &&
        typeof part.thought.text === "string")
    );
  };

  // 尝试解析 SSE 格式
  const lines = text.split("\n");
  for (const line of lines) {
    if (line.startsWith("data: ")) {
      const jsonStr = line.slice(6).trim();
      if (!jsonStr || jsonStr === "[DONE]") continue;

      try {
        const data = JSON.parse(jsonStr);
        if (data.candidates?.[0]?.content?.parts) {
          for (const part of data.candidates[0].content.parts) {
            const chunk = extractChunk(part);
            if (!chunk) continue;
            if (isThoughtPart(part)) {
              thoughtsMarkdown += chunk;
              onStreamChunk?.(chunk, true);
            } else {
              markdown += chunk;
              onStreamChunk?.(chunk, false);
            }
          }
        }
      } catch (e) {
        continue;
      }
    }
  }

  // 如果 SSE 解析失败，尝试直接解析 JSON
  if (!markdown && !thoughtsMarkdown) {
    try {
      const data = JSON.parse(text);
      if (data.candidates?.[0]?.content?.parts) {
        for (const part of data.candidates[0].content.parts) {
          if (part.thought && part.text) {
            thoughtsMarkdown += part.text + "\n";
            onStreamChunk?.(part.text + "\n", true);
          } else if (part.text) {
            markdown += part.text;
            onStreamChunk?.(part.text, false);
          }
        }
      } else if (data.choices?.[0]?.message?.content) {
        markdown = data.choices[0].message.content;
        onStreamChunk?.(markdown, false);
      }
    } catch (e) {
      // 解析失败
    }
  }

  return {
    markdown: markdown.trim(),
    thoughtsMarkdown: thoughtsMarkdown.trim() || undefined,
  };
}
