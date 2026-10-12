/**
 * documentAssets —— 资产提取子域（T4-P1 E 块 · contract-split-r1 §2.1 assets/documentAssets.ts）
 *
 * 自 docParser.ts 原样迁出（move-only，符号名锚）：extractImages / extractPictures /
 * extractProperties / extractDop + 私有静态常量 MAX_IMAGES / MIN_IMAGE_SCAN_BYTES。
 *
 * 结构性适配（非逻辑改动）：原类方法经 AssetExtractionContext 显式注入原 this 依赖
 * （ole / maxScanBytes / readTableStream[必选，B 域已落地]）；DEF-004 的 scanLimitReached 实例标志不在本域
 * （属 extractParagraphsWithFormat），随类保留。
 * 纯度：禁 import vue/.vue、禁反向 import ../docParser（契约 §2.2 规则 2）。
 */
import { logger } from '../../logger'
import type { OleParser, DirectoryEntry } from '../../oleParser'
import type { FibData } from '../../fibParser'
import type { ChpxRun } from '../../formatParser'
import { extractImagesFromStream, imagesToDataUrls, bytesToBase64DataUrl } from '../../imageExtractor'
import type { ExtractedImage, ImageFormat, ImageWorkCache, ImageScanIndexView } from '../../imageExtractor'
import { extractPicturesFromDataStream, parsePicfAt } from '../../pictureParser'
import type { ParsedPicture } from '../../pictureParser'
import { parseSummaryInformation, parseDocumentSummaryInformation } from '../../propertyParser'
import type { DocumentProperties } from '../../propertyParser'
import { parseDop } from '../../dopParser'
import type { DopData } from '../../dopParser'

/** 原 DocParser.MAX_IMAGES（私有静态，随域迁出并转公开导出） */
export const MAX_IMAGES = 50
/** 新增常量（PERF-T2 扫描预算下限，非迁出符号——E-F1 更正） */
export const MIN_IMAGE_SCAN_BYTES = 1024 * 1024

/** 资产提取会话上下文：原类实例依赖的显式注入面 */
export interface AssetExtractionContext {
ole: OleParser
maxScanBytes: number
/** 表流读取（B 域 clxReader 迁移前由 docParser 类实现提供；仅 extractDop 需要） */
readTableStream(fib: FibData, directory: DirectoryEntry[]): Uint8Array | null
}

/**
 * 提取 `document.images`（data URL 列表）。
 *
 * `cache`（可选，Round 139）：按视图对象身份复用魔数扫描结果。`extractPictures`
 * 稍后会对**同一个** `wordDocData` 再扫一遍，共用同一缓存即可省掉那一次重复
 * 全流扫描（真实 27 份语料实测占全部扫描字节的 41.9%）。省略 `cache` 时与旧
 * 实现逐字节等价。等价性论证见 `imageExtractor.ImageWorkCache`。
 *
 * `index`（可选，Round 143）：Round 142 为 `wordDocData` 建的共享魔数扫描索引。
 * 当被扫窗口恰是那条流本身（`index.data === window`）时，图片扫描直接消费索引里的
 * 升序候选数组，省掉对同一条流的第二趟全缓冲扫描；窗口被 `scanBudget` 截断
 * （`subarray` 是新对象）或扫的是 `Data` 流时自动退回逐字节路径。等价性见
 * `imageExtractor.scanImagesFromStream`。
 */
