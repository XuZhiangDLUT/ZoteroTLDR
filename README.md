# Hanchen's Zotero TLDR

[![zotero target version](https://img.shields.io/badge/Zotero-7-green?style=flat-square&logo=zotero&logoColor=CC2936)](https://www.zotero.org)
[![Using Zotero Plugin Template](https://img.shields.io/badge/Using-Zotero%20Plugin%20Template-blue?style=flat-square&logo=github)](https://github.com/windingwind/zotero-plugin-template)

[简体中文](./README-zhCN.md)

A Zotero 7 plugin that generates structured AI summaries for PDF papers. It supports two provider profiles, **Gemini Native** and **OpenAI Compatible**, each with its own defaults so you can switch providers by selecting a profile and filling in the API key.

## Features

- **AI Summarization**: Right-click → "ZoteroTLDR: AI 总结" to generate structured summaries.
- **Two Provider Profiles**: Switch between Gemini Native and OpenAI Compatible without overwriting each profile's defaults.
- **Remote PDF Upload**: Gemini Native uses Gemini `inlineData`; OpenAI Compatible uses chat-time `input_file` upload for ds2api/cliproxyapi-style gateways.
- **Streaming Thoughts and Output**: Streams reasoning/thinking chunks separately from final content when the provider exposes them.
- **Per-PDF Processing**: Each PDF in an item generates its own separate note.
- **PDF Filtering**: Filter PDFs by filename with glob patterns (supports AND/OR/NOT).
- **Batch Processing**: Process multiple items concurrently with provider-specific concurrency and rate limits.
- **Markdown Rendering**: Full support for tables, lists, headings, code blocks.
- **Customizable Prompts**: Use `{title}`, `{abstract}`, `{content}`, `{fileName}` variables.

## Install

1. Download the latest `.xpi` from Releases (or build locally)
2. Open Zotero → Tools → Add-ons → ⚙️ → Install Add-on From File…
3. Select `hanchen-s-zotero-tldr.xpi` and restart Zotero

## Auto Updates

Stable builds embed this Zotero update URL:

```text
https://raw.githubusercontent.com/XuZhiangDLUT/ZoteroTLDR/main/updates/update.json
```

After `v0.3.0` is released on GitHub and `updates/update.json` is committed, Zotero can check that URL and update the locally installed plugin automatically. If you installed an older build that used a legacy update manifest URL, install `v0.3.0` once manually to migrate to the in-repo update manifest.

## Quick Start

1. Select one or more items (or PDF attachments) in Zotero
2. Right-click → **"ZoteroTLDR: AI 总结"**
3. Each PDF will be processed and a summary note will be created

## Settings

**Zotero → Edit → Settings → Hanchen's Zotero TLDR**

### Provider Defaults

| Setting           | Gemini Native                  | OpenAI Compatible                      |
| ----------------- | ------------------------------ | -------------------------------------- |
| API Base URL      | `https://x666.me/v1`           | `https://cpa.20020519.xyz/v1`          |
| Model             | `gemini-2.5-pro-1m`            | `ds2api-openai/deepseek-v4-pro-search` |
| PDF Parse Mode    | Remote upload                  | Remote upload                          |
| Remote PDF Upload | Gemini `inlineData`            | Chat `input_file` inline upload        |
| Temperature       | `0.2`                          | `0.2`                                  |
| Max Output Tokens | `65536`                        | `1000000`                              |
| Enable Thoughts   | `true`                         | `true`                                 |
| Thinking Budget   | `-1`                           | `-1`                                   |
| Concurrency       | `1`                            | `5`                                    |
| Max Characters    | `800000`                       | `1000000`                              |
| Rate Limit        | `20` per `5` minutes           | `100` per `1` minute                   |
| Max File Size     | `25 MB`                        | `80 MB`                                |
| Max Pages         | `50`                           | `50`                                   |
| PDF Filter        | `!* - mono.pdf, !* - dual.pdf` | `!* - mono.pdf, !* - dual.pdf`         |

Only the active provider's settings are shown in the preferences panel.

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

Output: `.scaffold/build/hanchen-s-zotero-tldr.xpi`

## Release Process

### Prerequisites

- Ensure all changes are committed and tests pass
- Clean up any unnecessary build artifacts
- Update version in `package.json` if needed

### Update Channel Logic (Stable vs Test)

This plugin uses **two separate update channels** to ensure beta testers and stable users receive appropriate updates:

#### How It Works

1. **Two Update Manifests (committed in-repo)**:
   - `updates/update.json` - Stable channel (only stable versions, keep latest)
   - `updates/update-beta.json` - Test channel (only pre-releases like beta/rc, keep latest)

2. **Version-Specific `update_url` (embedded in the `.xpi`)**:
   - **Stable builds** (e.g., `0.3.0`): `https://raw.githubusercontent.com/<owner>/<repo>/main/updates/update.json`
   - **Test builds** (e.g., `0.3.1-beta.1`): `https://raw.githubusercontent.com/<owner>/<repo>/main/updates/update-beta.json`

3. **How Zotero Checks for Updates**:
   - Zotero periodically fetches the `update_url` from the **installed plugin**
   - If you installed a **stable** `.xpi`, Zotero only checks `updates/update.json` (stable only)
   - If you installed a **test** `.xpi`, Zotero only checks `updates/update-beta.json` (test only)

#### Channel Isolation Guarantees

- ✅ **Stable users NEVER see test updates** (because `updates/update.json` never contains pre-release versions)
- ✅ **Test users NEVER see stable updates** (because `updates/update-beta.json` never contains stable versions)
- ✅ **Channels are completely isolated** by design

#### How to Switch Channels

1. **From Stable → Beta**: Download and install a beta `.xpi` (e.g., `v0.3.1-beta.1`)
2. **From Beta → Stable**: Download and install a stable `.xpi` (e.g., `v0.3.0`)

Once you install the new `.xpi`, Zotero will use that build's embedded `update_url` for all future update checks.

#### Release Rules

- **Version naming**:
  - Stable: `X.Y.Z`
  - Test: `X.Y.Z-beta.N` / `X.Y.Z-rc.N` (any `-` pre-release goes to test channel)
- **Tag naming**:
  - Stable: `vX.Y.Z`
  - Test: `vX.Y.Z-beta.N` / `vX.Y.Z-rc.N`
- **Update manifest update (automated by CI)**:
  - Publishing **test**: overwrite `updates/update-beta.json` only
  - Publishing **stable**: overwrite `updates/update.json` only
- **GitHub Release settings**:
  - Test releases MUST be marked as "pre-release"
  - Stable releases MUST NOT be marked as "pre-release"
- **Retention**: GitHub Releases are kept unless you delete older releases manually.

> Migration note: Older `.xpi` builds may still use the legacy `.../releases/download/release/update*.json` URL. Those builds will stop auto-updating once the legacy manifest is no longer maintained. Install a newer `.xpi` once to migrate to the in-repo `updates/` manifests.

### Publishing Beta Version

Use beta versions for pre-release testing and early feedback.

```bash
# 1. Update version to beta (if not already)
# Edit package.json: "version": "0.3.1-beta.1"

# 2. Clean up and stage necessary changes
git status
git add package.json package-lock.json README.md README-zhCN.md .github/workflows/release.yml addon/ src/ typings/
# Remove any build artifacts if needed
rm -rf release-*/

# 3. Commit your changes
git commit -m "feat: your feature description

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"

# 4. Build the plugin
npm run build

# 5. Create and push git tag
git tag v0.3.1-beta.1
git push origin main
git push origin v0.3.1-beta.1

# GitHub Actions will automatically:
# - Build the project
# - Create GitHub Release (marked as pre-release)
# - Upload the .xpi file
# - Update `updates/update-beta.json` so installed beta builds can auto-update
```

### Publishing Stable Version

For stable releases ready for production use.

```bash
# 1. Update version to stable
# Edit package.json: "version": "0.3.0"

# 2. Clean up and stage changes
git status
git add package.json package-lock.json README.md README-zhCN.md .github/workflows/release.yml addon/ src/ typings/
rm -rf release-*/

# 3. Commit your changes
git commit -m "chore(release): v0.3.0

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"

# 4. Build the plugin
npm run build

# 5. Create and push git tag (without -beta suffix)
git tag v0.3.0
git push origin main
git push origin v0.3.0

# GitHub Actions will automatically:
# - Build the project
# - Create GitHub Release (stable)
# - Upload the .xpi file
# - Update `updates/update.json` so installed stable builds can auto-update
```

### Manual Release (Without GitHub Actions)

If you need to release manually:

```bash
# 1. Ensure version is updated in package.json
# 2. Build and create tag
npm run build
git tag v0.3.0

# 3. Create release manually
npm run release

# 4. Update in-repo update manifest (pick ONE)
# - Stable channel (X.Y.Z):
cp .scaffold/build/update.json updates/update.json
# - Test channel (X.Y.Z-beta.N / X.Y.Z-rc.N):
cp .scaffold/build/update-beta.json updates/update-beta.json
git add updates/update*.json
git commit -m "chore: update update manifest"
git push origin main

# Or create GitHub release via web interface:
# - Visit: https://github.com/XuZhiangDLUT/ZoteroTLDR/releases/new
# - Select tag: v0.3.0
# - Upload: .scaffold/build/hanchen-s-zotero-tldr.xpi
# - Do not check "Set as a pre-release" for stable versions
```

### Version Naming Convention

- **Beta/Pre-release**: `0.3.1-beta.1`, `0.3.1-beta.2`, etc.
- **Stable**: `0.3.0`, `0.3.1`, `1.0.0`, etc.
- **Release Candidate**: `0.3.1-rc.1` (optional)

### Automated Release Workflow

The project uses GitHub Actions (`.github/workflows/release.yml`) which triggers on any `v*` tag push:

1. Checks out code and installs dependencies
2. Verifies the pushed tag matches `package.json` (for example, tag `v0.3.0` requires version `0.3.0`)
3. Runs `npm run build`
4. Runs `npm run release` to create GitHub Release
5. Uploads `.xpi` file automatically
6. Commits the channel update manifest to `updates/` on `main`
7. Adds release notifications to related issues/PRs

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

When using a proxy/gateway (e.g. Cloudflare) for long remote PDF parsing, the request may hit **524 (timeout)**. This project uses streaming to reduce 524 and to make long-running tasks observable:

1. **Streamed response (SSE) to keep the connection alive**
   - Gemini Native remote PDF mode uses the Gemini streaming endpoint: `:streamGenerateContent?alt=sse`
   - OpenAI Compatible remote PDF mode uses `/chat/completions` with `stream: true`
   - Parse `data: {...json...}` incrementally via `ReadableStream` (`src/llm/providers.ts`)
   - Forward chunks through `onStreamChunk(chunk, isThought)` so the UI can update while the request is still running

2. **Real-time “thoughts” display (progress + debugging)**
   - If **Enable Thinking** is on, send `thinkingConfig.includeThoughts=true` so compatible providers may return `thought` parts
   - Split streamed chunks into normal output vs thought output (`isThought=true/false`), and show them separately in the Task Queue Panel (`src/modules/aiSummary.ts`)
   - Open the panel via context menu: **“ZoteroTLDR: 查看总结任务队列”** (supports expand/collapse + auto-scroll for running tasks)

Extra: there is also a configurable `retryOnTransientErrors` to retry occasional 524/stream/timeout hiccups, but streaming is the primary fix.

## License

AGPL-3.0-or-later
