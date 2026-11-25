import type { SummarizeResult } from "./providers";

export const OPENAI_API_BASE = "https://api.openai.com/v1";
export const OPENAI_MODEL = "gpt-6-luna";
export const OPENAI_MAX_OUTPUT_TOKENS = 128_000;
export const OPENAI_PDF_SIZE_LIMIT = 50_000_000;

interface OpenAIResponse {
  status?: string;
  error?: { message?: string };
  incomplete_details?: { reason?: string };
  output?: Array<{
    type: string;
    content?: Array<{ type: string; text?: string }>;
  }>;
}

function getOutputText(response: OpenAIResponse): string {
  return (response.output ?? [])
    .filter((item) => item.type === "message")
    .flatMap((item) => item.content ?? [])
    .filter((part) => part.type === "output_text")
    .map((part) => part.text ?? "")
    .join("")
    .trim();
}

function responseError(response?: OpenAIResponse): string {
  return (
    response?.error?.message ||
    response?.incomplete_details?.reason ||
    response?.status ||
    "unknown error"
  );
}

async function postOpenAIResponse(
  apiKey: string,
  body: Record<string, unknown>,
): Promise<Response> {
  const response = await fetch(`${OPENAI_API_BASE}/responses`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ model: OPENAI_MODEL, store: false, ...body }),
  });
  if (!response.ok) {
    throw new Error(
      `OpenAI ${response.status}: ${(await response.text()).slice(0, 900)}`,
    );
  }
  return response;
}

export async function testOpenAI(apiKey: string): Promise<string> {
  const response = await postOpenAIResponse(apiKey, {
    input: "Reply with just: pong",
    reasoning: { effort: "none" },
    max_output_tokens: 64,
  });
  const data = (await response.json()) as unknown as OpenAIResponse;
  const text = getOutputText(data);
  if (data.status !== "completed" || !text) {
    throw new Error(`OpenAI 测试未返回正文: ${responseError(data)}`);
  }
  return text;
}

export async function streamOpenAIResponse(options: {
  apiKey: string;
  prompt: string;
  pdfBase64?: string;
  fileName?: string;
  onStreamChunk?: (chunk: string, isThought: boolean) => void;
}): Promise<SummarizeResult> {
  const { apiKey, prompt, pdfBase64, fileName, onStreamChunk } = options;
  if (pdfBase64) {
    const padding = pdfBase64.endsWith("==")
      ? 2
      : pdfBase64.endsWith("=")
        ? 1
        : 0;
    if ((pdfBase64.length * 3) / 4 - padding >= OPENAI_PDF_SIZE_LIMIT) {
      throw new Error("OpenAI 413: PDF must be smaller than 50 MB");
    }
  }

  const content: Array<Record<string, string>> = [
    { type: "input_text", text: prompt },
  ];
  if (pdfBase64) {
    content.push({
      type: "input_file",
      filename: fileName || "document.pdf",
      file_data: `data:application/pdf;base64,${pdfBase64}`,
    });
  }

  const response = await postOpenAIResponse(apiKey, {
    instructions: "You are an academic assistant.",
    input: [{ role: "user", content }],
    reasoning: { effort: "max" },
    max_output_tokens: OPENAI_MAX_OUTPUT_TOKENS,
    truncation: "disabled",
    stream: true,
  });
  return readOpenAIStream(response, onStreamChunk);
}

async function readOpenAIStream(
  response: Response,
  onStreamChunk?: (chunk: string, isThought: boolean) => void,
): Promise<SummarizeResult> {
  const reader = response.body?.getReader() as
    | ReadableStreamDefaultReader<Uint8Array>
    | undefined;
  if (!reader) {
    throw new Error("OpenAI SSE stream error: missing response body");
  }

  const decoder = new TextDecoder();
  let buffer = "";
  let markdown = "";
  let refusal = "";
  let completed: OpenAIResponse | undefined;

  function processEvent(frame: string) {
    const data = frame
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");
    if (!data || data === "[DONE]") return;

    const event = JSON.parse(data) as {
      type: string;
      delta?: string;
      response?: OpenAIResponse;
      message?: string;
    };
    switch (event.type) {
      case "response.output_text.delta":
        if (event.delta) {
          markdown += event.delta;
          onStreamChunk?.(event.delta, false);
        }
        break;
      case "response.refusal.delta":
        refusal += event.delta ?? "";
        break;
      case "response.completed":
        completed = event.response;
        break;
      case "response.incomplete":
        throw new Error(`OpenAI 摘要未完成: ${responseError(event.response)}`);
      case "response.failed":
        throw new Error(`OpenAI 摘要失败: ${responseError(event.response)}`);
      case "error":
        throw new Error(
          `OpenAI SSE stream error: ${event.message || "unknown error"}`,
        );
    }
  }

  try {
    while (!completed) {
      const { done, value } = await reader.read();
      if (done) {
        processEvent(buffer + decoder.decode(new Uint8Array()));
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      const frames = buffer.split(/\r?\n\r?\n/);
      buffer = frames.pop() ?? "";
      for (const frame of frames) processEvent(frame);
    }
  } finally {
    void reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }

  if (!completed) {
    throw new Error(
      "OpenAI SSE stream error: response ended before completion",
    );
  }
  const text = getOutputText(completed) || markdown.trim();
  if (!text && refusal)
    throw new Error(`OpenAI 拒绝生成摘要: ${refusal.trim()}`);
  if (text && !markdown) onStreamChunk?.(text, false);
  return { markdown: text };
}
