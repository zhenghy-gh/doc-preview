/**
 * 渲染管线黄金快照夹具构造器（TG-1 · vue-dev-4 · 2026-08-25）
 *
 * 为 tests/renderGolden.test.ts 构造确定性的合成 .doc 二进制。
 * 文件名下划线前缀 → vitest 不将其作为测试执行（与 tests/_probe75.test.ts 同一豁免约定）。
 *
 * 字节布局全部移植自现有已验证的构造器，不引入新布局假设：
 *   - OLE 骨架 / FIB 链式偏移(csw=0,cslw=22)      ← tests/docParser.test.ts buildOleWithTableStream
 *   - FibRgFcLcb 对索引 12/13/33/51/73/74          ← buildOleWithFields / real list format from LFO
 *   - CHPX/PAPX 记录布局（cb 含自身 2 字节）        ← tests/formatParser.test.ts buildPlcfBteChpx/Papx
 *   - TAP sprm（0xD608 TC80 / 0xD605 BRC80）       ← tests/tapParser.test.ts buildPlcfBtePapxWithTable
 *   - LST/LVLF/PlcfLfo 简单列表                    ← docParser.test.ts 'real list format from LFO'
 *   - SttbfRMark 布局（cbSttb=作者数, cbString=字符数）← src/utils/revisionParser.ts parseSttbfRMark
 *   - 修订 sprm 操作码                             ← src/utils/formatParser.ts 常量定义
 */

const SECTOR = 512
const END = 0xFFFFFFFE
const FREE = 0xFFFFFFFF

/** WordDocument 流：sector 2..5（链 2→3→4→5），流内偏移 0..2047 */
const WD_PHYS = SECTOR * 3
const WD_SIZE = SECTOR * 4
/** 0Table 流：sector 6..7（链 6→7），流内偏移 0..1023 */
const TBL_PHYS = SECTOR * 7
const TBL_SIZE = SECTOR * 2
/** 主文本在 WordDocument 流内的偏移（rgFcLcb blob 结束于 126+75*8=726，取 1024 对齐） */
const TEXT_OFFSET = 1024
/** cbRgFcLcb 对数：须覆盖用到的最大 pair 索引 74 (PlcfLfo) */
const CB_RG_FC_LCB = 75

// 0Table 流内各结构偏移
const OFF_CLX = 0
const OFF_CHPX_BIN = 64
const OFF_PAPX_BIN = 192
const OFF_RMARK = 320
const OFF_LST = 400
/** PlcfFldMom：位于 LST(≤2 组×70)+LFO 之后的安全空档（单列表时 LFO 止于 ~490） */
const OFF_FLD = 600
/** Data 流（sector 8）内 PICF 包络偏移 */
export const PICF_OFFSET = 128

export interface ChpxSpec {
  /** 字符位置（UTF-16 code unit 下标，与 JS 字符串索引一致） */
  cpStart: number
  bold?: boolean
  italic?: boolean
  underline?: boolean
  /** 字号（磅） */
  fontSizePt?: number
  /** SttbfFfn 字体表索引（本构造器不写字体表，仅占位解码路径） */
  fontIndex?: number
  istd?: number
  /** sprmCFSpec（0x0855）：特殊字符标记（图片锚点伴随位） */
  isSpecial?: boolean
  /** sprmCPicLocation（0x6A03）：Data 流内 PICF 包络偏移（图片内联路径） */
  picLocation?: number
  /** 修订插入标记（sprmCFRMark 0x0801 + sprmCIbstRMark 0x4804 + sprmCDttmRMark 0x6805） */
  insertMark?: { authorIndex: number; dttm: number }
  /** 修订删除标记（sprmCFRMarkDel 0x0800 + sprmCIbstRMarkDel 0x4863 + sprmCDttmRMarkDel 0x6864） */
  deleteMark?: { authorIndex: number; dttm: number }
}

export interface BorderSpec {
  colorIndex?: number
  lineWidth?: number
  borderType?: number
}