export function extractImages(
  ctx: AssetExtractionContext,
  directory: DirectoryEntry[],
  wordDocData?: Uint8Array,
  cache?: ImageWorkCache,
  index?: ImageScanIndexView,
): string[] {
  try {
    const candidates: Uint8Array[] = []

    // Primary: the `Data` stream is where Word stores embedded pictures.
    const dataEntry = ctx.ole.findStreamByName(directory, 'Data')
    if (dataEntry) {
      const dataStream = ctx.ole.readStream(dataEntry)
      if (dataStream.data && dataStream.data.length > 0) {
        candidates.push(dataStream.data)
      }
    }

    // Secondary fallback: some producers embed images directly in the
    // WordDocument stream. We scan it too, then dedupe by byte content.
    if (wordDocData && wordDocData.length > 0) {
      candidates.push(wordDocData)
    }

    // PERF-T2：魔数全量扫描降级为「预算内兜底」——fcPic 结构化路径
    // （extractPictures/pictureParser）优先覆盖已知嵌入图；此处仅对剩余
    // 来源做有界扫描，预算与 DEF-004 的 maxScanBytes 护栏协同。
    const scanBudget = Math.max(ctx.maxScanBytes, MIN_IMAGE_SCAN_BYTES)
    const images: ExtractedImage[] = []
    for (const candidate of candidates) {
      const window = candidate.length > scanBudget ? candidate.subarray(0, scanBudget) : candidate
      if (window.length < candidate.length) {
        logger.warn(`图片魔数兜底扫描达预算 ${scanBudget} 字节上限，剩余 ${candidate.length - scanBudget} 字节未扫（PERF-T2 预算化）`)
      }
      const found = extractImagesFromStream(window, cache, index)
      for (const img of found) {
        if (images.length >= MAX_IMAGES) break
        images.push(img)
      }
      if (images.length >= MAX_IMAGES) break
    }

    if (images.length === 0) return []

    // Dedupe by size + first 16 bytes (cheap and effective for embedded
    // images that may appear in both Data and WordDocument streams).
    const seen = new Set<string>()
    const unique: ExtractedImage[] = []
    for (const img of images) {
      const head = Array.from(img.data.subarray(0, Math.min(16, img.data.length)))
        .join(',')
      const key = `${img.format}:${img.data.length}:${head}`
      if (seen.has(key)) continue
      seen.add(key)
      unique.push(img)
    }

    return imagesToDataUrls(unique, cache)
  } catch (err) {
    logger.warn('图片提取失败:', err instanceof Error ? err.message : String(err))
    return []
  }
}

/**
 * Extract embedded pictures with structured info (format, dimensions, etc.)
 *
 * Uses PICF envelope detection when possible, falling back to magic-number
 * scanning. Returns structured picture objects instead of plain data URLs.
 *
 * `cache`（可选，Round 139）：仅用于底层的魔数扫描去重，见 `extractImages`。
 *
 * `index`（可选，Round 143）：同 `extractImages` —— 只有当被扫流恰是建索引的那条
 * `wordDocData` 时才生效，`Data` 流路径自动退回逐字节扫描。
 */
export function extractPictures(
    ctx: AssetExtractionContext,
    directory: DirectoryEntry[],
    chpxRuns: ChpxRun[] = [],
    wordDocData?: Uint8Array,
    cache?: ImageWorkCache,
    index?: ImageScanIndexView,
  ): Array<{
    format: string
    dataUrl: string
    widthPx?: number
    heightPx?: number
    floating?: boolean
    cp?: number
  }> {
    try {
    const dataEntry = ctx.ole.findStreamByName(directory, 'Data')
    let dataStreamData: Uint8Array | null = null
    if (dataEntry) {
      const dataStream = ctx.ole.readStream(dataEntry)
      if (dataStream.data && dataStream.data.length >= 64) {
        dataStreamData = dataStream.data
      }
    }

    const pictures: ParsedPicture[] = []
    const seenFcPics = new Set<number>()
    const fcPicToCp = new Map<number, number>()

    // Primary: PICF-based extraction from Data stream
    if (dataStreamData) {
      for (const run of chpxRuns) {
        if (run.fcPic === undefined) continue
        if (!fcPicToCp.has(run.fcPic)) {
          fcPicToCp.set(run.fcPic, run.cpStart)
        }
        if (seenFcPics.has(run.fcPic)) continue
        seenFcPics.add(run.fcPic)
        const pic = parsePicfAt(dataStreamData, run.fcPic)
        if (pic) {
          pic.dataOffset = run.fcPic
          pictures.push(pic)
        }
      }

      if (pictures.length === 0) {
        const scanned = extractPicturesFromDataStream(dataStreamData, cache, index)
        pictures.push(...scanned.slice(0, MAX_IMAGES))
      }
    }

    // Fallback: scan WordDocument stream for images when Data stream
    // has no pictures (common for libwv/non-standard .doc files where
    // images are embedded directly in the document stream).
    if (pictures.length === 0 && wordDocData && wordDocData.length > 0) {
      const scanned = extractPicturesFromDataStream(wordDocData, cache, index)
      pictures.push(...scanned.slice(0, MAX_IMAGES))
      logger.info(`从 WordDocument 流扫描到 ${pictures.length} 个图片`)
    }

    if (pictures.length === 0) return []

    const result: Array<{
      format: string
      dataUrl: string
      widthPx?: number
      heightPx?: number
      floating?: boolean
      cp?: number
    }> = []

    for (const pic of pictures) {
      if (pic.format === 'unknown') continue
      if (result.length >= MAX_IMAGES) break

      // PERF-T2：复用 imageExtractor 的快速编码器（apply 分块直编，
      // 免逐字符拼接），兆级嵌入图编码耗时下降一个数量级。
      const dataUrl = bytesToBase64DataUrl(pic.data, pic.format as ImageFormat, cache)

      const item: {
        format: string
        dataUrl: string
        widthPx?: number
        heightPx?: number
        floating?: boolean
        cp?: number
      } = {
        format: pic.format,
        dataUrl,
      }
      if (pic.widthPx !== undefined) item.widthPx = pic.widthPx
      if (pic.heightPx !== undefined) item.heightPx = pic.heightPx
      if (pic.floating !== undefined) item.floating = pic.floating
      if (pic.dataOffset !== undefined && fcPicToCp.has(pic.dataOffset)) {
        item.cp = fcPicToCp.get(pic.dataOffset)
      }

      result.push(item)
    }

    return result
  } catch (err) {
    logger.warn('结构化图片提取失败:', err instanceof Error ? err.message : String(err))
    return []
  }
}

