#!/usr/bin/env node
/**
 * 将 Markdown 文章自动保存为 CSDN 草稿
 *
 * 用法:
 *   node scripts/publish-csdn-draft.mjs [--file path/to/article.md] [--wait 秒]
 *
 * 说明:
 *   - CSDN 没有官方发布 API，本脚本用 Playwright 模拟浏览器操作
 *   - 首次运行会弹出浏览器窗口，请在弹出的窗口里扫码/账号登录 CSDN
 *   - 登录态保存在 .csdn-profile/ 目录（已加入 .gitignore，不会提交）
 *   - 脚本会尝试自动填入标题与正文并点击"存草稿"；若 CSDN 改版导致
 *     选择器失效，脚本会打印页面结构提示并停在编辑器等你手动保存
 */
import { chromium } from 'playwright';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

// ---------- 解析参数 ----------
const args = process.argv.slice(2);
const arg = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : def;
};
const filePath = path.resolve(repoRoot, arg('--file', 'docs/BLOG_FOLLOWUP_v0.7.3.md'));
const waitSeconds = parseInt(arg('--wait', '150'), 10);
const profileDir = path.join(repoRoot, '.csdn-profile');

if (!existsSync(filePath)) {
  console.error('❌ 找不到文章文件:', filePath);
  process.exit(1);
}

