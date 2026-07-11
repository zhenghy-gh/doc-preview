import { describe, it, expect } from 'vitest'
import {
  applyRevisionsToText,
  escapeHtmlSimple,
  formatRevisionTime,
} from '../src/utils/revisionRender'
import type { RevisionMark } from '../src/utils/docFormat'

/** Build a RevisionMark with the given range and type. */
function buildRev(
  cpStart: number,
  cpEnd: number,
  type: 'insert' | 'delete' | 'format',
  extra: Partial<RevisionMark> = {}
): RevisionMark {
  return { cpStart, cpEnd, type, ...extra }
}

describe('escapeHtmlSimple', () => {
  it('escapes < > & " \' characters', () => {
    expect(escapeHtmlSimple('<a href="x">&\'y\'</a>')).toBe(
      '&lt;a href=&quot;x&quot;&gt;&amp;&#39;y&#39;&lt;/a&gt;'
    )
  })

  it('returns empty string unchanged', () => {
    expect(escapeHtmlSimple('')).toBe('')
  })

  it('returns plain text unchanged', () => {
    expect(escapeHtmlSimple('Hello 世界')).toBe('Hello 世界')
  })
})

describe('formatRevisionTime', () => {
  it('returns empty string for undefined timestamp', () => {
    expect(formatRevisionTime(undefined)).toBe('')
  })

  it('returns empty string for 0 timestamp', () => {
    expect(formatRevisionTime(0)).toBe('')
  })

  it('formats a valid timestamp as YYYY-MM-DD HH:mm', () => {
    // 2024-03-15 14:30 UTC+8 (Asia/Shanghai)
    const ts = new Date(2024, 2, 15, 14, 30).getTime()
    expect(formatRevisionTime(ts)).toBe('2024-03-15 14:30')
  })

  it('returns empty string for NaN timestamp', () => {
    expect(formatRevisionTime(Number.NaN)).toBe('')
  })
})

