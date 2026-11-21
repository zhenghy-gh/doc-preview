#!/usr/bin/env node
/**
 * 预览页数 ↔ 打印布局对照审计（纯 Node，无浏览器依赖，可重复运行）。
 *
 * 方法与边界（详见 docs/changelog/2026-11-21-print-layout-audit.md）：
 *   1. 用 esbuild 临时打包 docParser / documentRenderer / printLayout，对 docs/*.doc
 *      逐个 parse + render，得到「预览页数」与逐页 HTML；
 *   2. 用 printLayout.buildPrintPageCss / buildPrintWindowHtml 生成每份样本的打印 HTML；
 *   3. 对打印 HTML 做静态规则分析（@page / margin box / break 规则 / 分节数 /
 *      .page-content 容器数），得到**可自动核验**的对照表；
 *   4. **不编造打印页数**：`printPageCount` 恒为 null。浏览器实际分页需在装有
 *      Chromium 的环境人工打印验证（或未来补充经校验的 page.pdf() PDF 页数采集）。
 *
 * 用法：
 *   npm run audit:print                       # 刷新 tests/fixtures/print-layout-audit.json
 *   node scripts/printPageAudit.mjs --check    # 只校验现有 fixture 与当前源码是否一致
 *   node scripts/printPageAudit.mjs --json x.json  # 写入自定义路径
 */
import { build } from 'esbuild'
import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync, writeFileSync, mkdtempSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Window } from 'happy-dom'

// textRender#escapeHtml 依赖 document.createElement；在 Node 下用 happy-dom 提供最小环境。
const dom = new Window()
globalThis.document = dom.document

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const docsDir = join(root, 'docs')
const defaultOut = join(root, 'tests/fixtures/print-layout-audit.json')
const args = process.argv.slice(2)
const checkOnly = args.includes('--check')
const jsonIdx = args.indexOf('--json')
const outPath = jsonIdx >= 0 && args[jsonIdx + 1] ? resolve(args[jsonIdx + 1]) : defaultOut

const tempDir = mkdtempSync(join(tmpdir(), 'dp-print-audit-'))
const entry = join(tempDir, 'entry.ts')
const bundle = join(tempDir, 'bundle.mjs')

writeFileSync(entry, `
import { parseDocFileFromBuffer } from '${join(root, 'src/utils/docParser.ts')}'
import { renderDocumentToPages } from '${join(root, 'src/utils/rendering/documentRenderer.ts')}'
import { buildPrintPageCss, buildPrintWindowHtml } from '${join(root, 'src/utils/rendering/printLayout.ts')}'
export { parseDocFileFromBuffer, renderDocumentToPages, buildPrintPageCss, buildPrintWindowHtml }
`)

const count = (text, re) => (text.match(re) || []).length

