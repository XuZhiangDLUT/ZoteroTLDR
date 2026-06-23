import assert from "node:assert/strict";
import test from "node:test";
import { buildOpenAICompatibleChatRequest } from "../src/llm/providers";
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
