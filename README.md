# Hanchen's Zotero TLDR

[![zotero target version](https://img.shields.io/badge/Zotero-7-green?style=flat-square&logo=zotero&logoColor=CC2936)](https://www.zotero.org)
[![Using Zotero Plugin Template](https://img.shields.io/badge/Using-Zotero%20Plugin%20Template-blue?style=flat-square&logo=github)](https://github.com/windingwind/zotero-plugin-template)

[简体中文](./README-zhCN.md)

A Zotero 7 plugin that uses Gemini AI to generate structured summaries for your PDF papers. Each PDF gets its own summary note with rich Markdown rendering (tables, lists, headings, code blocks).

## Features

- **AI Summarization**: Right-click → "AI 总结到子笔记" to generate structured summaries
- **Per-PDF Processing**: Each PDF in an item generates its own separate note
- **Gemini Integration**: Uses Gemini API via OpenAI-compatible proxy (e.g., x666.me)
- **Thinking Mode**: Supports Gemini's thinking/reasoning capabilities
- **PDF Filtering**: Filter PDFs by filename with glob patterns (supports AND/OR/NOT)
- **Batch Processing**: Process multiple items concurrently
- **Markdown Rendering**: Full support for tables, lists, headings, code blocks
- **Customizable Prompts**: Use `{title}`, `{abstract}`, `{content}`, `{fileName}` variables

## Install

1. Download the latest `.xpi` from Releases (or build locally)
2. Open Zotero → Tools → Add-ons → ⚙️ → Install Add-on From File…
3. Select `hanchens-zotero-tldr.xpi` and restart Zotero

## Quick Start

1. Select one or more items (or PDF attachments) in Zotero
2. Right-click → **"AI 总结到子笔记"**
3. Each PDF will be processed and a summary note will be created

## Settings

**Zotero → Edit → Settings → Hanchen's Zotero TLDR**

| Setting           | Description                  | Default                    |
| ----------------- | ---------------------------- | -------------------------- |
| API Base URL      | OpenAI-compatible endpoint   | `https://x666.me/v1`       |
| API Key           | Your API key                 | (empty)                    |
| Model             | Model name                   | `gemini-2.5-pro-1m`        |
| Temperature       | Creativity (0-2)             | `0.2`                      |
| Enable Thinking   | Use Gemini thinking mode     | `true`                     |
| Thinking Budget   | Token limit (-1=dynamic)     | `-1`                       |
| Concurrency       | Parallel processing count    | `1`                        |
| Max Characters    | Max text to extract per PDF  | `800000`                   |
| Rate Limit        | Max requests per time window | `20`                       |
| Rate Limit Window | Time window in minutes       | `5`                        |
| PDF Filter        | Filename filter patterns     | `!*-mono.pdf, !*-dual.pdf` |
| Prompt Template   | Customizable prompt          | (detailed template)        |

## PDF Filter Syntax

| Symbol | Meaning                | Example                                       |
| ------ | ---------------------- | --------------------------------------------- |
| `,`    | OR                     | `*.pdf, *.PDF` → match either                 |
| `;`    | AND                    | `*.pdf; !*-mono.pdf` → .pdf but not -mono.pdf |
| `!`    | NOT (exclude)          | `!*-dual.pdf` → exclude -dual.pdf             |
| `*`    | Wildcard (any chars)   | `paper*.pdf`                                  |
| `?`    | Wildcard (single char) | `paper?.pdf`                                  |

**Default**: `!*-mono.pdf, !*-dual.pdf` (excludes -mono.pdf and -dual.pdf files)

## Prompt Template Variables

- `{title}` - Paper title
- `{abstract}` - Paper abstract
- `{content}` - Extracted PDF text
- `{fileName}` - PDF filename

## Build from Source

```bash
# Install dependencies
npm install

# Development (hot reload)
npm start

# Production build
npm run build
```

Output: `.scaffold/build/hanchens-zotero-tldr.xpi`

## Release Process

### Prerequisites

- Ensure all changes are committed and tests pass
- Clean up any unnecessary build artifacts
- Update version in `package.json` if needed

### Publishing Beta Version

Use beta versions for pre-release testing and early feedback.

```bash
# 1. Update version to beta (if not already)
# Edit package.json: "version": "0.2.2-beta.1"

# 2. Clean up and stage necessary changes
git status
git add package.json package-lock.json src/
# Remove any build artifacts if needed
rm -rf release-*/

# 3. Commit your changes
git commit -m "feat: your feature description

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"

# 4. Build the plugin
npm run build

# 5. Create and push git tag
git tag v0.2.2-beta.1
git push origin main
git push origin v0.2.2-beta.1

# GitHub Actions will automatically:
# - Build the project
# - Create GitHub Release (marked as pre-release)
# - Upload the .xpi file
```

### Publishing Stable Version

For stable releases ready for production use.

```bash
# 1. Update version to stable
# Edit package.json: "version": "0.2.2"

# 2. Clean up and stage changes
git status
git add package.json package-lock.json src/
rm -rf release-*/

# 3. Commit your changes
git commit -m "chore(release): v0.2.2

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"

# 4. Build the plugin
npm run build

# 5. Create and push git tag (without -beta suffix)
git tag v0.2.2
git push origin main
git push origin v0.2.2

# GitHub Actions will automatically:
# - Build the project
# - Create GitHub Release (stable)
# - Upload the .xpi file
```

### Manual Release (Without GitHub Actions)

If you need to release manually:

```bash
# 1. Ensure version is updated in package.json
# 2. Build and create tag
npm run build
git tag v0.2.2-beta.1

# 3. Create release manually
npm run release

# Or create GitHub release via web interface:
# - Visit: https://github.com/XuZhiangDLUT/ZoteroTLDR/releases/new
# - Select tag: v0.2.2-beta.1
# - Upload: .scaffold/build/hanchens-zotero-tldr.xpi
# - Check "Set as a pre-release" for beta versions
```

### Version Naming Convention

- **Beta/Pre-release**: `0.2.2-beta.1`, `0.2.2-beta.2`, etc.
- **Stable**: `0.2.2`, `0.3.0`, `1.0.0`, etc.
- **Release Candidate**: `0.2.2-rc.1` (optional)

### Automated Release Workflow

The project uses GitHub Actions (`.github/workflows/release.yml`) which triggers on any `v*` tag push:

1. Checks out code and installs dependencies
2. Runs `npm run build`
3. Runs `npm run release` to create GitHub Release
4. Uploads `.xpi` file automatically
5. Adds release notifications to related issues/PRs

Check release status at: https://github.com/XuZhiangDLUT/ZoteroTLDR/actions

## Troubleshooting

- **No menu?** Restart Zotero, ensure plugin is enabled
- **API errors?** Check API Base, Key, Model; use "Test API" button
- **No PDF text?** Ensure PDFs are indexed by Zotero (right-click → Reindex Item)
- **PDF filtered out?** Check the PDF Filter setting matches your filenames

## Development Notes

### Zotero 7 Preferences Panel Fix

If your Zotero 7 plugin's preferences panel shows in the settings list but displays blank content or another plugin's content when clicked, here's the solution:

**Problem**: `Error: not well-formed XML` when loading `preferences.xhtml`

**Root Causes & Solutions**:

1. **Registration Location**:
   - ❌ Don't register in `bootstrap.js`
   - ✅ Register in `hooks.ts` → `onStartup()` after `initLocale()`

2. **URL Format**:
   - ❌ `rootURI + "content/preferences.xhtml"` (rootURI undefined in hooks.ts)
   - ✅ `chrome://${addonRef}/content/preferences.xhtml`

3. **preferences.xhtml Format**:
   - ❌ Don't use `<?xml version="1.0"?>`, `<!DOCTYPE>`, or `<linkset>` elements
   - ✅ Use minimal XUL format with single root `<vbox>`:

```xml
<vbox xmlns="http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul"
      xmlns:html="http://www.w3.org/1999/xhtml">
  <groupbox>
    <label><html:h2>Settings Title</html:h2></label>
    <hbox align="center">
      <label value="Setting:" style="width: 120px"/>
      <html:input type="text" id="..." preference="..." style="width: 350px"/>
    </hbox>
    <!-- more settings... -->
  </groupbox>
</vbox>
```

4. **hooks.ts Registration Code**:

```typescript
async function onStartup() {
  await Promise.all([
    Zotero.initializationPromise,
    Zotero.unlockPromise,
    Zotero.uiReadyPromise,
  ]);

  initLocale();

  // Register Preferences Pane - use chrome:// URL
  const addonRef = addon.data.config.addonRef;
  Zotero.PreferencePanes.register({
    pluginID: addon.data.config.addonID,
    src: `chrome://${addonRef}/content/preferences.xhtml`,
    label: addon.data.config.addonName,
    image: `chrome://${addonRef}/content/icons/favicon.png`,
  });

  // ... rest of startup
}
```

**Debugging Scripts** (Run in Zotero → Tools → Developer → Run JavaScript):

```javascript
// Check if plugin panes are registered
(function () {
  var panes = Zotero.PreferencePanes.pluginPanes || [];
  return (
    "Registered panes: " +
    panes.length +
    "\n" +
    panes.map((p) => p.pluginID).join("\n")
  );
})();

// Test XML parsing
(function () {
  var url = "chrome://YOUR_ADDON_REF/content/preferences.xhtml";
  var xhr = new XMLHttpRequest();
  xhr.open("GET", url, false);
  xhr.send();
  var parser = new DOMParser();
  var doc = parser.parseFromString(xhr.responseText, "application/xml");
  var err = doc.querySelector("parsererror");
  return err ? "❌ " + err.textContent.substring(0, 200) : "✅ XML OK";
})();
```

### Cloudflare 524 Timeout Mitigation

When using an OpenAI-compatible proxy (e.g. Cloudflare) for long remote PDF parsing, the request may hit **524 (timeout)**. This project uses two strategies to reduce 524 and to make long-running tasks observable:

1. **Streamed response (SSE) to keep the connection alive**
   - Remote PDF mode uses Gemini native streaming endpoint: `:streamGenerateContent?alt=sse`
   - Parse `data: {...json...}` incrementally via `ReadableStream` (`src/llm/providers.ts` → `summarizeWithRemotePdf()` / `parseSSEResponse()`)
   - Forward chunks through `onStreamChunk(chunk, isThought)` so the UI can update while the request is still running

2. **Real-time “thoughts” display (progress + debugging)**
   - If **Enable Thinking** is on, send `thinkingConfig.includeThoughts=true` so compatible providers may return `thought` parts
   - Split streamed chunks into normal output vs thought output (`isThought=true/false`), and show them separately in the Task Queue Panel (`src/modules/aiSummary.ts`)
   - Open the panel via context menu: **“查看 AI 任务队列”** (supports expand/collapse + auto-scroll for running tasks)

Extra: there is also a configurable `retryOnTransientErrors` to retry occasional 524/stream/timeout hiccups, but streaming is the primary fix.

## License

AGPL-3.0-or-later
