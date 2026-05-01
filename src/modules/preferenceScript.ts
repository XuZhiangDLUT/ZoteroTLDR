import { config } from "../../package.json";
import { AISummaryModule } from "./aiSummary";
import { getString } from "../utils/locale";
import { getPref, setPref } from "../utils/prefs";

export async function registerPrefsScripts(_window: Window) {
  try {
    (_window as any).MozXULElement?.insertFTLIfNeeded?.(
      `${config.addonRef}-preferences.ftl`,
    );
    (_window.document as any).l10n
      ?.translateFragment?.(_window.document.documentElement)
      ?.catch(() => undefined);
  } catch (err) {
    (Zotero as any).logError?.(err);
  }

  if (!addon.data.prefs) {
    addon.data.prefs = {
      window: _window,
      columns: [],
      rows: [],
    };
  } else {
    addon.data.prefs.window = _window;
  }
  bindPrefEvents();
  initSelectElements();
  updateProviderSettingsVisibility();
}

/**
 * 初始化 select 元素的值（Zotero 7 需要手动处理）
 */
function initSelectElements() {
  const doc = addon.data.prefs!.window.document;
  const selectPrefs = [
    { id: "activeProvider", pref: "activeProvider", fallback: "gemini-native" },
    {
      id: "geminiPdfParseMode",
      pref: "geminiPdfParseMode",
      fallback: "remote",
    },
    {
      id: "openaiCompatiblePdfParseMode",
      pref: "openaiCompatiblePdfParseMode",
      fallback: "remote",
    },
  ];

  for (const { id, pref, fallback } of selectPrefs) {
    const select = doc?.querySelector(
      `#zotero-prefpane-${config.addonRef}-${id}`,
    ) as HTMLSelectElement | null;

    if (!select) continue;
    select.value = (getPref(pref as any) as string) || fallback;
    select.addEventListener("change", () => {
      setPref(pref as any, select.value);
      if (pref === "activeProvider") {
        updateProviderSettingsVisibility();
      }
    });
  }
}

function updateProviderSettingsVisibility() {
  const doc = addon.data.prefs!.window.document;
  const activeProviderSelect = doc?.querySelector(
    `#zotero-prefpane-${config.addonRef}-activeProvider`,
  ) as HTMLSelectElement | null;
  const geminiSettings = doc?.querySelector(
    `#zotero-prefpane-${config.addonRef}-geminiSettings`,
  ) as HTMLElement | null;
  const openaiSettings = doc?.querySelector(
    `#zotero-prefpane-${config.addonRef}-openaiCompatibleSettings`,
  ) as HTMLElement | null;

  const activeProvider = activeProviderSelect?.value || "gemini-native";
  if (geminiSettings) {
    geminiSettings.hidden = activeProvider !== "gemini-native";
  }
  if (openaiSettings) {
    openaiSettings.hidden = activeProvider !== "openai-compatible";
  }
}

function bindPrefEvents() {
  // 绑定"测试 API"按钮
  addon.data
    .prefs!.window.document?.querySelector(
      `#zotero-prefpane-${config.addonRef}-apitest`,
    )
    ?.addEventListener("command", async () => {
      const progress = new ztoolkit.ProgressWindow(config.addonName)
        .createLine({ text: getString("pref-api-test-progress"), progress: 50 })
        .show();
      try {
        await AISummaryModule.testAPI();
      } finally {
        progress.startCloseTimer(500);
      }
    });
}
