/**
 * OLE Property Set (MS-OLEPS) parser for SummaryInformation stream.
 *
 * Word .doc files store document metadata (title, author, etc.) in the
 * SummaryInformation stream using the OLE Property Set format.
 *
 * Reference: MS-OLEPS §2.20 (PropertySetStream), §2.21 (PropertySet)
 */

/** Document properties extracted from SummaryInformation stream. */
export interface DocumentProperties {
  /** Document title. */
  title?: string
  /** Document subject/topic. */
  subject?: string
  /** Author name. */
  author?: string
  /** Keywords/tags. */
  keywords?: string
  /** Comments/notes. */
  comments?: string
  /** Template name. */
  template?: string
  /** Last author who modified the document. */
  lastAuthor?: string
  /** Revision number. */
  revisionNumber?: string
  /** Application name that created the document. */
  appName?: string
  /** Total editing time in minutes. */
  editTime?: number
  /** Last print date (Windows FILETIME). */
  lastPrinted?: number
  /** Creation date (Windows FILETIME). */
  createdTime?: number
  /** Last save date (Windows FILETIME). */
  lastSavedTime?: number
  /** Page count. */
  pageCount?: number
  /** Word count. */
  wordCount?: number
  /** Character count. */
  charCount?: number
  /** Thumbnail (preview image). */
  thumbnail?: Uint8Array
  // --- DocumentSummaryInformation extended properties ---
  /** Document category (from DocumentSummaryInformation). */
  category?: string
  /** Presentation format (from DocumentSummaryInformation). */
  presentationFormat?: string
  /** Byte count (from DocumentSummaryInformation). */
  byteCount?: number
  /** Line count (from DocumentSummaryInformation). */
  lineCount?: number
  /** Paragraph count (from DocumentSummaryInformation). */
  paragraphCount?: number
  /** Slide count (from DocumentSummaryInformation). */
  slideCount?: number
  /** Note count (from DocumentSummaryInformation). */
  noteCount?: number
  /** Hidden slide count (from DocumentSummaryInformation). */
  hiddenCount?: number
  /** Manager name (from DocumentSummaryInformation). */
  manager?: string
  /** Company name (from DocumentSummaryInformation). */
  company?: string
  /** Character count including spaces (from DocumentSummaryInformation). */
  charCountWithSpaces?: number
  /** Whether document is shared (from DocumentSummaryInformation). */
  sharedDoc?: boolean
}

/** Property ID constants for standard document properties. */
const PID_TITLE = 0x02
const PID_SUBJECT = 0x03
const PID_AUTHOR = 0x04
const PID_KEYWORDS = 0x05
const PID_COMMENTS = 0x06
const PID_TEMPLATE = 0x07
const PID_LASTAUTHOR = 0x08
const PID_REVNUMBER = 0x09
const PID_EDITTIME = 0x0A
const PID_LASTPRINTED = 0x0B
const PID_CREATEDTIME = 0x0C
const PID_LASTSAVEDTIME = 0x0D
const PID_PAGECOUNT = 0x0E
const PID_WORDCOUNT = 0x0F
const PID_CHARCOUNT = 0x10
const PID_APPNAME = 0x18
const PID_THUMBNAIL = 0x11

/** Property ID constants for DocumentSummaryInformation (extended properties). */
const PIDDSI_CATEGORY = 0x02
const PIDDSI_PRESFORMAT = 0x03
const PIDDSI_BYTECOUNT = 0x04
const PIDDSI_LINECOUNT = 0x05
const PIDDSI_PARACOUNT = 0x06
const PIDDSI_SLIDECOUNT = 0x07
const PIDDSI_NOTECOUNT = 0x08
const PIDDSI_HIDDENCOUNT = 0x09
const PIDDSI_MANAGER = 0x0E
const PIDDSI_COMPANY = 0x0F
const PIDDSI_CCHWITHSPACES = 0x11
const PIDDSI_SHAREDDOC = 0x13

