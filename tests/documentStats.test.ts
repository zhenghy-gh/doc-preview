import { describe, it, expect } from 'vitest'
import { computeDocumentStats, buildDocumentOutline } from '../src/utils/documentStats'
import type { ParagraphFormat } from '../src/utils/docFormat'

const para = (text: string, charFormat: Record<string, unknown> = {}, paraFormat: Partial<ParagraphFormat> = {}) => ({
  text,
  charFormat: charFormat as never,
  paraFormat: paraFormat as ParagraphFormat,
})

describe('computeDocumentStats', () => {
  it('counts Chinese chars, English words and paragraphs by blank lines', () => {
    const s = computeDocumentStats('  中文标题\n\nThis is a test 文档。\n\n\nAnother paragraph!  ')
    expect(s.charCount).toBe('中文标题\n\nThis is a test 文档。\n\n\nAnother paragraph!'.length)
    expect(s.chineseCharCount).toBeGreaterThan(0)
    expect(s.wordCount).toBe(s.chineseCharCount + 5) // This/is/test/Another/paragraph (单字母 "a" 不计)
    expect(s.paragraphCount).toBe(3)
  })

  it('returns all zeros for blank input', () => {
    expect(computeDocumentStats(' \n\n ')).toEqual({
      charCount: 0, chineseCharCount: 0, wordCount: 0, paragraphCount: 0,
    })
  })
})

describe('buildDocumentOutline', () => {
  it('prefers real headingLevel and falls back to font/bold/center heuristics', () => {
    const items = buildDocumentOutline([
      para('Chapter One', { fontSize: 32 }, {}),
      para('Section A', {}, { headingLevel: 2 }),
      para('not a heading', { fontSize: 10 }, {}),
      para('Centered', {}, { alignment: 'center' }),
      para('List item', {}, { listType: 'unordered' }),
      para('TooLong'.repeat(20), { fontSize: 40 }, {}),
    ])
    expect(items).toEqual([
      { text: 'Chapter One', level: 1, index: 0 },
      { text: 'Section A', level: 2, index: 1 },
      { text: 'Centered', level: 3, index: 3 },
    ])
  })

  it('hides outline when fewer than two headings are found', () => {
    expect(buildDocumentOutline([para('Only One', { fontSize: 32 })])).toEqual([])
    expect(buildDocumentOutline([])).toEqual([])
  })
})
