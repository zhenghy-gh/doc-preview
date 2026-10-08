/**
 * storySplitter —— Story 分流子域（T4-P1 A 块 · contract-split-r1 §2.1 storySplitter.ts）
 *
 * 自 docParser.ts 正式归位（move-only，符号名锚）：StoryText / StoryPieceMap /
 * parseClxWithStories / splitPiecesByStory / toDocumentStories / splitHeaderParts。
 *
 * FIELD-CP-GOV 时序对齐说明：本域内不含 _cpStart 推导链与域结果替换逻辑
 * （规格 docs/changelog/2026-08-26-field-cp-gov-parser-spec.md 的 R-F2/R-F4 对象），
 * 迁移为逐字节保真、零逻辑改动；后续 R-F 系列修复若触及本域将按同 PR 序列对齐。
 * 纯度：禁 import vue/.vue、禁反向 import ../docParser（契约 §2.2 规则 2）。
 */
import { logger } from '../logger'
import { parsePicfAt } from '../pictureParser'
import type { ParsedPicture } from '../pictureParser'
import { parsePlcfHdd, splitHeaderText, splitHeaderTextHeuristic, splitHeaderTextWithImages } from '../headerFooterParser'

import { extractTextFromRange } from './clxReader'
import { parseClxPieces } from './pieceTable'
import type { Piece } from './pieceTable'
import type { FibData, RgCcp } from '../fibParser'
import type { OleParser, DirectoryEntry } from '../oleParser'
import type { DopData } from '../dopParser'
import type { ChpxRun } from '../formatParser'
import type { DocumentStories, HeaderFooterPartType, HeaderFooterPartContent } from '../docFormat'

/** A 域会话上下文：结构化兼容 clxReader.ClxContext */
export interface StorySplitterContext {
  ole: OleParser
  maxTotalChars: number
  readUint16(data: Uint8Array, offset: number): number
  readUint32(data: Uint8Array, offset: number): number
  /** 表流读取（splitHeaderParts 的 PlcfHdd 路径需要） */
  readTableStream(fib: FibData, directory: DirectoryEntry[]): Uint8Array | null
}

export interface StoryText {
  /** Main document body (ccpText). */
  main: string
  /** Footnotes (ccpFtn). */
  footnotes: string
  /** Headers and footers (ccpHdd). */
  headers: string
  /** Endnotes (ccpEdn). */
  endnotes: string
  /** Comments / annotations (ccpAtn). */
  comments: string
  /** Text boxes (ccpTxbx + ccpHdrTxbx). */
  textboxes: string
}

/**
 * Per-character CHPX association produced by parseClxWithStories. For each
 * story, lists pieces as (start, end, chpxIndex?) — chpxIndex is set when the
 * piece's fChp flag is on. Used to apply piece-level CHP at the right cp range.
 */
export interface StoryPieceMap {
  main: Array<{ start: number; end: number; chpxIndex?: number }>
  footnotes: Array<{ start: number; end: number; chpxIndex?: number }>
  headers: Array<{ start: number; end: number; chpxIndex?: number }>
  endnotes: Array<{ start: number; end: number; chpxIndex?: number }>
  comments: Array<{ start: number; end: number; chpxIndex?: number }>
  textboxes: Array<{ start: number; end: number; chpxIndex?: number }>
}


