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

| Setting | Description | Default |
|---------|-------------|---------|
| API Base URL | OpenAI-compatible endpoint | `https://x666.me/v1` |
| API Key | Your API key | (empty) |
| Model | Model name | `gemini-2.5-pro-1m` |
| Temperature | Creativity (0-2) | `0.2` |
| Enable Thinking | Use Gemini thinking mode | `true` |
| Thinking Budget | Token limit (-1=dynamic) | `-1` |
| Concurrency | Parallel processing count | `1` |
| Max Characters | Max text to extract per PDF | `800000` |
| Rate Limit | Max requests per time window | `20` |
| Rate Limit Window | Time window in minutes | `5` |
| PDF Filter | Filename filter patterns | `!*-mono.pdf, !*-dual.pdf` |
| Prompt Template | Customizable prompt | (detailed template) |

## PDF Filter Syntax

| Symbol | Meaning | Example |
|--------|---------|---------|
| `,` | OR | `*.pdf, *.PDF` → match either |
| `;` | AND | `*.pdf; !*-mono.pdf` → .pdf but not -mono.pdf |
| `!` | NOT (exclude) | `!*-dual.pdf` → exclude -dual.pdf |
| `*` | Wildcard (any chars) | `paper*.pdf` |
| `?` | Wildcard (single char) | `paper?.pdf` |

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

## Troubleshooting

- **No menu?** Restart Zotero, ensure plugin is enabled
- **API errors?** Check API Base, Key, Model; use "Test API" button
- **No PDF text?** Ensure PDFs are indexed by Zotero (right-click → Reindex Item)
- **PDF filtered out?** Check the PDF Filter setting matches your filenames

## License

AGPL-3.0-or-later
