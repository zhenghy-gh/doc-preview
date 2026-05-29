import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function test() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  
  // 打开测试页面
  await page.goto('http://localhost:5180/doc-preview/test.html');
  
  // 等待页面加载
  await page.waitForSelector('.upload-area', { timeout: 5000 });
  
  // 上传文件
  const filePath = path.join(__dirname, 'docs', '6a164d2b7d5a1fdadbc11541.doc');
  const fileInput = await page.$('input[type="file"]');
  await fileInput.setInputFiles(filePath);
  
  // 等待文档解析
  await page.waitForTimeout(3000);
  
  // 获取完整 HTML 内容
  const content = await page.$('.document-content');
  if (content) {
    const html = await content.innerHTML();
    
    console.log('📄 完整 HTML 内容:');
    console.log(html.substring(0, 2000));
    
    // 检查是否有 span 标签包含乱码
    const spanMatches = html.match(/<span[^>]*>([^<]*)<\/span>/g);
    if (spanMatches && spanMatches.length > 0) {
      console.log('\n📄 前5个 <span> 标签内容:');
      spanMatches.slice(0, 5).forEach((match, i) => {
        console.log(`  ${i + 1}. ${match.substring(0, 100)}`);
      });
    }
  }
  
  await browser.close();
}

test().catch(err => {
  console.error('测试失败:', err);
  process.exit(1);
});