export interface PapxSpec {
  cpStart: number
  alignment?: 'left' | 'center' | 'right' | 'justify'
  indentPt?: number
  /** 大纲级别 0-8（sprmPOutlineLvl 0x2640） */
  outlineLevel?: number
  /** 列表级别（sprmPIlvl 0x260A） */
  ilvl?: number
  /** 传统列表索引（sprmPIlstLegacy 0x460E，配 LST 使用） */
  ilstLegacy?: number
  /** 列表覆盖索引（sprmPIlvl 之外的 ilfo 路径 0x460B，配 PlcfLfo 使用） */
  ilfo?: number
  inTable?: boolean
  tableDepth?: number
  /** sprmTDefTable 0xD608 的 rgtc[] */
  cells?: Array<{ verticalMerge: 'none' | 'restart' | 'continue' }>
  /** sprmTTableBorders 0xD605 */
  borders?: Partial<Record<'top' | 'left' | 'bottom' | 'right' | 'insideH' | 'insideV', BorderSpec>>
}

export interface ListTableSpec {
  lsid: number
  iStartAt: number
  /** number format：0=decimal, 23=bullet 等 */
  nfc: number
}

export interface GoldenDocSpec {
  /** 主文本全文：\r 分段；表格单元格/行以 \u0007 结尾；域字符 \u0013/\u0014/\u0015 直接写入文本 */
  text: string
  charRuns?: ChpxSpec[]
  paraRuns?: PapxSpec[]
  lists?: ListTableSpec[]
  /** PlcfFldMom（pair 16）：域字符表，cps 长度 = 条目数 + 1（末项为结束 CP） */
  plcfFld?: Array<{ cp: number; ch: number; flt: number }>
  /** SttbfRMark 作者表（有修订时必须提供） */
  revisionAuthors?: string[]
  /** 在 OLE 目录中追加 MSGraph.Chart.8 存储（触发图表识别） */
  withChartStorage?: boolean
  /** 追加 Data 流（sector 8）并在偏移 128 写入 PICF 包络（最小 PNG，2×3px）——图片提取回退路径 */
  withDataPicture?: boolean
}

/** 校验 cp 序列严格递增且落在文本范围内（parseChpx/parsePapxRuns 的前置条件） */
function assertAscendingCps(specs: Array<{ cpStart: number }>, textLen: number): void {
  let prev = -1
  for (const s of specs) {
    if (s.cpStart <= prev || s.cpStart >= textLen) {
      throw new Error(`cpStart 必须严格递增且小于文本长度(${textLen})：${prev} -> ${s.cpStart}`)
    }
    prev = s.cpStart
  }
}

/** CHPX 记录的 grpprl 字节序列 */
function chpxGrpprl(e: ChpxSpec): number[] {
  const p: number[] = []
  if (e.bold !== undefined) p.push(0x35, 0x08, e.bold ? 1 : 0)
  if (e.italic !== undefined) p.push(0x36, 0x08, e.italic ? 1 : 0)
  if (e.underline !== undefined) p.push(0x3E, 0x2A, e.underline ? 1 : 0)
  if (e.fontSizePt !== undefined) {
    const hps = Math.round(e.fontSizePt * 2)
    p.push(0x43, 0x4A, hps & 0xFF, (hps >> 8) & 0xFF)
  }
  if (e.fontIndex !== undefined) p.push(0x4F, 0x4A, e.fontIndex & 0xFF, (e.fontIndex >> 8) & 0xFF)
  if (e.istd !== undefined) p.push(0x30, 0x4A, e.istd & 0xFF, (e.istd >> 8) & 0xFF)
  if (e.isSpecial) p.push(0x55, 0x08, 0x01)
  if (e.picLocation !== undefined) {
    const fc = e.picLocation
    p.push(0x03, 0x6A, fc & 0xFF, (fc >> 8) & 0xFF, (fc >> 16) & 0xFF, (fc >> 24) & 0xFF)
  }
  if (e.insertMark) {
    const { authorIndex, dttm } = e.insertMark
    p.push(0x01, 0x08, 0x01)
    p.push(0x04, 0x48, authorIndex & 0xFF, (authorIndex >> 8) & 0xFF)
    p.push(0x05, 0x68, dttm & 0xFF, (dttm >> 8) & 0xFF, (dttm >> 16) & 0xFF, (dttm >> 24) & 0xFF)
  }
  if (e.deleteMark) {
    const { authorIndex, dttm } = e.deleteMark
    p.push(0x00, 0x08, 0x01)
    p.push(0x63, 0x48, authorIndex & 0xFF, (authorIndex >> 8) & 0xFF)
    p.push(0x64, 0x68, dttm & 0xFF, (dttm >> 8) & 0xFF, (dttm >> 16) & 0xFF, (dttm >> 24) & 0xFF)
  }
  return p
}