// ---------- 读取文章 ----------
const md = await readFile(filePath, 'utf-8');
const lines = md.split('\n');
const titleLine = lines.find(l => l.startsWith('# ') && !l.startsWith('## ')) || lines.find(l => l.startsWith('#'));
if (!titleLine) {
  console.error('❌ 文章中找不到 # 标题');
  process.exit(1);
}
const title = titleLine.replace(/^#\s+/, '').trim();
// 正文：去掉标题行和它下面的分隔/引言，保留其余
let bodyLines = lines.slice(lines.indexOf(titleLine) + 1);
// 去掉紧跟标题的引用块(> )和空行，从第一个非空非引用行开始？不，引言也保留，CSDN 博客常见引言。直接全部保留。
const body = bodyLines.join('\n').trim();
console.log('📄 文章:', filePath);
console.log('📌 标题:', title);
console.log('📏 正文长度:', body.length, '字符');

// ---------- 启动浏览器 ----------
// 优先用系统 Chrome（无需下载浏览器），否则用 playwright 自带 chromium
let browser;
const systemChrome =
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
try {
  browser = await chromium.launchPersistentContext(profileDir, {
    headless: false,
    viewport: { width: 1440, height: 900 },
    ...(existsSync(systemChrome)
      ? { executablePath: systemChrome }
      : {}),
    args: ['--disable-blink-features=AutomationControlled'],
  });
} catch (e) {
  console.error('❌ 启动浏览器失败:', e.message);
  console.error('   如果是缺少浏览器二进制，请先运行: npx playwright install chromium');
  process.exit(1);
}

console.log('🌐 打开 CSDN 编辑器 ...');
const page = browser.pages()[0] || (await browser.newPage());
await page.goto('https://editor.csdn.net/', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(e => {
  console.error('⚠️ 打开编辑器页面异常(继续尝试):', e.message.split('\n')[0]);
});

// ---------- 等待登录 ----------
// 标题输入框出现 = 已进入编辑器；否则可能停在登录页
const titleSelector = [
  'input[placeholder*="标题"]',
  'input[placeholder*="title"]',
  '.article-bar input',
  '#articleTitle',
];
const deadline = Date.now() + waitSeconds * 1000;
let loggedIn = false;
while (Date.now() < deadline) {
  for (const sel of titleSelector) {
    if (await page.locator(sel).first().isVisible().catch(() => false)) {
      loggedIn = true;
      break;
    }
  }
  if (loggedIn) break;
  // 未找到编辑器元素：可能停在登录页，或页面还在加载
  await page.waitForTimeout(2000);
  console.log('⏳ 等待登录/编辑器加载中 ...（请在浏览器窗口完成登录，最多等待', waitSeconds, '秒）');
}
if (!loggedIn) {
  console.error('❌ 超时未进入编辑器。请检查是否已在弹出的浏览器窗口登录 CSDN，然后重试。');
  console.error('   提示：重试时登录态已保存，无需再次扫码。');
  await browser.close();
  process.exit(1);
}
console.log('✅ 已进入编辑器');

// ---------- 填写标题 ----------
let filledTitle = false;
for (const sel of titleSelector) {
  const loc = page.locator(sel).first();
  if (await loc.isVisible().catch(() => false)) {
    await loc.click().catch(() => {});
    await loc.fill('').catch(() => {});
    await loc.fill(title).catch(() => {});
    filledTitle = true;
    console.log('📝 标题已填入（选择器:', sel, '）');
    break;
  }
}
if (!filledTitle) {
  console.log('⚠️ 未找到标题输入框，请在页面顶部手动填写标题:');
  console.log('   ', title);
}

// ---------- 填写正文 ----------
// CSDN Markdown 编辑器的正文可能是 contenteditable / CodeMirror / textarea
const bodySelectors = [
  '.editor-toolbar + div textarea',
  'textarea',
  '.CodeMirror textarea',
  '[contenteditable="true"]',
  '.markdown-editor',
];
let bodyFilled = false;
for (const sel of bodySelectors) {
  const loc = page.locator(sel).first();
  if (!(await loc.isVisible().catch(() => false))) continue;
  try {
    const tag = (await loc.evaluate(el => el.tagName)).toLowerCase();
    if (tag === 'textarea') {
      await loc.fill(body);
      bodyFilled = true;
    } else if (sel.includes('CodeMirror')) {
      // CodeMirror 隐藏 textarea：通过实例设置
      await loc.evaluate((el, text) => {
        const cm = el.parentElement?.CodeMirror || window.CodeMirror?.instances?.length
          ? undefined : undefined;
        const cmEl = document.querySelector('.CodeMirror');
        if (cmEl && cmEl.CodeMirror) cmEl.CodeMirror.setValue(text);
        else if (el.value !== undefined) el.value = text;
        else el.textContent = text;
      }, body);
      bodyFilled = true;
    } else {
      // contenteditable：点击聚焦后注入
      await loc.click();
      await page.keyboard.press('Meta+A').catch(() => {});
      await page.keyboard.insertText(body).catch(() => {});
      bodyFilled = true;
    }
    if (bodyFilled) {
      console.log('✍️ 正文已尝试填入（选择器:', sel, '）');
      break;
    }
  } catch (e) {
    console.log('⚠️ 选择器', sel, '填充失败:', e.message.split('\n')[0]);
  }
}
if (!bodyFilled) {
  console.log('⚠️ 未能自动填入正文，请手动粘贴文章内容（编辑器右上角可切换 Markdown 模式）');
}

await page.waitForTimeout(1500);

// ---------- 点击存草稿 ----------
const saveSelectors = [
  'button:has-text("存草稿")',
  'button:has-text("保存草稿")',
  '.btn-save',
  'button:has-text("草稿")',
];
let saved = false;
for (const sel of saveSelectors) {
  const loc = page.locator(sel).first();
  if (await loc.isVisible().catch(() => false)) {
    await loc.click().catch(() => {});
    saved = true;
    console.log('💾 已点击存草稿（选择器:', sel, '）');
    break;
  }
}
if (!saved) {
  console.log('⚠️ 未自动找到存草稿按钮。请检查页面并手动点击【存草稿】。');
  console.log('   页面按钮候选:');
  try {
    const btns = await page.locator('button').allTextContents();
    console.log('   ', btns.map(b => b.trim()).filter(Boolean).slice(0, 15).join(' | '));
  } catch {}
}

// 等待几秒让保存请求完成，然后打印结果
await page.waitForTimeout(3000);
const url = page.url();
console.log('\n✅ 完成。当前页面:', url);
console.log('   如果保存成功，草稿会出现在 https://editor.csdn.net/ 或 创作中心');
console.log('   （浏览器保持打开，你可以直接检查/微调后手动发布）');

// 保持浏览器打开，让用户检查；按 Ctrl+C 退出
console.log('\n⚠️ 浏览器保持打开供你检查。检查完按 Ctrl+C 结束脚本。');
process.stdin.resume();