/** Property type constants. */
const VT_EMPTY = 0x0000
const VT_NULL = 0x0001
const VT_I2 = 0x0002 // 16-bit signed integer
const VT_I4 = 0x0003 // 32-bit signed integer
const VT_R4 = 0x0004 // 32-bit float
const VT_R8 = 0x0005 // 64-bit float
// const VT_CY = 0x0006 // Currency (64-bit)
// const VT_DATE = 0x0007 // Date (64-bit float)
// const VT_BSTR = 0x0008 // BSTR string
const VT_BOOL = 0x000B // Boolean (16-bit)
// const VT_VARIANT = 0x000C // VARIANT
// const VT_I1 = 0x0010 // 8-bit signed integer
// const VT_UI1 = 0x0011 // 8-bit unsigned integer
// const VT_UI2 = 0x0012 // 16-bit unsigned integer
const VT_UI4 = 0x0013 // 32-bit unsigned integer
const VT_I8 = 0x0014 // 64-bit signed integer
const VT_UI8 = 0x0015 // 64-bit unsigned integer
const VT_LPSTR = 0x001E // LPSTR (ANSI string)
const VT_LPWSTR = 0x001F // LPWSTR (Unicode string)
const VT_FILETIME = 0x0040 // Windows FILETIME (64-bit)
const VT_BLOB = 0x0041 // Binary blob

function readUint16(data: Uint8Array, offset: number): number {
  return (data[offset] | (data[offset + 1] << 8)) & 0xFFFF
}

function readUint32(data: Uint8Array, offset: number): number {
  return (data[offset] | (data[offset + 1] << 8) |
          (data[offset + 2] << 16) | (data[offset + 3] << 24)) >>> 0
}

function readInt32(data: Uint8Array, offset: number): number {
  return data[offset] | (data[offset + 1] << 8) |
         (data[offset + 2] << 16) | (data[offset + 3] << 24)
}

function readUint64(data: Uint8Array, offset: number): bigint {
  const low = BigInt(readUint32(data, offset))
  const high = BigInt(readUint32(data, offset + 4))
  return (high << 32n) | low
}

/**
 * Read a null-terminated ANSI string from the data.
 */
function readAnsiString(data: Uint8Array, offset: number): string {
  let end = offset
  while (end < data.length && data[end] !== 0) {
    end++
  }
  return new TextDecoder('latin1').decode(data.subarray(offset, end))
}

/**
 * Read a length-prefixed Unicode string (LPWSTR).
 * Format: 4-byte length (in bytes, including null terminator) + UTF-16LE string
 */
function readUnicodeString(data: Uint8Array, offset: number): string {
  const byteLen = readUint32(data, offset)
  if (byteLen === 0) return ''
  const strData = data.subarray(offset + 4, offset + 4 + byteLen)
  // Remove null terminator if present
  let end = strData.length
  if (end >= 2 && strData[end - 2] === 0 && strData[end - 1] === 0) {
    end -= 2
  }
  return new TextDecoder('utf-16le').decode(strData.subarray(0, end))
}

/**
 * Parse a property value based on its type.
 * Returns the value and the number of bytes consumed.
 */
function parsePropertyValue(data: Uint8Array, offset: number, type: number): { value: any; size: number } {
  switch (type) {
    case VT_EMPTY:
    case VT_NULL:
      return { value: null, size: 0 }

    case VT_I2:
      return { value: readUint16(data, offset), size: 2 }

    case VT_I4:
    case VT_UI4:
      return { value: readInt32(data, offset), size: 4 }

    case VT_R4: {
      const view = new DataView(data.buffer, data.byteOffset + offset, 4)
      return { value: view.getFloat32(0, true), size: 4 }
    }

    case VT_R8: {
      const view = new DataView(data.buffer, data.byteOffset + offset, 8)
      return { value: view.getFloat64(0, true), size: 8 }
    }

    case VT_BOOL:
      return { value: readUint16(data, offset) !== 0, size: 2 }

    case VT_FILETIME:
    case VT_I8:
    case VT_UI8:
      return { value: readUint64(data, offset), size: 8 }

    case VT_LPSTR: {
      const str = readAnsiString(data, offset)
      // String + null terminator + padding to 4-byte boundary
      const size = str.length + 1
      return { value: str, size: size + (4 - (size % 4)) % 4 }
    }

    case VT_LPWSTR: {
      const byteLen = readUint32(data, offset)
      const str = readUnicodeString(data, offset)
      // 4-byte length + string bytes
      return { value: str, size: 4 + byteLen }
    }

    case VT_BLOB: {
      const blobLen = readUint32(data, offset)
      const blobData = data.subarray(offset + 4, offset + 4 + blobLen)
      return { value: blobData, size: 4 + blobLen }
    }

    default:
      // Unknown type, try to skip based on common sizes
      return { value: undefined, size: 4 }
  }
}

