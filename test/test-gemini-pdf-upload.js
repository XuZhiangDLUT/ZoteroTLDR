/**
 * 测试 Gemini API 是否支持直接上传 PDF 附件
 *
 * 测试配置:
 * - model: gemini-2.5-pro-1m
 * - thinking_budget: -1
 * - api_base: https://x666.me
 *
 * 运行方式: node test/test-gemini-pdf-upload.js
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 配置
const CONFIG = {
  model: "gemini-2.5-pro-1m",
  api_base: "https://x666.me",
  api_key: "", // 请填入你的 API Key
  thinking_budget: -1,
};

// 测试 PDF 文件路径
const PDF_PATH = path.join(__dirname, 'Du-2022-An efficient and easy-to-extend Matlab code of the Moving Morphable Component (MMC) method for three.pdf');

/**
 * 将文件转换为 base64
 */
function fileToBase64(filePath) {
  const buffer = fs.readFileSync(filePath);
  return buffer.toString('base64');
}

/**
 * 测试方法 1: 使用 OpenAI 兼容格式发送 PDF (inline image-like format)
 * 某些代理支持在 content 中嵌入 base64 文件
 */
async function testOpenAICompatibleFormat() {
  console.log('\n' + '='.repeat(60));
  console.log('测试方法 1: OpenAI 兼容格式 (image_url 方式)');
  console.log('='.repeat(60));

  const pdfBase64 = fileToBase64(PDF_PATH);
  const url = `${CONFIG.api_base}/v1/chat/completions`;

  const body = {
    model: CONFIG.model,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: "请描述这个 PDF 文档中包含的图片内容。如果你能看到图片（如流程图、示意图、数学公式图、实验结果图等），请详细描述它们。这是一篇关于 Moving Morphable Component (MMC) 方法的论文。"
          },
          {
            type: "image_url",
            image_url: {
              url: `data:application/pdf;base64,${pdfBase64}`
            }
          }
        ]
      }
    ],
    temperature: 0.2,
    max_tokens: 2000,
  };

  try {
    console.log(`请求 URL: ${url}`);
    console.log(`PDF 文件大小: ${(pdfBase64.length * 0.75 / 1024 / 1024).toFixed(2)} MB`);
    console.log('发送请求中...\n');

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${CONFIG.api_key}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.log(`❌ 请求失败: ${response.status}`);
      console.log(`错误详情: ${errorText}`);
      return false;
    }

    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content || '';

    console.log('✅ 请求成功!');
    console.log('\n--- 模型响应 ---');
    console.log(content);
    console.log('--- 响应结束 ---\n');

    // 检查是否识别到了图片内容
    const hasImageDescription = content.includes('图') ||
                                content.includes('Figure') ||
                                content.includes('image') ||
                                content.includes('diagram') ||
                                content.includes('流程') ||
                                content.includes('示意');

    if (hasImageDescription) {
      console.log('✅ 模型成功识别到 PDF 中的图片内容！远端解析有效！');
    } else {
      console.log('⚠️ 模型响应中未明确提到图片内容，可能只解析了文本。');
    }

    return true;
  } catch (error) {
    console.log(`❌ 请求异常: ${error.message}`);
    return false;
  }
}

/**
 * 测试方法 2: 使用 Gemini 原生格式 (inlineData)
 * 某些代理可能支持透传 Gemini 原生 API 格式
 */