/** PAPX 记录的 grpprl 字节序列（顺序沿用 tapParser/formatParser 先例） */
function papxGrpprl(e: PapxSpec): number[] {
  const p: number[] = []
  if (e.ilvl !== undefined) p.push(0x0A, 0x26, e.ilvl)
  if (e.alignment !== undefined) {
    const jc = e.alignment === 'left' ? 0 : e.alignment === 'center' ? 1 : e.alignment === 'right' ? 2 : 3
    p.push(0x03, 0x24, jc)
  }
  if (e.indentPt !== undefined) {
    const twips = Math.round(e.indentPt * 20)
    p.push(0x0F, 0x84, twips & 0xFF, (twips >> 8) & 0xFF)
  }
  if (e.outlineLevel !== undefined) p.push(0x40, 0x26, e.outlineLevel)
  if (e.ilstLegacy !== undefined) p.push(0x0E, 0x46, e.ilstLegacy & 0xFF, (e.ilstLegacy >> 8) & 0xFF)
  if (e.ilfo !== undefined) p.push(0x0B, 0x46, e.ilfo & 0xFF, (e.ilfo >> 8) & 0xFF)
  if (e.inTable) p.push(0x16, 0x24, 0x01)
  if (e.tableDepth !== undefined) p.push(0x10, 0x44, e.tableDepth & 0xFF)
  if (e.cells && e.cells.length > 0) {
    const n = e.cells.length
    const rgdxaSize = (n + 1) * 2
    const payloadSize = 1 + rgdxaSize + n * 20
    const cb16 = payloadSize + 1
    p.push(0x08, 0xD6, cb16 & 0xFF, (cb16 >> 8) & 0xFF)
    p.push(n)
    for (let i = 0; i <= n; i++) p.push((i * 1000) & 0xFF, ((i * 1000) >> 8) & 0xFF)
    for (const cell of e.cells) {
      const grfTc = cell.verticalMerge === 'none' ? 0x00 : cell.verticalMerge === 'continue' ? 0x20 : 0x60
      p.push(grfTc, 0x00, 0x00, 0x00)
      for (let j = 0; j < 16; j++) p.push(0x00)
    }
  }
  if (e.borders) {
    const order = ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'] as const
    p.push(0x05, 0xD6, 24)
    for (const key of order) {
      const b = e.borders[key]
      if (!b) {
        p.push(0, 0, 0, 0)
      } else {
        p.push((b.lineWidth ?? 0) & 0xFF, (b.borderType ?? 0) & 0xFF, (b.colorIndex ?? 0) & 0xFF, 0x00)
      }
    }
  }
  return p
}

/**
 * 构造 aCP + 变长记录 的 PLCF-BTE 直排区域（解析器约定：记录紧跟 CP 数组）。
 * - CHPX 记录：u16 cb（含自身 2 字节）+ grpprl；
 * - PAPX 记录：u16 cbOffset（含自身 4 字节）+ u16 istd + grpprl
 *   （parsePapxRuns 契约："each starting with cbOffset (2 bytes) + istd (2 bytes)"）。
 */