try {
  await build({ entryPoints: [entry], bundle: true, platform: 'node', format: 'esm', outfile: bundle, logLevel: 'silent' })
  const { parseDocFileFromBuffer, renderDocumentToPages, buildPrintPageCss, buildPrintWindowHtml } = await import(bundle)

  const labels = { prefix: '第 ', middle: ' 页 / 共 ', suffix: ' 页' }
  const title = 'Print Audit'
  const css = buildPrintPageCss({ title, labels })
  const atPageRuleCount = count(css, /@page\b/g)
  const marginBoxCount = count(css, /@(?:top|bottom)-(?:left|center|right)\b/g)
  const cssBreakRuleCount = count(css, /page-break-|break-(?:before|after|inside)\s*:/g)

  const files = readdirSync(docsDir).filter(f => f.toLowerCase().endsWith('.doc')).sort()
  const rows = []
  for (const name of files) {
    const data = readFileSync(join(docsDir, name))
    const buffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)
    const result = parseDocFileFromBuffer(buffer)
    if (!result.success || !result.document) {
      rows.push({ doc: name, parseFailed: true, previewPages: 0, pageContentCount: 0, sectionCount: 0, printPageCount: null })
      continue
    }
    const d = result.document
    // 与 tests/realCorpusPageBaseline.test.ts 完全同口径：首节页高 + 页眉页脚，
    // 保证本审计的 previewPages 可与钉住的基线逐样本交叉核对。
    const firstSection = d.sections?.[0]
    const pages = renderDocumentToPages({
      paragraphs: d.paragraphs,
      hyperlinks: d.hyperlinks,
      revisions: d.revisions,
      revisionMode: 'marks',
      shapes: d.shapes || [],
      pictures: d.pictures || [],
      images: d.images || [],
      charts: d.charts || [],
      sections: d.sections || [],
      pageHeightPt: firstSection?.pageHeightPt || 842,
      showHiddenText: false,
      fontResolver: () => '',
      t: (k) => k,
      headerFooter: d.stories?.headerParts
        ? { parts: d.stories.headerParts, titlePage: d.docFlags?.titlePage, facingPages: d.docFlags?.facingPages }
        : undefined,
      equations: d.equations,
      wordArts: d.wordArts,
    })
    const bodyHtml = pages.join('\n')
    const printHtml = buildPrintWindowHtml({ title, labels, bodyHtml })
    rows.push({
      doc: name,
      parseFailed: false,
      previewPages: pages.length,
      pageContentCount: count(bodyHtml, /class="[^"]*\bpage-content\b[^"]*"/g),
      sectionCount: d.sections?.length ?? 0,
      atPageRuleCount,
      marginBoxCount,
      cssBreakRuleCount,
      contentBreakMarkerCount: count(bodyHtml, /page-break-before\s*:\s*always|break-before\s*:\s*page/g),
      printHtmlBytes: Buffer.byteLength(printHtml),
      // 关键：不编造。浏览器实际打印页数需人工核验，见 report.manualOnly。
      printPageCount: null,
    })
    console.log(`${name.padEnd(30)} preview=${String(pages.length).padStart(4)}  containers=${String(rows[rows.length - 1].pageContentCount).padStart(4)}  sections=${String(rows[rows.length - 1].sectionCount).padStart(3)}`)
  }

  const report = {
    schemaVersion: 1,
    generatedBy: 'scripts/printPageAudit.mjs',
    method: 'static-analysis (no browser)',
    browser: {
      playwrightInstalled: existsSync(join(root, 'node_modules/playwright')),
      chromiumBinaryPresent: (() => {
        try {
          // 子进程探测，避免在顶层强制加载 playwright。
          const out = execFileSync(process.execPath, ['-e', "try{const{chromium}=require('playwright');process.stdout.write(chromium.executablePath())}catch{}"], { encoding: 'utf8', cwd: root })
          return out.length > 0 && existsSync(out)
        } catch { return false }
      })(),
      note: '无 Chromium 时不采集 page.pdf()；printPageCount 恒为 null，需人工打印核验。',
    },
    autoVerifiable: [
      'previewPages', 'pageContentCount', 'sectionCount', 'atPageRuleCount',
      'marginBoxCount', 'cssBreakRuleCount', 'contentBreakMarkerCount', 'printHtmlBytes',
    ],
    manualOnly: ['printPageCount'],
    limits: [
      '预览页数为字符估算分页（pageBuilder），打印页数为浏览器回流结果，两套布局独立，天然可能不等。',
      '打印 CSS 未给 .page-content 设置固定高度或 break-after: page，预览分界线在打印时被浏览器忽略。',
      '本脚本仅统计打印 HTML 中的分页规则数量，不模拟浏览器分页，故不输出打印页数估计值。',
    ],
    totals: {
      docs: rows.length,
      parseFailed: rows.filter(r => r.parseFailed).length,
      previewPages: rows.reduce((s, r) => s + r.previewPages, 0),
      pageContentCount: rows.reduce((s, r) => s + r.pageContentCount, 0),
      sections: rows.reduce((s, r) => s + r.sectionCount, 0),
    },
    rows,
  }

  if (checkOnly) {
    const current = JSON.parse(readFileSync(outPath, 'utf8'))
    const drift = JSON.stringify(current.rows) !== JSON.stringify(report.rows)
    console.log(drift ? `CHECK FAILED: ${outPath} rows differ from current source` : `CHECK OK: ${outPath} rows match current source`)
    process.exitCode = drift ? 1 : 0
  } else {
    writeFileSync(outPath, JSON.stringify(report, null, 2) + '\n')
    console.log(`\nWrote ${outPath} (${rows.length} docs). printPageCount intentionally null — manual print verification required.`)
  }
} finally {
  rmSync(tempDir, { recursive: true, force: true })
}