describe('applyRevisionsToText', () => {
  const text = 'Hello World'

  describe('empty / no-op cases', () => {
    it('returns original text when revisions array is empty', () => {
      const result = applyRevisionsToText(text, 0, text.length, [], 'marks')
      expect(result.text).toBe(text)
      expect(result.hasRevisionHtml).toBe(false)
    })

    it('returns original text when no revisions intersect the paragraph', () => {
      const revisions = [buildRev(100, 105, 'insert')]
      const result = applyRevisionsToText(text, 0, text.length, revisions, 'marks')
      expect(result.text).toBe(text)
      expect(result.hasRevisionHtml).toBe(false)
    })

    it('ignores format-type revisions', () => {
      const revisions = [buildRev(0, 5, 'format')]
      const result = applyRevisionsToText(text, 0, text.length, revisions, 'marks')
      expect(result.text).toBe(text)
      expect(result.hasRevisionHtml).toBe(false)
    })
  })

  describe('marks mode', () => {
    it('wraps inserted text in <ins> with author+time tooltip', () => {
      const ts = new Date(2024, 2, 15, 14, 30).getTime()
      const revisions = [
        buildRev(6, 11, 'insert', { author: 'Alice', timestamp: ts }),
      ]
      const result = applyRevisionsToText(text, 0, text.length, revisions, 'marks')
      expect(result.text).toBe('Hello <ins class="rev-insert" title="Alice · 2024-03-15 14:30">World</ins>')
      expect(result.hasRevisionHtml).toBe(true)
    })

    it('wraps deleted text in <del> with author tooltip', () => {
      const revisions = [
        buildRev(0, 5, 'delete', { author: 'Bob' }),
      ]
      const result = applyRevisionsToText(text, 0, text.length, revisions, 'marks')
      expect(result.text).toBe('<del class="rev-delete" title="Bob">Hello</del> World')
      expect(result.hasRevisionHtml).toBe(true)
    })

    it('falls back to author index when author name is missing', () => {
      const revisions = [
        buildRev(0, 5, 'insert', { authorIndex: 2 }),
      ]
      const result = applyRevisionsToText(text, 0, text.length, revisions, 'marks')
      expect(result.text).toBe('<ins class="rev-insert" title="作者#2">Hello</ins> World')
      expect(result.hasRevisionHtml).toBe(true)
    })

    it('omits title attribute when no author and no timestamp', () => {
      const revisions = [buildRev(0, 5, 'insert')]
      const result = applyRevisionsToText(text, 0, text.length, revisions, 'marks')
      expect(result.text).toBe('<ins class="rev-insert">Hello</ins> World')
      expect(result.hasRevisionHtml).toBe(true)
    })

    it('escapes HTML special characters in revision text', () => {
      // Revision covers the full text '<b>Hi</b>' (9 chars)
      const revisions = [buildRev(0, 9, 'insert')]
      const result = applyRevisionsToText('<b>Hi</b>', 0, 9, revisions, 'marks')
      expect(result.text).toBe('<ins class="rev-insert">&lt;b&gt;Hi&lt;/b&gt;</ins>')
      expect(result.hasRevisionHtml).toBe(true)
    })

    it('handles multiple revisions in descending cpStart order', () => {
      const revisions = [
        buildRev(6, 11, 'insert', { author: 'A' }),
        buildRev(0, 5, 'delete', { author: 'B' }),
      ]
      const result = applyRevisionsToText(text, 0, text.length, revisions, 'marks')
      expect(result.text).toBe('<del class="rev-delete" title="B">Hello</del> <ins class="rev-insert" title="A">World</ins>')
      expect(result.hasRevisionHtml).toBe(true)
    })
  })

  describe('accepted mode', () => {
    it('keeps inserted text as plain text (no tag)', () => {
      const revisions = [buildRev(6, 11, 'insert', { author: 'Alice' })]
      const result = applyRevisionsToText(text, 0, text.length, revisions, 'accepted')
      expect(result.text).toBe('Hello World')
      expect(result.hasRevisionHtml).toBe(false)
    })

    it('drops deleted text', () => {
      const revisions = [buildRev(0, 5, 'delete', { author: 'Bob' })]
      const result = applyRevisionsToText(text, 0, text.length, revisions, 'accepted')
      expect(result.text).toBe(' World')
      expect(result.hasRevisionHtml).toBe(false)
    })

    it('handles mixed insert + delete revisions', () => {
      const revisions = [
        buildRev(6, 11, 'insert', { author: 'A' }),  // "World" inserted
        buildRev(0, 5, 'delete', { author: 'B' }),   // "Hello" deleted
      ]
      const result = applyRevisionsToText(text, 0, text.length, revisions, 'accepted')
      expect(result.text).toBe(' World')
      expect(result.hasRevisionHtml).toBe(false)
    })

    it('escapes HTML in kept inserted text', () => {
      const revisions = [buildRev(0, 3, 'insert')]
      const result = applyRevisionsToText('<b>', 0, 3, revisions, 'accepted')
      expect(result.text).toBe('&lt;b&gt;')
      expect(result.hasRevisionHtml).toBe(false)
    })
  })

  describe('rejected mode', () => {
    it('drops inserted text', () => {
      const revisions = [buildRev(6, 11, 'insert', { author: 'Alice' })]
      const result = applyRevisionsToText(text, 0, text.length, revisions, 'rejected')
      expect(result.text).toBe('Hello ')
      expect(result.hasRevisionHtml).toBe(false)
    })

    it('keeps deleted text as plain text (no tag)', () => {
      const revisions = [buildRev(0, 5, 'delete', { author: 'Bob' })]
      const result = applyRevisionsToText(text, 0, text.length, revisions, 'rejected')
      expect(result.text).toBe('Hello World')
      expect(result.hasRevisionHtml).toBe(false)
    })

    it('handles mixed insert + delete revisions', () => {
      const revisions = [
        buildRev(6, 11, 'insert', { author: 'A' }),  // "World" inserted (rejected → dropped)
        buildRev(0, 5, 'delete', { author: 'B' }),   // "Hello" deleted (rejected → kept)
      ]
      const result = applyRevisionsToText(text, 0, text.length, revisions, 'rejected')
      expect(result.text).toBe('Hello ')
      expect(result.hasRevisionHtml).toBe(false)
    })
  })

  describe('paragraph offset handling', () => {
    it('uses paraCpStart to compute revision offsets within the paragraph', () => {
      // Paragraph starts at CP 100, text is "AB"
      const revisions = [buildRev(101, 102, 'insert', { author: 'X' })]
      const result = applyRevisionsToText('AB', 100, 102, revisions, 'marks')
      expect(result.text).toBe('A<ins class="rev-insert" title="X">B</ins>')
      expect(result.hasRevisionHtml).toBe(true)
    })

    it('clamps revision range to paragraph boundaries', () => {
      // Revision extends beyond paragraph end; should be clamped to text.length
      const revisions = [buildRev(5, 50, 'insert', { author: 'X' })]
      const result = applyRevisionsToText(text, 0, text.length, revisions, 'accepted')
      expect(result.text).toBe('Hello World')
      expect(result.hasRevisionHtml).toBe(false)
    })

    it('skips revisions with zero-length overlap', () => {
      const revisions = [buildRev(5, 5, 'insert')]
      const result = applyRevisionsToText(text, 0, text.length, revisions, 'marks')
      expect(result.text).toBe(text)
      expect(result.hasRevisionHtml).toBe(false)
    })
  })

  describe('mode switching produces consistent results', () => {
    const revisions: RevisionMark[] = [
      buildRev(0, 5, 'delete', { author: 'Del' }),    // "Hello" marked for deletion
      buildRev(6, 11, 'insert', { author: 'Ins' }),   // "World" marked as insertion
    ]

    it('marks mode shows both revisions as tags', () => {
      const r = applyRevisionsToText(text, 0, text.length, revisions, 'marks')
      expect(r.hasRevisionHtml).toBe(true)
      expect(r.text).toContain('<del')
      expect(r.text).toContain('<ins')
    })

    it('accepted mode keeps "World", drops "Hello"', () => {
      const r = applyRevisionsToText(text, 0, text.length, revisions, 'accepted')
      expect(r.text).toBe(' World')
    })

    it('rejected mode keeps "Hello", drops "World"', () => {
      const r = applyRevisionsToText(text, 0, text.length, revisions, 'rejected')
      expect(r.text).toBe('Hello ')
    })
  })
})