function buildBinTable(
  entries: Array<{ cpStart: number; grpprl: number[]; istd?: number }>,
  textLen: number,
): Uint8Array {
  const n = entries.length
  const parts: Uint8Array[] = []
  for (const e of entries) {
    if (e.istd !== undefined) {
      const total = 4 + e.grpprl.length
      const rec = new Uint8Array(total)
      rec[0] = total & 0xFF
      rec[1] = (total >> 8) & 0xFF
      rec[2] = e.istd & 0xFF
      rec[3] = (e.istd >> 8) & 0xFF
      rec.set(e.grpprl, 4)
      parts.push(rec)
    } else {
      const total = 2 + e.grpprl.length
      const rec = new Uint8Array(total)
      rec[0] = total & 0xFF
      rec[1] = (total >> 8) & 0xFF
      rec.set(e.grpprl, 2)
      parts.push(rec)
    }
  }
  const bodyLen = parts.reduce((s, p) => s + p.length, 0)
  const out = new Uint8Array((n + 1) * 4 + bodyLen)
  const w32 = (off: number, v: number) => {
    out[off] = v & 0xFF
    out[off + 1] = (v >> 8) & 0xFF
    out[off + 2] = (v >> 16) & 0xFF
    out[off + 3] = (v >> 24) & 0xFF
  }
  entries.forEach((e, i) => w32(i * 4, e.cpStart))
  w32(n * 4, textLen)
  let cur = (n + 1) * 4
  for (const p of parts) {
    out.set(p, cur)
    cur += p.length
  }
  return out
}

/**
 * 构造合成 .doc 二进制。所有特性可选，按需写入对应 FIB pair 与 0Table 结构。
 * 抛出 Error 表示 spec 违反解析器前置条件（cp 不递增 / 文本超容量等）。
 */
