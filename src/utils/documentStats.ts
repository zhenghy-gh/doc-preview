/**
 * 文档统计与大纲提取（从 DocPreview.vue 抽离的纯函数）。
 *
 * 输入均为解析结果的结构化数据，不依赖 Vue ref/DOM；组件只负责把结果写回 ref。
 */
import type { CharacterFormat, ParagraphFormat } from './docFormat'

export interface OutlineItem {
  text: string
  level: number
  index: number
}

export interface DocumentStats {
  charCount: number
  chineseCharCount: number
  wordCount: number
  paragraphCount: number
}

/** 字数统计：中文字符 + 英文单词（≥2 字母）；段落按空行切分。 */
export function computeDocumentStats(text: string): DocumentStats {
  const trimmed = text.trim()
  const charCount = trimmed.length
  const chineseCharCount = (trimmed.match(/[\u4e00-\u9fff]/g) || []).length
  const englishWords = (trimmed.match(/[A-Za-z]{2,}/g) || []).length
  const paragraphCount = trimmed.split(/\n\n+/).filter(p => p.trim().length > 0).length
  return {
    charCount,
    chineseCharCount,
    wordCount: chineseCharCount + englishWords,
    paragraphCount,
  }
}

interface OutlineSourceParagraph {
  text?: string
  charFormat?: CharacterFormat
  paraFormat?: ParagraphFormat
}

/** 从段落格式启发式构建大纲；少于 2 个标题时返回空数组（不显示侧栏）。 */
export function buildDocumentOutline(paragraphs: OutlineSourceParagraph[]): OutlineItem[] {
  const items: OutlineItem[] = []
  for (let i = 0; i < paragraphs.length; i++) {
    const para = paragraphs[i]
    const text = para.text?.trim()
    if (!text || text.length < 2) continue
    if (para.paraFormat?.listType) continue
    if (text.length > 80) continue

    const charFormat = para.charFormat || {}
    const isBold = charFormat.bold
    const fontSize = charFormat.fontSize || 16
    const align = para.paraFormat?.alignment

    let level = 0
    const realHeadingLevel = para.paraFormat?.headingLevel
    if (realHeadingLevel && realHeadingLevel >= 1 && realHeadingLevel <= 9) {
      level = realHeadingLevel
    } else if (fontSize >= 32) level = 1
    else if (fontSize >= 22) level = 2
    else if (fontSize >= 18 && isBold) level = 2
    else if (isBold && text.length <= 40 && fontSize >= 16) level = 3
    else if (align === 'center' && text.length <= 30) level = 3

    if (level > 0) items.push({ text, level, index: i })
  }
  return items.length >= 2 ? items : []
}
