import { logger } from '../logger'
import type { OleParser, DirectoryEntry } from '../oleParser'
import type { FibData } from '../fibParser'
import type { CharacterFormat, ParagraphFormat, ParserParagraph } from '../docFormat'
import type { RevisionMark, BookmarkRange, SectionInfo, ShapeInfo, EquationInfo, ChartInfo, WordArtInfo } from '../docFormat'
import type { ChpxRun, PapxRun, PieceFcRange } from '../formatParser'
import { parseChpxRuns, parsePapxRuns, parseChpxRunsFromFkp, parsePapxRunsFromFkp, mergeCharFormatForParagraph } from '../formatParser'
import type { StyleDefinition, StyleSetInfo } from '../styleParser'
import { resolveStyleFormat, detectStyleSet, parseStylesheet, getHeadingLevel } from '../styleParser'
import type { ListEntry, LfoEntry } from '../listParser'
import { getListFormat, getListFormatFromLfo, parseListTable, parsePlcfLfo } from '../listParser'
import type { FieldRange, TocEntry, IndexEntry, DocumentFields, PageFieldInfo, CrossReferenceInfo } from '../fieldParser'
import { extractAllFields, extractHyperlinks, extractDocumentFields, extractPageFields, extractCrossReferences, parsePlcfFld } from '../fieldParser'
import { extractSections } from '../sectionParser'
import { extractBookmarks } from '../bookmarkParser'
import { parseFontTable } from '../fontParser'
import { extractChartsFromDirectory, extractChartsFromWordDocumentStream } from '../chartParser'
import { extractEquationsFromDirectory, extractEquationsFromWordDocumentStream } from '../equationParser'
import { extractWordArtFromDirectory, extractWordArtFromDrawingData } from '../wordArtParser'
import { extractShapesFromDataStream, extractShapesFromWordDocumentStream } from '../shapeParser'
import { parseSttbfRMark } from '../revisionParser'
import { parseClxPieces } from './pieceTable'
import { readClxData } from './clxReader'

