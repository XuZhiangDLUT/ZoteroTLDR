import { config } from "../../package.json";
import { AISummaryModule } from "./aiSummary";
import { getString } from "../utils/locale";
import { DEFAULT_PROVIDER, getPref, setPref } from "../utils/prefs";

interface PreferenceMenuList extends Element {
  value: string;
}

const initializedMenuLists = new WeakSet<PreferenceMenuList>();
const paneId = `zotero-prefpane-${config.addonRef}-`;

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
  initMenuLists(_window);
  updateProviderSettingsVisibility(_window.document);
}

/**
 * 初始化下拉控件的值（Zotero 7 需要手动处理）
 */
function initMenuLists(win: Window) {
  const doc = win.document;
  const menuPrefs = [
    ["activeProvider", DEFAULT_PROVIDER],
    ["geminiPdfParseMode", "remote"],
    ["openaiNativePdfParseMode", "remote"],
    ["openaiCompatiblePdfParseMode", "remote"],
    ["mimoPdfParseMode", "local"],
    ["mimoBalancePdfParseMode", "local"],
  ] as const;

  for (const [pref, fallback] of menuPrefs) {
    const select = doc.querySelector<PreferenceMenuList>(`#${paneId}${pref}`);
    if (!select) continue;
    const value = getPref(pref);
    const hasValue = Array.from<Element>(
      select.querySelectorAll<Element>("menuitem"),
    ).some((item) => item.getAttribute("value") === value);
    select.value = hasValue ? value : fallback;

    if (initializedMenuLists.has(select)) continue;
    initializedMenuLists.add(select);

    select.addEventListener("command", () => {
      setPref(pref, select.value);
      if (pref === "activeProvider") {
        // Let the native popup finish closing before changing the pane layout.
        win.setTimeout(() => updateProviderSettingsVisibility(doc), 0);
      }
    });
  }
}

function updateProviderSettingsVisibility(doc: Document) {
  const activeProvider = doc.querySelector<PreferenceMenuList>(
    `#${paneId}activeProvider`,
  )?.value;
  const sections = {
    "gemini-native": "geminiSettings",
    "openai-native": "openaiNativeSettings",
    "openai-compatible": "openaiCompatibleSettings",
    "mimo-token-plan": "mimoSettings",
    "mimo-balance-api": "mimoBalanceSettings",
  };
  for (const [provider, id] of Object.entries(sections)) {
    const settings = doc.getElementById(`${paneId}${id}`);
    settings?.toggleAttribute(
      "hidden",
      provider !== (activeProvider || DEFAULT_PROVIDER),
    );
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
