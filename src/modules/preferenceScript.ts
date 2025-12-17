import { config } from "../../package.json";
import { AISummaryModule } from "./aiSummary";

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
