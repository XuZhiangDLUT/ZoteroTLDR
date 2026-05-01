import { config } from "../../package.json";

type PluginPrefsMap = _ZoteroTypes.Prefs["PluginPrefsMap"];

const PREFS_PREFIX = config.prefsPrefix;

/**
 * 获取偏好设置值
 */
export function getPref<K extends keyof PluginPrefsMap>(key: K) {
  return Zotero.Prefs.get(`${PREFS_PREFIX}.${key}`, true) as PluginPrefsMap[K];
}

/**
 * 设置偏好设置值
 */
export function setPref<K extends keyof PluginPrefsMap>(
  key: K,
  value: PluginPrefsMap[K],
) {
  return Zotero.Prefs.set(`${PREFS_PREFIX}.${key}`, value, true);
}

export type LLMProvider = "gemini-native" | "openai-compatible";

/**
 * PDF 解析模式
 */
export type PdfParseMode = "remote" | "local";

/**
 * 插件配置接口
 */
export interface AddonPrefs {
  provider: LLMProvider;
  providerLabel: string;
  apiKey: string;
  apiBase: string;
  model: string;
  temperature: number;
  maxOutputTokens: number;
  enableThoughts: boolean;
  thinkingBudget: number;
  concurrency: number;
  maxChars: number;
  attachmentFilter: string;
  maxFileSizeMB: number;
  maxPageCount: number;
  skipExistingSummary: boolean;
  retryOnTransientErrors: number;
  rateLimitCount: number;
  rateLimitWindowMinutes: number;
  prompt: string;
  pdfParseMode: PdfParseMode;
}

interface ProviderDefaults {
  apiBase: string;
  apiKey: string;
  model: string;
  temperature: number;
  maxOutputTokens: number;
  pdfParseMode: PdfParseMode;
  enableThoughts: boolean;
  thinkingBudget: number;
  concurrency: number;
  maxChars: number;
  attachmentFilter: string;
  maxFileSizeMB: number;
  maxPageCount: number;
  skipExistingSummary: boolean;
  retryOnTransientErrors: number;
  rateLimitCount: number;
  rateLimitWindowMinutes: number;
  prompt: string;
}

const PROVIDER_DEFAULTS: Record<LLMProvider, ProviderDefaults> = {
  "gemini-native": {
    apiBase: "https://x666.me/v1",
    apiKey: "",
    model: "gemini-2.5-pro-1m",
    temperature: 0.2,
    maxOutputTokens: 65536,
    pdfParseMode: "remote",
    enableThoughts: true,
    thinkingBudget: -1,
    concurrency: 1,
    maxChars: 800000,
    attachmentFilter: "!* - mono.pdf, !* - dual.pdf",
    maxFileSizeMB: 25,
    maxPageCount: 50,
    skipExistingSummary: true,
    retryOnTransientErrors: 2,
    rateLimitCount: 20,
    rateLimitWindowMinutes: 5,
    prompt: "",
  },
  "openai-compatible": {
    apiBase: "https://cpa.20020519.xyz/v1",
    apiKey: "",
    model: "ds2api-openai/deepseek-v4-pro-search",
    temperature: 0.2,
    maxOutputTokens: 1000000,
    pdfParseMode: "remote",
    enableThoughts: true,
    thinkingBudget: -1,
    concurrency: 5,
    maxChars: 1000000,
    attachmentFilter: "!* - mono.pdf, !* - dual.pdf",
    maxFileSizeMB: 80,
    maxPageCount: 50,
    skipExistingSummary: true,
    retryOnTransientErrors: 2,
    rateLimitCount: 100,
    rateLimitWindowMinutes: 1,
    prompt: "",
  },
};

const PROVIDER_PREFIX: Record<LLMProvider, "gemini" | "openaiCompatible"> = {
  "gemini-native": "gemini",
  "openai-compatible": "openaiCompatible",
};

const PROVIDER_LABEL: Record<LLMProvider, string> = {
  "gemini-native": "Gemini Native",
  "openai-compatible": "OpenAI Compatible",
};

function normalizeProvider(value: unknown): LLMProvider {
  return value === "openai-compatible" ? "openai-compatible" : "gemini-native";
}

function normalizePdfParseMode(value: unknown): PdfParseMode {
  return value === "local" ? "local" : "remote";
}

function capitalizeKey(key: string): string {
  return key.charAt(0).toUpperCase() + key.slice(1);
}

