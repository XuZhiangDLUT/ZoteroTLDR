/**
 * API 测试脚本
 * 用于测试远端 PDF 解析的超时问题
 *
 * 使用方法：
 * 1. 在 Node.js 环境中运行：npx ts-node test/api-test.ts
 * 2. 或者在浏览器控制台中运行（需要修改 import）
 */

// 配置
const CONFIG = {
  apiBase: "https://x666.me/v1",
  apiKey: "YOUR_API_KEY_HERE", // 替换为你的 API Key
  model: "gemini-2.5-pro-1m",
  enableThoughts: true,
  thinkingBudget: -1,
  temperature: 0.2,
  maxOutputTokens: 32768,
};

// 测试用的小 PDF（base64 编码的最小有效 PDF）
const MINIMAL_PDF_BASE64 =
  "JVBERi0xLjQKMSAwIG9iago8PAovVHlwZSAvQ2F0YWxvZwovUGFnZXMgMiAwIFIKPj4KZW5kb2JqCjIgMCBvYmoKPDwKL1R5cGUgL1BhZ2VzCi9LaWRzIFszIDAgUl0KL0NvdW50IDEKL01lZGlhQm94IFswIDAgNjEyIDc5Ml0KPj4KZW5kb2JqCjMgMCBvYmoKPDwKL1R5cGUgL1BhZ2UKL1BhcmVudCAyIDAgUgovQ29udGVudHMgNCAwIFIKPj4KZW5kb2JqCjQgMCBvYmoKPDwKL0xlbmd0aCA0NAo+PgpzdHJlYW0KQlQKL0YxIDEyIFRmCjEwMCA3MDAgVGQKKEhlbGxvIFdvcmxkKSBUagpFVAplbmRzdHJlYW0KZW5kb2JqCnhyZWYKMCA1CjAwMDAwMDAwMDAgNjU1MzUgZiAKMDAwMDAwMDAwOSAwMDAwMCBuIAowMDAwMDAwMDU4IDAwMDAwIG4gCjAwMDAwMDAxNDcgMDAwMDAgbiAKMDAwMDAwMDIxNiAwMDAwMCBuIAp0cmFpbGVyCjw8Ci9TaXplIDUKL1Jvb3QgMSAwIFIKPj4Kc3RhcnR4cmVmCjMwOQolJUVPRgo=";

/**
 * 测试 1: 简单的 API 连接测试
 */
async function testConnection(): Promise<void> {
  console.log("\n=== 测试 1: API 连接测试 ===");
  const url = `${CONFIG.apiBase}/chat/completions`;

  const startTime = Date.now();
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${CONFIG.apiKey}`,
      },
      body: JSON.stringify({
        model: CONFIG.model,
        messages: [{ role: "user", content: "回复: pong" }],
        max_tokens: 10,
      }),
    });

    const elapsed = Date.now() - startTime;
    console.log(`状态码: ${res.status}`);
    console.log(`耗时: ${elapsed}ms`);

    if (res.ok) {
      const data = await res.json();
      console.log(`响应: ${JSON.stringify(data).substring(0, 200)}...`);
    } else {
      const text = await res.text();
      console.log(`错误: ${text.substring(0, 500)}`);
    }
  } catch (e) {
    const elapsed = Date.now() - startTime;
    console.log(`异常: ${e}`);
    console.log(`耗时: ${elapsed}ms`);
  }
}

/**
 * 测试 2: Gemini 原生 API 格式（小 PDF）
 */
async function testGeminiNativeSmallPdf(): Promise<void> {
  console.log("\n=== 测试 2: Gemini 原生 API（小 PDF）===");
  const baseUrl = CONFIG.apiBase.replace(/\/v1\/?$/, "").replace(/\/$/, "");
  const url = `${baseUrl}/v1/models/${CONFIG.model}:generateContent`;

  console.log(`URL: ${url}`);

  const body = {
    contents: [
      {
        parts: [
          { text: "请描述这个 PDF 文档的内容" },
          {
            inlineData: {
              mimeType: "application/pdf",
              data: MINIMAL_PDF_BASE64,
            },
          },
        ],
      },
    ],
    generationConfig: {
      temperature: CONFIG.temperature,
      maxOutputTokens: CONFIG.maxOutputTokens,
      ...(CONFIG.enableThoughts && {
        thinkingConfig: { thinkingBudget: CONFIG.thinkingBudget },
      }),
    },
  };

  const startTime = Date.now();
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${CONFIG.apiKey}`,
        "x-goog-api-key": CONFIG.apiKey,
      },
      body: JSON.stringify(body),
    });

    const elapsed = Date.now() - startTime;
    console.log(`状态码: ${res.status}`);
    console.log(`耗时: ${elapsed}ms`);

    if (res.ok) {
      const data = await res.json();
      console.log(`响应大小: ${JSON.stringify(data).length} 字节`);
      console.log(`响应预览: ${JSON.stringify(data).substring(0, 500)}...`);
    } else {
      const text = await res.text();
      console.log(`错误: ${text.substring(0, 500)}`);
    }
  } catch (e) {
    const elapsed = Date.now() - startTime;
    console.log(`异常: ${e}`);
    console.log(`耗时: ${elapsed}ms`);
  }
}

