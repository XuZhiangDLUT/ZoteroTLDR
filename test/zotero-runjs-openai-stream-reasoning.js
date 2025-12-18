// Zotero: Tools > Developer > Run JavaScript
// 目的：用 OpenAI 兼容的 /v1/chat/completions 流式接口测试：
// 1) 首包时间(TTFB)是否足够快（用于规避 Cloudflare 524：120s 无首包）
// 2) 是否能从流式 delta 中拿到“思维链/推理字段”（常见字段名：reasoning_content / reasoning / thought 等）
//
// 重要：不要把 API Key 写进脚本文件。运行时会用 prompt 让你临时输入。
//
// 默认配置（按你的测试模型）：
// - apiBase: https://x666.me
// - model: gemini-2.5-pro-1m
// - enableThinking: true（通过 extra_body.generationConfig.thinkingConfig 传递）
// - thinkingBudget: -1
//
// 使用：
// 1) Tools > Developer > Run JavaScript
// 2) 复制本文件全部内容并运行
// 3) 到 Tools > Developer > Error Console 看 [REASONING]/[TEXT] 实时输出 + TTFB

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
    "是否尝试请求返回思维链？\n1 = extra_body.generationConfig.thinkingConfig.includeThoughts=true（如果服务端支持）\n0 = 不加该字段",
    "1",
  );
  const INCLUDE_THOUGHTS = String(includeThoughtsRaw ?? "1").trim() !== "0";

  const userPrompt = prompt(
    "请输入测试 prompt（建议选一个需要推理的任务，便于观察 reasoning 字段是否出现）",
    "请解决：给定 1..100 的整数，哪些数能被 3 或 7 整除但不能同时被二者整除？请给出结论并解释。",
  );
  if (!userPrompt) {
    alert("未输入 prompt，已取消");
    return;
  }

  const normalizeBase = (s) => String(s || "").replace(/\/$/, "");
  const base = normalizeBase(API_BASE);
  const url = base.endsWith("/v1")
    ? `${base}/chat/completions`
    : `${base}/v1/chat/completions`;

  const body = {
    model: MODEL,
    messages: [{ role: "user", content: userPrompt }],
    stream: true,
    temperature: 0.2,
  };

  if (ENABLE_THINKING) {
    body.extra_body = {
      generationConfig: {
        thinkingConfig: {
          thinkingBudget: THINKING_BUDGET,
        },
      },
    };
    if (INCLUDE_THOUGHTS) {
      body.extra_body.generationConfig.thinkingConfig.includeThoughts = true;
    }
  }

  const controller = new AbortController();
  const hardTimeoutMs = 6 * 60 * 1000;
  const hardTimer = setTimeout(() => controller.abort(), hardTimeoutMs);

  const t0 = Date.now();
  let firstChunkMs = null;
  let reasoning = "";
  let text = "";
  let loggedDeltaKeys = false;

  console.log("=== OpenAI SSE(兼容) 推理流测试开始 ===");
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

  const pickReasoningChunk = (delta) => {
    // 常见：reasoning_content（DeepSeek 等）、reasoning、thought、thinking 等
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
          console.log("[SSE] JSON 解析失败:", payload.slice(0, 200));
          continue;
        }

        const choice = data?.choices?.[0];
        const delta = choice?.delta || {};

        if (!loggedDeltaKeys && delta && Object.keys(delta).length) {
          loggedDeltaKeys = true;
          console.log("[DEBUG] 首次看到 delta keys:", Object.keys(delta));
          console.log(
            "[DEBUG] delta 示例:",
            JSON.stringify(delta).slice(0, 800),
          );
        }

        const r = pickReasoningChunk(delta);
        if (r) {
          reasoning += r;
          console.log("[REASONING]", r);
        }

        const c = pickTextChunk(delta);
        if (c) {
          text += c;
          console.log("[TEXT]", c);
        }
      }
    }
  } catch (e) {
    console.log("流式读取中断/报错:", e);
  } finally {
    clearTimeout(hardTimer);
    try {
      reader.releaseLock();
    } catch (_e) {}
  }

  const totalMs = Date.now() - t0;
  console.log("=== 完成 ===");
  console.log("总耗时(ms):", totalMs);
  console.log("reasoning length:", reasoning.length);
  console.log("text length:", text.length);
  console.log("=== REASONING(完整) ===\n" + reasoning);
  console.log("=== TEXT(完整) ===\n" + text);

  alert(
    "完成。\n" +
      `TTFB(ms): ${firstChunkMs === null ? "NULL(未收到首包)" : firstChunkMs}\n` +
      `总耗时(ms): ${totalMs}\n` +
      `reasoning长度: ${reasoning.length}\n` +
      `text长度: ${text.length}\n\n` +
      "请到 Tools > Developer > Error Console 查看 [REASONING]/[TEXT] 实时输出。",
  );
})();