async function testGeminiNativeFormat() {
  console.log('\n' + '='.repeat(60));
  console.log('测试方法 2: Gemini 原生格式 (inlineData)');
  console.log('='.repeat(60));

  const pdfBase64 = fileToBase64(PDF_PATH);

  // 尝试使用 Gemini 原生 API 端点
  const url = `${CONFIG.api_base}/v1/models/${CONFIG.model}:generateContent`;

  const body = {
    contents: [
      {
        parts: [
          {
            text: "请描述这个 PDF 文档中包含的图片内容。如果你能看到图片（如流程图、示意图、数学公式图、实验结果图等），请详细描述它们。"
          },
          {
            inlineData: {
              mimeType: "application/pdf",
              data: pdfBase64
            }
          }
        ]
      }
    ],
    generationConfig: {
      temperature: 0.2,
      maxOutputTokens: 2000,
      thinkingConfig: {
        thinkingBudget: CONFIG.thinking_budget
      }
    }
  };

  try {
    console.log(`请求 URL: ${url}`);
    console.log('发送请求中...\n');

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${CONFIG.api_key}`,
        'x-goog-api-key': CONFIG.api_key,  // Gemini 可能使用此 header
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.log(`❌ 请求失败: ${response.status}`);
      console.log(`错误详情: ${errorText.substring(0, 500)}`);
      return false;
    }

    const data = await response.json();
    const content = data?.candidates?.[0]?.content?.parts?.[0]?.text ||
                    data?.choices?.[0]?.message?.content || '';

    console.log('✅ 请求成功!');
    console.log('\n--- 模型响应 ---');
    console.log(content);
    console.log('--- 响应结束 ---\n');

    return true;
  } catch (error) {
    console.log(`❌ 请求异常: ${error.message}`);
    return false;
  }
}

/**
 * 测试方法 3: 使用 OpenAI 兼容格式但在 extra_body 中传递 PDF
 */
async function testExtraBodyFormat() {
  console.log('\n' + '='.repeat(60));
  console.log('测试方法 3: extra_body 格式');
  console.log('='.repeat(60));

  const pdfBase64 = fileToBase64(PDF_PATH);
  const url = `${CONFIG.api_base}/v1/chat/completions`;

  const body = {
    model: CONFIG.model,
    messages: [
      {
        role: "user",
        content: "请描述这个 PDF 文档中包含的图片内容。如果你能看到图片（如流程图、示意图、数学公式图、实验结果图等），请详细描述它们。这是一篇关于 Moving Morphable Component (MMC) 方法的论文。"
      }
    ],
    temperature: 0.2,
    max_tokens: 2000,
    extra_body: {
      generationConfig: {
        thinkingConfig: { thinkingBudget: CONFIG.thinking_budget },
      },
      // 尝试通过 extra_body 传递 PDF
      inlineData: [
        {
          mimeType: "application/pdf",
          data: pdfBase64
        }
      ]
    }
  };

  try {
    console.log(`请求 URL: ${url}`);
    console.log('发送请求中...\n');

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${CONFIG.api_key}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.log(`❌ 请求失败: ${response.status}`);
      console.log(`错误详情: ${errorText.substring(0, 500)}`);
      return false;
    }

    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content || '';

    console.log('✅ 请求成功!');
    console.log('\n--- 模型响应 ---');
    console.log(content);
    console.log('--- 响应结束 ---\n');

    return true;
  } catch (error) {
    console.log(`❌ 请求异常: ${error.message}`);
    return false;
  }
}

/**
 * 对照测试: 只发送文本提示（不包含 PDF）
 * 用于对比，确认模型能区分有无 PDF 的情况
 */
async function testTextOnly() {
  console.log('\n' + '='.repeat(60));
  console.log('对照测试: 仅文本（无 PDF）');
  console.log('='.repeat(60));

  const url = `${CONFIG.api_base}/v1/chat/completions`;

  const body = {
    model: CONFIG.model,
    messages: [
      {
        role: "user",
        content: "请描述 Moving Morphable Component (MMC) 方法论文中通常包含哪些类型的图片？（注意：我没有发送实际的 PDF 文件给你）"
      }
    ],
    temperature: 0.2,
    max_tokens: 500,
  };

  try {
    console.log(`请求 URL: ${url}`);
    console.log('发送请求中...\n');

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${CONFIG.api_key}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.log(`❌ 请求失败: ${response.status}`);
      console.log(`错误详情: ${errorText}`);
      return false;
    }

    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content || '';

    console.log('✅ 请求成功!');
    console.log('\n--- 模型响应 ---');
    console.log(content);
    console.log('--- 响应结束 ---\n');

    return true;
  } catch (error) {
    console.log(`❌ 请求异常: ${error.message}`);
    return false;
  }
}

/**
 * 主测试函数
 */
async function main() {
  console.log('Gemini PDF 上传能力测试');
  console.log('========================\n');

  // 检查 PDF 文件是否存在
  if (!fs.existsSync(PDF_PATH)) {
    console.error(`❌ PDF 文件不存在: ${PDF_PATH}`);
    process.exit(1);
  }

  const fileStats = fs.statSync(PDF_PATH);
  console.log(`测试文件: ${path.basename(PDF_PATH)}`);
  console.log(`文件大小: ${(fileStats.size / 1024 / 1024).toFixed(2)} MB`);
  console.log(`API Base: ${CONFIG.api_base}`);
  console.log(`Model: ${CONFIG.model}`);
  console.log(`Thinking Budget: ${CONFIG.thinking_budget}`);

  // 运行测试
  console.log('\n开始测试...\n');

  // 先运行对照测试
  await testTextOnly();

  // 测试方法 1: OpenAI 兼容格式
  const result1 = await testOpenAICompatibleFormat();

  // 如果方法 1 失败，尝试方法 2
  if (!result1) {
    await testGeminiNativeFormat();
  }

  // 测试方法 3: extra_body 格式
  // await testExtraBodyFormat();

  console.log('\n' + '='.repeat(60));
  console.log('测试完成');
  console.log('='.repeat(60));
  console.log('\n判断标准:');
  console.log('- 如果模型能够描述 PDF 中具体的图片内容（如 Figure 1, Figure 2 等），');
  console.log('  说明远端成功解析了 PDF 中的图像。');
  console.log('- 如果模型只是泛泛而谈或说"无法查看"，说明可能只解析了文本或不支持。');
}

// 运行测试
main().catch(console.error);
