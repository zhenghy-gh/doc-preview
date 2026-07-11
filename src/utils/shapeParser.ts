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

function readUint16(data: Uint8Array, offset: number): number {
  if (offset < 0 || offset + 2 > data.length) return 0
  return data[offset] | (data[offset + 1] << 8)
}

function readUint32(data: Uint8Array, offset: number): number {
  if (offset < 0 || offset + 4 > data.length) return 0
  return (
    (data[offset] |
      (data[offset + 1] << 8) |
      (data[offset + 2] << 16) |
      (data[offset + 3] << 24)) >>>
    0
  )
}

function readInt32(data: Uint8Array, offset: number): number {
  if (offset < 0 || offset + 4 > data.length) return 0
  const raw =
    data[offset] |
    (data[offset + 1] << 8) |
    (data[offset + 2] << 16) |
    (data[offset + 3] << 24)
  return raw
}

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

export function extractShapesFromDataStream(dataStream: Uint8Array): ShapeInfo[] {
  if (!dataStream || dataStream.length < 64) return []

  const shapes: ShapeInfo[] = []
  const seenSpid = new Set<number>()

  for (let offset = 0; offset < dataStream.length - 8; offset++) {
    const magic = readUint16(dataStream, offset)
    if ((magic & 0xC000) !== 0xC000) continue

    const header = parseOfficeArtRecordHeader(dataStream, offset)
    if (!header) continue

    if (header.recType === OFFICE_ART_FDG) {
      const found = parseFdg(dataStream, offset)
      for (const shape of found) {
        if (!seenSpid.has(shape.spid)) {
          seenSpid.add(shape.spid)
          shapes.push(shape)
        }
      }
    }
  }

  return shapes
}

export function extractShapesFromWordDocumentStream(wordDocData: Uint8Array): ShapeInfo[] {
  if (!wordDocData || wordDocData.length < 64) return []

  const shapes: ShapeInfo[] = []
  const seenSpid = new Set<number>()

  for (let offset = 0; offset < wordDocData.length - 8; offset++) {
    const magic = readUint16(wordDocData, offset)
    if ((magic & 0xC000) !== 0xC000) continue

    const header = parseOfficeArtRecordHeader(wordDocData, offset)
    if (!header) continue

    if (header.recType === OFFICE_ART_FDG) {
      const found = parseFdg(wordDocData, offset)
      for (const shape of found) {
        if (!seenSpid.has(shape.spid)) {
          seenSpid.add(shape.spid)
          shapes.push(shape)
        }
      }
    }
  }

  return shapes
}