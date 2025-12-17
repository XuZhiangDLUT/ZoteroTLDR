import { config } from "../../package.json";
import { AISummaryModule } from "./aiSummary";
import { getPref, setPref } from "../utils/prefs";

export async function registerPrefsScripts(_window: Window) {
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
}

/**
 * 初始化 select 元素的值（Zotero 7 需要手动处理）
 */
function initSelectElements() {
  const doc = addon.data.prefs!.window.document;

  // PDF 解析模式下拉菜单
  const pdfParseModeSelect = doc?.querySelector(
    `#zotero-prefpane-${config.addonRef}-pdfParseMode`,
  ) as HTMLSelectElement | null;

  if (pdfParseModeSelect) {
    // 加载当前值
    const currentValue = (getPref("pdfParseMode" as any) as string) || "remote";
    pdfParseModeSelect.value = currentValue;

    // 监听变化并保存
    pdfParseModeSelect.addEventListener("change", () => {
      setPref("pdfParseMode" as any, pdfParseModeSelect.value);
    });
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
        .createLine({ text: "测试 API 连接中...", progress: 50 })
        .show();
      try {
        await AISummaryModule.testAPI();
      } finally {
        progress.startCloseTimer(500);
      }
    });
}
