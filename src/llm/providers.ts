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
 * 通过 Gemini 原生 API 进行远端 PDF 解析
 * 使用 inlineData 直接上传 PDF，由远端解析图片和文本
 */
export async function summarizeWithRemotePdf(
  opts: RemotePdfSummarizeOptions,
): Promise<SummarizeResult> {
  const { prefs, prompt, pdfBase64 } = opts;

  // 构建 Gemini 原生 API 端点
  // 从 apiBase 中提取基础 URL（去掉 /v1 后缀如果有的话）
  const baseUrl = prefs.apiBase.replace(/\/v1\/?$/, "").replace(/\/$/, "");
  const url = `${baseUrl}/v1/models/${prefs.model}:generateContent`;

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

  const data = (await res.json()) as {
    candidates?: Array<{
      content?: {
        parts?: Array<{
          text?: string;
          thought?: boolean;
        }>;
      };
    }>;
    // OpenAI 兼容格式备用
    choices?: Array<{
      message?: {
        content?: string;
      };
    }>;
  };

  // 解析 Gemini 原生格式响应
  let markdown = "";
  let thoughtsMarkdown = "";

  if (data.candidates?.[0]?.content?.parts) {
    for (const part of data.candidates[0].content.parts) {
      if (part.thought && part.text) {
        thoughtsMarkdown += part.text + "\n";
      } else if (part.text) {
        markdown += part.text;
      }
    }
  }
  // 备用：OpenAI 兼容格式
  else if (data.choices?.[0]?.message?.content) {
    markdown = data.choices[0].message.content;
  }

  return {
    markdown: markdown.trim(),
    thoughtsMarkdown: thoughtsMarkdown.trim() || undefined,
  };
}
