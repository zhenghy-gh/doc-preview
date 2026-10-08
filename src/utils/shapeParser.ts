/**
 * Office Art Drawing Container parser (MS-ODRAW).
 *
 * Word 97-2003 stores floating shapes and images in Office Art Drawing
 * Containers within the Document stream (for inline shapes) or the Data
 * stream (for floating shapes). Each shape has position, size, type,
 * and optional picture data.
 *
 * Structure (MS-ODRAW §2):
 *
 *   OfficeArtFDG (OfficeArtFContainer):
 *     OfficeArtRecordHeader (8 bytes)
 *     OfficeArtDgContainer (nested)
 *
 *   OfficeArtDgContainer (OfficeArtFContainer):
 *     OfficeArtRecordHeader
 *     OfficeArtSpContainer[]
 *
 *   OfficeArtSpContainer (OfficeArtFContainer):
 *     OfficeArtRecordHeader
 *     OfficeArtSp (Shape)
 *     OfficeArtClientData
 *     ... (other optional records)
 *
 *   OfficeArtSp (OfficeArtSpContainer):
 *     OfficeArtRecordHeader
 *     spid (4 bytes): shape ID
 *     grf.sp (2 bytes): shape flags
 *     xfrm (60 bytes): transform (position/size)
 *
 *   OfficeArtClientData:
 *     OfficeArtRecordHeader
 *     Client data (contains textbox text, field info, etc.)
 */

import { readUint16, readUint32, readInt32 } from './binaryReader'

export type ShapeType =
  | 'rectangle'
  | 'ellipse'
  | 'line'
  | 'freeform'
  | 'textbox'
  | 'picture'
  | 'group'
  | 'unknown'

export type ShapeAnchorType =
  | 'char'
  | 'paragraph'
  | 'page'
  | 'margin'
  | 'unknown'

export interface ShapeInfo {
  /** Shape ID */
  spid: number
  /** Shape type */
  type: ShapeType
  /** Shape name (optional) */
  name?: string
  /** Position X (twips) */
  x?: number
  /** Position Y (twips) */
  y?: number
  /** Width (twips) */
  width?: number
  /** Height (twips) */
  height?: number
  /** Anchor type */
  anchorType: ShapeAnchorType
  /** Anchor CP (character position) */
  anchorCp?: number
  /** Whether this shape contains a picture */
  hasPicture?: boolean
  /** Picture offset in Data stream (if hasPicture) */
  fcPic?: number
  /** Picture format (if hasPicture) */
  pictureFormat?: string
  /** Whether this is a floating shape */
  floating?: boolean
  /** Shape group ID (if part of a group) */
  groupId?: number
}

const OFFICE_ART_RECORD_HEADER_SIZE = 8

const OFFICE_ART_FDG = 0xF000
const OFFICE_ART_DG_CONTAINER = 0xF002
const OFFICE_ART_SP_CONTAINER = 0xF003
const OFFICE_ART_SP = 0x0004
const OFFICE_ART_CLIENT_DATA = 0x0010
const OFFICE_ART_FILL_PICTURE = 0x0016
const OFFICE_ART_LINE_PICTURE = 0x0017
const OFFICE_ART_BLK_PICTURE = 0x0018

/**
 * `OFFICE_ART_FDG` 在小端序记录头里的第 3、4 个字节。
 *
 * recType 取 `data[o + 2] | (data[o + 3] << 8)`，位 0-7 落在字节 3、位 8-15 落在
 * 字节 4，所以 `recType === OFFICE_ART_FDG` 与
 * `data[o + 2] === FDG_TYPE_LO && data[o + 3] === FDG_TYPE_HI` 完全等价。
 * 从 OFFICE_ART_FDG 派生而非写死字面量，两者不会日后漂移。
 */
const FDG_TYPE_LO = OFFICE_ART_FDG & 0xff
const FDG_TYPE_HI = (OFFICE_ART_FDG >> 8) & 0xff

interface OfficeArtRecordHeader {
  recVer: number
  recInstance: number
  recType: number
  recLen: number
}

function parseOfficeArtRecordHeader(data: Uint8Array, offset: number): OfficeArtRecordHeader | null {
  if (offset + OFFICE_ART_RECORD_HEADER_SIZE > data.length) return null
  const recVer = (data[offset] >> 6) & 0x03
  const recInstance = ((data[offset] & 0x3F) << 8) | data[offset + 1]
  const recType = data[offset + 2] | (data[offset + 3] << 8)
  const recLen = readUint32(data, offset + 4)
  return { recVer, recInstance, recType, recLen }
}

