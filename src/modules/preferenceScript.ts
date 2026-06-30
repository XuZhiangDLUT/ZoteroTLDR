import { config } from "../../package.json";
import { AISummaryModule } from "./aiSummary";
import { getString } from "../utils/locale";
import { DEFAULT_PROVIDER, getPref, setPref } from "../utils/prefs";

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
    {
      id: "activeProvider",
      pref: "activeProvider",
      fallback: DEFAULT_PROVIDER,
    },
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
    {
      id: "mimoPdfParseMode",
      pref: "mimoPdfParseMode",
      fallback: "local",
    },
    {
      id: "mimoBalancePdfParseMode",
      pref: "mimoBalancePdfParseMode",
      fallback: "local",
    },
  ];

  for (const { id, pref, fallback } of selectPrefs) {
    const select = doc?.querySelector(
      `#zotero-prefpane-${config.addonRef}-${id}`,
    ) as HTMLSelectElement | null;

    if (!select) continue;
    select.value = (getPref(pref as any) as string) || fallback;
    const syncSelectPref = () => {
      setPref(pref as any, select.value);
      if (pref === "activeProvider") {
        updateProviderSettingsVisibility();
      }
    };
    select.addEventListener("input", syncSelectPref);
    select.addEventListener("change", syncSelectPref);
    select.addEventListener("command", syncSelectPref);
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
  const mimoSettings = doc?.querySelector(
    `#zotero-prefpane-${config.addonRef}-mimoSettings`,
  ) as HTMLElement | null;
  const mimoBalanceSettings = doc?.querySelector(
    `#zotero-prefpane-${config.addonRef}-mimoBalanceSettings`,
  ) as HTMLElement | null;

  const activeProvider = activeProviderSelect?.value || DEFAULT_PROVIDER;
  if (geminiSettings) {
    geminiSettings.hidden = activeProvider !== "gemini-native";
  }
  if (openaiSettings) {
    openaiSettings.hidden = activeProvider !== "openai-compatible";
  }
  if (mimoSettings) {
    mimoSettings.hidden = activeProvider !== "mimo-token-plan";
  }
  if (mimoBalanceSettings) {
    mimoBalanceSettings.hidden = activeProvider !== "mimo-balance-api";
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
