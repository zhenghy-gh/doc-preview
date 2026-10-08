// T3-W3 · pageBuilder 单测（contract-split-r1 §1.2 Batch-C / §3.2 可单测标准）
// 纯字符串状态机，无需 DOM 环境。
import { describe, it, expect } from 'vitest'
import { PT_TO_PX, createPageBuilder } from '../src/utils/rendering/pageBuilder'
import type { CharacterFormat, SectionInfo } from '../src/utils/docFormat'

describe('PT_TO_PX', () => {
  it('freezes the historical 1.333 literal', () => {
    expect(PT_TO_PX).toBe(1.333)
  })
})

describe('createPageBuilder · 分页状态机', () => {
  it('wraps content into a single .page-content and resets buffer on finalize', () => {
    const b = createPageBuilder({ pageHeightPt: 842, sections: [] })
    b.addToPage('<p>A</p>', 100)
    b.addToPage('<p>B</p>', 100)
    b.finalizePage()
    expect(b.result).toEqual(['<div class="page-content"><p>A</p>\n<p>B</p></div>'])
    // finalize 后缓冲清空：再次 finalize 不产生空页
    b.finalizePage()
    expect(b.result).toHaveLength(1)
  })

  it('starts a new page when estimated height exceeds the page height', () => {
    const b = createPageBuilder({ pageHeightPt: 842, sections: [] })
    // 842pt × 1.333 ≈ 1122px；首段 1100 入页后，第二段 50 超限 → 先落页再入新页
    b.addToPage('<p>big</p>', 1100)
    b.addToPage('<p>small</p>', 50)
    b.finalizePage()
    expect(b.result).toEqual([
      '<div class="page-content"><p>big</p></div>',
      '<div class="page-content"><p>small</p></div>',
    ])
  })

  it('estimateParaHeight keeps the magic numbers verbatim (45 chars/line, ×1.5, +4)', () => {
    const b = createPageBuilder({ pageHeightPt: 842, sections: [] })
    const cf: CharacterFormat = { fontSize: 12 }
    expect(b.estimateParaHeight('', cf)).toBe(1 * 12 * 1.5 + 4) // max(1 line)
    expect(b.estimateParaHeight('x'.repeat(45), cf)).toBe(45 / 45 * 12 * 1.5 + 4)
    expect(b.estimateParaHeight('x'.repeat(46), cf)).toBe(2 * 12 * 1.5 + 4)
  })

  it('injects column-count/gap CSS and splits pages when column count changes', () => {
    const sections: SectionInfo[] = [
      { cpStart: 0, cpEnd: 100, columnCount: 2, columnSpacingPt: 20 } as SectionInfo,
      { cpStart: 100, cpEnd: 200, columnCount: 1 } as SectionInfo,
    ]
    const b = createPageBuilder({ pageHeightPt: 842, sections })
    b.applySectionForCp(0) // 进入双栏节
    b.addToPage('<p>c1</p>', 10)
    b.applySectionForCp(50)
    b.finalizePage()
    expect(b.result[0]).toContain('column-count: 2')
    expect(b.result[0]).toContain('column-fill: auto')
    expect(b.result[0]).toContain(`column-gap: ${Math.round(20 * PT_TO_PX)}px`)

    // 栏数变化（2→1）触发强制换页
    b.applySectionForCp(150)
    b.addToPage('<p>c2</p>', 10)
    b.finalizePage()
    expect(b.result).toHaveLength(2)
    expect(b.result[1]).not.toContain('column-count')

    // 未命中任何分节时保持当前栏状态不变
    b.applySectionForCp(9999)
    b.addToPage('<p>c3</p>', 10)
    b.finalizePage()
    expect(b.result[2]).not.toContain('column-count')
  })

  it('keeps first-match behavior for overlapping or unsorted sections', () => {
    const sections: SectionInfo[] = [
      { cpStart: 50, cpEnd: 150, columnCount: 2 } as SectionInfo,
      { cpStart: 0, cpEnd: 100, columnCount: 3 } as SectionInfo,
    ]
    const b = createPageBuilder({ pageHeightPt: 842, sections })
    expect(b.findSectionForCp(60)?.columnCount).toBe(2)
  })

  it('findSectionForCp is half-open [cpStart, cpEnd)', () => {
    const sections: SectionInfo[] = [
      { cpStart: 0, cpEnd: 100 } as SectionInfo,
    ]
    const b = createPageBuilder({ pageHeightPt: 842, sections })
    expect(b.findSectionForCp(0)).toBeDefined()
    expect(b.findSectionForCp(99)).toBeDefined()
    expect(b.findSectionForCp(100)).toBeUndefined()
    expect(b.findSectionForCp(-1)).toBeUndefined()
  })
})
