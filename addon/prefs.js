// API 配置
pref("apiBase", "https://x666.me/v1");
pref("apiKey", "");
pref("model", "gemini-2.5-pro-1m");
pref("temperature", 0.2);

// PDF 解析模式: "remote" = 远端解析（上传PDF）, "local" = 本地解析（提取文本）
pref("pdfParseMode", "remote");

// 思考模式
pref("enableThoughts", true);
pref("thinkingBudget", -1); // -1=动态思考；0=关闭；>0=token数

// 处理参数
pref("concurrency", 1);
pref("maxChars", 800000);
pref("attachmentFilter", "!* - mono.pdf, !* - dual.pdf"); // 排除 - mono.pdf 和 - dual.pdf

// 速率限制
pref("rateLimitCount", 20); // 时间窗口内最大请求数
pref("rateLimitWindowMinutes", 5); // 时间窗口（分钟）

// 提示词模板
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
