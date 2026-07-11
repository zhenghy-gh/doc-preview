import { describe, it, expect } from 'vitest'
import { DocParser } from '../src/utils/docParser'

/**
 * Tests for list marker detection (`DocParser.detectListInfo` / `detectParagraphFormat`).
 *
 * These verify the heuristic list-marker patterns supported without parsing
 * the real PAP/LST structures: Arabic / Latin / Roman / CJK ideographic /
 * circled numerals, parenthesized forms, multi-level numbering, and
 * indentation-based list level inference.
 */
describe('list detection', () => {
  function detect(text: string) {
    const parser = new DocParser(new ArrayBuffer(512))
    return (parser as any).detectListInfo(text)
  }

  describe('Arabic numerals', () => {
    it('should detect "1. item" as ordered decimal', () => {
      const r = detect('1. 第一项')
      expect(r).not.toBeNull()
      expect(r.listType).toBe('ordered')
      expect(r.listStyle).toBe('decimal')
      expect(r.listLevel).toBe(0)
    })

    it('should detect "2) item" as ordered decimal', () => {
      const r = detect('2) 第二项')
      expect(r).not.toBeNull()
      expect(r.listStyle).toBe('decimal')
    })

    it('should detect "(3) item" as ordered decimal', () => {
      const r = detect('(3) 第三项')
      expect(r).not.toBeNull()
      expect(r.listStyle).toBe('decimal')
    })

    it('should detect "（4） item" (full-width parens) as ordered decimal', () => {
      const r = detect('（4）第四项')
      expect(r).not.toBeNull()
      expect(r.listStyle).toBe('decimal')
    })
  })

  describe('multi-level Arabic', () => {
    it('should detect "1.1 sub-item" as ordered decimal', () => {
      const r = detect('1.1 子项')
      expect(r).not.toBeNull()
      expect(r.listStyle).toBe('decimal')
    })

    it('should detect "1.2.3 deeper sub-item" as ordered decimal', () => {
      const r = detect('1.2.3 更深的子项')
      expect(r).not.toBeNull()
      expect(r.listStyle).toBe('decimal')
    })
  })

  describe('Latin letters', () => {
    it('should detect "a. item" as ordered lower-alpha', () => {
      const r = detect('a. 子项')
      expect(r).not.toBeNull()
      expect(r.listStyle).toBe('lower-alpha')
    })

    it('should detect "B) item" as ordered lower-alpha', () => {
      const r = detect('B) 子项内容')
      expect(r).not.toBeNull()
      expect(r.listStyle).toBe('lower-alpha')
    })

    it('should detect "(c) item" as ordered lower-alpha', () => {
      const r = detect('(c) 子项内容')
      expect(r).not.toBeNull()
      expect(r.listStyle).toBe('lower-alpha')
    })
  })

  describe('Roman numerals', () => {
    it('should detect "i. item" as lower-roman', () => {
      const r = detect('i. 子项')
      expect(r).not.toBeNull()
      expect(r.listStyle).toBe('lower-roman')
    })

    it('should detect "iv. item" as lower-roman', () => {
      const r = detect('iv. 子项')
      expect(r).not.toBeNull()
      expect(r.listStyle).toBe('lower-roman')
    })

    it('should detect "II. item" as upper-roman', () => {
      const r = detect('II. 大项')
      expect(r).not.toBeNull()
      expect(r.listStyle).toBe('upper-roman')
    })
  })

  describe('CJK ideographic numerals', () => {
    it('should detect "一、第一项" as cjk-ideographic', () => {
      const r = detect('一、第一项')
      expect(r).not.toBeNull()
      expect(r.listType).toBe('ordered')
      expect(r.listStyle).toBe('cjk-ideographic')
    })

    it('should detect "二、第二项" as cjk-ideographic', () => {
      const r = detect('二、第二项')
      expect(r).not.toBeNull()
      expect(r.listStyle).toBe('cjk-ideographic')
    })

    it('should detect "十、第十项" as cjk-ideographic', () => {
      const r = detect('十、第十项')
      expect(r).not.toBeNull()
      expect(r.listStyle).toBe('cjk-ideographic')
    })

    it('should detect "甲、第一项" as cjk-ideographic', () => {
      const r = detect('甲、第一项')
      expect(r).not.toBeNull()
      expect(r.listStyle).toBe('cjk-ideographic')
    })

    it('should detect "（一）第一项" as cjk-ideographic', () => {
      const r = detect('（一）第一项')
      expect(r).not.toBeNull()
      expect(r.listStyle).toBe('cjk-ideographic')
    })
  })

  describe('circled numbers', () => {
    it('should detect "① 第一项" as cjk-ideographic', () => {
      const r = detect('① 第一项')
      expect(r).not.toBeNull()
      expect(r.listStyle).toBe('cjk-ideographic')
    })

    it('should detect "② 第二项" as cjk-ideographic', () => {
      const r = detect('② 第二项')
      expect(r).not.toBeNull()
      expect(r.listStyle).toBe('cjk-ideographic')
    })
  })

  describe('unordered bullets', () => {
    it('should detect "- item" as unordered disc', () => {
      const r = detect('- 无序项')
      expect(r).not.toBeNull()
      expect(r.listType).toBe('unordered')
      expect(r.listStyle).toBe('disc')
    })

    it('should detect "* item" as unordered disc', () => {
      const r = detect('* 无序项')
      expect(r).not.toBeNull()
      expect(r.listType).toBe('unordered')
    })

    it('should detect "• item" as unordered disc', () => {
      const r = detect('• 无序项')
      expect(r).not.toBeNull()
      expect(r.listType).toBe('unordered')
    })

    it('should detect "○ item" as unordered disc', () => {
      const r = detect('○ 无序项')
      expect(r).not.toBeNull()
      expect(r.listType).toBe('unordered')
    })
  })

  describe('list level (indentation)', () => {
    it('should infer level 0 for unindented items', () => {
      const r = detect('1. 顶级项')
      expect(r.listLevel).toBe(0)
    })

    it('should infer level 1 for 2-space indent', () => {
      const r = detect('  1.1 子项')
      expect(r.listLevel).toBe(1)
    })

    it('should infer level 2 for 4-space indent', () => {
      const r = detect('    a. 更深的子项')
      expect(r.listLevel).toBe(2)
    })

    it('should treat a full-width space as 2 spaces', () => {
      const r = detect('\u3000\u3000a. 子项')
      expect(r.listLevel).toBe(2)
    })
  })

  describe('non-list text', () => {
    it('should return null for plain prose', () => {
      expect(detect('这是一段普通的中文正文，没有任何列表标记。')).toBeNull()
    })

    it('should return null for short text', () => {
      expect(detect('一')).toBeNull()
    })

    it('should return null for a single character without a marker', () => {
      expect(detect('A')).toBeNull()
    })
  })
})
