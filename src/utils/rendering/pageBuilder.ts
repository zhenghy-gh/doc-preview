/**
 * pageBuilder —— 分页/分栏状态机纯函数（T3-W3 · contract-split-r1 §1.2 Batch-C）
 *
 * 自 DocPreview.vue#formatFormattedTextToHtml 内部闭包组原样迁出（符号名锚）：
 * findSectionForCp / finalizePage / addToPage / estimateParaHeight /
 * currentColumnCount / currentColumnSpacingPt。
 *
 * ⚠️ 高度估算魔数群（契约红线 R4，数值逐一原样、严禁顺手优化——它们决定分页断点）：
 *   45 字/行、行高 fontSize×1.5、+4 padding；
 *   调用方使用的其余估算值：表格=100、图表=200、文本框锚点=24、图片 min(400)+16、空段=8。
 * pt→px 换算收敛为导出常量 PT_TO_PX = 1.333（原 :pageHeightPx 与 getPagePlaceholderHeight 两处重复字面量）。
 *
 * 纯度边界（契约 §1.3）：禁 import vue/.vue、不触 DOM/window；
 * 同一输入必须字节同输出；状态限定在单次 createPageBuilder 生命周期内。
 */
import type { CharacterFormat, SectionInfo } from '../docFormat'

/** pt → px 换算常量（原组件两处 1.333 字面量的单一事实源） */
export const PT_TO_PX = 1.333

export interface PageBuilderInput {
  /** 页面高度（pt，A4 默认 842），内部换算为 px */
  pageHeightPt: number
  /** 分节信息（分栏渲染依据），按 cpStart/cpEnd 线性查找 */
  sections: SectionInfo[]
}

export interface PageBuilder {
  /** 已完成的页面（每页一个 .page-content div） */
  result: string[]
  /** 线性查找 CP 所属分节 */
  findSectionForCp(cp: number): SectionInfo | undefined
  /** 段落所属分节变化时更新分栏状态；栏数变化即强制换页（镜像原主循环分支） */
  applySectionForCp(cp: number): void
  /** 将当前缓冲落为一页并注入分栏 CSS */
  finalizePage(): void
  /** 高度驱动的入页（超页高先 finalizePage） */
  addToPage(html: string, estimatedHeight: number): void
  /** 段落高度估算（魔数群见文件头，禁止调整） */
  estimateParaHeight(text: string, charFormat: CharacterFormat): number
}

export function createPageBuilder(input: PageBuilderInput): PageBuilder {
  const result: string[] = []
  const pageContent: string[] = []
  let currentPageHeight = 0
  const pageHeightPx = input.pageHeightPt * PT_TO_PX

  // Section lookup for multi-column rendering.
  // We track which section the current paragraph belongs to so that
  // finalizePage() can apply CSS column-count to the page container.
  let currentColumnCount = 1
  let currentColumnSpacingPt: number | undefined

  // Sorted, non-overlapping sections can be searched in logarithmic time. Keep
  // the original first-match scan for malformed or overlapping metadata.
  const sectionsAreSearchable = input.sections.every((sec, index, sections) => {
    if (sec.cpEnd < sec.cpStart) return false
    const previous = sections[index - 1]
    return !previous || previous.cpStart <= sec.cpStart && previous.cpEnd <= sec.cpStart
  })

  const findSectionForCp = (cp: number): SectionInfo | undefined => {
    if (!sectionsAreSearchable) {
      for (const sec of input.sections) {
        if (cp >= sec.cpStart && cp < sec.cpEnd) return sec
      }
      return undefined
    }

    let low = 0
    let high = input.sections.length - 1
    while (low <= high) {
      const mid = low + Math.floor((high - low) / 2)
      const sec = input.sections[mid]
      if (cp < sec.cpStart) high = mid - 1
      else if (cp >= sec.cpEnd) low = mid + 1
      else return sec
    }
    return undefined
  }

  const finalizePage = () => {
    if (pageContent.length > 0) {
      const styleParts: string[] = []
      if (currentColumnCount > 1) {
        styleParts.push(`column-count: ${currentColumnCount}`)
        styleParts.push('column-fill: auto')
        if (currentColumnSpacingPt !== undefined) {
          styleParts.push(`column-gap: ${Math.round(currentColumnSpacingPt * PT_TO_PX)}px`)
        }
      }
      const style = styleParts.length > 0 ? ` style="${styleParts.join('; ')}"` : ''
      result.push(`<div class="page-content"${style}>${pageContent.join('\n')}</div>`)
      pageContent.length = 0
      currentPageHeight = 0
    }
  }

  const addToPage = (html: string, estimatedHeight: number) => {
    if (currentPageHeight > 0 && currentPageHeight + estimatedHeight > pageHeightPx) {
      finalizePage()
    }
    pageContent.push(html)
    currentPageHeight += estimatedHeight
  }

  const estimateParaHeight = (text: string, charFormat: CharacterFormat): number => {
    const fontSize = charFormat.fontSize || 12
    const baseLineHeight = fontSize * 1.5
    const charCount = text.length
    const charsPerLine = 45
    const lines = Math.max(1, Math.ceil(charCount / charsPerLine))
    return lines * baseLineHeight + 4
  }

  // Track which section this paragraph belongs to and update column settings.
  // When the column count changes (section switch), finalize the current page
  // so that content with different column layouts stays in separate pages.
  const applySectionForCp = (cp: number): void => {
    const sec = findSectionForCp(cp)
    if (sec) {
      const newColumnCount = sec.columnCount || 1
      const newColumnSpacing = sec.columnSpacingPt
      if (newColumnCount !== currentColumnCount) {
        finalizePage()
        currentColumnCount = newColumnCount
        currentColumnSpacingPt = newColumnSpacing
      } else if (newColumnSpacing !== currentColumnSpacingPt) {
        currentColumnSpacingPt = newColumnSpacing
      }
    }
  }

  return {
    result,
    findSectionForCp,
    applySectionForCp,
    finalizePage,
    addToPage,
    estimateParaHeight,
  }
}