export function buildGoldenDocBytes(spec: GoldenDocSpec): ArrayBuffer {
  const textLen = spec.text.length
  const maxChars = (WD_SIZE - TEXT_OFFSET) / 2
  if (textLen > maxChars) throw new Error(`文本 ${textLen} 字符超过单流容量 ${maxChars}`)
  if (spec.charRuns) assertAscendingCps(spec.charRuns, textLen)
  if (spec.paraRuns) assertAscendingCps(spec.paraRuns, textLen)

  // 基础布局占用 sector 0..7（物理偏移至 4095）；Data 流需 sector 8（物理 [4608,5120)）
  const buf = new ArrayBuffer(SECTOR * (spec.withDataPicture ? 10 : 9))
  const view = new Uint8Array(buf)
  const w16 = (off: number, v: number) => {
    view[off] = v & 0xFF
    view[off + 1] = (v >> 8) & 0xFF
  }
  const w32 = (off: number, v: number) => {
    view[off] = v & 0xFF
    view[off + 1] = (v >> 8) & 0xFF
    view[off + 2] = (v >> 16) & 0xFF
    view[off + 3] = (v >> 24) & 0xFF
  }

  // ---- OLE Header ----
  view[0] = 0xD0; view[1] = 0xCF; view[2] = 0x11; view[3] = 0xE0
  view[4] = 0xA1; view[5] = 0xB1; view[6] = 0x1A; view[7] = 0xE1
  w16(26, 3); w16(30, 9); w16(32, 6)
  w32(48, 1); w32(56, 4096)
  w32(60, END); w32(64, 0); w32(68, END); w32(72, 0)
  w32(76, 0)
  for (let i = 1; i < 109; i++) w32(76 + i * 4, FREE)

  // ---- FAT (sector 0)：0=FAT, 1=目录, 2→3→4→5 WordDocument, 6→7 0Table ----
  const fatBase = SECTOR
  w32(fatBase + 0 * 4, END)
  w32(fatBase + 1 * 4, END)
  w32(fatBase + 2 * 4, 3)
  w32(fatBase + 3 * 4, 4)
  w32(fatBase + 4 * 4, 5)
  w32(fatBase + 5 * 4, END)
  w32(fatBase + 6 * 4, 7)
  w32(fatBase + 7 * 4, END)
  for (let i = 8; i < 128; i++) w32(fatBase + i * 4, FREE)

  // ---- Directory (sector 1) ----
  const dirBase = SECTOR * 2
  const writeDir = (entryIdx: number, name: string, type: number, start: number, size: number) => {
    const off = dirBase + entryIdx * 128
    for (let i = 0; i < name.length; i++) w16(off + i * 2, name.charCodeAt(i))
    w16(off + 64, name.length * 2)
    view[off + 66] = type
    view[off + 67] = 1
    w32(off + 116, start)
    w32(off + 120, size)
  }
  let dirCount = 0
  writeDir(dirCount++, 'Root Entry', 5, END, 0)
  writeDir(dirCount++, 'WordDocument', 2, 2, WD_SIZE)
  writeDir(dirCount++, '0Table', 2, 6, TBL_SIZE)
  if (spec.withChartStorage) writeDir(dirCount++, 'MSGraph.Chart.8', 1, END, 0)

  // ---- Data 流（sector 8，物理 [4608,5120)）：PICF 包络 @128（布局移植 buildOleWithFields）----
  const DATA_PHYS = SECTOR * 9
  if (spec.withDataPicture) {
    w32(fatBase + 8 * 4, END)                       // FAT[8]：Data 流单扇区
    writeDir(dirCount++, 'Data', 2, 8, SECTOR)
    const picf = DATA_PHYS + PICF_OFFSET
    w32(picf + 0, 68 + 65)                          // FCPic lcb = 68 字节头 + 65 字节 PNG
    w16(picf + 4, 0x000A)                           // mm = PNG
    w16(picf + 6, 2)                                // xExt = 2px
    w16(picf + 8, 3)                                // yExt = 3px
    // 最小 PNG：签名+IHDR(13B 零载荷)+IDAT(8B 零载荷)+IEND（与先例逐字节一致）
    const picPng: number[] = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]
    picPng.push(0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52)
    for (let i = 0; i < 13; i++) picPng.push(0)
    for (let i = 0; i < 4; i++) picPng.push(0)
    picPng.push(0, 0, 0, 8, 0x49, 0x44, 0x41, 0x54)
    for (let i = 0; i < 8; i++) picPng.push(0)
    for (let i = 0; i < 4; i++) picPng.push(0)
    picPng.push(0, 0, 0, 0, 0x49, 0x45, 0x4E, 0x44)
    for (let i = 0; i < 4; i++) picPng.push(0)
    picPng.forEach((b, i) => { view[picf + 72 + i] = b })
  }

  // ---- FIB（WordDocument 流头部）----
  const wd = (streamOff: number) => WD_PHYS + streamOff
  w16(wd(0), 0xA5EC)          // wIdent
  w16(wd(2), 0x0101)          // nFib
  w16(wd(10), 0)              // fFlags: fComplex=0（UTF-16LE）、fWhichTblStm=0（0Table）
  // FibBase fcMin/fcMac（字符偏移）：PlcfFld 域指令按 fcMin 切片定位文本窗口，
  // 缺省 0 会使 instruction 读到 FIB 头部 → 超链接静默丢弃（docParser :1343 注释同款坑）
  w32(wd(24), TEXT_OFFSET / 2)
  w32(wd(28), TEXT_OFFSET / 2 + textLen)
  w16(wd(32), 0)              // csw = 0
  w16(wd(34), 22)             // cslw = 22
  w32(wd(36 + 12), textLen)   // ccpText @ FibRgLw97[3]
  w16(wd(124), CB_RG_FC_LCB)
  const pair = (idx: number, fcTblOff: number, lcb: number) => {
    w32(wd(126 + idx * 8), fcTblOff)
    w32(wd(126 + idx * 8 + 4), lcb)
  }

  // ---- 主文本（UTF-16LE）----
  for (let i = 0; i < textLen; i++) w16(wd(TEXT_OFFSET + i * 2), spec.text.charCodeAt(i))

  // ---- CLX @0Table:0 —— 单 piece 覆盖全文（未压缩位=0 → UTF-16LE）----
  view[TBL_PHYS + OFF_CLX] = 0x02
  w32(TBL_PHYS + OFF_CLX + 1, 16)
  w32(TBL_PHYS + OFF_CLX + 5, 0)
  w32(TBL_PHYS + OFF_CLX + 9, textLen)
  w32(TBL_PHYS + OFF_CLX + 13 + 2, TEXT_OFFSET)
  pair(33, OFF_CLX, 21)

  // ---- PlcfBteChpx @64（pair 12）----
  if (spec.charRuns && spec.charRuns.length > 0) {
    const bin = buildBinTable(
      spec.charRuns.map(e => ({ cpStart: e.cpStart, grpprl: chpxGrpprl(e) })),
      textLen,
    )
    view.set(bin, TBL_PHYS + OFF_CHPX_BIN)
    pair(12, OFF_CHPX_BIN, bin.length)
  }

  // ---- PlcfBtePapx @192（pair 13）：PAPX 记录带 istd（列表路径沿用先例值 istd=1）----
  if (spec.paraRuns && spec.paraRuns.length > 0) {
    const bin = buildBinTable(
      spec.paraRuns.map(e => ({ cpStart: e.cpStart, grpprl: papxGrpprl(e), istd: e.ilstLegacy !== undefined || e.ilfo !== undefined ? 1 : 0 })),
      textLen,
    )
    view.set(bin, TBL_PHYS + OFF_PAPX_BIN)
    pair(13, OFF_PAPX_BIN, bin.length)
  }

  // ---- SttbfRMark @320（pair 51）：fExtend + cbSttb(作者数) + N×(cbString + UTF-16 名) ----
  if (spec.revisionAuthors && spec.revisionAuthors.length > 0) {
    let off = TBL_PHYS + OFF_RMARK
    w16(off, 0xFFFF); off += 2
    w16(off, spec.revisionAuthors.length); off += 2
    for (const name of spec.revisionAuthors) {
      w16(off, name.length); off += 2
      for (let i = 0; i < name.length; i++) w16(off + i * 2, name.charCodeAt(i))
      off += name.length * 2
    }
    pair(51, OFF_RMARK, off - (TBL_PHYS + OFF_RMARK))
  }

  // ---- LST @400（pair 73）+ PlcfLfo（pair 74）----
  if (spec.lists && spec.lists.length > 0) {
    const n = spec.lists.length
    spec.lists.forEach((lst, i) => {
      const base = TBL_PHYS + OFF_LST + i * 70
      w32(base + 0, lst.lsid)
      w32(base + 4, 0)            // tplc
      view[base + 26] = 1         // fSimpleList
      const lvlf = base + 28
      w16(lvlf + 0, lst.iStartAt)
      view[lvlf + 2] = lst.nfc
      w16(lvlf + 40, 0)           // 编号文本长度 = 0
    })
    pair(73, OFF_LST, n * 70)
    const lfoOff = OFF_LST + n * 70
    let cur = TBL_PHYS + lfoOff
    for (let i = 0; i <= n; i++) { w32(cur, i); cur += 4 }
    for (const lst of spec.lists) {
      w32(cur, lst.lsid)
      view[cur + 4] = 1           // clfolvl
      cur += 8                    // lsid(4) + clfolvl(1) + padding(3)
    }
    pair(74, lfoOff, cur - (TBL_PHYS + lfoOff))
  }

  // ---- PlcfFldMom @600（pair 16）：aCP(n+1)×4 + aFLD n×2（ch,flt）----
  if (spec.plcfFld && spec.plcfFld.length > 0) {
    const entries = spec.plcfFld
    let off = TBL_PHYS + OFF_FLD
    for (const e of entries) { w32(off, e.cp); off += 4 }
    // 布局约定：entries 前 n-1 项为域字符 CP，末项为结束 CP（parsePlcfFld 的 aCP 数组）
    // 因此 ch/flt 对应 entries[0..n-2]
    for (let i = 0; i < entries.length - 1; i++) {
      view[off] = entries[i].ch & 0xFF
      view[off + 1] = entries[i].flt & 0xFF
      off += 2
    }
    pair(16, OFF_FLD, off - (TBL_PHYS + OFF_FLD))
  }

  return buf
}
