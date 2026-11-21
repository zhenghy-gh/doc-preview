import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const read = (name: string) => JSON.parse(readFileSync(resolve(here, 'fixtures', name), 'utf8'))

describe('real-corpus baselines cross-check', () => {
  it('page baseline and print-layout audit agree on document set and preview page counts', () => {
    const pages: Record<string, { pages: number }> = read('real-corpus-pages.json')
    const print: { rows: Array<{ doc: string; previewPages: number | null; printPageCount: number | null }> } =
      read('print-layout-audit.json')

    const pageDocs = Object.keys(pages).sort()
    const printRows = print.rows.slice().sort((a, b) => a.doc.localeCompare(b.doc))
    expect(printRows.map(r => r.doc)).toEqual(pageDocs)

    // 两份基线由不同脚本在不同时间生成：previewPages 必须逐份一致。
    // printPageCount 为 null 表示本机无法自动核验，不得被误当成 0 或页数。
    for (const row of printRows) {
      expect(row.previewPages, `${row.doc}: preview page count drift`).toBe(pages[row.doc].pages)
      if (row.printPageCount !== null) {
        expect(row.printPageCount, `${row.doc}: print page count must be verified explicitly`).toBeGreaterThan(0)
      }
    }
  })

  it('never fabricates a print page count without a verified measurement', () => {
    const print: { autoVerifiable: string[]; manualOnly: string[]; rows: Array<{ printPageCount: number | null }> } =
      read('print-layout-audit.json')
    expect(print.autoVerifiable.length).toBeGreaterThan(0)
    expect(print.manualOnly.length).toBeGreaterThan(0)
    // 当前环境无可用 Chromium：所有 printPageCount 必须是 null，而不是编造的整数。
    for (const row of print.rows) expect(row.printPageCount).toBeNull()
  })
})