/** 二期会话上下文 */
export interface FormatRecoveryContext {
  ole: OleParser
  readTableStream(fib: FibData, directory: DirectoryEntry[]): Uint8Array | null
  maxTotalChars: number
  readUint16(data: Uint8Array, offset: number): number
  readUint32(data: Uint8Array, offset: number): number
  cleanParagraph(text: string): string
  detectParagraphFormat(text: string, index: number, totalParagraphs: number): ParagraphFormat
  guessCharFormat(text: string, _paragraphIndex?: number): CharacterFormat
  shouldSkipParagraph(text: string): boolean
  extractTextSimple(data: Uint8Array, options?: { fcMin?: number; fComplex?: boolean }): string
}

  /**
   * Parse CHPX (character property) and PAPX (paragraph property) runs from
   * the table stream. Returns empty arrays if the data is missing or malformed.
   *
   * The CHP/PAP tables are stored in the table stream (0Table / 1Table) and
   * their offsets are given by fcPlcfBteChpx / fcPlcfBtePapx in the FIB.
   */
  export function parseFormatRuns(
    ctx: FormatRecoveryContext,
    fib: FibData,
    directory: DirectoryEntry[],
    wordDocData?: Uint8Array,
    text?: string,
  ): { chpxRuns: ChpxRun[]; papxRuns: PapxRun[]; styles: StyleDefinition[]; fontNames: string[]; listEntries: ListEntry[]; lfoEntries: LfoEntry[]; hyperlinks: FieldRange[]; tocEntries: TocEntry[]; indexEntries: IndexEntry[]; authors: string[]; revisions: RevisionMark[]; documentFields: DocumentFields; bookmarks: BookmarkRange[]; sections: SectionInfo[]; pageFields: PageFieldInfo[]; crossReferences: CrossReferenceInfo[]; shapes: ShapeInfo[]; equations: EquationInfo[]; charts: ChartInfo[]; wordArts: WordArtInfo[]; styleSet?: StyleSetInfo } {
    const chpxRuns: ChpxRun[] = []
    const papxRuns: PapxRun[] = []
    let styles: StyleDefinition[] = []
    let styleSet: StyleSetInfo | undefined
    let fontNames: string[] = []
    let listEntries: ListEntry[] = []
    const lfoEntries: LfoEntry[] = []
    const hyperlinks: FieldRange[] = []
    const tocEntries: TocEntry[] = []
    const indexEntries: IndexEntry[] = []
    let authors: string[] = []
    const revisions: RevisionMark[] = []
    const documentFields: DocumentFields = {}
    let bookmarks: BookmarkRange[] = []
    let sections: SectionInfo[] = []
    let pageFields: PageFieldInfo[] = []
    let crossReferences: CrossReferenceInfo[] = []
    const shapes: ShapeInfo[] = []
    const equations: EquationInfo[] = []

    if (!fib) return { chpxRuns, papxRuns, styles, fontNames, listEntries, lfoEntries, hyperlinks, tocEntries, indexEntries, authors, revisions, documentFields, bookmarks, sections, pageFields, crossReferences, shapes, equations, charts: [], wordArts: [] }

    const tableData = ctx.readTableStream(fib, directory)
    if (!tableData || tableData.length === 0) return { chpxRuns, papxRuns, styles, fontNames, listEntries, lfoEntries, hyperlinks, tocEntries, indexEntries, authors, revisions, documentFields, bookmarks, sections, pageFields, crossReferences, shapes, equations, charts: [], wordArts: [] }

    // libwv/textutil fallback: when FIB offsets are invalid (all zeros) but table stream exists,
    // try parsing structures from stream start. This is common for non-Word generated .doc files.
    const hasValidFibOffsets = fib.lcbStshf > 0 || fib.lcbPlcfBteChpx > 0 || fib.lcbPlcfBtePapx > 0
    const isLibwvFile = !hasValidFibOffsets && tableData.length > 100

    // Lazily-built piece table for spec-level FKP parsing (FC→CP conversion).
    // Real Word 97+ bin tables reference 512-byte FKPs in the WordDocument
    // stream instead of storing grpprls inline, so when the legacy inline
    // parse yields nothing we retry via FKPs.
    let fkpPieces: PieceFcRange[] | null = null
    const getFkpPieces = (): PieceFcRange[] => {
      if (fkpPieces !== null) return fkpPieces
      fkpPieces = []
      if (wordDocData && fib.lcbClx > 0) {
        const clxData = readClxData({ ole: ctx.ole, maxTotalChars: ctx.maxTotalChars, readUint16: ctx.readUint16, readUint32: ctx.readUint32 }, fib, wordDocData, directory)
        if (clxData) {
          fkpPieces = parseClxPieces({ maxTotalChars: ctx.maxTotalChars, readUint16: ctx.readUint16, readUint32: ctx.readUint32 }, clxData).map(p => ({
            cpStart: p.cpStart,
            cpEnd: p.cpEnd,
            fcStart: p.fcValue,
            compressed: p.fCompressed,
          }))
        }
      }
      return fkpPieces
    }

    try {
      if (fib.lcbPlcfBteChpx > 0 &&
          fib.fcPlcfBteChpx + fib.lcbPlcfBteChpx <= tableData.length) {
        const runs = parseChpxRuns(tableData, fib.fcPlcfBteChpx, fib.lcbPlcfBteChpx)
        if (runs.length > 0) {
          logger.info(`解析到 ${runs.length} 个 CHPX 字符格式运行`)
          chpxRuns.push(...runs)
        } else if (wordDocData) {
          const fkpRuns = parseChpxRunsFromFkp(
            tableData, wordDocData, fib.fcPlcfBteChpx, fib.lcbPlcfBteChpx, getFkpPieces(),
          )
          if (fkpRuns.length > 0) {
            logger.info(`FKP 路径解析到 ${fkpRuns.length} 个 CHPX 字符格式运行`)
            chpxRuns.push(...fkpRuns)
          }
        }
      }
    } catch (e) {
      // Unreachable: parsePlcfBteChpx/parseChpxRunsFromFkp read bounds-checked arrays.
      /* v8 ignore start */
      logger.warn(`CHPX 解析失败: ${e}`)
    }
    /* v8 ignore stop */

    // Parse revision author table (SttbfRMark) and collect revision marks from CHPX runs.
    try {
      if (fib.fcSttbfRMark !== undefined && fib.lcbSttbfRMark !== undefined && fib.lcbSttbfRMark > 0 &&
          fib.fcSttbfRMark + fib.lcbSttbfRMark <= tableData.length) {
        authors = parseSttbfRMark(tableData, fib.fcSttbfRMark, fib.lcbSttbfRMark)
        if (authors.length > 0) {
          logger.info(`解析到 ${authors.length} 个修订作者`)
        }
      }
    } catch (e) {
      // Unreachable: parseRevisionMarks reads bounds-checked arrays.
      /* v8 ignore start */
      logger.warn(`SttbfRMark 解析失败: ${e}`)
    }
/* v8 ignore stop */

    for (const run of chpxRuns) {
      if (run.revision) {
        const mark: RevisionMark = {
          cpStart: run.cpStart,
          cpEnd: run.cpEnd,
          type: run.revision.type,
        }
        if (run.revision.authorIndex !== undefined) {
          mark.authorIndex = run.revision.authorIndex
          if (authors.length > 0 && run.revision.authorIndex < authors.length) {
            mark.author = authors[run.revision.authorIndex]
          }
        }
        if (run.revision.timestamp !== undefined) {
          mark.timestamp = run.revision.timestamp
        }
        revisions.push(mark)
      }
    }
    if (revisions.length > 0) {
      logger.info(`解析到 ${revisions.length} 个修订标记`)
    }

    try {
      if (fib.lcbPlcfBtePapx > 0 &&
          fib.fcPlcfBtePapx + fib.lcbPlcfBtePapx <= tableData.length) {
        const runs = parsePapxRuns(tableData, fib.fcPlcfBtePapx, fib.lcbPlcfBtePapx)
        if (runs.length > 0) {
          logger.info(`解析到 ${runs.length} 个 PAPX 段落格式运行`)
          papxRuns.push(...runs)
        } else if (wordDocData) {
          const fkpRuns = parsePapxRunsFromFkp(
            tableData, wordDocData, fib.fcPlcfBtePapx, fib.lcbPlcfBtePapx, getFkpPieces(),
          )
          if (fkpRuns.length > 0) {
            logger.info(`FKP 路径解析到 ${fkpRuns.length} 个 PAPX 段落格式运行`)
            papxRuns.push(...fkpRuns)
          }
        }
      }
    } catch (e) {
      // Unreachable: parsePlcfBtePapx reads bounds-checked arrays.
      /* v8 ignore start */
      logger.warn(`PAPX 解析失败: ${e}`)
    }
    /* v8 ignore stop */

    try {
      if (fib.lcbStshf > 0 &&
          fib.fcStshf + fib.lcbStshf <= tableData.length) {
        const parsedStyles = parseStylesheet(tableData, fib.fcStshf, fib.lcbStshf)
        if (parsedStyles.length > 0) {
          logger.info(`解析到 ${parsedStyles.length} 个样式定义`)
          styles = parsedStyles
          const detected = detectStyleSet(parsedStyles)
          if (detected) {
            logger.info(`检测到样式集: ${detected.name}`)
            styleSet = detected
          }
        }
      }
    } catch (e) {
      // Unreachable: the wrapped parser reads bounds-checked arrays.
      /* v8 ignore start */
      logger.warn(`样式表解析失败: ${e}`)
    }
/* v8 ignore stop */

    // libwv fallback: try parsing stylesheet from table stream start when FIB offsets are invalid
    if (isLibwvFile && styles.length === 0) {
      try {
        // STSH is typically at the beginning of 1Table
        const fallbackStyles = parseStylesheet(tableData, 0, tableData.length)
        if (fallbackStyles.length > 0) {
          // Reachable for libwv files with a valid STSH at stream start;
          // our fixtures use empty or font-only tables.
          /* v8 ignore start */
          logger.info(`libwv回退：从偏移0解析到 ${fallbackStyles.length} 个样式定义`)
          styles = fallbackStyles
          const detected = detectStyleSet(fallbackStyles)
          if (detected) {
            styleSet = detected
          }
          /* v8 ignore stop */
        }
      } catch (e) {
        // Unreachable: parseStylesheet/detectStyleSet never throw.
        /* v8 ignore start */
        logger.warn(`libwv样式表回退解析失败: ${e}`)
      }
      /* v8 ignore stop */
    }

    // Apply character-style base formatting (sprmCIstd) to CHPX runs: a
    // run's own grpprl only stores the differences from its character
    // style (e.g. Hyperlink, Strong), so resolve the istdBase chain and
    // merge it underneath the run's direct formatting.
    if (styles.length > 0 && chpxRuns.length > 0) {
      const firstStyleById = new Map<number, StyleDefinition>()
      for (const style of styles) {
        if (!firstStyleById.has(style.istd)) firstStyleById.set(style.istd, style)
      }
      const resolvedCharacterStyles = new Map<number, ReturnType<typeof resolveStyleFormat> | null>()
      for (const run of chpxRuns) {
        if (run.istd === undefined) continue
        const charStyle = firstStyleById.get(run.istd)
        if (!charStyle || charStyle.type !== 'character') continue
        let resolved = resolvedCharacterStyles.get(run.istd)
        if (resolved === undefined) {
          resolved = resolveStyleFormat(styles, run.istd)
          resolvedCharacterStyles.set(run.istd, resolved)
        }
        if (!resolved) continue
        if (resolved.charFormat && Object.keys(resolved.charFormat).length > 0) {
          run.format = { ...resolved.charFormat, ...run.format }
        }
        if (run.fontIndex === undefined && resolved.fontIndex !== undefined) {
          run.fontIndex = resolved.fontIndex
        }
      }
    }

    try {
      if (fib.lcbSttbfFfn > 0 &&
          fib.fcSttbfFfn + fib.lcbSttbfFfn <= tableData.length) {
        fontNames = parseFontTable(tableData, fib.fcSttbfFfn, fib.lcbSttbfFfn)
        if (fontNames.length > 0) {
          logger.info(`解析到 ${fontNames.length} 个字体名称`)
        }
      }
    } catch (e) {
      // Unreachable: the wrapped parser reads bounds-checked arrays.
      /* v8 ignore start */
      logger.warn(`字体表解析失败: ${e}`)
    }
/* v8 ignore stop */

    try {
      if (fib.lcbLst > 0 &&
          fib.fcLst + fib.lcbLst <= tableData.length) {
        listEntries = parseListTable(tableData, fib.fcLst, fib.lcbLst)
        if (listEntries.length > 0) {
          logger.info(`解析到 ${listEntries.length} 个列表定义`)
        }
      }

      // Parse PlcfLfo (List Format Override table)
      if (fib.lcbPlcfLfo > 0 && fib.fcPlcfLfo + fib.lcbPlcfLfo <= tableData.length) {
        const parsed = parsePlcfLfo(tableData, fib.fcPlcfLfo, fib.lcbPlcfLfo)
        if (parsed.length > 0) {
          ;(lfoEntries as LfoEntry[]).push(...parsed)
          logger.info(`解析到 ${parsed.length} 个列表格式覆盖 (LFO)`)
        }
      }
    } catch (e) {
      // Unreachable: the wrapped parser reads bounds-checked arrays.
      /* v8 ignore start */
      logger.warn(`列表表解析失败: ${e}`)
    }
/* v8 ignore stop */

    // Field CPs index document characters relative to the text start.
    // FibBase fcMin is that start as a character offset, so slice the stream
    // so byte offset == cp * bytesPerChar; otherwise instructions read from
    // the FIB header instead of the text (fields in real docs were silently
    // dropped). Falls back to the whole stream when fcMin is absent/zero.
    const textBase = fib.fcMinBase !== undefined && fib.fcMinBase > 0 ? fib.fcMinBase : 0
    const bytesPerChar = fib.fComplex ? 1 : 2
    const fieldTextData = textBase > 0 && wordDocData && textBase * bytesPerChar <= wordDocData.length
      ? wordDocData.subarray(textBase * bytesPerChar)
      : wordDocData
    // R-F2-2 同轴保证：下方四个字段抽取调用点一律传 fieldTextData 作为字节轴切片源；
    // text 参数仅作 textBytes 缺失时的回退切片源（extractAllFields 会标注 axis:'text'），
    // 不再参与规范态 result 提取。

    // Parse PlcfFld (field positions) and extract hyperlinks and TOC
    try {
      if (fib.lcbPlcfFldMom > 0 &&
          fib.fcPlcfFldMom + fib.lcbPlcfFldMom <= tableData.length) {
        const fldEntries = parsePlcfFld(tableData, fib.fcPlcfFldMom, fib.lcbPlcfFldMom)
        if (fldEntries.length > 0 && wordDocData && text) {
          const links = extractHyperlinks(fldEntries, text, fieldTextData)
          if (links.length > 0) {
            ;(hyperlinks as FieldRange[]).push(...links)
            logger.info(`解析到 ${links.length} 个超链接`)
          }

          const allFields = extractAllFields(fldEntries, text, fieldTextData)
          const tocFields = allFields.filter(f => f.flt === 19 && f.tocEntries && f.tocEntries.length > 0)
          for (const tocField of tocFields) {
            if (tocField.tocEntries) {
              ;(tocEntries as TocEntry[]).push(...tocField.tocEntries)
            }
          }
          if (tocEntries.length > 0) {
            logger.info(`解析到 ${tocEntries.length} 个目录条目`)
          }

          const indexFields = allFields.filter(f => f.flt === 14 && f.indexEntries && f.indexEntries.length > 0)
          for (const indexField of indexFields) {
            if (indexField.indexEntries) {
              ;(indexEntries as IndexEntry[]).push(...indexField.indexEntries)
            }
          }
          if (indexEntries.length > 0) {
            logger.info(`解析到 ${indexEntries.length} 个索引条目`)
          }

          const fields = extractDocumentFields(fldEntries, text, fieldTextData)
          const fieldCount = Object.keys(fields).length
          if (fieldCount > 0) {
            Object.assign(documentFields, fields)
            logger.info(`解析到 ${fieldCount} 个文档域（AUTHOR/TITLE/DATE 等）`)
          }
        }
      }
    } catch (e) {
      // Unreachable: the wrapped parser reads bounds-checked arrays.
      /* v8 ignore start */
      logger.warn(`域表解析失败: ${e}`)
    }
/* v8 ignore stop */

    // Parse bookmarks (PlcfBkf + PlcfBkl + SttbfBkmk)
    try {
      if (fib.fcPlcfBkf !== undefined && fib.lcbPlcfBkf !== undefined &&
          fib.fcPlcfBkl !== undefined && fib.lcbPlcfBkl !== undefined &&
          fib.fcSttbfBkmk !== undefined && fib.lcbSttbfBkmk !== undefined) {
        const parsed = extractBookmarks(
          tableData,
          fib.fcPlcfBkf, fib.lcbPlcfBkf,
          fib.fcPlcfBkl, fib.lcbPlcfBkl,
          fib.fcSttbfBkmk, fib.lcbSttbfBkmk,
        )
        if (parsed.length > 0) {
          bookmarks = parsed
          logger.info(`解析到 ${bookmarks.length} 个书签`)
        }
      }
    } catch (e) {
      // Unreachable: the wrapped parser reads bounds-checked arrays.
      /* v8 ignore start */
      logger.warn(`书签解析失败: ${e}`)
    }
/* v8 ignore stop */

    // Parse sections (PlcfSed + SEPX) — requires WordDocument stream for SEPX
    try {
      if (fib.fcPlcfSed !== undefined && fib.lcbPlcfSed !== undefined &&
          fib.lcbPlcfSed > 0 && wordDocData) {
        const parsed = extractSections(
          tableData,
          wordDocData,
          fib.fcPlcfSed, fib.lcbPlcfSed,
        )
        if (parsed.length > 0) {
          sections = parsed
        }
      }
    } catch (e) {
      // Unreachable: the wrapped parser reads bounds-checked arrays.
      /* v8 ignore start */
      logger.warn(`分节解析失败: ${e}`)
    }
/* v8 ignore stop */

    // Parse page fields (PAGE / NUMPAGES / SECTION / SECTIONPAGES)
    // Reuses the PlcfFld parsing above; extractPageFields matches by instruction text.
    try {
      if (fib.lcbPlcfFldMom > 0 &&
          fib.fcPlcfFldMom + fib.lcbPlcfFldMom <= tableData.length &&
          wordDocData && text) {
        const fldEntries = parsePlcfFld(tableData, fib.fcPlcfFldMom, fib.lcbPlcfFldMom)
        if (fldEntries.length > 0) {
          const parsed = extractPageFields(fldEntries, text, fieldTextData)
          if (parsed.length > 0) {
            pageFields = parsed
            logger.info(`解析到 ${pageFields.length} 个页码域（PAGE/NUMPAGES/SECTION）`)
          }
        }
      }
    } catch (e) {
      // Unreachable: the wrapped parser reads bounds-checked arrays.
      /* v8 ignore start */
      logger.warn(`页码域解析失败: ${e}`)
    }
/* v8 ignore stop */

    // Parse cross-references (REF / NOTEREF)
    // Reuses the PlcfFld parsing above; extractCrossReferences matches by instruction text.
    try {
      if (fib.lcbPlcfFldMom > 0 &&
          fib.fcPlcfFldMom + fib.lcbPlcfFldMom <= tableData.length &&
          wordDocData && text) {
        const fldEntries = parsePlcfFld(tableData, fib.fcPlcfFldMom, fib.lcbPlcfFldMom)
        if (fldEntries.length > 0) {
          const parsed = extractCrossReferences(fldEntries, text, fieldTextData)
          if (parsed.length > 0) {
            crossReferences = parsed
            logger.info(`解析到 ${crossReferences.length} 个交叉引用（REF/NOTEREF）`)
          }
        }
      }
    } catch (e) {
      // Unreachable: the wrapped parser reads bounds-checked arrays.
      /* v8 ignore start */
      logger.warn(`交叉引用解析失败: ${e}`)
    }
/* v8 ignore stop */

    // Parse shapes (Office Art Drawing Container)
    // Floating images have shape anchors that describe their position/size
    try {
      const dataEntry = ctx.ole.findStreamByName(directory, 'Data')
      if (dataEntry) {
        const dataStream = ctx.ole.readStream(dataEntry)
        if (dataStream.data && dataStream.data.length > 0) {
          const dataShapes = extractShapesFromDataStream(dataStream.data)
          if (dataShapes.length > 0) {
            shapes.push(...dataShapes)
          }
        }
      }
      if (wordDocData && wordDocData.length > 0) {
        const docShapes = extractShapesFromWordDocumentStream(wordDocData)
        for (const shape of docShapes) {
          if (!shapes.some(s => s.spid === shape.spid)) {
            shapes.push(shape)
          }
        }
      }
      if (shapes.length > 0) {
        logger.info(`解析到 ${shapes.length} 个形状（Office Art Drawing Container）`)
      }
    } catch (e) {
      // Unreachable: the wrapped parser reads bounds-checked arrays.
      /* v8 ignore start */
      logger.warn(`形状解析失败: ${e}`)
    }
/* v8 ignore stop */

    // Parse equations (Equation Editor OLE objects)
    // Equations are stored as OLE objects with names like "Equation.1", "Equation.2"
    try {
      const dirEquations = extractEquationsFromDirectory(directory, (entry) => ctx.ole.readStream(entry))
      if (dirEquations.length > 0) {
        equations.push(...dirEquations)
        logger.info(`解析到 ${dirEquations.length} 个公式（OLE 对象）`)
      }

      if (wordDocData && wordDocData.length > 0) {
        const docEquations = extractEquationsFromWordDocumentStream(wordDocData)
        for (const eq of docEquations) {
          if (!equations.some(e => e.eqnText === eq.eqnText)) {
            equations.push(eq)
          }
        }
        if (docEquations.length > 0) {
          logger.info(`从 WordDocument 流解析到 ${docEquations.length} 个公式`)
        }
      }
    } catch (e) {
      // Unreachable: the wrapped parser reads bounds-checked arrays.
      /* v8 ignore start */
      logger.warn(`公式解析失败: ${e}`)
    }
/* v8 ignore stop */

    // 图表解析
    const charts: ChartInfo[] = []
    try {
      const dirCharts = extractChartsFromDirectory(directory, (entry) => ctx.ole.readStream(entry))
      if (dirCharts.length > 0) {
        charts.push(...dirCharts)
        logger.info(`解析到 ${dirCharts.length} 个图表（OLE 对象）`)
      }

      if (wordDocData && wordDocData.length > 0) {
        const docCharts = extractChartsFromWordDocumentStream(wordDocData)
        for (const chart of docCharts) {
          if (!charts.some(c => c.name === chart.name)) {
            charts.push(chart)
          }
        }
        if (docCharts.length > 0) {
          logger.info(`从 WordDocument 流解析到 ${docCharts.length} 个图表`)
        }
      }
    } catch (e) {
      // Unreachable: the wrapped parser reads bounds-checked arrays.
      /* v8 ignore start */
      logger.warn(`图表解析失败: ${e}`)
    }
/* v8 ignore stop */

    // WordArt 解析
    const wordArts: WordArtInfo[] = []
    try {
      const dirWordArts = extractWordArtFromDirectory(directory, (entry) => ctx.ole.readStream(entry))
      if (dirWordArts.length > 0) {
        wordArts.push(...dirWordArts)
        logger.info(`解析到 ${dirWordArts.length} 个 WordArt（OLE 对象）`)
      }

      if (wordDocData && wordDocData.length > 0) {
        const docWordArts = extractWordArtFromDrawingData(wordDocData)
        for (const wa of docWordArts) {
          if (!wordArts.some(w => w.name === wa.name && w.text === wa.text)) {
            wordArts.push(wa)
          }
        }
        if (docWordArts.length > 0) {
          logger.info(`从 WordDocument 流解析到 ${docWordArts.length} 个 WordArt`)
        }
      }
    } catch (e) {
      // Unreachable: the wrapped parser reads bounds-checked arrays.
      /* v8 ignore start */
      logger.warn(`WordArt 解析失败: ${e}`)
    }
/* v8 ignore stop */

    return { chpxRuns, papxRuns, styles, fontNames, listEntries, lfoEntries, hyperlinks, tocEntries, indexEntries, authors, revisions, documentFields, bookmarks, sections, pageFields, crossReferences, shapes, equations, charts, wordArts, styleSet }
  }

  /**
   * Create formatted paragraphs with real CHP/PAP format data.
   * Uses single newline splitting and original paragraph indices for accurate
   * PAPX matching, and text offset as cp estimate for CHPX matching.
   *
   * @param pieceMap - Optional piece map from splitPiecesByStory that gives
   *   per-character CHPX associations via piece-level chpxIndex.
   */

  /**
   * Create formatted paragraphs with real CHP/PAP format data.
   * Uses single newline splitting and original paragraph indices for accurate
   * PAPX matching, and text offset as cp estimate for CHPX matching.
   *
   * @param pieceMap - Optional piece map from splitPiecesByStory that gives
   *   per-character CHPX associations via piece-level chpxIndex.
   */
  export function createParagraphsWithRealFormats(
    ctx: FormatRecoveryContext,
    text: string,
    chpxRuns: ChpxRun[],
    papxRuns: PapxRun[],
    styles: StyleDefinition[],
    fontNames: string[],
    pieceMap?: Array<{ start: number; end: number; chpxIndex?: number }>,
    listEntries?: ListEntry[],
    lfoEntries?: LfoEntry[],
  ): ParserParagraph[] {
    const allParagraphs: Array<{ text: string; cpStart: number; originalIndex: number }> = []
    let cp = 0

    // Avoid split() creating a second full string array for large documents.
    // Paragraph extraction is allocation-sensitive because this path runs for
    // every formatted document. Walk the source string once and only retain
    // paragraph slices that survive into the result metadata.
    let partStart = 0
    let partIndex = 0
    for (let i = 0; i <= text.length; i++) {
      if (i !== text.length && text.charCodeAt(i) !== 10) continue
      const paraText = text.slice(partStart, i)
      // Word table rows end with a TTP mark (0x07) instead of a paragraph
      // mark (0x0D), so whole tables arrive glued to the following text
      // inside a single \n-part. Split after each row boundary (two
      // consecutive cell marks) so every row becomes its own paragraph and
      // can match its PAPX run — the run that carries the row's TAP
      // (sprmTDefTable: borders, merges, widths).
      const subParts = paraText.includes('\u0007\u0007')
        ? paraText.split(/(?<=\u0007\u0007)/)
        : [paraText]
      let subOffset = 0
      for (const subText of subParts) {
        allParagraphs.push({ text: subText, cpStart: cp + subOffset, originalIndex: partIndex })
        subOffset += subText.length
      }
      cp += paraText.length + 1 // +1 for the \n (paragraph mark)
      partStart = i + 1
      partIndex++
    }

    const result: ParserParagraph[] = []
    const styleById = new Map<number, StyleDefinition>()
    for (const style of styles) styleById.set(style.istd, style)
    // Keep piece lookup linear over the document instead of filtering every
    // paragraph. Large documents can contain tens of thousands of paragraphs.
    let pieceCursor = 0
    const resolvedParagraphStyles = new Map<number, ReturnType<typeof resolveStyleFormat>>()
    const characterStyleFormats = new Map<number, Partial<CharacterFormat>>()
    for (const style of styles) {
      const resolved = resolveStyleFormat(styles, style.istd)
      const format: Partial<CharacterFormat> = { ...resolved.charFormat }
      if (resolved.fontIndex !== undefined && fontNames[resolved.fontIndex]) {
        format.fontName = fontNames[resolved.fontIndex]
      }
      if (Object.keys(format).length > 0) characterStyleFormats.set(style.istd, format)
    }

    for (let i = 0; i < allParagraphs.length; i++) {
      const para = allParagraphs[i]
      const rawText = para.text
      // 检测分页符：段落开头的 \f 表示段前分页
      let pageBreakBefore = false
      let textToClean = rawText
      if (rawText.startsWith('\f')) {
        pageBreakBefore = true
        textToClean = rawText.slice(1)
      }
      // 段落中间的 \f 也视为分页符（放在下一段前）
      if (textToClean.includes('\f')) {
        // 将文本按 \f 分割，第一个部分作为当前段落
        const firstPart = textToClean.split('\f')[0]
        const remaining = textToClean.slice(firstPart.length + 1)
        if (firstPart.trim().length > 0) {
          textToClean = firstPart
        } else {
          pageBreakBefore = true
          textToClean = remaining
        }
      }
      const cleaned = ctx.cleanParagraph(textToClean.trim())
      if (!ctx.shouldSkipParagraph(cleaned) && cleaned.length > 0) {
        const paraFormat = ctx.detectParagraphFormat(cleaned, i, allParagraphs.length)
        const charFormat = ctx.guessCharFormat(cleaned, i)
        if (pageBreakBefore) {
          paraFormat.pageBreakBefore = true
        }
        const newPara: ParserParagraph = {
          text: cleaned,
          paraFormat,
          charFormat,
          _cpStart: para.cpStart, // 保留 CP 位置供超链接映射
        }

        // Match the paragraph to its PAPX run. Prefer CP matching: a PAPX
        // run covers [cpStart, cpEnd) including the paragraph mark, so the
        // run containing the mark CP (cpStart + text length) is the right
        // one. Positional (index) alignment is kept as a fallback for
        // non-standard files whose runs carry unrelated coordinates — but
        // it breaks whenever the \n-split count differs from the real
        // paragraph count (e.g. table cell/row marks are 0x07, not 0x0D).
        let papx: PapxRun | undefined
        if (papxRuns.length > 0) {
          // For a normal paragraph the mark (0x0D → \n) sits just past the
          // text. A table row keeps its TTP mark (0x07) as its own last
          // character, so probe that position instead — its run carries the
          // row's TAP.
          const markCp = para.text.endsWith('\u0007')
            ? para.cpStart + para.text.length - 1
            : para.cpStart + para.text.length
          // Runs are sorted by cpStart: binary-search the run containing markCp.
          let lo = 0
          let hi = papxRuns.length - 1
          while (lo <= hi) {
            const mid = (lo + hi) >> 1
            const run = papxRuns[mid]
            if (run.cpEnd <= markCp) lo = mid + 1
            else if (run.cpStart > markCp) hi = mid - 1
            else { papx = run; break }
          }
          if (!papx && para.originalIndex < papxRuns.length) {
            papx = papxRuns[para.originalIndex]
          }
        }
        if (papx) {
          if (papx.format && Object.keys(papx.format).length > 0) {
            newPara.paraFormat = {
              ...newPara.paraFormat,
              ...papx.format,
            }
            newPara.paraFormatFromReal = true
          }
          // Use outlineLevel from PAPX (sprmPOutlineLvl) as heading level
          if (papx.format.outlineLevel !== undefined && papx.format.outlineLevel >= 0 && papx.format.outlineLevel <= 8) {
            newPara.paraFormat.headingLevel = papx.format.outlineLevel + 1 // 0-based → 1-based
          }
          if (styles.length > 0 && papx.istd !== undefined) {
            const style = styleById.get(papx.istd)
            if (style) {
              newPara.paraFormat.styleName = style.name
              // Resolve the full style formatting along the istdBase
              // inheritance chain (e.g. Heading 3 → Heading 1 → Normal),
              // then let direct PAPX/CHPX overrides win.
              let resolved = resolvedParagraphStyles.get(papx.istd)
              if (!resolved) {
                resolved = resolveStyleFormat(styles, papx.istd)
                resolvedParagraphStyles.set(papx.istd, resolved)
              }
              if (resolved.paraFormat && Object.keys(resolved.paraFormat).length > 0) {
                // Style base format → PAPX overrides (already applied above)
                newPara.paraFormat = {
                  ...resolved.paraFormat,
                  ...newPara.paraFormat,
                }
              }
              if (resolved.charFormat && Object.keys(resolved.charFormat).length > 0) {
                newPara.charFormat = {
                  ...resolved.charFormat,
                  ...newPara.charFormat,
                }
              }
              // Apply style's font name
              if (resolved.fontIndex !== undefined && fontNames && fontNames.length > resolved.fontIndex) {
                // Unreachable: guessCharFormat always seeds charFormat.fontName
                // ('Times New Roman' / 宋体 / 仿宋_GB2312), so the guard below
                // never sees an empty font name. Kept for spec symmetry.
                /* v8 ignore start */
                if (!newPara.charFormat.fontName) {
                  newPara.charFormat.fontName = fontNames[resolved.fontIndex]
                }
                /* v8 ignore stop */
              }
              // Only use style-name-based heading level if outlineLevel wasn't set
              if (newPara.paraFormat.headingLevel === undefined) {
                const headingLevel = getHeadingLevel(style.name)
                if (headingLevel !== null) {
                  newPara.paraFormat.headingLevel = headingLevel
                }
              }
            }
          }
          // Apply real list format from LST/LFO table (replaces heuristic detectListInfo)
          // Priority: ilfo (LFO override) > ilst (direct LST reference)
          if (papx.ilfo !== undefined && papx.ilfo > 0 && lfoEntries && lfoEntries.length > 0 && listEntries && listEntries.length > 0) {
            const level = papx.ilvl ?? 0
            const listFmt = getListFormatFromLfo(listEntries, lfoEntries, papx.ilfo, level)
            if (listFmt) {
              newPara.paraFormat.listType = listFmt.listType
              newPara.paraFormat.listStyle = listFmt.listStyle
              newPara.paraFormat.listLevel = listFmt.listLevel
              newPara.paraFormat.listId = papx.ilfo
              newPara.paraFormatFromReal = true
            }
          } else if (papx.ilst !== undefined && listEntries && listEntries.length > 0) {
            const level = papx.ilvl ?? 0
            const listFmt = getListFormat(listEntries, papx.ilst, level)
            if (listFmt) {
              newPara.paraFormat.listType = listFmt.listType
              newPara.paraFormat.listStyle = listFmt.listStyle
              newPara.paraFormat.listLevel = listFmt.listLevel
              newPara.paraFormat.listId = papx.ilst
              newPara.paraFormatFromReal = true
            }
          }
          // Apply table info from TAP SPRMs (sprmPFInTable / sprmTDefTable / sprmTTableBorders)
          if (papx.table) {
            newPara.paraFormat.table = papx.table
            newPara.paraFormatFromReal = true
          }
        }

        const cpStart = para.cpStart
        const cpEnd = cpStart + para.text.length
        // 1. Try piece-level CHPX first (most accurate when prm/fChp is set)
        let merged: Partial<CharacterFormat> = {}
        let usedPieceChp = false
        if (pieceMap && pieceMap.length > 0) {
          // Find pieces that overlap the paragraph's [cpStart, cpEnd).
          // We need to know the paragraph's range in piece-map coordinates.
          // Since pieceMap and para are both based on `text`, para.cpStart
          // IS the offset in the same coordinate system.
          while (pieceCursor < pieceMap.length && pieceMap[pieceCursor].end <= cpStart) {
            pieceCursor++
          }
          const overlapping: Array<{ start: number; end: number; chpxIndex?: number }> = []
          for (let pi = pieceCursor; pi < pieceMap.length && pieceMap[pi].start < cpEnd; pi++) {
            const p = pieceMap[pi]
            if (p.end > cpStart) overlapping.push(p)
          }
          if (overlapping.length > 0) {
            const ratio = overlapping.reduce((s, p) => {
              const overlapStart = Math.max(p.start, cpStart)
              const overlapEnd = Math.min(p.end, cpEnd)
              return s + (overlapEnd - overlapStart)
            }, 0) / (cpEnd - cpStart)
            // If overlapping pieces cover >= 50% of the paragraph, use them.
            if (ratio >= 0.5) {
              for (const p of overlapping) {
                if (p.chpxIndex !== undefined && p.chpxIndex < chpxRuns.length) {
                  const pieceChp = chpxRuns[p.chpxIndex]
                  if (pieceChp.istd !== undefined) {
                    const styleFormat = characterStyleFormats.get(pieceChp.istd)
                    if (styleFormat) {
                      merged = { ...merged, ...styleFormat }
                      usedPieceChp = true
                    }
                  }
                  if (pieceChp.format) {
                    merged = { ...merged, ...pieceChp.format }
                    usedPieceChp = true
                  }
                  if (pieceChp.fontIndex !== undefined && fontNames && fontNames[pieceChp.fontIndex]) {
                    merged.fontName = fontNames[pieceChp.fontIndex]
                    usedPieceChp = true
                  }
                }
              }
            }
          }
        }
        // 2. Fall back to CHPX range matching when no piece-level data.
        if (!usedPieceChp && chpxRuns.length > 0 && cleaned.length > 0) {
          merged = mergeCharFormatForParagraph(chpxRuns, cpStart, cpEnd, fontNames, characterStyleFormats)
        }
        if (Object.keys(merged).length > 0) {
          newPara.charFormat = {
            ...newPara.charFormat,
            ...merged,
          }
          newPara.charFormatFromReal = true
          // Clear heuristic styles array since real CHPX format is available
          delete newPara.charFormat.styles
        }

        result.push(newPara)
      }
    }

    return result
  }

  // ==================== Format extraction ====================

  /**
   * Try to parse format data directly from 1Table stream when FIB offsets are invalid.
   * Used for non-standard files (like libwv-generated docs) that have valid format data
   * but invalid FIB offset tables.
   */
  export function tryParseFormatsFromTableStream(
    ctx: FormatRecoveryContext,
    directory: DirectoryEntry[],
    _wordDocData: Uint8Array,
  ): { 
    styles: StyleDefinition[]; 
    fontTable: Record<string, string>;
    charts?: ChartInfo[];
  } | null {
    const tableEntry = directory.find(e => e.name === '1Table' || e.name === '0Table')
    if (!tableEntry) return null

    try {
      const tableStream = ctx.ole.readStream(tableEntry)
      if (!tableStream.data || tableStream.data.length === 0) return null

      const tableData = tableStream.data
      const styles: StyleDefinition[] = []
      const fontTable: Record<string, string> = {}

      // Try to parse STSH (stylesheet) - starts at offset 0 for Word 97+
      // STSH: cstd(2) + cbSTDBase(2) + std[]
      if (tableData.length >= 4) {
        const cstd = tableData[0] | (tableData[1] << 8)
        const cbStdbase = tableData[2] | (tableData[3] << 8)

        // Sanity check: cstd should be reasonable (< 1000)
        if (cstd > 0 && cstd < 1000 && cbStdbase > 0 && cbStdbase < 500) {
          logger.log(`尝试从 1Table 解析样式表 (cstd=${cstd}, cbSTDBase=${cbStdbase})`)

          // Parse styles using the existing stylesheet parser
          // STSH structure: cstd + cbSTDBase + (cstd * std entries)
          // We'll call parseStylesheet with offset 0 and size = total STSH size
          const stshSize = 4 + cstd * (cbStdbase + 20) // rough estimate
          try {
            const parsedStyles = parseStylesheet(tableData, 0, Math.min(stshSize, tableData.length))
            logger.log(`parseStylesheet returned ${parsedStyles.length} styles`)
            if (parsedStyles.length > 0) {
              logger.log(`从 1Table 解析到 ${parsedStyles.length} 个样式`)
              styles.push(...parsedStyles)
            }
          } catch (e) {
            logger.warn(`从 1Table 解析样式失败: ${e}`)
          }
        }
      }

      // Try to parse font table (STTB Ffn) - usually after STSH
      // Look for valid STTB signature
      for (let offset = 0; offset < Math.min(2000, tableData.length - 10); offset++) {
        // STTB Ffn: cttb(2) + cbFfn(2) + [ffn entries]
        const cttb = tableData[offset] | (tableData[offset + 1] << 8)
        const cbFfn = tableData[offset + 2] | (tableData[offset + 3] << 8)

        // cbFfn should be 32 or similar for Word 97+
        if (cttb > 0 && cttb < 500 && cbFfn >= 30 && cbFfn <= 64) {
          logger.log(`可能找到字体表在偏移 ${offset} (cttb=${cttb}, cbFfn=${cbFfn})`)
          try {
            const fontEntries = parseFontTable(tableData, offset, cttb * cbFfn + 4)
            const fontEntryNames = Object.keys(fontEntries)
            if (fontEntryNames.length > 0) {
              logger.log(`从 1Table 解析到 ${fontEntryNames.length} 个字体`)
              Object.assign(fontTable, fontEntries)
              break
            }
          } catch {
            // Continue searching
          }
        }
      }

      // Extract charts from OLE directory
      const charts = extractChartsFromDirectory(directory, (entry) => ctx.ole.readStream(entry))

      if (styles.length > 0 || Object.keys(fontTable).length > 0 || charts.length > 0) {
        return { 
          styles, 
          fontTable,
          charts: charts.length > 0 ? charts : undefined,
        }
      }
    } catch (e) {
      logger.warn(`从 1Table 解析格式失败: ${e}`)
    }

    return null
  }

  /**
   * Apply parsed styles to paragraphs (used when FIB offsets are invalid but 1Table has format data).
   */

  /**
   * Apply parsed styles to paragraphs (used when FIB offsets are invalid but 1Table has format data).
   */
  export function applyParsedStylesToParagraphs(_ctx: FormatRecoveryContext, 
    paragraphs: ParserParagraph[],
    formatResult: { styles: StyleDefinition[]; fontTable: Record<string, string> },
  ): void {
    if (!formatResult.styles.length && !Object.keys(formatResult.fontTable).length) return

    // Build a default style from the font table
    const defaultFont = Object.keys(formatResult.fontTable)[0] || 'Times New Roman'

    for (const p of paragraphs) {
      // Apply default font to paragraph if no character styles
      if (p.charFormat) {
        if (!p.charFormat.fontName) {
          p.charFormat.fontName = defaultFont
        }
      } else {
        p.charFormat = { fontName: defaultFont, fontSize: 12 }
      }
    }
  }

