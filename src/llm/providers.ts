import { getPref, type AddonPrefs } from "../utils/prefs";

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
  prompt: string;
  prefs: AddonPrefs;
}

export interface SummarizeResult {
  markdown: string;
  thoughtsMarkdown?: string;
}

function getApiKey(): string {
  const key = (getPref("apiKey") as string) || "";
  if (!key) {
    throw new Error("未配置 API Key，请在偏好设置中填写。");
  }
  return key;
}

/**
 * 通过 OpenAI 兼容接口调用 Gemini
 * 支持 x666.me 等代理服务
 */
export async function summarize(opts: SummarizeOptions): Promise<SummarizeResult> {
  const { prefs, prompt } = opts;
  const url = `${prefs.apiBase.replace(/\/$/, "")}/chat/completions`;

  const body: Record<string, unknown> = {
    model: prefs.model,
    messages: [
      { role: "system", content: "You are an academic assistant." },
      { role: "user", content: prompt },
    ],
    temperature: prefs.temperature ?? 0.2,
  };

  // 通过 extra_body 传递 Gemini 的 thinking 配置
  if (prefs.enableThoughts) {
    body.extra_body = {
      generationConfig: {
        thinkingConfig: { thinkingBudget: prefs.thinkingBudget ?? -1 },
      },
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
  const url = `${prefs.apiBase.replace(/\/$/, "")}/chat/completions`;

  const body = {
    model: prefs.model,
    messages: [
      { role: "user", content: "请直接回复：pong" },
    ],
    temperature: 0.1,
    max_tokens: 10,
  };

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${getApiKey()}`,
    },
    body: JSON.stringify(body),
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
  const { prefs, prompt, pdfBase64 } = opts;

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
      maxOutputTokens: prefs.maxOutputTokens ?? 32768,
    },
  };

  // 添加 thinking 配置（如果启用）
  if (prefs.enableThoughts) {
    (body.generationConfig as Record<string, unknown>).thinkingConfig = {
      thinkingBudget: prefs.thinkingBudget ?? -1,
    };
  }

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${getApiKey()}`,
      "x-goog-api-key": getApiKey(),
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`远端 PDF 解析失败: ${res.status} ${errorText.substring(0, 500)}`);
  }

  // 解析 SSE 流式响应
  const result = await parseSSEResponse(res);
  return result;
}

/**
 * 解析 SSE 流式响应
 */
async function parseSSEResponse(res: Response): Promise<SummarizeResult> {
  let markdown = "";
  let thoughtsMarkdown = "";

  // 获取响应文本并解析 SSE 格式
  const text = await res.text();
  const lines = text.split("\n");

  for (const line of lines) {
    // SSE 格式：data: {...json...}
    if (line.startsWith("data: ")) {
      const jsonStr = line.slice(6).trim();
      if (!jsonStr || jsonStr === "[DONE]") continue;

      try {
        const data = JSON.parse(jsonStr) as {
          candidates?: Array<{
            content?: {
              parts?: Array<{
                text?: string;
                thought?: boolean;
              }>;
            };
          }>;
        };

        // 解析每个响应片段
        if (data.candidates?.[0]?.content?.parts) {
          for (const part of data.candidates[0].content.parts) {
            if (part.thought && part.text) {
              thoughtsMarkdown += part.text;
            } else if (part.text) {
              markdown += part.text;
            }
          }
        }
      } catch (e) {
        // 忽略解析错误，继续处理下一行
        continue;
      }
    }
  }

  // 如果流式解析没有获取到内容，尝试直接解析整个响应（兼容非流式响应）
  if (!markdown && !thoughtsMarkdown) {
    try {
      const data = JSON.parse(text) as {
        candidates?: Array<{
          content?: {
            parts?: Array<{
              text?: string;
              thought?: boolean;
            }>;
          };
        }>;
        choices?: Array<{
          message?: {
            content?: string;
          };
        }>;
      };

      if (data.candidates?.[0]?.content?.parts) {
        for (const part of data.candidates[0].content.parts) {
          if (part.thought && part.text) {
            thoughtsMarkdown += part.text + "\n";
          } else if (part.text) {
            markdown += part.text;
          }
        }
      } else if (data.choices?.[0]?.message?.content) {
        markdown = data.choices[0].message.content;
      }
    } catch (e) {
      // 解析失败，返回空结果
    }
  }

  return {
    markdown: markdown.trim(),
    thoughtsMarkdown: thoughtsMarkdown.trim() || undefined,
  };
}
