import assert from "node:assert/strict";
import test from "node:test";
import {
  buildOpenAICompatibleChatRequest,
  summarizeWithRemotePdf,
  summarizeWithTextStream,
  testAPI,
} from "../src/llm/providers";
import {
  DEFAULT_PROVIDER,
  getPrefs,
  normalizeProvider,
  setActiveProvider,
} from "../src/utils/prefs";
import type { AddonPrefs } from "../src/utils/prefs";

function makePrefs(overrides: Partial<AddonPrefs> = {}): AddonPrefs {
  return {
    provider: "openai-compatible",
    providerLabel: "OpenAI Compatible",
    apiKey: "test-key",
    apiBase: "https://example.test/v1",
    model: "test-model",
    temperature: 0.2,
    maxOutputTokens: 1024,
    enableThoughts: false,
    thinkingBudget: -1,
    concurrency: 1,
    maxChars: 1000,
    attachmentFilter: "",
    maxFileSizeMB: 0,
    maxPageCount: 0,
    skipExistingSummary: false,
    retryOnTransientErrors: 0,
    rateLimitCount: 100,
    rateLimitWindowMinutes: 1,
    prompt: "",
    pdfParseMode: "local",
    ...overrides,
  };
}

test("MiMo Token Plan uses api-key auth and max_completion_tokens", () => {
  const request = buildOpenAICompatibleChatRequest({
    prefs: makePrefs({
      provider: "mimo-token-plan",
      providerLabel: "MiMo Token Plan",
      apiKey: "tp-test",
      apiBase: "https://token-plan-cn.xiaomimimo.com/v1",
      model: "mimo-v2.5-pro",
      maxOutputTokens: 128000,
      enableThoughts: true,
    }),
    messages: [{ role: "user", content: "pong" }],
    stream: true,
  });

  assert.equal(
    request.url,
    "https://token-plan-cn.xiaomimimo.com/v1/chat/completions",
  );
  assert.equal(request.headers["api-key"], "tp-test");
  assert.equal(request.headers.Authorization, undefined);
  assert.equal(request.body.max_completion_tokens, 128000);
  assert.equal(request.body.max_tokens, undefined);
  assert.equal(request.body.extra_body, undefined);
});

test("default provider is MiMo Balance API", () => {
  assert.equal(DEFAULT_PROVIDER, "mimo-balance-api");
  assert.equal(normalizeProvider(undefined), "mimo-balance-api");
  assert.equal(normalizeProvider("legacy-provider"), "mimo-balance-api");
  assert.equal(normalizeProvider("gemini-native"), "gemini-native");
});

test("MiMo Balance API uses api-key auth and max_completion_tokens", () => {
  const request = buildOpenAICompatibleChatRequest({
    prefs: makePrefs({
      provider: "mimo-balance-api",
      providerLabel: "MiMo Balance API",
      apiKey: "sk-test",
      apiBase: "https://api.xiaomimimo.com/v1",
      model: "mimo-v2.5-pro",
      maxOutputTokens: 128000,
      enableThoughts: true,
    }),
    messages: [{ role: "user", content: "pong" }],
    stream: true,
  });

  assert.equal(request.url, "https://api.xiaomimimo.com/v1/chat/completions");
  assert.equal(request.headers["api-key"], "sk-test");
  assert.equal(request.headers.Authorization, undefined);
  assert.equal(request.body.max_completion_tokens, 128000);
  assert.equal(request.body.max_tokens, undefined);
  assert.equal(request.body.extra_body, undefined);
});

test("OpenAI-compatible provider keeps bearer auth and max_tokens", () => {
  const request = buildOpenAICompatibleChatRequest({
    prefs: makePrefs({
      apiKey: "sk-test",
      enableThoughts: true,
      thinkingBudget: 4096,
    }),
    messages: [{ role: "user", content: "pong" }],
    stream: true,
  });

  assert.equal(request.headers.Authorization, "Bearer sk-test");
  assert.equal(request.headers["api-key"], undefined);
  assert.equal(request.body.max_tokens, 1024);
  assert.equal(request.body.max_completion_tokens, undefined);
  assert.deepEqual(request.body.extra_body, {
    thinking: { type: "enabled", budget_tokens: 4096 },
  });
});