/**
 * 测试 3: 测试长时间请求（不带 PDF，但请求复杂任务）
 */
async function testLongRequest(): Promise<void> {
  console.log("\n=== 测试 3: 长时间请求测试（复杂任务）===");
  const url = `${CONFIG.apiBase}/chat/completions`;

  const body = {
    model: CONFIG.model,
    messages: [
      {
        role: "user",
        content:
          "请详细解释量子计算的基本原理，包括量子比特、量子门、量子纠缠、量子叠加等概念，并给出一些实际应用案例。请写至少 2000 字。",
      },
    ],
    temperature: CONFIG.temperature,
    ...(CONFIG.enableThoughts && {
      extra_body: {
        generationConfig: {
          thinkingConfig: { thinkingBudget: CONFIG.thinkingBudget },
        },
      },
    }),
  };

  console.log("开始请求...");
  const startTime = Date.now();

  // 设置 30 秒超时检查点
  const checkpoints = [30, 60, 90, 120, 150, 180];
  let checkpointIndex = 0;

  const timer = setInterval(() => {
    const elapsed = Math.round((Date.now() - startTime) / 1000);
    if (
      checkpointIndex < checkpoints.length &&
      elapsed >= checkpoints[checkpointIndex]
    ) {
      console.log(`  ... ${elapsed} 秒，仍在等待响应 ...`);
      checkpointIndex++;
    }
  }, 1000);

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${CONFIG.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    clearInterval(timer);
    const elapsed = Date.now() - startTime;
    console.log(`状态码: ${res.status}`);
    console.log(`总耗时: ${elapsed}ms (${Math.round(elapsed / 1000)}秒)`);

    if (res.ok) {
      const data = await res.json();
      const content = data?.choices?.[0]?.message?.content || "";
      console.log(`响应长度: ${content.length} 字符`);
      console.log(`响应预览: ${content.substring(0, 200)}...`);
    } else {
      const text = await res.text();
      console.log(`错误: ${text.substring(0, 500)}`);
    }
  } catch (e) {
    clearInterval(timer);
    const elapsed = Date.now() - startTime;
    console.log(`异常: ${e}`);
    console.log(`耗时: ${elapsed}ms (${Math.round(elapsed / 1000)}秒)`);
  }
}

/**
 * 测试 4: 使用 AbortController 设置超时
 */
async function testWithTimeout(timeoutMs: number): Promise<void> {
  console.log(`\n=== 测试 4: 带超时的请求 (${timeoutMs}ms) ===`);
  const url = `${CONFIG.apiBase}/chat/completions`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  const body = {
    model: CONFIG.model,
    messages: [{ role: "user", content: "请写一首关于春天的诗" }],
    temperature: CONFIG.temperature,
  };

  const startTime = Date.now();
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${CONFIG.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);
    const elapsed = Date.now() - startTime;
    console.log(`状态码: ${res.status}`);
    console.log(`耗时: ${elapsed}ms`);

    if (res.ok) {
      const data = await res.json();
      console.log(`响应: ${JSON.stringify(data).substring(0, 300)}...`);
    }
  } catch (e: any) {
    clearTimeout(timeoutId);
    const elapsed = Date.now() - startTime;
    if (e.name === "AbortError") {
      console.log(`请求被中止（超时）`);
    } else {
      console.log(`异常: ${e.message || e}`);
    }
    console.log(`耗时: ${elapsed}ms`);
  }
}

/**
 * 主函数
 */
async function main(): Promise<void> {
  console.log("========================================");
  console.log("API 超时测试脚本");
  console.log("========================================");
  console.log(`API Base: ${CONFIG.apiBase}`);
  console.log(`Model: ${CONFIG.model}`);
  console.log(`Thinking: ${CONFIG.enableThoughts}`);
  console.log("========================================");

  if (CONFIG.apiKey === "YOUR_API_KEY_HERE") {
    console.log("\n⚠️  请先设置 API Key！");
    console.log("编辑此文件，将 CONFIG.apiKey 替换为你的 API Key\n");
    return;
  }

  await testConnection();
  await testGeminiNativeSmallPdf();
  await testLongRequest();
  await testWithTimeout(10000);

  console.log("\n========================================");
  console.log("测试完成");
  console.log("========================================");
}

// 运行
main().catch(console.error);
