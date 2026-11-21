// @vitest-environment happy-dom
/**
 * 打印布局审计 fixture 的结构不变量（由 `npm run audit:print` 刷新）。
 *
 * 本用例只钉住**可自动核验**的指标；`printPageCount` 必须由人工打印验证，
 * fixture 中恒为 null——任何把它写成具体数字的做法都是伪造证据。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildPrintPageCss, buildPrintWindowHtml } from '../src/utils/rendering/printLayout'

const here = dirname(fileURLToPath(import.meta.url))
const fixture = JSON.parse(readFileSync(join(here, 'fixtures/print-layout-audit.json'), 'utf8'))
const pageBaseline = JSON.parse(readFileSync(join(here, 'fixtures/real-corpus-pages.json'), 'utf8'))

type Row = Record<string, any>

describe('print layout audit fixture', () => {
  it('declares static-analysis method and never fabricates a print page count', () => {
    expect(fixture.schemaVersion).toBe(1)
    expect(fixture.method).toContain('static-analysis')
    expect(fixture.manualOnly).toContain('printPageCount')
    expect(fixture.autoVerifiable).toEqual(expect.arrayContaining([
      'previewPages', 'pageContentCount', 'sectionCount', 'atPageRuleCount',
    ]))
    for (const key of fixture.autoVerifiable as string[]) {
      expect(fixture.rows.every((r: Row) => key in r), `row missing auto-verifiable key ${key}`).toBe(true)
    }
    for (const row of fixture.rows as Row[]) {
      expect(row.printPageCount).toBeNull()
      expect(row.parseFailed).toBe(false)
    }
  })

  it('covers every .doc fixture exactly once', () => {
    const names = (fixture.rows as Row[]).map(r => r.doc)
    expect(names).toHaveLength(27)
    expect(new Set(names).size).toBe(27)
    expect(names).toEqual(Object.keys(pageBaseline).sort())
    expect(fixture.totals.docs).toBe(names.length)
  })

  it('keeps .page-content containers in lockstep with the pinned preview page count', () => {
    for (const row of fixture.rows as Row[]) {
      expect(row.pageContentCount, `${row.doc}: container count`).toBe(row.previewPages)
      expect(row.previewPages, `${row.doc}: preview page count`).toBe(pageBaseline[row.doc].pages)
      expect(row.previewPages).toBeGreaterThan(0)
      expect(row.sectionCount).toBeGreaterThanOrEqual(1)
    }
    expect(fixture.totals.previewPages).toBe(fixture.totals.pageContentCount)
    expect(fixture.totals.previewPages).toBe(
      fixture.rows.reduce((sum: number, r: Row) => sum + r.previewPages, 0)
    )
  })

  it('pins print CSS rule counts (one @page, two margin boxes, at least one break rule)', () => {
    for (const row of fixture.rows as Row[]) {
      expect(row.atPageRuleCount, `${row.doc}: @page`).toBe(1)
      expect(row.marginBoxCount, `${row.doc}: margin boxes`).toBe(2)
      expect(row.cssBreakRuleCount, `${row.doc}: break rules`).toBeGreaterThanOrEqual(1)
      expect(row.contentBreakMarkerCount).toBeGreaterThanOrEqual(0)
      expect(row.printHtmlBytes).toBeGreaterThan(0)
    }
  })
})

describe('printLayout pure functions', () => {
  const labels = { prefix: '第 ', middle: ' 页 / 共 ', suffix: ' 页' }

  it('builds CSS with a single @page rule and page counters', () => {
    const css = buildPrintPageCss({ title: 'Doc', labels })
    expect(css.match(/@page\b/g)).toHaveLength(1)
    expect(css).toContain('size: A4')
    expect(css).toContain('@top-center')
    expect(css).toContain('@bottom-center')
    expect(css).toContain('counter(page)')
    expect(css).toContain('counter(pages)')
  })

  it('embeds CSS and body HTML into a self-contained window document', () => {
    const css = buildPrintPageCss({ title: 'Doc', labels })
    const html = buildPrintWindowHtml({ title: 'Doc', labels, bodyHtml: '<p>hi</p>' })
    expect(html.startsWith('<!DOCTYPE html>')).toBe(true)
    expect(html).toContain(`<style>\n${css}  </style>`)
    expect(html).toContain('<title>Doc</title>')
    expect(html).toContain('<div class="document-content">\n    <p>hi</p>')
  })
})
