import { describe, it, expect } from 'vitest'
import { parseSummaryInformation, parseDocumentSummaryInformation, hasProperties, mergeProperties } from '../src/utils/propertyParser'

/**
 * Build a minimal SummaryInformation stream with given properties.
 *
 * Format (MS-OLEPS §2.20):
 * - Byte order marker: 0xFFFE (little-endian)
 * - Format version: 0x0000
 * - OS version: 0x00020005 (Windows)
 * - Class ID: 16 bytes (zeros)
 * - Section count: 1
 * - FMTID: 16 bytes (GUID for SummaryInformation)
 * - Section offset: 4 bytes
 * - Section data: PropertySet
 */
function buildSummaryStream(properties: Array<{ id: number; type: number; value: any }>): Uint8Array {
  const FMTID_SUMMARY = [
    0xF0, 0x4F, 0x87, 0xE0, // GUID part 1
    0xD0, 0x11, // GUID part 2
    0xCF, 0x11, // GUID part 3
    0x00, 0x00, 0xC0, 0x00, 0x00, 0x00, 0x00, 0x46 // GUID part 4
  ]

  // Calculate section size
  const propertyCount = properties.length
  let sectionDataSize = 8 + propertyCount * 8 // header + property entries

  // Property values (type + value)
  for (const prop of properties) {
    sectionDataSize += 4 // type
    if (prop.type === 0x001E) { // LPSTR
      const strLen = (prop.value as string).length + 1
      sectionDataSize += strLen + (4 - (strLen % 4)) % 4
    } else if (prop.type === 0x001F) { // LPWSTR
      const strLen = (prop.value as string).length * 2 + 2
      sectionDataSize += 4 + strLen
    } else if (prop.type === 0x0000 || prop.type === 0x0001) { // EMPTY / NULL
      sectionDataSize += 0
    } else if (prop.type === 0x0002) { // I2
      sectionDataSize += 2
    } else if (prop.type === 0x0003) { // I4
      sectionDataSize += 4
    } else if (prop.type === 0x0004) { // R4
      sectionDataSize += 4
    } else if (prop.type === 0x0005) { // R8
      sectionDataSize += 8
    } else if (prop.type === 0x000B) { // BOOL
      sectionDataSize += 2
    } else if (prop.type === 0x0040 || prop.type === 0x0014) { // FILETIME / I8
      sectionDataSize += 8
    } else if (prop.type === 0x0041) { // BLOB
      sectionDataSize += 4 + (prop.value as number[]).length
    } else { // unknown types default to 4 bytes
      sectionDataSize += 4
    }
  }

  const headerSize = 48 // up to section offset
  const totalSize = headerSize + sectionDataSize
  const data = new Uint8Array(totalSize)
  const view = new DataView(data.buffer)

  // Header
  view.setUint16(0, 0xFFFE, true) // Byte order
  view.setUint16(2, 0x0000, true) // Format version
  view.setUint32(4, 0x00020005, true) // OS version
  // Class ID (16 zeros) at offset 8-23
  view.setUint32(24, 1, true) // Section count
  // FMTID at offset 28-43
  data.set(FMTID_SUMMARY, 28)
  view.setUint32(44, headerSize, true) // Section offset

  // Section data
  const sectionOffset = headerSize
  view.setUint32(sectionOffset, sectionDataSize, true) // Section size
  view.setUint32(sectionOffset + 4, propertyCount, true) // Property count

  // Property ID/offset entries
  let valueOffset = sectionOffset + 8 + propertyCount * 8
  for (let i = 0; i < properties.length; i++) {
    const prop = properties[i]
    view.setUint32(sectionOffset + 8 + i * 8, prop.id, true) // Property ID
    view.setUint32(sectionOffset + 8 + i * 8 + 4, valueOffset - sectionOffset, true) // Offset relative to section

    // Write property value
    view.setUint32(valueOffset, prop.type, true) // Type
    valueOffset += 4

    if (prop.type === 0x001E) { // LPSTR
      const str = prop.value as string
      for (let j = 0; j < str.length; j++) {
        data[valueOffset + j] = str.charCodeAt(j)
      }
      data[valueOffset + str.length] = 0 // null terminator
      const paddedLen = str.length + 1 + (4 - ((str.length + 1) % 4)) % 4
      valueOffset += paddedLen
    } else if (prop.type === 0x001F) { // LPWSTR
      const str = prop.value as string
      const byteLen = str.length * 2 + 2
      view.setUint32(valueOffset, byteLen, true) // length in bytes
      valueOffset += 4
      for (let j = 0; j < str.length; j++) {
        view.setUint16(valueOffset + j * 2, str.charCodeAt(j), true)
      }
      view.setUint16(valueOffset + str.length * 2, 0, true) // null terminator
      valueOffset += byteLen
    } else if (prop.type === 0x0002) { // I2
      view.setInt16(valueOffset, prop.value as number, true)
      valueOffset += 2
    } else if (prop.type === 0x0003) { // I4
      view.setInt32(valueOffset, prop.value as number, true)
      valueOffset += 4
    } else if (prop.type === 0x0004) { // R4
      view.setFloat32(valueOffset, prop.value as number, true)
      valueOffset += 4
    } else if (prop.type === 0x0005) { // R8
      view.setFloat64(valueOffset, prop.value as number, true)
      valueOffset += 8
    } else if (prop.type === 0x000B) { // BOOL
      view.setUint16(valueOffset, prop.value ? 0xFFFF : 0, true)
      valueOffset += 2
    } else if (prop.type === 0x0040 || prop.type === 0x0014) { // FILETIME / I8
      view.setBigInt64(valueOffset, BigInt(prop.value as number), true)
      valueOffset += 8
    } else if (prop.type === 0x0041) { // BLOB
      const bytes = prop.value as number[]
      view.setUint32(valueOffset, bytes.length, true) // blob length
      valueOffset += 4
      for (let j = 0; j < bytes.length; j++) {
        data[valueOffset + j] = bytes[j]
      }
      valueOffset += bytes.length
    } else if (prop.type === 0x0000 || prop.type === 0x0001) {
      // EMPTY / NULL — no value bytes
    } else {
      // Unknown type — write 4 placeholder bytes
      valueOffset += 4
    }
  }

  return data
}

