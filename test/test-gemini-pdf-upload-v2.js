/**
 * 测试 Gemini API 直接上传 PDF - 精简版
 *
 * 结论：x666.me 支持 Gemini 原生 API 格式，可以使用 inlineData 上传 PDF
 *
 * 运行方式: node test/test-gemini-pdf-upload-v2.js
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
 * 使用 Gemini 原生格式 (inlineData) 上传 PDF
 * 这是经验证可用的方法
 */
async function testGeminiNativeFormat() {
  console.log('\n' + '='.repeat(60));
  console.log('Gemini 原生格式测试 - PDF 远端解析');
  console.log('='.repeat(60));

  const pdfBase64 = fileToBase64(PDF_PATH);

  // 使用 Gemini 原生 API 端点
  const url = `${CONFIG.api_base}/v1/models/${CONFIG.model}:generateContent`;

  const body = {
    contents: [
      {
        parts: [
          {
            text: `请仔细分析这个 PDF 文档，完成以下任务：

1. **图片识别**：列出你能看到的所有图片（Figure），描述每张图的内容
2. **图片数量**：总共有多少张图？
3. **图片细节**：选择一张最有代表性的图片，详细描述其中的视觉元素（如坐标轴、颜色、形状、标注等）

这是一篇关于 Moving Morphable Component (MMC) 方法的论文。如果你无法看到图片只能看到文本，请明确告诉我。`
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
      maxOutputTokens: 8000,  // 增加输出长度
      thinkingConfig: {
        thinkingBudget: CONFIG.thinking_budget
      }
    }
  };

  try {
    console.log(`请求 URL: ${url}`);
    console.log(`PDF 文件大小: ${(pdfBase64.length * 0.75 / 1024 / 1024).toFixed(2)} MB`);
    console.log('发送请求中（可能需要几分钟）...\n');

    const startTime = Date.now();
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${CONFIG.api_key}`,
        'x-goog-api-key': CONFIG.api_key,
      },
      body: JSON.stringify(body),
    });

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    if (!response.ok) {
      const errorText = await response.text();
      console.log(`❌ 请求失败: ${response.status} (耗时 ${elapsed}s)`);
      console.log(`错误详情: ${errorText.substring(0, 1000)}`);
      return false;
    }

    const data = await response.json();

    // 解析响应
    let content = '';
    let thinkingContent = '';

    // Gemini 原生格式响应
    if (data.candidates?.[0]?.content?.parts) {
      for (const part of data.candidates[0].content.parts) {
        if (part.thought) {
          thinkingContent += part.text + '\n';
        } else if (part.text) {
          content += part.text;
        }
      }
    }
    // OpenAI 兼容格式响应 (备用)
    else if (data.choices?.[0]?.message?.content) {
      content = data.choices[0].message.content;
    }

    console.log(`✅ 请求成功! (耗时 ${elapsed}s)`);

    if (thinkingContent) {
      console.log('\n--- 思考过程 ---');
      console.log(thinkingContent.substring(0, 500) + (thinkingContent.length > 500 ? '...(截断)' : ''));
    }

    console.log('\n--- 模型响应 ---');
    console.log(content);
    console.log('--- 响应结束 ---\n');

    // 分析结果
    console.log('\n' + '='.repeat(60));
    console.log('测试结果分析');
    console.log('='.repeat(60));

    const hasSpecificFigure = content.includes('Figure') || content.includes('图');
    const hasVisualDetails = content.includes('颜色') || content.includes('color') ||
                             content.includes('坐标') || content.includes('axis') ||
                             content.includes('形状') || content.includes('shape') ||
                             content.includes('网格') || content.includes('mesh');
    const saysCannotSee = content.includes('无法看到') || content.includes('cannot see') ||
                          content.includes('看不到') || content.includes('无法查看');

    if (saysCannotSee) {
      console.log('❌ 远端解析失败：模型表示无法看到图片');
      console.log('   可能原因：代理仅支持文本，不支持多模态');
    } else if (hasSpecificFigure && hasVisualDetails) {
      console.log('✅ 远端解析成功！模型能够识别并描述 PDF 中的图片！');
      console.log('   - 识别到具体的 Figure');
      console.log('   - 描述了视觉元素细节');
      console.log('\n结论：x666.me 代理支持 Gemini 原生 PDF 上传功能！');
    } else if (hasSpecificFigure) {
      console.log('⚠️ 部分成功：模型提到了 Figure，但视觉细节不够具体');
      console.log('   建议：可能需要更明确的提示词来获取图片描述');
    } else {
      console.log('⚠️ 不确定：模型响应中没有明确提到具体图片');
      console.log('   需要人工判断响应内容');
    }

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
  console.log('Gemini PDF 远端解析能力测试 v2');
  console.log('================================\n');

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
  await testGeminiNativeFormat();

  console.log('\n' + '='.repeat(60));
  console.log('使用建议');
  console.log('='.repeat(60));
  console.log(`
如果要在 Zotero 插件中使用远端 PDF 解析：

1. 使用 Gemini 原生 API 格式而不是 OpenAI 兼容格式
2. 端点: ${CONFIG.api_base}/v1/models/{model}:generateContent
3. 请求体格式:
   {
     "contents": [{
       "parts": [
         { "text": "你的提示词" },
         { "inlineData": { "mimeType": "application/pdf", "data": "base64编码的PDF" } }
       ]
     }],
     "generationConfig": { ... }
   }

注意：大文件上传可能较慢，32MB 的 PDF 预计需要 1-2 分钟。
`);
}

// 运行测试
main().catch(console.error);