export function spidToShapeType(spid: number): ShapeType {
  const typeCode = (spid >> 28) & 0x0F
  switch (typeCode) {
    case 0:
      return 'rectangle'
    case 1:
      return 'ellipse'
    case 2:
      return 'line'
    case 3:
      return 'freeform'
    case 4:
      return 'textbox'
    case 5:
      return 'picture'
    case 6:
      return 'group'
    default:
      return 'unknown'
  }
}

function parseXfrm(data: Uint8Array, offset: number): { x: number; y: number; width: number; height: number } | null {
  if (offset + 60 > data.length) return null
  const x = readInt32(data, offset + 4)
  const y = readInt32(data, offset + 8)
  const width = readInt32(data, offset + 28)
  const height = readInt32(data, offset + 32)
  return { x, y, width, height }
}

function parseSpContainer(data: Uint8Array, offset: number, _parentOffset: number): ShapeInfo | null {
  // 防御：recType 已由调用方 parseDgContainer 验证为 SP_CONTAINER，此处再查仅为直调保护
  const header = parseOfficeArtRecordHeader(data, offset)
  if (!header || header.recType !== OFFICE_ART_SP_CONTAINER) return null

  const containerEnd = offset + OFFICE_ART_RECORD_HEADER_SIZE + header.recLen
  if (containerEnd > data.length) return null

  const shape: ShapeInfo = {
    spid: 0,
    type: 'unknown',
    anchorType: 'unknown',
    floating: true,
  }

  let pos = offset + OFFICE_ART_RECORD_HEADER_SIZE
  while (pos < containerEnd) {
    const recHeader = parseOfficeArtRecordHeader(data, pos)
    if (!recHeader) break

    const recDataStart = pos + OFFICE_ART_RECORD_HEADER_SIZE
    const recDataEnd = recDataStart + recHeader.recLen

    switch (recHeader.recType) {
      case OFFICE_ART_SP: {
        if (recHeader.recLen < 72) break
        const spid = readUint32(data, recDataStart)
        shape.spid = spid
        shape.type = spidToShapeType(spid)
        const xfrm = parseXfrm(data, recDataStart + 8)
        if (xfrm) {
          shape.x = xfrm.x
          shape.y = xfrm.y
          shape.width = xfrm.width
          shape.height = xfrm.height
        }
        const grfSp = readUint16(data, recDataStart + 4)
        shape.floating = (grfSp & 0x0001) !== 0
        break
      }
      case OFFICE_ART_FILL_PICTURE:
      case OFFICE_ART_LINE_PICTURE:
      case OFFICE_ART_BLK_PICTURE: {
        shape.hasPicture = true
        if (recHeader.recLen >= 4) {
          const fcPic = readUint32(data, recDataStart) & 0x3FFFFFFF
          if (fcPic > 0) shape.fcPic = fcPic
        }
        break
      }
      case OFFICE_ART_CLIENT_DATA: {
        if (recHeader.recLen >= 8) {
          const cp = readUint32(data, recDataStart)
          if (cp > 0) {
            shape.anchorCp = cp
            shape.anchorType = 'char'
          }
        }
        break
      }
    }

    pos = recDataEnd
  }

  return shape.spid > 0 ? shape : null
}

function parseDgContainer(data: Uint8Array, offset: number): ShapeInfo[] {
  // 防御：recType 已由调用方 parseFdg 验证为 DG_CONTAINER，此处再查仅为直调保护
  const header = parseOfficeArtRecordHeader(data, offset)
  if (!header || header.recType !== OFFICE_ART_DG_CONTAINER) return []

  const containerEnd = offset + OFFICE_ART_RECORD_HEADER_SIZE + header.recLen
  if (containerEnd > data.length) return []

  const shapes: ShapeInfo[] = []
  let pos = offset + OFFICE_ART_RECORD_HEADER_SIZE

  while (pos < containerEnd) {
    const recHeader = parseOfficeArtRecordHeader(data, pos)
    if (!recHeader) break

    if (recHeader.recType === OFFICE_ART_SP_CONTAINER) {
      const shape = parseSpContainer(data, pos, offset)
      if (shape) shapes.push(shape)
    }

    pos += OFFICE_ART_RECORD_HEADER_SIZE + recHeader.recLen
  }

  return shapes
}