function readProviderPref(
  provider: LLMProvider,
  key: keyof ProviderDefaults,
  legacyKey?: string,
): unknown {
  const prefKey = `${PROVIDER_PREFIX[provider]}${capitalizeKey(String(key))}`;
  const value = getPref(prefKey as any);
  if (value !== undefined && value !== null && value !== "") {
    return value;
  }

  // Existing installations stored the original single-provider settings under
  // flat keys. Treat those as Gemini Native values during migration.
  if (provider === "gemini-native" && legacyKey) {
    const legacyValue = getPref(legacyKey as any);
    if (
      legacyValue !== undefined &&
      legacyValue !== null &&
      legacyValue !== ""
    ) {
      return legacyValue;
    }
  }

  return PROVIDER_DEFAULTS[provider][key];
}

function readString(
  provider: LLMProvider,
  key: keyof ProviderDefaults,
  legacyKey?: string,
): string {
  return String(readProviderPref(provider, key, legacyKey) ?? "").trim();
}

function readNumber(
  provider: LLMProvider,
  key: keyof ProviderDefaults,
  legacyKey?: string,
): number {
  const fallback = PROVIDER_DEFAULTS[provider][key];
  const raw = readProviderPref(provider, key, legacyKey);
  const value = Number(raw ?? fallback);
  return Number.isFinite(value) ? value : Number(fallback);
}

function readBoolean(
  provider: LLMProvider,
  key: keyof ProviderDefaults,
  legacyKey?: string,
): boolean {
  const raw = readProviderPref(provider, key, legacyKey);
  if (typeof raw === "boolean") return raw;
  if (typeof raw === "string") {
    if (raw.toLowerCase() === "true") return true;
    if (raw.toLowerCase() === "false") return false;
  }
  return Boolean(PROVIDER_DEFAULTS[provider][key]);
}

/**
 * 获取所有偏好设置，带默认值
 */
export function getPrefs(): AddonPrefs {
  const provider = normalizeProvider(getPref("activeProvider" as any));
  const apiBase = readString(provider, "apiBase", "apiBase").replace(/\/$/, "");
  const apiKey = readString(provider, "apiKey", "apiKey");
  const model = readString(provider, "model", "model");
  const temperature = readNumber(provider, "temperature", "temperature");
  const maxOutputTokens = Math.max(
    1,
    Math.trunc(readNumber(provider, "maxOutputTokens", "maxOutputTokens")),
  );
  const enableThoughts = readBoolean(
    provider,
    "enableThoughts",
    "enableThoughts",
  );
  const thinkingBudget = Math.trunc(
    readNumber(provider, "thinkingBudget", "thinkingBudget"),
  );
  const concurrency = Math.max(
    1,
    Math.min(
      10,
      Math.trunc(readNumber(provider, "concurrency", "concurrency")),
    ),
  );
  const maxChars = Math.max(
    1,
    Math.trunc(readNumber(provider, "maxChars", "maxChars")),
  );
  const attachmentFilter = readString(
    provider,
    "attachmentFilter",
    "attachmentFilter",
  );
  const maxFileSizeMB = Math.max(
    0,
    readNumber(provider, "maxFileSizeMB", "maxFileSizeMB"),
  );
  const maxPageCount = Math.max(
    0,
    Math.trunc(readNumber(provider, "maxPageCount", "maxPageCount")),
  );
  const skipExistingSummary = readBoolean(
    provider,
    "skipExistingSummary",
    "skipExistingSummary",
  );
  const retryOnTransientErrors = Math.max(
    0,
    Math.trunc(
      readNumber(provider, "retryOnTransientErrors", "retryOnTransientErrors"),
    ),
  );
  const rateLimitCount = Math.max(
    1,
    Math.trunc(readNumber(provider, "rateLimitCount", "rateLimitCount")),
  );
  const rateLimitWindowMinutes = Math.max(
    1,
    Math.trunc(
      readNumber(provider, "rateLimitWindowMinutes", "rateLimitWindowMinutes"),
    ),
  );
  const prompt = String(readProviderPref(provider, "prompt", "prompt") ?? "");
  const pdfParseMode = normalizePdfParseMode(
    readProviderPref(provider, "pdfParseMode", "pdfParseMode"),
  );

  return {
    provider,
    providerLabel: PROVIDER_LABEL[provider],
    apiKey,
    apiBase,
    model,
    temperature,
    maxOutputTokens,
    enableThoughts,
    thinkingBudget,
    concurrency,
    maxChars,
    attachmentFilter,
    maxFileSizeMB,
    maxPageCount,
    skipExistingSummary,
    retryOnTransientErrors,
    rateLimitCount,
    rateLimitWindowMinutes,
    prompt,
    pdfParseMode,
  };
}
