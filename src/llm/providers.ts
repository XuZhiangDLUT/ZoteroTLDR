import { getPref, type AddonPrefs } from "../utils/prefs";

export interface SummarizeOptions {
  title: string;
  abstract?: string;
  content: string; // 从 PDF 提取的纯文本
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
