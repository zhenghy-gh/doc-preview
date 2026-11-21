// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest'
import { formatPanelTitle, formatSizePt } from '../src/utils/formatUtils'
import { formatStoryText } from '../src/utils/storyRender'

const t = (key: string, params?: Record<string, unknown>) => {
  if (key === 'sections.sizePt') return `${params?.pt}pt (${params?.cm}cm)`
  return key
}

describe('formatUtils', () => {
  it('formatPanelTitle uses full-width brackets in zh and half-width in en', () => {
    expect(formatPanelTitle(t, false, 'toc.title', 3)).toBe('toc.title（3）')
    expect(formatPanelTitle(t, true, 'toc.title', 3)).toBe('toc.title (3)')
  })

  it('formatSizePt handles empty/invalid values and formats pt+cm', () => {
    expect(formatSizePt(t, undefined)).toBe('')
    expect(formatSizePt(t, 0)).toBe('')
    expect(formatSizePt(t, -1)).toBe('')
    expect(formatSizePt(t, 10)).toBe('10.0pt (0.35cm)')
  })
})

describe('formatStoryText', () => {
  it('preserves indentation, collapses blank runs and renders special marks', () => {
    const html = formatStoryText('  indented\n\n\nsecond\vline\f\u0007end<script>')
    expect(html).toContain('  indented')
    expect(html).toContain('<br>')
    expect(html).toContain('[分页]')
    expect(html).toContain('│')
    expect(html).not.toContain('<script>')
    expect(html.match(/&nbsp;/g)).toHaveLength(1) // consecutive blanks collapsed
  })

  it('returns empty string for empty input', () => {
    expect(formatStoryText('')).toBe('')
  })
})