/**
 * Parse the SummaryInformation stream and extract document properties.
 *
 * Property Set Stream format (MS-OLEPS §2.20):
 * - Byte order marker: 0xFFFE (little-endian)
 * - Format version: usually 0x0000 or 0x0001
 * - OS version: usually 0x00020005 (Windows)
 * - Class ID: 16 bytes (usually zeros)
 * - Section count: usually 1
 * - FMTID: 16 bytes identifying the property set
 * - Offset to section
 * - Section data (properties)
 *
 * @param data - The SummaryInformation stream data.
 * @returns Parsed document properties, or null if parsing fails.
 */
export function parseSummaryInformation(data: Uint8Array): DocumentProperties | null {
  if (data.length < 48) return null

  // Byte order marker (should be 0xFFFE for little-endian)
  const byteOrder = readUint16(data, 0)
  if (byteOrder !== 0xFFFE) {
    // Try big-endian marker
    if (byteOrder !== 0xFEFF) return null
  }

  // Format version (skip)
  // const formatVersion = readUint16(data, 2)

  // OS version (skip)
  // const osVersion = readUint32(data, 4)

  // Class ID (16 bytes, skip)
  // Bytes 8-23

  // Section count
  const sectionCount = readUint32(data, 24)
  if (sectionCount === 0 || sectionCount > 10) return null

  // Read FMTID and offset for the first section
  // FMTID: bytes 28-43 (16 bytes)
  // Offset: bytes 44-47
  const sectionOffset = readUint32(data, 44)
  if (sectionOffset === 0 || sectionOffset >= data.length) return null

  // Parse the section
  return parsePropertySetSection(data, sectionOffset)
}

/**
 * Parse the DocumentSummaryInformation stream and extract extended properties.
 *
 * This stream uses the same OLE Property Set format as SummaryInformation,
 * but with different property IDs (category, company, manager, etc.).
 *
 * @param data - The DocumentSummaryInformation stream data.
 * @returns Parsed document properties, or null if parsing fails.
 */
export function parseDocumentSummaryInformation(data: Uint8Array): DocumentProperties | null {
  if (data.length < 48) return null

  const byteOrder = readUint16(data, 0)
  if (byteOrder !== 0xFFFE && byteOrder !== 0xFEFF) return null

  const sectionCount = readUint32(data, 24)
  if (sectionCount === 0 || sectionCount > 10) return null

  const sectionOffset = readUint32(data, 44)
  if (sectionOffset === 0 || sectionOffset >= data.length) return null

  return parsePropertySetSection(data, sectionOffset, true)
}

/**
 * Parse a PropertySet section (MS-OLEPS §2.21).
 * @param isDocSummary - If true, maps property IDs as DocumentSummaryInformation extended properties.
 */
function parsePropertySetSection(data: Uint8Array, sectionOffset: number, isDocSummary = false): DocumentProperties | null {
  if (sectionOffset + 8 > data.length) return null

  // Property count (4 bytes)
  const propertyCount = readUint32(data, sectionOffset + 4)
  if (propertyCount === 0 || propertyCount > 100) return null

  const properties: DocumentProperties = {}

  for (let i = 0; i < propertyCount; i++) {
    const entryOffset = sectionOffset + 8 + i * 8
    if (entryOffset + 8 > data.length) break

    const propertyId = readUint32(data, entryOffset)
    const propertyOffset = readUint32(data, entryOffset + 4)

    const propDataOffset = sectionOffset + propertyOffset
    if (propDataOffset + 4 > data.length) continue

    const type = readUint32(data, propDataOffset)
    const { value } = parsePropertyValue(data, propDataOffset + 4, type)

    if (isDocSummary) {
      mapDocSummaryProperty(properties, propertyId, value)
    } else {
      mapSummaryProperty(properties, propertyId, value)
    }
  }

  return properties
}

