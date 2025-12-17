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

/**
 * PDF 解析模式
 */
export type PdfParseMode = "remote" | "local";

/**
 * 插件配置接口
 */
export interface AddonPrefs {
  apiBase: string;
  model: string;
  temperature: number;
  maxOutputTokens: number;
  enableThoughts: boolean;
  thinkingBudget: number;
  concurrency: number;
  maxChars: number;
  attachmentFilter: string;
  rateLimitCount: number;
  rateLimitWindowMinutes: number;
  prompt: string;
  pdfParseMode: PdfParseMode;
}

/**
 * 获取所有偏好设置，带默认值
 */
export function getPrefs(): AddonPrefs {
  const apiBase =
    ((getPref("apiBase" as any) as string) || "https://x666.me/v1").replace(
      /\/$/,
      "",
    );

  const model = (getPref("model" as any) as string) || "gemini-2.5-pro-1m";

  const temperaturePref = getPref("temperature" as any);
  const temperature =
    typeof temperaturePref === "number"
      ? temperaturePref
      : parseFloat(String(temperaturePref ?? "0.2")) || 0.2;

  const maxOutputTokensPref = getPref("maxOutputTokens" as any);
  const maxOutputTokens =
    typeof maxOutputTokensPref === "number"
      ? maxOutputTokensPref
      : parseInt(String(maxOutputTokensPref ?? "65536"), 10) || 65536;

  const enableThoughts = Boolean(getPref("enableThoughts" as any) ?? true);

  const thinkingBudgetPref = getPref("thinkingBudget" as any);
  const thinkingBudget =
    typeof thinkingBudgetPref === "number"
      ? thinkingBudgetPref
      : Number(thinkingBudgetPref ?? -1) || -1;

  const concurrencyPref = getPref("concurrency" as any);
  const concurrency = Math.max(1, Math.min(10, Number(concurrencyPref ?? 1) || 1));

  const maxCharsPref = getPref("maxChars" as any);
  const maxChars = Number(maxCharsPref ?? 800000) || 800000;

  const attachmentFilter = ((getPref("attachmentFilter" as any) as string) || "").trim();

  const rateLimitCountPref = getPref("rateLimitCount" as any);
  const rateLimitCount = Math.max(1, Number(rateLimitCountPref ?? 20) || 20);

  const rateLimitWindowMinutesPref = getPref("rateLimitWindowMinutes" as any);
  const rateLimitWindowMinutes = Math.max(1, Number(rateLimitWindowMinutesPref ?? 5) || 5);

  const prompt = (getPref("prompt" as any) as string) || "";

  const pdfParseModeRaw = (getPref("pdfParseMode" as any) as string) || "remote";
  const pdfParseMode: PdfParseMode = pdfParseModeRaw === "local" ? "local" : "remote";

  return {
    apiBase,
    model,
    temperature,
    maxOutputTokens,
    enableThoughts,
    thinkingBudget,
    concurrency,
    maxChars,
    attachmentFilter,
    rateLimitCount,
    rateLimitWindowMinutes,
    prompt,
    pdfParseMode,
  };
}
