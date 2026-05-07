# Hanchen's Zotero TLDR

[![zotero target version](https://img.shields.io/badge/Zotero-7-green?style=flat-square&logo=zotero&logoColor=CC2936)](https://www.zotero.org)
[![Using Zotero Plugin Template](https://img.shields.io/badge/Using-Zotero%20Plugin%20Template-blue?style=flat-square&logo=github)](https://github.com/windingwind/zotero-plugin-template)

[English](./README.md)

一个 Zotero 7 插件，用 AI 为 PDF 论文生成结构化摘要。插件支持 **Gemini Native** 和 **OpenAI Compatible** 两套 Provider 配置，每套都有独立默认参数，切换 Provider 后通常只需要填写对应 API Key。

## 功能特点

- **AI 摘要生成**：右键 → "ZoteroTLDR: AI 总结"，一键生成结构化摘要。
- **双 Provider 配置**：Gemini Native 与 OpenAI Compatible 参数互不覆盖，便于快速切换。
- **远端 PDF 上传**：Gemini Native 使用 Gemini `inlineData`；OpenAI Compatible 使用 chat-time `input_file` 上传，适配 ds2api/cliproxyapi 链路。
- **流式思考与输出**：Provider 支持时，思考/推理内容和最终正文会分流显示。
- **独立处理每个 PDF**：一个条目有多个 PDF 时，每个 PDF 生成独立笔记。
- **PDF 过滤**：支持按文件名过滤，使用 glob 模式（支持 AND/OR/NOT）。
- **批量处理**：支持多选条目并发处理，并使用 Provider 独立并发与速率限制。
- **Markdown 渲染**：完整支持表格、列表、标题、代码块。
- **自定义提示词**：支持 `{title}`、`{abstract}`、`{content}`、`{fileName}` 变量。

## 安装

1. 从 Releases 下载最新 `.xpi` 文件
2. Zotero → 工具 → 附加组件 → ⚙️ → 从文件安装…
3. 选择 `hanchen-s-zotero-tldr.xpi` 并重启 Zotero

## 自动更新

稳定版构建会在 XPI 中写入这个 Zotero 更新地址：

```text
https://raw.githubusercontent.com/XuZhiangDLUT/ZoteroTLDR/main/updates/update.json
```

`v0.3.2` 发布到 GitHub 且 `updates/update.json` 提交后，Zotero 就可以通过这个链接检查并更新本地已安装插件。如果你安装的是很早以前使用旧更新清单地址的版本，请先手动安装一次新版 `.xpi`，之后就会迁移到仓库内更新清单。

## 快速开始

1. 在 Zotero 中选择一个或多个条目（或 PDF 附件）
2. 右键 → **"ZoteroTLDR: AI 总结"**
3. 每个 PDF 都会被处理并生成一个摘要笔记

## 设置

**Zotero → 编辑 → 设置 → Hanchen's Zotero TLDR**

### Provider 默认参数

| 设置项         | Gemini Native                  | OpenAI Compatible                      |
| -------------- | ------------------------------ | -------------------------------------- |
| API Base URL   | `https://x666.me/v1`           | `https://cpa.20020519.xyz/v1`          |
| 模型           | `gemini-2.5-pro-1m`            | `ds2api-openai/deepseek-v4-pro-search` |
| PDF 解析模式   | 远端上传                       | 远端上传                               |
| 远端 PDF 上传  | Gemini `inlineData`            | Chat `input_file` 内联上传             |
| 温度           | `0.2`                          | `0.2`                                  |
| 最大输出 Token | `65536`                        | `1000000`                              |
| 启用思考模式   | `true`                         | `true`                                 |
| 思考预算       | `-1`                           | `-1`                                   |
| 并发数         | `1`                            | `5`                                    |
| 最大字符数     | `800000`                       | `1000000`                              |
| 速率限制       | `20` 次 / `5` 分钟             | `100` 次 / `1` 分钟                    |
| 最大文件大小   | `25 MB`                        | `80 MB`                                |
| 最大页数       | `50`                           | `50`                                   |
| PDF 过滤       | `!* - mono.pdf, !* - dual.pdf` | `!* - mono.pdf, !* - dual.pdf`         |

设置界面只显示当前启用 Provider 的相关配置。

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

输出：`.scaffold/build/hanchen-s-zotero-tldr.xpi`

## 发布流程

### 前提条件

- 确保所有改动已提交且测试通过
- 清理不必要的构建产物
- 根据需要更新 `package.json` 中的版本号

### 自动更新与发布链路

当前仓库已经配置 GitHub Actions（`.github/workflows/release.yml`）。正常发布时不需要手动上传 `.xpi`：

```bash
git push origin main
git push origin vX.Y.Z
```

推送 tag 后，GitHub Actions 会在云端重新构建 `.xpi`、创建 GitHub Release、上传构建产物，并把对应通道的 `updates/update*.json` 自动提交回 `main`。

注意：`.xpi` 内包含构建时间，因此本地构建产物与 GitHub Actions 构建产物的 `sha512` 通常不同。以 Actions 自动提交回 `updates/update*.json` 的 hash 为准。发布完成后执行：

```bash
git pull --ff-only
```

把 `github-actions[bot]` 回写的更新清单同步回本地仓库。

### 更新通道逻辑（稳定/测试）

本插件使用**两个独立的更新通道**来确保测试用户和正式用户各自收到合适的更新：

#### 工作原理

1. **两个更新清单（托管在仓库中）**：
   - `updates/update.json` - 稳定通道（只包含稳定版本，仅保留最新一个）
   - `updates/update-beta.json` - 测试通道（只包含预发布版本如 beta/rc，仅保留最新一个）

2. **版本专属的 `update_url`（写入 `.xpi`）**：
   - **稳定版构建**（如 `0.3.0`）：`https://raw.githubusercontent.com/<owner>/<repo>/main/updates/update.json`
   - **测试版构建**（如 `0.3.1-beta.1`）：`https://raw.githubusercontent.com/<owner>/<repo>/main/updates/update-beta.json`

3. **Zotero 如何检查更新**：
   - Zotero 定期从**已安装插件**的 `update_url` 获取更新信息
   - 如果你安装了**稳定版** `.xpi`，Zotero 只会检查 `updates/update.json`（仅稳定版本）
   - 如果你安装了**测试版** `.xpi`，Zotero 只会检查 `updates/update-beta.json`（仅测试版本）

#### 通道隔离保证

- ✅ **稳定版用户永远看不到测试版更新**（因为 `updates/update.json` 永远不包含预发布版本）
- ✅ **测试版用户永远看不到稳定版更新**（因为 `updates/update-beta.json` 永远不包含稳定版本）
- ✅ **通道完全隔离**，这是设计保证的

#### 如何切换通道

1. **从稳定版 → 测试版**：下载并安装测试版 `.xpi`（如 `v0.3.1-beta.1`）
2. **从测试版 → 稳定版**：下载并安装稳定版 `.xpi`（如 `v0.3.0`）

一旦安装了新的 `.xpi`，Zotero 将使用该构建版本内置的 `update_url` 进行所有后续更新检查。

#### 发布规则

- **版本命名**：
  - 稳定版：`X.Y.Z`
  - 测试版：`X.Y.Z-beta.N` / `X.Y.Z-rc.N`（任意包含 `-` 的预发布版本都会走测试通道）
- **Tag 命名**：
  - 稳定版：`vX.Y.Z`
  - 测试版：`vX.Y.Z-beta.N` / `vX.Y.Z-rc.N`
- **更新清单更新（CI 自动完成）**：
  - 发布**测试版**：只覆盖 `updates/update-beta.json`
  - 发布**稳定版**：只覆盖 `updates/update.json`
- **GitHub Release 设置**：
  - 测试版必须标记为"pre-release"（预发布）
  - 稳定版不能标记为"pre-release"
- **保留策略**：GitHub Releases 会保留历史版本；如需清理旧版本，请手动删除。

> 迁移提示：旧版 `.xpi` 可能仍然使用历史的 `.../releases/download/release/update*.json` 地址。等历史清单不再维护后，这些旧版将无法继续自动更新；请手动安装一次新版 `.xpi` 以迁移到仓库内 `updates/` 清单。

### 发布 Beta 版本

Beta 版本用于预发布测试和早期反馈。

```bash
# 1. 更新版本号为 beta（如果还没更新）
# 编辑 package.json: "version": "0.3.1-beta.1"

# 2. 清理并暂存必要的改动
git status
git add package.json package-lock.json README.md README-zhCN.md .github/workflows/release.yml addon/ src/ typings/
# 如有需要，删除构建产物
rm -rf release-*/

# 3. 提交改动
git commit -m "feat: 功能描述

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"

# 4. 创建并推送 git tag
git tag v0.3.1-beta.1
git push origin main
git push origin v0.3.1-beta.1

# GitHub Actions 将自动：
# - 构建项目
# - 创建 GitHub Release（标记为预发布）
# - 上传 .xpi 文件
# - 更新 `updates/update-beta.json`，让已安装的 beta 版自动更新

# 5. 同步 Actions 回写的更新清单
git pull --ff-only
```

### 发布正式版本

用于生产环境的稳定版本发布。

```bash
# 1. 更新版本号为正式版
# 编辑 package.json: "version": "0.3.0"

# 2. 清理并暂存改动
git status
git add package.json package-lock.json README.md README-zhCN.md .github/workflows/release.yml addon/ src/ typings/
rm -rf release-*/

# 3. 提交改动
git commit -m "chore(release): v0.3.0

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"

# 4. 创建并推送 git tag（不带 -beta 后缀）
git tag v0.3.0
git push origin main
git push origin v0.3.0

# GitHub Actions 将自动：
# - 构建项目
# - 创建 GitHub Release（稳定版）
# - 上传 .xpi 文件
# - 更新 `updates/update.json`，让已安装的稳定版自动更新

# 5. 同步 Actions 回写的更新清单
git pull --ff-only
```

### 手动发布（不使用 GitHub Actions）

仅在 GitHub Actions 不可用时使用手动发布。手动发布时必须确保上传的 `.xpi` 与 `updates/update*.json` 中的 `update_hash` 完全一致。

```bash
# 1. 确保 package.json 中的版本号已更新
# 2. 构建并创建 tag
npm run build
git tag v0.3.0

# 3. 手动创建 release
npm run release

# 4. 更新仓库内更新清单（任选其一）
# - 稳定通道（X.Y.Z）：
cp .scaffold/build/update.json updates/update.json
# - 测试通道（X.Y.Z-beta.N / X.Y.Z-rc.N）：
cp .scaffold/build/update-beta.json updates/update-beta.json
git add updates/update*.json
git commit -m "chore: update update manifest"
git push origin main

# 或通过 GitHub 网页界面创建 release：
# - 访问：https://github.com/XuZhiangDLUT/ZoteroTLDR/releases/new
# - 选择 tag：v0.3.0
# - 上传文件：.scaffold/build/hanchen-s-zotero-tldr.xpi
# - 稳定版不要勾选 "Set as a pre-release"
# - 发布后重新计算已上传资产的 SHA-512，并确认 `updates/update*.json` 中的 `update_hash` 一致
```

### 版本命名规范

- **Beta/预发布版**：`0.3.1-beta.1`、`0.3.1-beta.2` 等
- **正式版**：`0.3.0`、`0.3.1`、`1.0.0` 等
- **候选版本**：`0.3.1-rc.1`（可选）

### 自动发布工作流

项目使用 GitHub Actions（`.github/workflows/release.yml`），在推送任何 `v*` 格式的 tag 时触发：

1. 检出代码并安装依赖
2. 校验推送的 tag 与 `package.json` 匹配（例如 tag `v0.3.0` 要求版本号为 `0.3.0`）
3. 运行 `npm run build`
4. 运行 `npm run release` 创建 GitHub Release
5. 自动上传 `.xpi` 文件
6. 根据云端构建出的 `.xpi` 计算 `update_hash`
7. 将对应通道的更新清单提交到 `main` 的 `updates/`
8. 在相关 issue/PR 上添加发布通知

发布完成后，本地仓库通常会显示 `behind 1`，因为 Actions 会追加一个类似 `chore: update stable manifest for vX.Y.Z` 的提交。执行 `git pull --ff-only` 即可同步。

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

当使用代理/网关（例如走 Cloudflare）进行**远端 PDF 解析**时，长响应可能触发 **524（超时）**。本项目主要通过流式输出来减少 524，并让长任务可观察：

1. **流式输出（SSE）作为“保活”与进度输出**
   - Gemini Native 远端 PDF 模式使用 Gemini 流式接口：`:streamGenerateContent?alt=sse`
   - OpenAI Compatible 远端 PDF 模式使用 `/chat/completions` 且设置 `stream: true`
   - 通过 `ReadableStream` 逐行解析 `data: {...json...}`（`src/llm/providers.ts`）
   - 把每个 chunk 通过 `onStreamChunk(chunk, isThought)` 回传，任务队列面板可实时更新

2. **展示实时“思考/推理”片段（进度 + 调试）**
   - 开启“思考模式”后发送 `thinkingConfig.includeThoughts=true`，兼容的服务端会返回 `thought` parts
   - 将 `thought` 与正文输出分流（`isThought=true/false`），在任务队列面板中分区显示（`src/modules/aiSummary.ts`）
   - 通过右键菜单 **“ZoteroTLDR: 查看总结任务队列”** 打开面板（支持展开/收起与运行中自动滚动）

补充：`retryOnTransientErrors` 可配置在偶发 524/流错误/超时时自动快速重试，但“流式接口”仍是主要解决方案。

## 许可证

AGPL-3.0-or-later
