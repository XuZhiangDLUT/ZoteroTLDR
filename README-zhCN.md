# Hanchen's Zotero TLDR

[![zotero target version](https://img.shields.io/badge/Zotero-7-green?style=flat-square&logo=zotero&logoColor=CC2936)](https://www.zotero.org)
[![Using Zotero Plugin Template](https://img.shields.io/badge/Using-Zotero%20Plugin%20Template-blue?style=flat-square&logo=github)](https://github.com/windingwind/zotero-plugin-template)

[English](./README.md)

一个 Zotero 7 插件，使用 Gemini AI 为 PDF 论文生成结构化摘要。每个 PDF 都会生成独立的摘要笔记，支持表格、列表、标题、代码块等 Markdown 渲染。

## 功能特点

- **AI 摘要生成**：右键 → "AI 总结到子笔记"，一键生成结构化摘要
- **独立处理每个 PDF**：一个条目有多个 PDF 时，每个 PDF 生成独立的笔记
- **Gemini 集成**：通过 OpenAI 兼容代理（如 x666.me）调用 Gemini API
- **思考模式**：支持 Gemini 的思考/推理能力
- **PDF 过滤**：支持按文件名过滤，使用 glob 模式（支持 AND/OR/NOT）
- **批量处理**：支持多选条目并发处理
- **Markdown 渲染**：完整支持表格、列表、标题、代码块
- **自定义提示词**：支持 `{title}`、`{abstract}`、`{content}`、`{fileName}` 变量

## 安装

1. 从 Releases 下载最新 `.xpi` 文件
2. Zotero → 工具 → 附加组件 → ⚙️ → 从文件安装…
3. 选择 `hanchens-zotero-tldr.xpi` 并重启 Zotero

## 快速开始

1. 在 Zotero 中选择一个或多个条目（或 PDF 附件）
2. 右键 → **"AI 总结到子笔记"**
3. 每个 PDF 都会被处理并生成一个摘要笔记

## 设置

**Zotero → 编辑 → 设置 → Hanchen's Zotero TLDR**

| 设置项       | 说明                     | 默认值                     |
| ------------ | ------------------------ | -------------------------- |
| API Base URL | OpenAI 兼容接口地址      | `https://x666.me/v1`       |
| API Key      | API 密钥                 | (空)                       |
| 模型         | 模型名称                 | `gemini-2.5-pro-1m`        |
| 温度         | 创造性 (0-2)             | `0.2`                      |
| 启用思考模式 | 使用 Gemini 思考功能     | `true`                     |
| 思考预算     | Token 限制 (-1=动态)     | `-1`                       |
| 并发数       | 并行处理数量             | `1`                        |
| 最大字符数   | 每个 PDF 最大提取字符    | `800000`                   |
| 速率限制     | 时间窗口内最大请求数     | `20`                       |
| 时间窗口     | 速率限制时间窗口（分钟） | `5`                        |
| PDF 过滤     | 文件名过滤规则           | `!*-mono.pdf, !*-dual.pdf` |
| 提示词模板   | 自定义提示词             | (详细模板)                 |

## PDF 过滤语法

| 符号 | 含义              | 示例                                         |
| ---- | ----------------- | -------------------------------------------- |
| `,`  | 或 (OR)           | `*.pdf, *.PDF` → 匹配任一                    |
| `;`  | 且 (AND)          | `*.pdf; !*-mono.pdf` → .pdf 但排除 -mono.pdf |
| `!`  | 排除 (NOT)        | `!*-dual.pdf` → 排除 -dual.pdf               |
| `*`  | 通配符 (任意字符) | `paper*.pdf`                                 |
| `?`  | 通配符 (单字符)   | `paper?.pdf`                                 |

**默认规则**：`!*-mono.pdf, !*-dual.pdf`（排除 -mono.pdf 和 -dual.pdf 文件）

## 提示词模板变量

- `{title}` - 论文标题
- `{abstract}` - 论文摘要
- `{content}` - PDF 提取的文本
- `{fileName}` - PDF 文件名

## 从源码构建

```bash
# 安装依赖
npm install

# 开发模式（热重载）
npm start

# 生产构建
npm run build
```

输出：`.scaffold/build/hanchens-zotero-tldr.xpi`

## 发布流程

### 前提条件

- 确保所有改动已提交且测试通过
- 清理不必要的构建产物
- 根据需要更新 `package.json` 中的版本号

### 发布 Beta 版本

Beta 版本用于预发布测试和早期反馈。

```bash
# 1. 更新版本号为 beta（如果还没更新）
# 编辑 package.json: "version": "0.2.2-beta.1"

# 2. 清理并暂存必要的改动
git status
git add package.json package-lock.json src/
# 如有需要，删除构建产物
rm -rf release-*/

# 3. 提交改动
git commit -m "feat: 功能描述

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"

# 4. 构建插件
npm run build

# 5. 创建并推送 git tag
git tag v0.2.2-beta.1
git push origin main
git push origin v0.2.2-beta.1

# GitHub Actions 将自动：
# - 构建项目
# - 创建 GitHub Release（标记为预发布）
# - 上传 .xpi 文件
```

### 发布正式版本

用于生产环境的稳定版本发布。

```bash
# 1. 更新版本号为正式版
# 编辑 package.json: "version": "0.2.2"

# 2. 清理并暂存改动
git status
git add package.json package-lock.json src/
rm -rf release-*/

# 3. 提交改动
git commit -m "chore(release): v0.2.2

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"

# 4. 构建插件
npm run build

# 5. 创建并推送 git tag（不带 -beta 后缀）
git tag v0.2.2
git push origin main
git push origin v0.2.2

# GitHub Actions 将自动：
# - 构建项目
# - 创建 GitHub Release（稳定版）
# - 上传 .xpi 文件
```

### 手动发布（不使用 GitHub Actions）

如果需要手动发布：

```bash
# 1. 确保 package.json 中的版本号已更新
# 2. 构建并创建 tag
npm run build
git tag v0.2.2-beta.1

# 3. 手动创建 release
npm run release

# 或通过 GitHub 网页界面创建 release：
# - 访问：https://github.com/XuZhiangDLUT/ZoteroTLDR/releases/new
# - 选择 tag：v0.2.2-beta.1
# - 上传文件：.scaffold/build/hanchens-zotero-tldr.xpi
# - Beta 版本勾选"Set as a pre-release"
```

### 版本命名规范

- **Beta/预发布版**：`0.2.2-beta.1`、`0.2.2-beta.2` 等
- **正式版**：`0.2.2`、`0.3.0`、`1.0.0` 等
- **候选版本**：`0.2.2-rc.1`（可选）

### 自动发布工作流

项目使用 GitHub Actions（`.github/workflows/release.yml`），在推送任何 `v*` 格式的 tag 时触发：

1. 检出代码并安装依赖
2. 运行 `npm run build`
3. 运行 `npm run release` 创建 GitHub Release
4. 自动上传 `.xpi` 文件
5. 在相关 issue/PR 上添加发布通知

查看发布状态：https://github.com/XuZhiangDLUT/ZoteroTLDR/actions

## 常见问题

- **没有菜单？** 重启 Zotero，确保插件已启用
- **API 错误？** 检查 API Base、Key、Model；使用"测试 API"按钮
- **没有 PDF 文本？** 确保 PDF 已被 Zotero 索引（右键 → 重新索引条目）
- **PDF 被过滤？** 检查 PDF 过滤设置是否匹配你的文件名

## 开发笔记

### Zotero 7 设置面板修复指南

如果你的 Zotero 7 插件的设置面板在设置列表中显示，但点击后显示空白或显示其他插件的内容，以下是解决方案：

**问题现象**：加载 `preferences.xhtml` 时报错 `Error: not well-formed XML`

**根本原因与解决方案**：

1. **注册位置**：
   - ❌ 不要在 `bootstrap.js` 中注册
   - ✅ 在 `hooks.ts` → `onStartup()` 中，`initLocale()` 之后注册

2. **URL 格式**：
   - ❌ `rootURI + "content/preferences.xhtml"`（rootURI 在 hooks.ts 中未定义）
   - ✅ `chrome://${addonRef}/content/preferences.xhtml`

3. **preferences.xhtml 格式**：
   - ❌ 不要使用 `<?xml version="1.0"?>`、`<!DOCTYPE>` 或 `<linkset>` 元素
   - ✅ 使用最简 XUL 格式，单一 `<vbox>` 根元素：

```xml
<vbox xmlns="http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul"
      xmlns:html="http://www.w3.org/1999/xhtml">
  <groupbox>
    <label><html:h2>设置标题</html:h2></label>
    <hbox align="center">
      <label value="设置项:" style="width: 120px"/>
      <html:input type="text" id="..." preference="..." style="width: 350px"/>
    </hbox>
    <!-- 更多设置... -->
  </groupbox>
</vbox>
```

4. **hooks.ts 注册代码**：

```typescript
async function onStartup() {
  await Promise.all([
    Zotero.initializationPromise,
    Zotero.unlockPromise,
    Zotero.uiReadyPromise,
  ]);

  initLocale();

  // 注册设置面板 - 使用 chrome:// URL
  const addonRef = addon.data.config.addonRef;
  Zotero.PreferencePanes.register({
    pluginID: addon.data.config.addonID,
    src: `chrome://${addonRef}/content/preferences.xhtml`,
    label: addon.data.config.addonName,
    image: `chrome://${addonRef}/content/icons/favicon.png`,
  });

  // ... 其余启动代码
}
```

**调试脚本**（在 Zotero → 工具 → 开发者 → 运行 JavaScript 中执行）：

```javascript
// 检查已注册的设置面板
(function () {
  var panes = Zotero.PreferencePanes.pluginPanes || [];
  return (
    "已注册面板数: " +
    panes.length +
    "\n" +
    panes.map((p) => p.pluginID).join("\n")
  );
})();

// 测试 XML 解析
(function () {
  var url = "chrome://YOUR_ADDON_REF/content/preferences.xhtml";
  var xhr = new XMLHttpRequest();
  xhr.open("GET", url, false);
  xhr.send();
  var parser = new DOMParser();
  var doc = parser.parseFromString(xhr.responseText, "application/xml");
  var err = doc.querySelector("parsererror");
  return err ? "❌ " + err.textContent.substring(0, 200) : "✅ XML 正常";
})();
```

### 524 超时应对

当使用 OpenAI 兼容代理（例如走 Cloudflare）进行**远端 PDF 解析**时，长响应可能触发 **524（超时）**。本项目针对 524 主要采用了两种策略：

1. **流式输出（SSE）作为“保活”与进度输出**
   - 远端 PDF 模式改用 Gemini 原生流式接口：`:streamGenerateContent?alt=sse`
   - 通过 `ReadableStream` 逐行解析 `data: {...json...}`（`src/llm/providers.ts` → `summarizeWithRemotePdf()` / `parseSSEResponse()`）
   - 把每个 chunk 通过 `onStreamChunk(chunk, isThought)` 回传，任务队列面板可实时更新

2. **展示实时“思考/推理”片段（进度 + 调试）**
   - 开启“思考模式”后发送 `thinkingConfig.includeThoughts=true`，兼容的服务端会返回 `thought` parts
   - 将 `thought` 与正文输出分流（`isThought=true/false`），在任务队列面板中分区显示（`src/modules/aiSummary.ts`）
   - 通过右键菜单 **“查看 AI 任务队列”** 打开面板（支持展开/收起与运行中自动滚动）

补充：`retryOnTransientErrors` 可配置在偶发 524/流错误/超时时自动快速重试，但“流式接口”仍是主要解决方案。

## 许可证

AGPL-3.0-or-later
