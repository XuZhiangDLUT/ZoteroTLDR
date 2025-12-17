# Zotero AI Summarizer（中文）

[![zotero target version](https://img.shields.io/badge/Zotero-7-green?style=flat-square&logo=zotero&logoColor=CC2936)](https://www.zotero.org)
[![Using Zotero Plugin Template](https://img.shields.io/badge/Using-Zotero%20Plugin%20Template-blue?style=flat-square&logo=github)](https://github.com/windingwind/zotero-plugin-template)

[English README](./README.md)

一个适用于 Zotero 7 的 AI 摘要插件。它可以调用大模型，根据自定义提示词为选中文献生成结构化摘要，并将结果作为“子笔记”保存。

插件内置 Markdown→HTML 渲染（使用 `marked`），可以在 Zotero 笔记中正确显示表格、列表、标题、粗体、斜体、代码块等。

![效果预览](./img/Attention-Is-All-You-Need.png)

## 功能

- 右键一键「AI 总结到子笔记」，摘要结果自动挂在条目下
- 支持 **OpenAI 兼容接口** 和 **Gemini v1beta 原生接口**（例如 `x666.me`）
- 支持两种摘要模式：
  - `text-index`：基于 Zotero 全文索引文本（兼容性最好）
  - `pdf-native`：直接把 PDF 丢给 Gemini，让其原生理解文档
- 支持 **思考模式（thinking）** 与 **思考预算（thinkingBudget）**，可选将「思考摘要」折叠写入子笔记
- 支持按文件名 glob 过滤附件（默认过滤 `*-dual.pdf`）
- 支持多选条目 + 并发处理，可一键批量生成整库摘要
- 使用 Markdown→HTML 渲染，最大程度保留原始排版结构

## 安装

1. 在 Releases 页面下载最新 `.xpi`
2. Zotero → 工具 → 插件 → 右上角齿轮 → 从文件安装附加组件…
3. 选择 `zotero-ai-summarizer.xpi` 并重启 Zotero

## 快速上手

1. 打开偏好设置（见下一节），至少配置：
   - Provider（服务提供方）
   - 对应 Base URL
   - API Key
   - 模型名
2. 在中间列表选中文献条目（非笔记/非附件）
3. 右键 → 「AI 总结到子笔记」
4. 插件会：
   - 根据当前模式从 PDF/HTML 附件读取上下文
   - 调用所选模型生成结构化摘要
   - 在对应条目下创建子笔记写入结果（如启用思考摘要，会以折叠块形式附在末尾）

> 提示：`pdf-native` 模式下，请确保 PDF 已下载到本地，且大小不超过 `maxInlineMB` / `maxFileMB` 限制。

## 偏好设置

路径：Zotero → 首选项 → 扩展 → 「AI-Summarizer」

![设置](./img/Setting.png)

当前偏好项说明（对应 `addon/content/preferences.xhtml`）：

- Provider（服务提供方，`provider`）
  - `openai-compatible`：OpenAI 兼容 Chat Completions 接口
  - `gemini-v1beta`：Gemini v1beta 原生接口
- OpenAI 兼容 Base URL（`openaiApiBase`）
  - 例如 `https://x666.me/v1` 或你自己的反向代理
- Gemini v1beta Base URL（`geminiApiBase`）
  - 例如 `https://x666.me`
- API Key（`apiKey`）
  - 与所选服务对应的密钥/token
- 模型（`model`）
  - 例如：`gemini-2.5-pro`（通过 `x666.me` 调用）
- 温度（`temperature`）
  - 默认 `0.2`，数值越大输出越发散
- 启用思考模式（`enableThoughts`）
  - 勾选后会向代理传递思考配置（如果代理支持，例如 `x666.me`）
- 思考预算（`thinkingBudget`）
  - `-1`：动态思考
  - `0`：关闭思考
  - `>0`：限制思考 token 数量
- 摘要模式（`summarizeMode`）
  - `text-index`：使用 Zotero 的全文索引文本作为上下文
  - `pdf-native`：直接把 PDF 作为文件传给 Gemini（小文件走 inline，大文件走 Files API）
- 并发条目数（`concurrency`）
  - 同时处理的条目数量，建议 2–3 之间
- 附件过滤（`attachmentFilterGlob`）
  - 使用 glob 语法按文件名过滤附件，例如默认的 `*-dual.pdf`
- 将思考摘要保存为子笔记（`saveThoughtsToNote`）
  - 勾选后，会在摘要末尾追加一个折叠块展示思考摘要
- 截取最大字符数（`maxChars`）
  - 仅在 `text-index` 模式下生效，用于限制从附件全文索引中提取的最大长度
- 提示词模板（`prompt`）
  - 支持变量：`{title}`（题目）、`{abstract}`（摘要）、`{content}`（正文片段）
  - 可以完全自定义输出结构（例如增加表格、项目符号、对比分析等）
- 测试 API（按钮，`pref-api-test`）
  - 调用当前 Provider 对应接口进行一次简单请求，验证连通性与凭据是否正确

### 默认值位置

- 运行时可直接在偏好面板修改，立即生效
- 安装后的初始默认值来自 `addon/prefs.js`，包括：
  - `pref("openaiApiBase", "https://x666.me/v1")`
  - `pref("geminiApiBase", "https://x666.me")`
  - `pref("provider", "openai-compatible")`
  - `pref("model", "gemini-2.5-pro")`
  - `pref("enableThoughts", true)`
  - `pref("thinkingBudget", -1)`
  - `pref("summarizeMode", "text-index")`
  - `pref("concurrency", 2)`
  - `pref("attachmentFilterGlob", "*-dual.pdf")`
  - `pref("maxInlineMB", 20)`
  - `pref("maxFileMB", 50)`
  - `pref("saveThoughtsToNote", true)`
  - 以及原有的 `prompt`、`temperature`、`maxChars`
- 当偏好为空或未设置时，代码会在 `src/utils/prefs.ts` 与 `src/modules/aiSummary.ts` 中使用合理的 fallback 默认值

## 从源码编译

前置：Node.js（LTS）、Git、Zotero 7

```bash
npm install
npm start      # 开发热重载
npm run build  # 生成 .scaffold/build/zotero-ai-summarizer.xpi
```

若在 macOS 上 `npm install` 出现权限问题，可用临时缓存：

```bash
npm install --cache /tmp/.npm
```

## 发布到 GitHub

1. 推送代码到 GitHub
2. `npm run build`
3. GitHub → Releases → Draft a new release → 上传 `.scaffold/build/zotero-ai-summarizer.xpi`

## 许可

AGPL-3.0-or-later
