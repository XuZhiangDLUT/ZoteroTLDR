import { config } from "../../package.json";

type PluginPrefsMap = _ZoteroTypes.Prefs["PluginPrefsMap"];

const PREFS_PREFIX = config.prefsPrefix;

/**
 * Get preference value.
 * Wrapper of `Zotero.Prefs.get`.
 * @param key
 */
export function getPref<K extends keyof PluginPrefsMap>(key: K) {
  return Zotero.Prefs.get(`${PREFS_PREFIX}.${key}`, true) as PluginPrefsMap[K];
}

/**
 * Set preference value.
 * Wrapper of `Zotero.Prefs.set`.
 * @param key
 * @param value
 */
export function setPref<K extends keyof PluginPrefsMap>(
  key: K,
  value: PluginPrefsMap[K],
) {
  return Zotero.Prefs.set(`${PREFS_PREFIX}.${key}`, value, true);
}

/**
 * Clear preference value.
 * Wrapper of `Zotero.Prefs.clear`.
 * @param key
 */
export function clearPref(key: string) {
  return Zotero.Prefs.clear(`${PREFS_PREFIX}.${key}`, true);
}

export interface AddonPrefs {
  openaiApiBase: string;
  geminiApiBase: string;
  provider: "openai-compatible" | "gemini-v1beta";
  model: string;
  enableThoughts: boolean;
  thinkingBudget: number;
  summarizeMode: "text-index" | "pdf-native";
  concurrency: number;
  attachmentFilterGlob: string;
  maxInlineMB: number;
  maxFileMB: number;
  saveThoughtsToNote: boolean;
  prompt: string;
  maxChars: number;
  temperature: number;
}

/**
 * Get all addon preferences with proper defaults and normalization.
 */
export function getPrefs(): AddonPrefs {
  const openaiApiBase =
    ((getPref("openaiApiBase" as any) as string) ||
      (getPref("apiBase" as any) as string) ||
      "https://x666.me/v1").replace(/\/$/, "");

  const geminiApiBase =
    ((getPref("geminiApiBase" as any) as string) || "https://x666.me").replace(
      /\/$/,
      "",
    );

  const providerRaw = (getPref("provider" as any) as string) ||
    "openai-compatible";
  const provider: AddonPrefs["provider"] =
    providerRaw === "gemini-v1beta" ? "gemini-v1beta" : "openai-compatible";

  const model =
    (getPref("model" as any) as string) || "gemini-2.5-pro-1m";

  const enableThoughts = Boolean(getPref("enableThoughts" as any));
  const thinkingBudgetPref = getPref("thinkingBudget" as any);
  const thinkingBudget =
    typeof thinkingBudgetPref === "number"
      ? thinkingBudgetPref
      : Number(thinkingBudgetPref ?? -1) || -1;

  const summarizeModeRaw = (getPref("summarizeMode" as any) as string) ||
    "text-index";
  const summarizeMode: AddonPrefs["summarizeMode"] =
    summarizeModeRaw === "pdf-native" ? "pdf-native" : "text-index";

  const concurrencyPref = getPref("concurrency" as any);
  const concurrency = Math.max(
    1,
    Number(concurrencyPref ?? 2) || 2,
  );

  const attachmentFilterGlob =
    ((getPref("attachmentFilterGlob" as any) as string) || "*-dual.pdf").trim();

  const maxInlineMBPref = getPref("maxInlineMB" as any);
  const maxFileMBPref = getPref("maxFileMB" as any);

  const maxInlineMB = Number(maxInlineMBPref ?? 20) || 20;
  const maxFileMB = Number(maxFileMBPref ?? 50) || 50;

  const saveThoughtsToNote = Boolean(getPref("saveThoughtsToNote" as any));

  const prompt = (getPref("prompt" as any) as string) || "";
  const maxChars = Number(getPref("maxChars" as any) ?? 800000) || 800000;
  const temperature = Number(getPref("temperature" as any) ?? 0.2) || 0.2;

  return {
    openaiApiBase,
    geminiApiBase,
    provider,
    model,
    enableThoughts,
    thinkingBudget,
    summarizeMode,
    concurrency,
    attachmentFilterGlob,
    maxInlineMB,
    maxFileMB,
    saveThoughtsToNote,
    prompt,
    maxChars,
    temperature,
  };
}