export function splitPiecesByStory(
    ctx: StorySplitterContext,
    pieces: Piece[],
    rgCcp: RgCcp,
    wordDocData: Uint8Array,
  ): { stories: StoryText; pieceMap: StoryPieceMap } | null {
    if (pieces.length === 0 || rgCcp.ccpText <= 0) return null

    // Build story CP boundaries in order. Names map to StoryText fields.
    // macro (ccpMcr) is skipped — we don't expose macro text.
    let cp = 0
    const bounds: Array<{ name: keyof StoryText; start: number; end: number }> = []
    const addBound = (name: keyof StoryText, count: number) => {
      bounds.push({ name, start: cp, end: cp + count })
      cp += count
    }
    addBound('main', rgCcp.ccpText)
    addBound('footnotes', rgCcp.ccpFtn)
    addBound('headers', rgCcp.ccpHdd)
    cp += rgCcp.ccpMcr // skip macro
    addBound('comments', rgCcp.ccpAtn)
    addBound('endnotes', rgCcp.ccpEdn)
    addBound('textboxes', rgCcp.ccpTxbx)
    // ccpHdrTxbx folded into textboxes per our StoryText shape
    cp += rgCcp.ccpHdrTxbx

    const stories: StoryText = {
      main: '',
      footnotes: '',
      headers: '',
      endnotes: '',
      comments: '',
      textboxes: '',
    }
    const pieceMap: StoryPieceMap = {
      main: [],
      footnotes: [],
      headers: [],
      endnotes: [],
      comments: [],
      textboxes: [],
    }

    let totalChars = 0
    // Per-piece running character offsets within each story (post-skip).
    const storyOffset: Record<keyof StoryText, number> = {
      main: 0, footnotes: 0, headers: 0, endnotes: 0, comments: 0, textboxes: 0,
    }

    for (let pieceIdx = 0; pieceIdx < pieces.length; pieceIdx++) {
      const piece = pieces[pieceIdx]
      for (const b of bounds) {
        if (b.end <= b.start) continue
        if (piece.cpEnd <= b.start || piece.cpStart >= b.end) continue

        const overlapCpStart = Math.max(piece.cpStart, b.start)
        const overlapCpEnd = Math.min(piece.cpEnd, b.end)
        const overlapCharCount = overlapCpEnd - overlapCpStart
        if (overlapCharCount <= 0) continue

        totalChars += overlapCharCount
        /* v8 ignore start */
        if (totalChars > ctx.maxTotalChars) {
          logger.warn('总字符数超出限制，停止 story 分流')
          return { stories, pieceMap }
        }
        /* v8 ignore stop */

        const charOffset = overlapCpStart - piece.cpStart
        const byteOffset = piece.fCompressed ? charOffset : charOffset * 2
        const byteLen = piece.fCompressed ? overlapCharCount : overlapCharCount * 2
        const segStart = piece.fcValue + byteOffset
        const segEnd = segStart + byteLen

        if (segStart < 0 || segEnd > wordDocData.length) {
          logger.warn(`Story segment 越界 (cp=${overlapCpStart})，跳过`)
          continue
        }

        const segText = extractTextFromRange(
          wordDocData, segStart, segEnd, piece.fCompressed, false,
        )
        const segTextLen = segText.length
        const segStartInStory = storyOffset[b.name]
        
        stories[b.name] += segText
        if (segTextLen > 0) {
          pieceMap[b.name].push({
            start: segStartInStory,
            end: segStartInStory + segTextLen,
            chpxIndex: piece.fChp ? piece.chpxIndex : undefined,
          })
        }
        storyOffset[b.name] += segTextLen
      }
    }

    return { stories, pieceMap }
  }

export function parseClxWithStories(
    ctx: StorySplitterContext,
    clxData: Uint8Array,
    wordDocData: Uint8Array,
    rgCcp: RgCcp,
  ): { stories: StoryText; pieceMap: StoryPieceMap } | null {
    const pieces = parseClxPieces(ctx, clxData)
    if (pieces.length === 0) return null
    return splitPiecesByStory(ctx, pieces, rgCcp, wordDocData)
  }