/** Map SummaryInformation property ID to DocumentProperties field. */
function mapSummaryProperty(properties: DocumentProperties, propertyId: number, value: any): void {
  switch (propertyId) {
    case PID_TITLE:
      if (typeof value === 'string') properties.title = value
      break
    case PID_SUBJECT:
      if (typeof value === 'string') properties.subject = value
      break
    case PID_AUTHOR:
      if (typeof value === 'string') properties.author = value
      break
    case PID_KEYWORDS:
      if (typeof value === 'string') properties.keywords = value
      break
    case PID_COMMENTS:
      if (typeof value === 'string') properties.comments = value
      break
    case PID_TEMPLATE:
      if (typeof value === 'string') properties.template = value
      break
    case PID_LASTAUTHOR:
      if (typeof value === 'string') properties.lastAuthor = value
      break
    case PID_REVNUMBER:
      if (typeof value === 'string') properties.revisionNumber = value
      break
    case PID_EDITTIME:
      if (typeof value === 'bigint' || typeof value === 'number') {
        properties.editTime = Number(value) / 600000000
      }
      break
    case PID_LASTPRINTED:
      if (typeof value === 'bigint' || typeof value === 'number') {
        properties.lastPrinted = Number(value)
      }
      break
    case PID_CREATEDTIME:
      if (typeof value === 'bigint' || typeof value === 'number') {
        properties.createdTime = Number(value)
      }
      break
    case PID_LASTSAVEDTIME:
      if (typeof value === 'bigint' || typeof value === 'number') {
        properties.lastSavedTime = Number(value)
      }
      break
    case PID_PAGECOUNT:
      if (typeof value === 'number') properties.pageCount = value
      break
    case PID_WORDCOUNT:
      if (typeof value === 'number') properties.wordCount = value
      break
    case PID_CHARCOUNT:
      if (typeof value === 'number') properties.charCount = value
      break
    case PID_APPNAME:
      if (typeof value === 'string') properties.appName = value
      break
    case PID_THUMBNAIL:
      if (value instanceof Uint8Array) properties.thumbnail = value
      break
  }
}

/** Map DocumentSummaryInformation property ID to DocumentProperties field. */
function mapDocSummaryProperty(properties: DocumentProperties, propertyId: number, value: any): void {
  switch (propertyId) {
    case PIDDSI_CATEGORY:
      if (typeof value === 'string') properties.category = value
      break
    case PIDDSI_PRESFORMAT:
      if (typeof value === 'string') properties.presentationFormat = value
      break
    case PIDDSI_BYTECOUNT:
      if (typeof value === 'number') properties.byteCount = value
      break
    case PIDDSI_LINECOUNT:
      if (typeof value === 'number') properties.lineCount = value
      break
    case PIDDSI_PARACOUNT:
      if (typeof value === 'number') properties.paragraphCount = value
      break
    case PIDDSI_SLIDECOUNT:
      if (typeof value === 'number') properties.slideCount = value
      break
    case PIDDSI_NOTECOUNT:
      if (typeof value === 'number') properties.noteCount = value
      break
    case PIDDSI_HIDDENCOUNT:
      if (typeof value === 'number') properties.hiddenCount = value
      break
    case PIDDSI_MANAGER:
      if (typeof value === 'string') properties.manager = value
      break
    case PIDDSI_COMPANY:
      if (typeof value === 'string') properties.company = value
      break
    case PIDDSI_CCHWITHSPACES:
      if (typeof value === 'number') properties.charCountWithSpaces = value
      break
    case PIDDSI_SHAREDDOC:
      if (typeof value === 'boolean') properties.sharedDoc = value
      break
  }
}

/**
 * Check if the object has any meaningful properties.
 */
export function hasProperties(props: DocumentProperties | null): boolean {
  if (!props) return false
  return !!(props.title || props.subject || props.author ||
            props.keywords || props.comments || props.lastAuthor ||
            props.pageCount || props.wordCount || props.charCount ||
            props.category || props.company || props.manager ||
            props.template || props.appName || props.revisionNumber)
}

/**
 * Merge two DocumentProperties objects (base + extended).
 * Non-undefined values from `extended` take precedence.
 */
export function mergeProperties(base: DocumentProperties, extended: DocumentProperties): DocumentProperties {
  return { ...base, ...extended }
}