function parseFdg(data: Uint8Array, offset: number): ShapeInfo[] {
  // 防御：recType 已由调用方 extractShapesFrom* 扫描循环验证为 FDG，此处再查仅为直调保护
  const header = parseOfficeArtRecordHeader(data, offset)
  if (!header || header.recType !== OFFICE_ART_FDG) return []

  const containerEnd = offset + OFFICE_ART_RECORD_HEADER_SIZE + header.recLen
  if (containerEnd > data.length) return []

  const shapes: ShapeInfo[] = []
  let pos = offset + OFFICE_ART_RECORD_HEADER_SIZE

  while (pos < containerEnd) {
    const recHeader = parseOfficeArtRecordHeader(data, pos)
    if (!recHeader) break

    if (recHeader.recType === OFFICE_ART_DG_CONTAINER) {
      const dgShapes = parseDgContainer(data, pos)
      shapes.push(...dgShapes)
    }

    pos += OFFICE_ART_RECORD_HEADER_SIZE + recHeader.recLen
  }

  return shapes
}

function extractShapes(data: Uint8Array): ShapeInfo[] {
  if (!data || data.length < 64) return []

  const shapes: ShapeInfo[] = []
  const seenSpid = new Set<number>()
  const limit = data.length - 8
  let offset = 0

  while (offset < limit) {
    // 前置筛：recType 为 OFFICE_ART_FDG 时第 3/4 字节必为 0x00/0xF0。这是下方
    // `header.recType === OFFICE_ART_FDG` 的**必要条件**，因此加在这里只改变
    // 「谁被挡在记录头解析之前」，不改变任何一个偏移的去留（等价性由此可证）。
    //
    // 放在 16 位掩码之前是有意的：本筛通过率约 0.0094%（7.65 MB 真实语料上
    // 751 个偏移），而掩码是 8.457%（678 221 个）。先查更严的那个，绝大多数
    // 偏移只付两次数组读取，parseFdg 之前的记录头解析次数从 678 221 降到 49。
    //
    // 注意掩码 `(readUint16(data, offset) & 0xC000) === 0xC000` **不是** FDG 的
    // 必要条件（它约束的是 recInstance 低字节的高 2 位），它是历史遗留的额外
    // 筛选，不能删——删掉会让大量本来被拒的候选进入 parseFdg，输出随之改变。
    if (data[offset + 2] !== FDG_TYPE_LO || data[offset + 3] !== FDG_TYPE_HI) {
      // 条件式跳跃：本筛要求 `data[offset + 3] === FDG_TYPE_HI`，所以把
      // 「下一个 data[p] === FDG_TYPE_HI」映射回 `p - 3` 就得到下一个**可能**
      // 通过的偏移。落在 [offset+1, p-3) 之间的偏移其 o+3 处都不是 0xF0，
      // 本筛必然失败，跳过它们不会漏掉任何候选。
      //
      // 锚点选 FDG_TYPE_HI（0xF0）而不是 FDG_TYPE_LO（0x00）：0x00 在真实语料
      // 里占 31.4%（每 3.2 字节一次），拿它当锚点必然退化。0xF0 实测 0.1171%。
      //
      // 「锚点紧邻就不跳」这一层是必需的：`indexOf` 即使立刻命中也要付一次
      // 原生调用，而锚点铺满时每次只前进 1 字节，就变成「每字节一次调用」。
      // 实测 1 MB 全 0xF0（同一进程内三个版本对比）：
      //   旧（逐字节）1.45 ms / 无守卫 9.10 ms（0.16x）/ 有守卫 2.03 ms（0.72x）
      // 守卫把 6.3 倍的退化收回成 1.4 倍，代价在真实语料上可忽略
      // （6.48x → 6.40x，约 1.2% 的相对损失）。
      if (data[offset + 4] === FDG_TYPE_HI) {
        offset++
        continue
      }
      const p = data.indexOf(FDG_TYPE_HI, offset + 4)
      if (p < 0) break
      offset = p - 3
      continue
    }

    const magic = readUint16(data, offset)
    if ((magic & 0xC000) === 0xC000) {
      const header = parseOfficeArtRecordHeader(data, offset)
      if (header && header.recType === OFFICE_ART_FDG) {
        const found = parseFdg(data, offset)
        for (const shape of found) {
          if (!seenSpid.has(shape.spid)) {
            seenSpid.add(shape.spid)
            shapes.push(shape)
          }
        }
      }
    }
    // 原 `for` 的 `offset++`；跳跃路径在自己的分支里 `continue`，不走这里。
    offset++
  }

  return shapes
}

export function extractShapesFromDataStream(dataStream: Uint8Array): ShapeInfo[] {
  return extractShapes(dataStream)
}

export function extractShapesFromWordDocumentStream(wordDocData: Uint8Array): ShapeInfo[] {
  return extractShapes(wordDocData)
}