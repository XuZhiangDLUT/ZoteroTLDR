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
 * 插件配置接口
 */
export interface AddonPrefs {
  apiBase: string;
  model: string;
  temperature: number;
  enableThoughts: boolean;
  thinkingBudget: number;
  concurrency: number;
  maxChars: number;
  attachmentFilter: string;
  prompt: string;
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
    typeof temperaturePref === "number" ? temperaturePref : 0.2;

  const enableThoughts = Boolean(getPref("enableThoughts" as any) ?? true);

  const thinkingBudgetPref = getPref("thinkingBudget" as any);
  const thinkingBudget =
    typeof thinkingBudgetPref === "number"
      ? thinkingBudgetPref
      : Number(thinkingBudgetPref ?? -1) || -1;

  const concurrencyPref = getPref("concurrency" as any);
  const concurrency = Math.max(1, Math.min(10, Number(concurrencyPref ?? 2) || 2));

  const maxCharsPref = getPref("maxChars" as any);
  const maxChars = Number(maxCharsPref ?? 800000) || 800000;

  const attachmentFilter = ((getPref("attachmentFilter" as any) as string) || "").trim();

  const prompt = (getPref("prompt" as any) as string) || "";

  return {
    apiBase,
    model,
    temperature,
    enableThoughts,
    thinkingBudget,
    concurrency,
    maxChars,
    attachmentFilter,
    prompt,
  };
}
