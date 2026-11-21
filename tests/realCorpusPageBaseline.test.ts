// @vitest-environment happy-dom
/**
 * 真实语料分页回归基线（Phase 3 切片）。
 *
 * 对 docs/ 下全部 .doc 执行 parseWithFormat → renderDocumentToPages，
 * 把「页数 + 每页 HTML 的 SHA-1」钉在 tests/fixtures/real-corpus-pages.json。
 * 任何解析/渲染改动导致分页变化都会在这里失败，并给出逐样本差异；
 * 确认变化是预期改进后，用 UPDATE_PAGE_BASELINE=1 npx vitest run ... 重新生成基线。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseDocFileFromBuffer } from '../src/utils/docParser'
import { renderDocumentToPages, type RenderInput } from '../src/utils/rendering/documentRenderer'
import type { SectionInfo } from '../src/utils/docFormat'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')
const docsDir = resolve(root, 'docs')
const baselinePath = resolve(here, 'fixtures/real-corpus-pages.json')

type Baseline = Record<string, { pages: number; sha1: string; firstPageLen: number }>

function loadBaseline(): Baseline {
  if (!existsSync(baselinePath)) return {}
  return JSON.parse(readFileSync(baselinePath, 'utf8')) as Baseline
}

function renderOne(buffer: ArrayBuffer) {
  const parsed = parseDocFileFromBuffer(buffer)
  expect(parsed.success).toBe(true)
  const document = parsed.document!
  const firstSection = document.sections?.[0] as SectionInfo | undefined
  const input: RenderInput = {
    paragraphs: document.paragraphs,
    hyperlinks: document.hyperlinks,
    revisions: document.revisions,
    revisionMode: 'marks',
    shapes: document.shapes || [],
    pictures: document.pictures || [],
    images: document.images || [],
    charts: document.charts || [],
    sections: document.sections || [],
    pageHeightPt: firstSection?.pageHeightPt || 842,
    showHiddenText: false,
    fontResolver: () => '',
    t: (key: string) => key,
    headerFooter: document.stories?.headerParts
      ? { parts: document.stories.headerParts, titlePage: document.docFlags?.titlePage, facingPages: document.docFlags?.facingPages }
      : undefined,
    equations: document.equations,
    wordArts: document.wordArts,
  }
  // documentRenderer 需要 fontResolver；字体度量由 getFontMetrics 在无 Canvas 环境自动回退
  return renderDocumentToPages({ ...input, fontResolver: () => '' })
}

function sha1(s: string): string {
  return createHash('sha1').update(s).digest('hex')
}

const files = readdirSync(docsDir).filter(f => f.toLowerCase().endsWith('.doc')).sort()

describe('real corpus page baseline', () => {
  it(
    'matches the recorded page count and HTML fingerprint for every fixture',
    () => {
      const baseline = loadBaseline()
      const actual: Baseline = {}
      const diffs: string[] = []
      for (const name of files) {
        const data = readFileSync(join(docsDir, name))
        const buffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)
        const pages = renderOne(buffer)
        const html = pages.join('\n')
        actual[name] = { pages: pages.length, sha1: sha1(html), firstPageLen: pages[0]?.length || 0 }
        const old = baseline[name]
        if (!old) diffs.push(`${name}: NEW (${actual[name].pages} pages)`)
        else if (old.pages !== actual[name].pages) diffs.push(`${name}: pages ${old.pages} -> ${actual[name].pages}`)
        else if (old.sha1 !== actual[name].sha1) diffs.push(`${name}: HTML changed (same page count)`)
      }
      for (const name of Object.keys(baseline)) {
        if (!actual[name]) diffs.push(`${name}: REMOVED`)
      }
      if (process.env.UPDATE_PAGE_BASELINE === '1') {
        writeFileSync(baselinePath, `${JSON.stringify(actual, null, 2)}\n`)
        console.log(`[baseline] updated ${Object.keys(actual).length} entries at ${baselinePath}`)
        return
      }
      expect(diffs, `page baseline drift:\n${diffs.join('\n')}`).toEqual([])
    },
    120000,
  )
})