describe('propertyParser', () => {
  describe('parseSummaryInformation', () => {
    it('should return null for empty data', () => {
      expect(parseSummaryInformation(new Uint8Array(0))).toBeNull()
      expect(parseSummaryInformation(new Uint8Array(10))).toBeNull()
    })

    it('should return null for invalid byte order marker', () => {
      const data = new Uint8Array(48)
      new DataView(data.buffer).setUint16(0, 0x1234, true) // Invalid marker
      expect(parseSummaryInformation(data)).toBeNull()
    })

    it('should parse title property (LPWSTR)', () => {
      const data = buildSummaryStream([
        { id: 0x02, type: 0x001F, value: 'Test Document' }
      ])
      const result = parseSummaryInformation(data)
      expect(result).not.toBeNull()
      expect(result?.title).toBe('Test Document')
    })

    it('should parse author property (LPWSTR)', () => {
      const data = buildSummaryStream([
        { id: 0x04, type: 0x001F, value: 'John Doe' }
      ])
      const result = parseSummaryInformation(data)
      expect(result?.author).toBe('John Doe')
    })

    it('should parse subject property (LPWSTR)', () => {
      const data = buildSummaryStream([
        { id: 0x03, type: 0x001F, value: 'Test Subject' }
      ])
      const result = parseSummaryInformation(data)
      expect(result?.subject).toBe('Test Subject')
    })

    it('should parse keywords property (LPWSTR)', () => {
      const data = buildSummaryStream([
        { id: 0x05, type: 0x001F, value: 'test, keywords, parser' }
      ])
      const result = parseSummaryInformation(data)
      expect(result?.keywords).toBe('test, keywords, parser')
    })

    it('should parse comments property (LPWSTR)', () => {
      const data = buildSummaryStream([
        { id: 0x06, type: 0x001F, value: 'This is a test comment.' }
      ])
      const result = parseSummaryInformation(data)
      expect(result?.comments).toBe('This is a test comment.')
    })

    it('should parse lastAuthor property (LPWSTR)', () => {
      const data = buildSummaryStream([
        { id: 0x08, type: 0x001F, value: 'Jane Smith' }
      ])
      const result = parseSummaryInformation(data)
      expect(result?.lastAuthor).toBe('Jane Smith')
    })

    it('should parse page count (I4)', () => {
      const data = buildSummaryStream([
        { id: 0x0E, type: 0x0003, value: 42 }
      ])
      const result = parseSummaryInformation(data)
      expect(result?.pageCount).toBe(42)
    })

    it('should parse word count (I4)', () => {
      const data = buildSummaryStream([
        { id: 0x0F, type: 0x0003, value: 1000 }
      ])
      const result = parseSummaryInformation(data)
      expect(result?.wordCount).toBe(1000)
    })

    it('should parse character count (I4)', () => {
      const data = buildSummaryStream([
        { id: 0x10, type: 0x0003, value: 5000 }
      ])
      const result = parseSummaryInformation(data)
      expect(result?.charCount).toBe(5000)
    })

    it('should parse multiple properties', () => {
      const data = buildSummaryStream([
        { id: 0x02, type: 0x001F, value: 'My Title' },
        { id: 0x04, type: 0x001F, value: 'Author Name' },
        { id: 0x0E, type: 0x0003, value: 10 },
        { id: 0x0F, type: 0x0003, value: 500 }
      ])
      const result = parseSummaryInformation(data)
      expect(result?.title).toBe('My Title')
      expect(result?.author).toBe('Author Name')
      expect(result?.pageCount).toBe(10)
      expect(result?.wordCount).toBe(500)
    })

    it('should handle LPSTR (ANSI string)', () => {
      const data = buildSummaryStream([
        { id: 0x02, type: 0x001E, value: 'ANSI Title' }
      ])
      const result = parseSummaryInformation(data)
      expect(result?.title).toBe('ANSI Title')
    })

    it('should handle empty strings', () => {
      const data = buildSummaryStream([
        { id: 0x02, type: 0x001F, value: '' }
      ])
      const result = parseSummaryInformation(data)
      expect(result?.title).toBe('')
    })

    it('should handle Unicode characters', () => {
      const data = buildSummaryStream([
        { id: 0x02, type: 0x001F, value: '中文标题 测试' }
      ])
      const result = parseSummaryInformation(data)
      expect(result?.title).toBe('中文标题 测试')
    })

    it('should return null for zero property count', () => {
      const data = new Uint8Array(56)
      const view = new DataView(data.buffer)
      view.setUint16(0, 0xFFFE, true)
      view.setUint32(24, 1, true) // section count
      view.setUint32(44, 48, true) // section offset at 48
      // Section at 48: size=8, count=0
      view.setUint32(48, 8, true) // size=8
      view.setUint32(52, 0, true) // count=0
      expect(parseSummaryInformation(data)).toBeNull()
    })

    it('should return null for excessive property count', () => {
      const data = new Uint8Array(56)
      const view = new DataView(data.buffer)
      view.setUint16(0, 0xFFFE, true)
      view.setUint32(24, 1, true)
      view.setUint32(44, 48, true)
      view.setUint32(48, 8, true) // size=8
      view.setUint32(52, 200, true) // count=200 (exceeds limit)
      expect(parseSummaryInformation(data)).toBeNull()
    })

    it('should parse appName (LPSTR) and thumbnail (BLOB)', () => {
      const data = buildSummaryStream([
        { id: 0x18, type: 0x001E, value: 'Microsoft Word' },
        { id: 0x11, type: 0x0041, value: [1, 2, 3, 4, 5] },
      ])
      const result = parseSummaryInformation(data)
      expect(result?.appName).toBe('Microsoft Word')
      expect(result?.thumbnail).toBeInstanceOf(Uint8Array)
      expect(Array.from(result!.thumbnail!)).toEqual([1, 2, 3, 4, 5])
    })

    it('should parse R4 and R8 numeric properties', () => {
      // editTime uses R8 (0x0005); revisionNumber uses I4 — use unknown ids
      // so values are still decoded through the generic property value parser.
      const data = buildSummaryStream([
        { id: 0x99, type: 0x0004, value: 1.5 },
        { id: 0x98, type: 0x0005, value: 2.25 },
      ])
      // These IDs are not mapped to fields, so parsing should still succeed
      // without throwing (values flow through parsePropertyValue).
      const result = parseSummaryInformation(data)
      expect(result).not.toBeNull()
    })

    it('should parse BOOL property values', () => {
      const data = buildSummaryStream([
        { id: 0x97, type: 0x000B, value: true },
      ])
      const result = parseSummaryInformation(data)
      expect(result).not.toBeNull()
    })

    it('should parse template, lastAuthor and revisionNumber', () => {
      const data = buildSummaryStream([
        { id: 0x07, type: 0x001E, value: 'Normal.dotm' },
        { id: 0x08, type: 0x001E, value: 'Jane' },
        { id: 0x09, type: 0x001E, value: '3' },
      ])
      const result = parseSummaryInformation(data)
      expect(result?.template).toBe('Normal.dotm')
      expect(result?.lastAuthor).toBe('Jane')
      expect(result?.revisionNumber).toBe('3')
    })

    it('should parse editTime and convert from 100ns units to minutes', () => {
      const data = buildSummaryStream([
        { id: 0x0A, type: 0x0040, value: 600000000 }, // 1 minute in 100ns units
      ])
      const result = parseSummaryInformation(data)
      expect(result?.editTime).toBe(1)
    })

    it('should parse FILETIME timestamps as raw 100ns counts', () => {
      // The parser stores FILETIME values as raw 100ns-since-1601 counts;
      // DocPreview converts them for display.
      const data = buildSummaryStream([
        { id: 0x0C, type: 0x0040, value: 133479360000000000 },
        { id: 0x0D, type: 0x0040, value: 133479366000000000 },
      ])
      const result = parseSummaryInformation(data)
      expect(result?.createdTime).toBe(133479360000000000)
      expect(result?.lastSavedTime).toBe(133479366000000000)
    })

    it('should parse lastPrinted FILETIME', () => {
      const data = buildSummaryStream([
        { id: 0x0B, type: 0x0040, value: 133479360000000000 },
      ])
      const result = parseSummaryInformation(data)
      expect(result?.lastPrinted).toBe(133479360000000000)
    })

    it('should handle empty and null property values', () => {
      // VT_EMPTY (0x0000) and VT_NULL (0x0001) — size 0
      const data = buildSummaryStream([
        { id: 0x02, type: 0x0000, value: null },
        { id: 0x03, type: 0x0001, value: null },
        { id: 0x04, type: 0x0002, value: 42 }, // I2
      ])
      const result = parseSummaryInformation(data)
      expect(result).not.toBeNull()
      expect(result?.title).toBeUndefined()
      expect(result?.subject).toBeUndefined()
      expect(result?.author).toBeUndefined()
    })

    it('should skip unknown property types with a default size', () => {
      // Type 0x9999 unknown → skipped with size 4
      const data = buildSummaryStream([
        { id: 0x02, type: 0x001E, value: 'Known' },
        { id: 0x03, type: 0x9999, value: null },
      ])
      const result = parseSummaryInformation(data)
      expect(result?.title).toBe('Known')
    })
  })

  describe('parseDocumentSummaryInformation', () => {
    it('should return null for empty data', () => {
      expect(parseDocumentSummaryInformation(new Uint8Array(0))).toBeNull()
    })

    it('should return null for invalid byte order', () => {
      const data = new Uint8Array(56)
      data[0] = 0x12; data[1] = 0x34
      expect(parseDocumentSummaryInformation(data)).toBeNull()
    })

    it('should parse extended properties (category, company, manager)', () => {
      const data = buildSummaryStream([
        { id: 0x02, type: 0x001E, value: 'Research' },
        { id: 0x0F, type: 0x001E, value: 'ACME Corp' },
        { id: 0x0E, type: 0x001E, value: 'Dr. Smith' },
        { id: 0x04, type: 0x0003, value: 12345 },
        { id: 0x05, type: 0x0003, value: 200 },
        { id: 0x06, type: 0x0003, value: 50 },
        { id: 0x13, type: 0x000B, value: true },
      ])
      const result = parseDocumentSummaryInformation(data)
      expect(result?.category).toBe('Research')
      expect(result?.company).toBe('ACME Corp')
      expect(result?.manager).toBe('Dr. Smith')
      expect(result?.byteCount).toBe(12345)
      expect(result?.lineCount).toBe(200)
      expect(result?.paragraphCount).toBe(50)
      expect(result?.sharedDoc).toBe(true)
    })

    it('should parse slide/note/hidden counts and charCountWithSpaces', () => {
      const data = buildSummaryStream([
        { id: 0x07, type: 0x0003, value: 3 },
        { id: 0x08, type: 0x0003, value: 4 },
        { id: 0x09, type: 0x0003, value: 1 },
        { id: 0x11, type: 0x0003, value: 999 },
      ])
      const result = parseDocumentSummaryInformation(data)
      expect(result?.slideCount).toBe(3)
      expect(result?.noteCount).toBe(4)
      expect(result?.hiddenCount).toBe(1)
      expect(result?.charCountWithSpaces).toBe(999)
    })

    it('should parse presentationFormat', () => {
      const data = buildSummaryStream([
        { id: 0x03, type: 0x001E, value: 'On-screen Show' },
      ])
      const result = parseDocumentSummaryInformation(data)
      expect(result?.presentationFormat).toBe('On-screen Show')
    })
  })

  describe('hasProperties', () => {
    it('should return false for null', () => {
      expect(hasProperties(null)).toBe(false)
    })

    it('should return false for empty object', () => {
      expect(hasProperties({})).toBe(false)
    })

    it('should return true when title is present', () => {
      expect(hasProperties({ title: 'Test' })).toBe(true)
    })

    it('should return true when author is present', () => {
      expect(hasProperties({ author: 'John' })).toBe(true)
    })

    it('should return true when pageCount is present', () => {
      expect(hasProperties({ pageCount: 10 })).toBe(true)
    })

    it('should return false when only editTime is present', () => {
      expect(hasProperties({ editTime: 60 })).toBe(false)
    })

    it('should return true when multiple properties are present', () => {
      expect(hasProperties({ title: 'Test', pageCount: 5, wordCount: 100 })).toBe(true)
    })
  })

  describe('mergeProperties', () => {
    it('should merge base and extended, extended wins', () => {
      const merged = mergeProperties(
        { title: 'Base', author: 'A' },
        { title: 'Extended', pageCount: 10 },
      )
      expect(merged).toEqual({ title: 'Extended', author: 'A', pageCount: 10 })
    })

    it('should return copy of base when extended is empty', () => {
      const merged = mergeProperties({ title: 'Base' }, {})
      expect(merged).toEqual({ title: 'Base' })
    })
  })
})
describe('propertyParser header and section bounds', () => {
  const FMTID_SUMMARY = [
    0xF0, 0x4F, 0x87, 0xE0, 0xD0, 0x11, 0xCF, 0x11,
    0x00, 0x00, 0xC0, 0x00, 0x00, 0x00, 0x00, 0x46,
  ]

  /** 构造一个仅含头部（48 字节）的流，字段可按需覆写 */
  function buildHeader(overrides: Record<string, number> = {}): Uint8Array {
    const data = new Uint8Array(64)
    const view = new DataView(data.buffer)
    view.setUint16(0, 0xFFFE, true)
    view.setUint32(24, 1, true) // sectionCount
    data.set(FMTID_SUMMARY, 28)
    view.setUint32(44, 48, true) // sectionOffset
    for (const [offset, value] of Object.entries(overrides)) {
      view.setUint32(Number(offset), value, true)
    }
    return data
  }

  it('rejects a zero section count', () => {
    expect(parseSummaryInformation(buildHeader({ 24: 0 }))).toBeNull()
    expect(parseDocumentSummaryInformation(buildHeader({ 24: 0 }))).toBeNull()
  })

  it('rejects an oversized section count', () => {
    expect(parseSummaryInformation(buildHeader({ 24: 11 }))).toBeNull()
    expect(parseDocumentSummaryInformation(buildHeader({ 24: 11 }))).toBeNull()
  })

  it('rejects a zero section offset', () => {
    expect(parseSummaryInformation(buildHeader({ 44: 0 }))).toBeNull()
    expect(parseDocumentSummaryInformation(buildHeader({ 44: 0 }))).toBeNull()
  })

  it('rejects a section offset at or past the end of data', () => {
    expect(parseSummaryInformation(buildHeader({ 44: 64 }))).toBeNull()
    expect(parseDocumentSummaryInformation(buildHeader({ 44: 100 }))).toBeNull()
  })

  it('rejects a section without room for its 8-byte header', () => {
    // sectionOffset = 60 < 64 有效，但 60+8 > 64
    expect(parseSummaryInformation(buildHeader({ 44: 60 }))).toBeNull()
  })

  it('stops the entry walk when an entry would read past the data end', () => {
    // 1 个属性的空间，但声称 2 个 → 第二个 entryOffset 越界 → break
    const base = buildSummaryStream([{ id: 0x02, type: 0x001E, value: 'T' }])
    const view = new DataView(base.buffer)
    view.setUint32(48 + 4, 2, true) // propertyCount = 2
    const result = parseSummaryInformation(base)
    expect(result?.title).toBe('T')
  })

  it('skips a property whose value offset points past the data end', () => {
    const base = buildSummaryStream([{ id: 0x02, type: 0x001E, value: 'T' }])
    const view = new DataView(base.buffer)
    view.setUint32(48 + 8 + 4, 1000, true) // 第一个 entry 的 propertyOffset 越界
    const result = parseSummaryInformation(base)
    expect(result?.title).toBeUndefined()
  })

  it('reads an empty LPWSTR when the byte length prefix is zero', () => {
    const base = buildSummaryStream([{ id: 0x02, type: 0x001F, value: '' }])
    const view = new DataView(base.buffer)
    // 属性值区：type(4) 位于 48+8+8=64，长度前缀位于 68
    view.setUint32(68, 0, true)
    const result = parseSummaryInformation(base)
    expect(result?.title).toBe('')
  })
})
