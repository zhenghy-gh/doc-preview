import { chromium } from 'playwright';
import path from 'path';

async function test() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  // 打开测试页面
  await page.goto('http://localhost:5180/doc-preview/test.html');
  
  // 等待页面加载
  await page.waitForSelector('.upload-area', { timeout: 5000 });
  
  console.log('✅ 页面加载成功');
  
  // 上传文件
  const filePath = path.join(process.cwd(), 'docs', '6a164d2b7d5a1fdadbc11541.doc');
  const fileInput = await page.$('input[type="file"]');
  await fileInput.setInputFiles(filePath);
  
  // 等待文档解析
  await page.waitForTimeout(2000);
  
  // 获取完整文本
  const fullText = await page.$eval('.document-content', el => el.innerText);
  const lines = fullText.trim().split('\n').filter(l => l.trim());
  
  console.log('\n📄 完整文本行:');
  lines.forEach((line, i) => {
    if (line.includes('PAGE') || line.includes('王一川') || line.includes('签名')) {
      console.log(`  ${i + 1}. ${line}`);
    }
  });
  
  // 查找包含这些关键词的段落
  const lastParagraphs = lines.slice(-10);
  console.log('\n📄 最后10段:');
  lastParagraphs.forEach((line, i) => {
    console.log(`  ${lines.length - 10 + i + 1}. ${line}`);
  });
  
  await browser.close();
}

test().catch(err => {
  console.error('测试失败:', err);
  process.exit(1);
});