export function toDocumentStories(
    ctx: StorySplitterContext,
    stories: StoryText,
    fib?: FibData,
    dop?: DopData | null,
    directory?: DirectoryEntry[],
    chpxRuns: ChpxRun[] = []
  ): DocumentStories {
    const out: DocumentStories = {}
    if (stories.headers.trim()) out.headers = stories.headers.trim()
    if (stories.footnotes.trim()) out.footnotes = stories.footnotes.trim()
    if (stories.endnotes.trim()) out.endnotes = stories.endnotes.trim()
    if (stories.comments.trim()) out.comments = stories.comments.trim()
    if (stories.textboxes.trim()) out.textboxes = stories.textboxes.trim()

    // 尝试拆分页眉页脚（仅当 DOP 标志位启用时）
    if (out.headers && dop && (dop.titlePage || dop.facingPages)) {
      const headerParts = splitHeaderParts(ctx, stories.headers, fib, dop, directory, chpxRuns)
      if (headerParts) {
        out.headerParts = headerParts.textParts
        if (headerParts.startsWithImages) {
          out.headerPartsWithImages = headerParts.startsWithImages
        }
      }
    }

    return out
  }

export function splitHeaderParts(
    ctx: StorySplitterContext,
    headersText: string,
    fib?: FibData,
    dop?: DopData | null,
    directory?: DirectoryEntry[],
    chpxRuns: ChpxRun[] = []
  ): { textParts: Partial<Record<HeaderFooterPartType, string>>; startsWithImages?: Partial<Record<HeaderFooterPartType, HeaderFooterPartContent>> } | null {
    if (!headersText || !dop) return null

    // 提取页眉页脚区域中的图片（通过 chpxRuns 中的 fcPic）
    const headerPictures: ParsedPicture[] = []
    if (chpxRuns.length > 0 && directory) {
      const dataEntry = ctx.ole.findStreamByName(directory, 'Data')
      if (dataEntry) {
        const dataStream = ctx.ole.readStream(dataEntry)
        if (dataStream.data && dataStream.data.length > 0) {
          const seenFcPics = new Set<number>()
          for (const run of chpxRuns) {
            if (run.fcPic !== undefined && !seenFcPics.has(run.fcPic)) {
              seenFcPics.add(run.fcPic)
              const pic = parsePicfAt(dataStream.data, run.fcPic)
              if (pic) {
                headerPictures.push(pic)
              }
            }
          }
        }
      }
    }

    // 策略 1：通过 PlcfHdd 精确拆分
    if (fib && fib.lcbPlcfHdd && fib.lcbPlcfHdd > 0 && fib.fcPlcfHdd && directory) {
      try {
        const tableData = ctx.readTableStream(fib, directory)
        if (tableData) {
          const end = fib.fcPlcfHdd + fib.lcbPlcfHdd
          if (end <= tableData.length) {
            const plcfHddData = tableData.subarray(fib.fcPlcfHdd, end)
            const split = parsePlcfHdd(plcfHddData, dop.titlePage, dop.facingPages)
            if (split) {
              const textParts = splitHeaderText(headersText, split)
              if (textParts) {
                logger.log(`页眉页脚通过 PlcfHdd 拆分成功: ${Object.keys(textParts).length} 部分`)
                
                // 如果有图片，尝试按子范围拆分图片
                let startsWithImages: Partial<Record<HeaderFooterPartType, HeaderFooterPartContent>> | undefined
                if (headerPictures.length > 0) {
                  const withImages = splitHeaderTextWithImages(headersText, split, headerPictures)
                  if (withImages && Object.keys(withImages).length > 0) {
                    startsWithImages = withImages
                    logger.log(`页眉页脚图片拆分成功: ${Object.keys(withImages).length} 部分包含图片`)
                  }
                }
                
                return { textParts, startsWithImages }
              }
            }
          }
        }
      } catch (e) {
        logger.warn(`PlcfHdd 拆分失败，回退到启发式: ${e}`)
      }
    }

    // 策略 2：启发式段落拆分（不支持图片拆分）
    const textParts = splitHeaderTextHeuristic(headersText, dop.titlePage, dop.facingPages)
    if (textParts) {
      return { textParts }
    }

    return null
  }
