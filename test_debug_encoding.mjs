import { chromium } from 'playwright';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const files = [
  { name: 'english_test.doc', label: 'English' },
  { name: 'chinese_test.doc', label: 'Chinese' },
];

async function run() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto('http://localhost:5173', { waitUntil: 'networkidle' });

  for (const { name, label } of files) {
    console.log(`\n========== Testing ${name} (${label}) ==========`);

    const filePath = path.join(__dirname, 'docs', name);

    // Use setInputFiles directly on the hidden file input
    const input = page.locator('input[type="file"]');
    await input.setInputFiles([filePath]);

    // Wait for either content or error
    try {
      await page.waitForSelector('.document-content, .error-container', { timeout: 15000 });
    } catch (e) {
      console.log(`  TIMEOUT - no result within 15s`);
      // Reload for next file
      await page.goto('http://localhost:5173', { waitUntil: 'networkidle' });
      continue;
    }

    const hasError = await page.locator('.error-container').count();
    if (hasError > 0) {
      const errText = await page.locator('.error-container p').textContent();
      console.log(`  ERROR: ${errText}`);
      // Reload for next file
      await page.goto('http://localhost:5173', { waitUntil: 'networkidle' });
      continue;
    }

    const text = await page.locator('.document-content').textContent();
    const html = await page.locator('.document-content').innerHTML();

    // Show first 300 chars of visible text
    const cleanText = text.trim().substring(0, 300);
    console.log(`  Text preview: "${cleanText}"`);

    // Check for binary garbage (>0x7E chars)
    const garbageChars = (text.match(/[\x7F-\x9F]/g) || []).length;
    console.log(`  Garbage high-bytes: ${garbageChars}`);

    // Paragraph count
    const pCount = (html.match(/<\/p>/g) || []).length;
    console.log(`  <p> tags: ${pCount}`);

    // Check for English or Chinese
    const hasEnglish = /[A-Za-z]{4,}/.test(text);
    const hasChinese = /[一-鿿]{2,}/.test(text);
    console.log(`  Has English: ${hasEnglish}, Has Chinese: ${hasChinese}`);

    // Reload for next file
    await page.goto('http://localhost:5173', { waitUntil: 'networkidle' });
  }

  await browser.close();
  console.log('\nDone.');
}

run().catch(err => { console.error(err); process.exit(1); });
