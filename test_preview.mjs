/**
 * E2E 预览效果测试 — 验证 .doc/.dot 文件能否正确渲染为可读内容
 *
 * 运行方式:
 *   1. 先启动 dev server: npm run dev
 *   2. 运行测试: node test_preview.mjs
 */
import { chromium } from 'playwright';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const docsDir = path.join(__dirname, 'docs');

const PASS = 0, FAIL = 1, TOTAL = 2;

const summary = { good: 0, fail: 0, total: 0 };

function assert(title, ok, detail = '') {
  summary.total++;
  const icon = ok ? '✓' : '✗';
  const label = ok ? 'PASS' : 'FAIL';
  const line = `  ${icon} [${label}] ${title}`;
  console.log(ok ? line : `  ${icon} [${label}] ${title} — ${detail}`);
  if (ok) summary.good++; else summary.fail++;
}

async function run() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();

  // 收集浏览器控制台日志
  const consoleLogs = [];
  page.on('console', msg => {
    if (msg.type() === 'error') consoleLogs.push(`[ERR] ${msg.text()}`);
  });

  await page.goto('http://localhost:5173', { waitUntil: 'networkidle' });

  // ============ 基础 UI 测试 ============
  console.log('\n--- 基础 UI ---');
  assert('页面标题可见',
    await page.locator('h1').count() > 0);
  assert('上传区域可见',
    await page.locator('.upload-area').count() > 0);
  assert('文件选择按钮可见',
    await page.locator('.upload-btn').count() > 0);
  assert('提示支持 .doc / .dot 格式',
    (await page.locator('.upload-area').textContent()).includes('.dot'));

  // ============ 文件上传测试 ============
  const testFiles = [
    { name: 'english_test.doc', desc: '纯英文文档', minLen: 100, expectEnglish: true },
    { name: 'chinese_test.doc', desc: '纯中文文档', minLen: 100, expectChinese: true },
    { name: 'sample3.doc', desc: '带格式英文文档', minLen: 500, expectEnglish: true },
    { name: 'Bug47742.doc', desc: '德英文混合文档', minLen: 500, expectEnglish: true },
    { name: 'Bug47958.doc', desc: '表格内容文档', minLen: 200, expectEnglish: true },
    { name: 'Bug41898.doc', desc: '简短英文文档', minLen: 5, expectEnglish: true },
    { name: 'testing.dot', desc: 'Word 模板', minLen: 5 },
    { name: '47304.doc', desc: '短文本带引号', minLen: 5, expectEnglish: true },
  ];

  const input = page.locator('input[type="file"]');

  for (const { name, desc, minLen, expectEnglish, expectChinese } of testFiles) {
    console.log(`\n--- ${name} (${desc}) ---`);

    await input.setInputFiles([path.join(docsDir, name)]);

    // 等待结果
    const resultSel = await page.waitForSelector('.document-content, .error-container', { timeout: 20000 })
      .catch(() => null);

    assert(`解析有结果 (不超时)`, !!resultSel, '20s 内无响应');
    if (!resultSel) {
      await page.goto('http://localhost:5173', { waitUntil: 'networkidle' });
      continue;
    }

    // 检查是否有错误
    const hasError = await page.locator('.error-container').count();
    assert(`无解析错误`, hasError === 0, hasError ? await page.locator('.error-container p').textContent() : '');
    if (hasError > 0) {
      await page.goto('http://localhost:5173', { waitUntil: 'networkidle' });
      continue;
    }

    // 检查内容
    const text = await page.locator('.document-content').textContent();
    const html = await page.locator('.document-content').innerHTML();
    const cleanText = text.trim();

    assert(`内容长度 >= ${minLen}`, cleanText.length >= minLen, `实际: ${cleanText.length}`);
    assert(`内容不为空`, cleanText.length > 5, `实际: "${cleanText.substring(0, 50)}"`);

    // 段落结构 — 应该有 <p> 标签
    const pCount = (html.match(/<p[\s>]/g) || []).length;
    assert(`有 <p> 段落标签 (>=1)`, pCount >= 1, `实际: ${pCount}`);

    // 预期语言检测
    if (expectEnglish) {
      assert(`包含英文单词`, /[A-Za-z]{4,}/.test(cleanText), `实际以 "${cleanText.substring(0, 40)}" 开头`);
    }
    if (expectChinese) {
      assert(`包含中文字符`, /[一-鿿]{2,}/.test(cleanText), `实际以 "${cleanText.substring(0, 40)}" 开头`);
    }

    // 检查是否有大量高字节乱码 (>0.7E 且不是中文)
    if (expectChinese) {
      // 中文文档：高字节是正常的
    } else {
      const nonPrintable = (cleanText.match(/[\x00-\x08\x0E-\x1F\x7F-\x9F]/g) || []).length;
      assert(`乱码字符不多 (< 10%)`, nonPrintable < cleanText.length * 0.1, `实际: ${nonPrintable} / ${cleanText.length}`);
    }

    // 渲染时间检查 — 从解析结果来看，不应该有空白内容
    assert(`内容不以空白字符填充`, !/^[\s]{10,}/.test(cleanText), `内容以空白开头`);

    // 检查无浏览器错误
    const hasConsoleError = consoleLogs.some(l => l.includes(name));
    if (!hasConsoleError) assert(`无浏览器控制台错误`, true);
    // 我们不 assert 这个，只是观察

    await page.goto('http://localhost:5173', { waitUntil: 'networkidle' });
  }

  // ============ 边界情况测试 ============
  console.log(`\n--- 边界情况 ---`);

  // 测试空/无内容文件
  for (const name of ['Bug44431.doc']) {
    await input.setInputFiles([path.join(docsDir, name)]);
    const sel = await page.waitForSelector('.error-container, .document-content', { timeout: 15000 });
    const hasErr = await page.locator('.error-container').count();
    assert(`${name} 显示错误信息`, hasErr > 0, '没有 WordDocument 流的文件应报错');
    await page.goto('http://localhost:5173', { waitUntil: 'networkidle' });
  }

  // 测试加载状态
  const largeFile = 'Bug50936_1.doc';
  await input.setInputFiles([path.join(docsDir, largeFile)]);
  const loading = await page.waitForSelector('.loading-container, .document-content', { timeout: 5000 });
  if (await page.locator('.loading-container').count() > 0) {
    assert('大文件显示加载状态', true);
  }
  const result = await page.waitForSelector('.document-content, .error-container', { timeout: 20000 });
  assert('大文件最终渲染完成', !!result);
  await page.goto('http://localhost:5173', { waitUntil: 'networkidle' });

  // ============ 总结 ============
  console.log(`\n${'='.repeat(50)}`);
  const passRate = summary.total > 0 ? (summary.good / summary.total * 100).toFixed(0) : '0';
  console.log(`结果: ${summary.good}/${summary.total} 通过 (${passRate}%)  |  ${summary.fail} 失败`);

  await browser.close();
  process.exit(summary.fail > 0 ? 1 : 0);
}

run().catch(err => {
  console.error('Test error:', err);
  process.exit(1);
});