/**
 * Extract document properties from the SummaryInformation stream.
 *
 * Word documents store metadata (title, author, keywords, etc.) in the
 * SummaryInformation stream using the OLE Property Set format (MS-OLEPS).
 *
 * @param directory - Directory entries from the OLE container.
 * @returns Document properties, or null if not found/parse failed.
 */

export function extractProperties(ctx: AssetExtractionContext, directory: DirectoryEntry[]): DocumentProperties | null {
  try {
    // SummaryInformation stream name can be:
    // - "\005SummaryInformation" (most common, \005 is byte 5)
    // - "SummaryInformation" (less common)
    const summaryEntry = ctx.ole.findStreamByName(directory, '\x05SummaryInformation') ||
                         ctx.ole.findStreamByName(directory, 'SummaryInformation')

    let baseProps: DocumentProperties | null = null
    if (summaryEntry) {
      const summaryStream = ctx.ole.readStream(summaryEntry)
      if (summaryStream.data && summaryStream.data.length > 0) {
        baseProps = parseSummaryInformation(summaryStream.data)
      }
    }

    // DocumentSummaryInformation stream contains extended properties
    // (category, company, manager, etc.)
    const docSummaryEntry = ctx.ole.findStreamByName(directory, '\x05DocumentSummaryInformation') ||
                            ctx.ole.findStreamByName(directory, 'DocumentSummaryInformation')
    if (docSummaryEntry) {
      const docSummaryStream = ctx.ole.readStream(docSummaryEntry)
      if (docSummaryStream.data && docSummaryStream.data.length > 0) {
        const extProps = parseDocumentSummaryInformation(docSummaryStream.data)
        if (extProps) {
          baseProps = baseProps ? { ...baseProps, ...extProps } : extProps
        }
      }
    }

    return baseProps
  } catch (err) {
    logger.warn('属性提取失败:', err instanceof Error ? err.message : String(err))
    return null
  }
}

/**
 * Extract DOP (Document Properties) from the table stream.
 *
 * Per MS-DOC §2.5.6, the DOP sits at offset `fcDop` in the table stream
 * (0Table or 1Table selected by fWhichTblStm) with length `lcbDop`.
 * Returns null if FIB has no DOP offset or the data is invalid.
 */
export function extractDop(ctx: AssetExtractionContext, fib: FibData, directory: DirectoryEntry[]): DopData | null {
  if (fib.lcbDop <= 0 || fib.fcDop === 0) {
    return null
  }

  try {
    const tableData = ctx.readTableStream(fib, directory)
    if (!tableData) {
      logger.warn('DOP 提取：未找到表格流')
      return null
    }

    const end = fib.fcDop + fib.lcbDop
    if (end > tableData.length) {
      logger.warn(`DOP 越界 (fcDop=${fib.fcDop}, lcbDop=${fib.lcbDop}, tableLen=${tableData.length})`)
      return null
    }

    const dopBytes = tableData.subarray(fib.fcDop, end)
    return parseDop(dopBytes)
  } catch (err) {
    logger.warn('DOP 提取失败:', err instanceof Error ? err.message : String(err))
    return null
  }
}
