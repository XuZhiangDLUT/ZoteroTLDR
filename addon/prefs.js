// 当前启用的 Provider
pref("activeProvider", "gemini-native");

// Gemini Native 配置
pref("geminiApiBase", "https://x666.me/v1");
pref("geminiApiKey", "");
pref("geminiModel", "gemini-2.5-pro-1m");
pref("geminiTemperature", "0.2");
pref("geminiMaxOutputTokens", "65536");
pref("geminiPdfParseMode", "remote");
pref("geminiEnableThoughts", true);
pref("geminiThinkingBudget", -1);
pref("geminiConcurrency", 1);
pref("geminiMaxChars", "800000");
pref("geminiAttachmentFilter", "!* - mono.pdf, !* - dual.pdf");
pref("geminiMaxFileSizeMB", 25);
pref("geminiMaxPageCount", 50);
pref("geminiSkipExistingSummary", true);
pref("geminiRetryOnTransientErrors", 2);
pref("geminiRateLimitCount", 20);
pref("geminiRateLimitWindowMinutes", 5);
pref(
  "geminiPrompt",
  `请严格按照原文的章节顺序，用简体中文对所提供的文章进行详细的、逐节的解释。请遵循以下结构：

**对于文章的每一个小节：**

1.  **分点总结该小节的文本内容。**
    * 清晰、简洁地概括该小节的核心论点和主要信息。

2.  **解释该小节中出现的每一张图片。**
    * **图片描述：** 详细描述图片的视觉元素，包括人物、物体、场景、图表、颜色和构图等。
    * **图片的角色与重要性：** 深入解释该图片如何与本小节的文本内容相关联。说明它是如何作为证据、示例、视觉化数据或情感补充，来支持、阐明或强调该小节所提出的观点的。

请确保整个解释过程与文章的原始流程完全一致，从而为读者提供一个与原文同步的、清晰的深度解读。

**论文信息:**
- 题目：{title}
- 摘要：{abstract}
- 正文：
{content}`,
);

// OpenAI Compatible / cliproxyapi 配置
pref("openaiCompatibleApiBase", "https://cpa.20020519.xyz/v1");
pref("openaiCompatibleApiKey", "");
pref("openaiCompatibleModel", "ds2api-openai/deepseek-v4-pro-search");
pref("openaiCompatibleTemperature", "0.2");
pref("openaiCompatibleMaxOutputTokens", "1000000");
pref("openaiCompatiblePdfParseMode", "remote");
pref("openaiCompatibleEnableThoughts", true);
pref("openaiCompatibleThinkingBudget", -1);
pref("openaiCompatibleConcurrency", 5);
pref("openaiCompatibleMaxChars", "1000000");
pref("openaiCompatibleAttachmentFilter", "!* - mono.pdf, !* - dual.pdf");
pref("openaiCompatibleMaxFileSizeMB", 80);
pref("openaiCompatibleMaxPageCount", 50);
pref("openaiCompatibleSkipExistingSummary", true);
pref("openaiCompatibleRetryOnTransientErrors", 2);
pref("openaiCompatibleRateLimitCount", 100);
pref("openaiCompatibleRateLimitWindowMinutes", 1);
pref(
  "openaiCompatiblePrompt",
  `请严格按照原文的章节顺序，用简体中文对所提供的文章进行详细的、逐节的解释。请遵循以下结构：

**对于文章的每一个小节：**

1.  **分点总结该小节的文本内容。**
    * 清晰、简洁地概括该小节的核心论点和主要信息。

2.  **解释该小节中出现的每一张图片。**
    * **图片描述：** 详细描述图片的视觉元素，包括人物、物体、场景、图表、颜色和构图等。
    * **图片的角色与重要性：** 深入解释该图片如何与本小节的文本内容相关联。说明它是如何作为证据、示例、视觉化数据或情感补充，来支持、阐明或强调该小节所提出的观点的。

请确保整个解释过程与文章的原始流程完全一致，从而为读者提供一个与原文同步的、清晰的深度解读。

**论文信息:**
- 题目：{title}
- 摘要：{abstract}
- 正文：
{content}`,
);

// 兼容旧版本的单套配置键。新代码会把这些作为 Gemini Native 的迁移来源。
pref("apiBase", "https://x666.me/v1");
pref("apiKey", "");
pref("model", "gemini-2.5-pro-1m");
pref("temperature", "0.2");
pref("maxOutputTokens", "65536");
pref("pdfParseMode", "remote");
pref("enableThoughts", true);
pref("thinkingBudget", -1);
pref("concurrency", 1);
pref("maxChars", "800000");
pref("attachmentFilter", "!* - mono.pdf, !* - dual.pdf");
pref("maxFileSizeMB", 25);
pref("maxPageCount", 50);
pref("skipExistingSummary", true);
pref("retryOnTransientErrors", 2);
pref("rateLimitCount", 20);
pref("rateLimitWindowMinutes", 5);
pref(
  "prompt",
  `请严格按照原文的章节顺序，用简体中文对所提供的文章进行详细的、逐节的解释。请遵循以下结构：

**对于文章的每一个小节：**

1.  **分点总结该小节的文本内容。**
    * 清晰、简洁地概括该小节的核心论点和主要信息。

2.  **解释该小节中出现的每一张图片。**
    * **图片描述：** 详细描述图片的视觉元素，包括人物、物体、场景、图表、颜色和构图等。
    * **图片的角色与重要性：** 深入解释该图片如何与本小节的文本内容相关联。说明它是如何作为证据、示例、视觉化数据或情感补充，来支持、阐明或强调该小节所提出的观点的。

请确保整个解释过程与文章的原始流程完全一致，从而为读者提供一个与原文同步的、清晰的深度解读。

**论文信息:**
- 题目：{title}
- 摘要：{abstract}
- 正文：
{content}`,
);
