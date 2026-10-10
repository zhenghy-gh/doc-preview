import { describe, expect, it } from 'vitest'
import {
  detectAlignment,
  detectListInfo,
  detectParagraphFormat,
} from '../src/utils/docparser/heuristics/textHeuristics'

describe('detectParagraphFormat shared trim', () => {
  it('matches independent alignment and list detection across representative paragraphs', () => {
    const cases = [
      '  1. 先导条目  ',
      '　　二、中文条目　',
      '  "A short title"  ',
      '  普通正文，没有字段标记。  ',
      '   ',
      '作者：张三',
    ]

    for (let index = 0; index < cases.length; index++) {
      const text = cases[index]
      const expectedAlignment = detectAlignment(text, index, cases.length)
      const expectedList = detectListInfo(text)
      const format = detectParagraphFormat(text, index, cases.length)

      expect(format.alignment ?? null).toBe(expectedAlignment)
      if (expectedList) {
        expect(format.listType).toBe(expectedList.listType)
        expect(format.listStyle).toBe(expectedList.listStyle)
        expect(format.listLevel).toBe(expectedList.listLevel)
      } else {
        expect(format.listType).toBeUndefined()
        expect(format.listStyle).toBeUndefined()
        expect(format.listLevel).toBeUndefined()
      }
    }
  })

  it('preserves explicit trimmed arguments for direct helper calls', () => {
    const text = '  1. item  '
    const trimmed = text.trim()
    expect(detectAlignment(text, 0, 1, trimmed)).toBe(detectAlignment(text, 0, 1))
    expect(detectListInfo(text, trimmed)).toEqual(detectListInfo(text))
  })
})
