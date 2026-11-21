#!/usr/bin/env node
/**
 * 真实语料健康扫描（纯 Node，无浏览器依赖）。
 *
 * 对 docs/*.doc 逐个 parse + render，检查：
 *   - 解析成功、段落非空、页数 > 0
 *   - 文本无异常控制字符（允许 \t \n \r）
 *   - 文本为合法 NFC（避免不可见码位差异）
 *   - 每页 HTML 含 .page-content 容器
 *
 * 解析/渲染源码通过 esbuild 临时打包后动态导入，保证与预览共用同一套实现。
 * 用法：node scripts/corpusHealth.mjs [--json out.json]
 */
import { build } from 'esbuild'
import { readFileSync, readdirSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Window } from 'happy-dom'

// textRender#escapeHtml 依赖 DOM（document.createElement）；在 Node 下用 happy-dom 提供最小环境。
const dom = new Window()
globalThis.document = dom.document

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const docsDir = join(root, 'docs')
const tempDir = mkdtempSync(join(tmpdir(), 'dp-health-'))
const entry = join(tempDir, 'entry.ts')
const bundle = join(tempDir, 'bundle.mjs')

writeFileSync(entry, `
import { parseDocFileFromBuffer } from '${join(root, 'src/utils/docParser.ts')}'
import { renderDocumentToPages } from '${join(root, 'src/utils/rendering/documentRenderer.ts')}'
export { parseDocFileFromBuffer, renderDocumentToPages }
`)

try {
  await build({ entryPoints: [entry], bundle: true, platform: 'node', format: 'esm', outfile: bundle, logLevel: 'silent' })
  const { parseDocFileFromBuffer, renderDocumentToPages } = await import(bundle)
  // 允许文档解析中合法的标记：\u0001 图片占位、\u0007 表格单元格、\u000b 软换行、\u000c 分页、\t\n\r
  const CONTROL_RE = /[\u0000\u0002-\u0006\u0008\u000e-\u001f\u007f]/
  const files = readdirSync(docsDir).filter(f => f.toLowerCase().endsWith('.doc')).sort()
  const rows = []
  let failures = 0
  for (const name of files) {
    const data = readFileSync(join(docsDir, name))
    const buffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)
    const issues = []
    let pages = 0
    try {
      const result = parseDocFileFromBuffer(buffer)
      if (!result.success || !result.document) issues.push('parse-failed')
      else {
        const text = result.text || ''
        if (CONTROL_RE.test(text)) issues.push('control-char')
        if (text !== text.normalize('NFC')) issues.push('non-nfc')
        if (result.document.paragraphs.length === 0) issues.push('no-paragraphs')
        const html = renderDocumentToPages({
          paragraphs: result.document.paragraphs,
          hyperlinks: result.document.hyperlinks,
          revisions: result.document.revisions,
          revisionMode: 'marks',
          shapes: result.document.shapes || [],
          pictures: result.document.pictures || [],
          images: result.document.images || [],
          charts: result.document.charts || [],
          sections: result.document.sections || [],
          pageHeightPt: 842,
          showHiddenText: false,
          fontResolver: () => '',
          t: (k) => k,
          headerFooter: undefined,
          equations: result.document.equations,
          wordArts: result.document.wordArts,
        })
        pages = html.length
        if (pages === 0 || !html[0]?.includes('page-content')) issues.push('bad-pages')
      }
    } catch (err) {
      issues.push(`throw: ${err instanceof Error ? err.message : String(err)}`)
    }
    if (issues.length) failures++
    rows.push({ doc: name, pages, issues })
    console.log(`${name.padEnd(30)} pages=${String(pages).padStart(5)}  ${issues.length ? issues.join(',') : 'ok'}`)
  }
  const report = { generatedAt: new Date().toISOString(), total: rows.length, failures, rows }
  const jsonArg = process.argv.indexOf('--json')
  if (jsonArg >= 0 && process.argv[jsonArg + 1]) writeFileSync(process.argv[jsonArg + 1], JSON.stringify(report, null, 2))
  console.log(`\n${rows.length} docs, ${failures} with issues`)
  process.exitCode = failures > 0 ? 1 : 0
} finally {
  rmSync(tempDir, { recursive: true, force: true })
}
