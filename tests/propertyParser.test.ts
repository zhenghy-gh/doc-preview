import { describe, it, expect } from 'vitest'
import { parseSummaryInformation, hasProperties } from '../src/utils/propertyParser'

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
    } else if (prop.type === 0x0002) { // I2
      sectionDataSize += 2
    } else if (prop.type === 0x0003) { // I4
      sectionDataSize += 4
    } else if (prop.type === 0x0040 || prop.type === 0x0014) { // FILETIME / I8
      sectionDataSize += 8
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
    } else if (prop.type === 0x0040 || prop.type === 0x0014) { // FILETIME / I8
      view.setBigInt64(valueOffset, BigInt(prop.value as number), true)
      valueOffset += 8
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
})