test("OpenAI uploads PDF data to Responses with the Luna limits and streams text", async (t) => {
  const encode = new TextEncoder();
  const events =
    'event: response.output_text.delta\r\ndata: {"type":"response.output_text.delta","delta":"摘要"}\r\n\r\n' +
    'data: {"type":"response.completed","response":{"status":"completed"}}\n\n';
  t.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    assert.equal(url, "https://api.openai.com/v1/responses");
    assert.equal(
      new Headers(init.headers).get("Authorization"),
      "Bearer test-key",
    );
    const body = JSON.parse(String(init.body));
    assert.equal(body.model, "gpt-6-luna");
    assert.equal(body.max_output_tokens, 128_000);
    assert.equal(body.truncation, "disabled");
    assert.equal(body.stream, true);
    assert.equal(body.store, false);
    assert.deepEqual(body.reasoning, { effort: "max" });
    for (const legacy of ["max_tokens", "temperature", "extra_body"]) {
      assert.equal(legacy in body, false);
    }
    assert.deepEqual(body.input[0].content, [
      { type: "input_text", text: "Summarize the PDF" },
      {
        type: "input_file",
        filename: "paper.pdf",
        file_data: "data:application/pdf;base64,JVBERg==",
      },
    ]);
    return new Response(
      new ReadableStream({
        start(controller) {
          const bytes = encode.encode(events);
          for (let i = 0; i < bytes.length; i += 5) {
            controller.enqueue(bytes.subarray(i, i + 5));
          }
          controller.close();
        },
      }),
    );
  });
  const chunks: string[] = [];
  const result = await summarizeWithRemotePdf({
    prefs: makePrefs({ provider: "openai-native" }),
    title: "Paper",
    prompt: "Summarize the PDF",
    fileName: "paper.pdf",
    pdfBase64: "JVBERg==",
    onStreamChunk: (text) => chunks.push(text),
  });
  assert.equal(result.markdown, "摘要");
  assert.deepEqual(chunks, ["摘要"]);
});

test("OpenAI rejects a partial local summary after reaching the output budget", async (t) => {
  t.mock.method(
    globalThis,
    "fetch",
    async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      assert.deepEqual(body.reasoning, { effort: "low" });
      assert.deepEqual(body.input[0].content, [
        { type: "input_text", text: "Full paper text" },
      ]);
      return new Response(
        'data: {"type":"response.output_text.delta","delta":"Partial"}\n\n' +
          'data: {"type":"response.incomplete","response":{"status":"incomplete","incomplete_details":{"reason":"max_output_tokens"}}}\n\n',
      );
    },
  );
  await assert.rejects(
    summarizeWithTextStream({
      prefs: makePrefs({
        provider: "openai-native",
        openaiReasoningEffort: "low",
      }),
      title: "Paper",
      content: "Full paper text",
      prompt: "Full paper text",
    }),
    /max_output_tokens/,
  );
});

test("OpenAI reads saved reasoning effort and defaults older installations to max", () => {
  const previous = globalThis.Zotero;
  let saved: string | undefined;
  globalThis.Zotero = {
    Prefs: {
      get(key: string) {
        if (key.endsWith(".activeProvider")) return "openai-native";
        if (key.endsWith(".openaiNativeReasoningEffort")) return saved;
      },
    },
  } as typeof Zotero;
  try {
    assert.equal(getPrefs().openaiReasoningEffort, "max");
    saved = "none";
    assert.equal(getPrefs().openaiReasoningEffort, "none");
    saved = "xhigh";
    assert.equal(getPrefs().openaiReasoningEffort, "xhigh");
    saved = "invalid";
    assert.equal(getPrefs().openaiReasoningEffort, "max");
  } finally {
    globalThis.Zotero = previous;
  }
});

test("OpenAI inherits the previous provider's prompt until a custom prompt is set", () => {
  const previous = globalThis.Zotero;
  const values = new Map([
    ["activeProvider", "openai-native"],
    ["mimoBalancePrompt", "MiMo template"],
    ["openaiCompatiblePrompt", "Gateway template"],
    ["prompt", "Legacy Gemini template"],
  ]);
  globalThis.Zotero = {
    Prefs: {
      get(key: string) {
        return values.get(key.split(".").pop()!);
      },
      set(key: string, value: string) {
        values.set(key.split(".").pop()!, value);
      },
    },
  } as typeof Zotero;
  try {
    assert.equal(getPrefs().prompt, "MiMo template");
    setActiveProvider("openai-compatible");
    setActiveProvider("openai-native");
    assert.equal(getPrefs().prompt, "Gateway template");

    values.set("openaiNativePrompt", "My OpenAI template");
    setActiveProvider("gemini-native");
    setActiveProvider("openai-native");
    assert.equal(getPrefs().prompt, "My OpenAI template");
    values.set("openaiNativePrompt", " ");
    assert.equal(getPrefs().prompt, "Legacy Gemini template");
    assert.equal(values.get("openaiCompatiblePrompt"), "Gateway template");
  } finally {
    globalThis.Zotero = previous;
  }
});

test("OpenAI connection testing uses a bounded Responses request", async (t) => {
  t.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    assert.equal(url, "https://api.openai.com/v1/responses");
    const body = JSON.parse(String(init.body));
    assert.deepEqual(body.reasoning, { effort: "none" });
    assert.equal(body.max_output_tokens, 64);
    return Response.json({
      status: "completed",
      output: [
        { type: "message", content: [{ type: "output_text", text: "pong" }] },
      ],
    });
  });
  assert.equal(await testAPI(makePrefs({ provider: "openai-native" })), "pong");
});
