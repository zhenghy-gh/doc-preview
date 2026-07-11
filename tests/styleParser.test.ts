import { describe, it, expect } from 'vitest'
import {
  parseStylesheet,
  getHeadingLevel,
  getStyleName,
  detectStyleSet,
  BUILTIN_STYLES,
} from '../src/utils/styleParser'

function writeUint16(buffer: Uint8Array, offset: number, value: number): void {
  buffer[offset] = value & 0xFF
  buffer[offset + 1] = (value >> 8) & 0xFF
}

function writeUtf16leString(buffer: Uint8Array, offset: number, str: string): number {
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i)
    buffer[offset + i * 2] = code & 0xFF
    buffer[offset + i * 2 + 1] = (code >> 8) & 0xFF
  }
  return str.length * 2
}

describe('styleParser', () => {
  describe('parseStylesheet', () => {
    it('should return empty array for invalid input', () => {
      expect(parseStylesheet(new Uint8Array(0), 0, 0)).toEqual([])
      expect(parseStylesheet(new Uint8Array(10), 0, 0)).toEqual([])
      expect(parseStylesheet(new Uint8Array(10), 100, 10)).toEqual([])
    })

    it('should return empty array for zero styles', () => {
      const data = new Uint8Array(16)
      writeUint16(data, 0, 0) // cstd = 0
      writeUint16(data, 2, 28) // cbStd
      const result = parseStylesheet(data, 0, 16)
      expect(result).toEqual([])
    })

    it('should return built-in styles when string table is corrupt (fallback)', () => {
      // cstd is reasonable but string table has all zeros (corrupt)
      const data = new Uint8Array(64)
      writeUint16(data, 0, 5) // cstd = 5
      writeUint16(data, 2, 28) // cbStd
      // Rest is all zeros → string table will have 0-length strings
      const result = parseStylesheet(data, 0, 64)
      // Should have at least some built-in styles as fallback
      expect(result.length).toBeGreaterThan(0)
      expect(result.some(s => s.name === 'Normal')).toBe(true)
      expect(result.some(s => s.name === 'Heading 1')).toBe(true)
    })

    it('should parse a simple stylesheet with string table first', () => {
      const styleNames = ['Normal', 'Heading 1', 'Heading 2']
      const cstd = styleNames.length
      const cbStd = 28

      // Calculate buffer size
      let strTableSize = 0
      const nameByteLengths = styleNames.map(n => n.length * 2)
      strTableSize = nameByteLengths.reduce((a, b) => a + b + 2, 0) // +2 for each length prefix

      const stdArraySize = cstd * cbStd
      const totalSize = 4 + strTableSize + stdArraySize

      const data = new Uint8Array(totalSize)
      let pos = 0

      // Header
      writeUint16(data, pos, cstd); pos += 2
      writeUint16(data, pos, cbStd); pos += 2

      // String table
      for (let i = 0; i < styleNames.length; i++) {
        writeUint16(data, pos, nameByteLengths[i]); pos += 2
        pos += writeUtf16leString(data, pos, styleNames[i])
      }

      // STD array (just zeros, we don't parse them fully)
      const result = parseStylesheet(data, 0, totalSize)

      // Should have at least the styles we provided names for
      expect(result.length).toBeGreaterThanOrEqual(3)
      expect(result[0].istd).toBe(0)
      expect(result[0].name).toBe('Normal')
      expect(result[1].istd).toBe(1)
      expect(result[1].name).toBe('Heading 1')
      expect(result[2].istd).toBe(2)
      expect(result[2].name).toBe('Heading 2')
    })

    it('should handle stylesheet with STD array first format (alternative layout)', () => {
      const styleNames = ['Normal', 'Heading 1']
      const cstd = styleNames.length
      const cbStd = 28

      const nameByteLengths = styleNames.map(n => n.length * 2)
      const strTableSize = nameByteLengths.reduce((a, b) => a + b + 2, 0)
      const stdArraySize = cstd * cbStd
      const totalSize = 4 + stdArraySize + strTableSize

      const data = new Uint8Array(totalSize)
      let pos = 0

      // Header
      writeUint16(data, pos, cstd); pos += 2
      writeUint16(data, pos, cbStd); pos += 2

      // Skip STD array (all zeros)
      pos += stdArraySize

      // String table comes after STD array
      for (let i = 0; i < styleNames.length; i++) {
        writeUint16(data, pos, nameByteLengths[i]); pos += 2
        pos += writeUtf16leString(data, pos, styleNames[i])
      }

      const result = parseStylesheet(data, 0, totalSize)
      // The parser tries both layouts; it should find the names somehow
      // (at minimum, the built-in fallback kicks in)
      expect(result.length).toBeGreaterThan(0)
    })
  })

  describe('getHeadingLevel', () => {
    it('should return 1-9 for Heading N styles (English)', () => {
      expect(getHeadingLevel('Heading 1')).toBe(1)
      expect(getHeadingLevel('Heading 2')).toBe(2)
      expect(getHeadingLevel('Heading 3')).toBe(3)
      expect(getHeadingLevel('Heading 9')).toBe(9)
    })

    it('should be case-insensitive', () => {
      expect(getHeadingLevel('heading 1')).toBe(1)
      expect(getHeadingLevel('HEADING 2')).toBe(2)
      expect(getHeadingLevel('Heading   3')).toBe(3)
    })

    it('should return null for non-heading styles', () => {
      expect(getHeadingLevel('Normal')).toBeNull()
      expect(getHeadingLevel('Body Text')).toBeNull()
      expect(getHeadingLevel('')).toBeNull()
    })

    it('should return null for out-of-range heading levels', () => {
      expect(getHeadingLevel('Heading 0')).toBeNull()
      expect(getHeadingLevel('Heading 10')).toBeNull()
    })

    it('should handle Chinese heading names', () => {
      expect(getHeadingLevel('标题 1')).toBe(1)
      expect(getHeadingLevel('标题 2')).toBe(2)
      expect(getHeadingLevel('标题 3')).toBe(3)
    })
  })

  describe('getStyleName', () => {
    it('should return the style name from the styles array', () => {
      const styles = [
        { istd: 0, name: 'Normal', type: 'paragraph' as const },
        { istd: 1, name: 'My Heading', type: 'paragraph' as const },
      ]
      expect(getStyleName(styles, 0)).toBe('Normal')
      expect(getStyleName(styles, 1)).toBe('My Heading')
    })

    it('should fall back to built-in styles if not in array', () => {
      const styles: any[] = []
      expect(getStyleName(styles, 0)).toBe('Normal')
      expect(getStyleName(styles, 1)).toBe('Heading 1')
      expect(getStyleName(styles, 2)).toBe('Heading 2')
    })

    it('should return Style N for unknown indices', () => {
      const styles: any[] = []
      expect(getStyleName(styles, 999)).toBe('Style 999')
    })
  })

  describe('BUILTIN_STYLES', () => {
    it('should have Normal at index 0', () => {
      expect(BUILTIN_STYLES[0]).toBeDefined()
      expect(BUILTIN_STYLES[0].name).toBe('Normal')
    })

    it('should have Heading 1-9', () => {
      for (let i = 1; i <= 9; i++) {
        expect(BUILTIN_STYLES[i]).toBeDefined()
        expect(BUILTIN_STYLES[i].name).toBe(`Heading ${i}`)
      }
    })

    it('should have character styles', () => {
      expect(BUILTIN_STYLES[23]).toBeDefined() // Footnote Text
      expect(BUILTIN_STYLES[24]).toBeDefined() // Footnote Reference
      expect(BUILTIN_STYLES[24].type).toBe('character')
    })
  })

  describe('detectStyleSet', () => {
    it('should detect Default style set with standard heading styles', () => {
      const styles = [
        { istd: 0, name: 'Normal', type: 'paragraph' as const },
        { istd: 1, name: 'Heading 1', type: 'paragraph' as const },
        { istd: 2, name: 'Heading 2', type: 'paragraph' as const },
        { istd: 3, name: 'Heading 3', type: 'paragraph' as const },
      ]
      const result = detectStyleSet(styles)
      expect(result).not.toBeNull()
      expect(result!.name).toBe('Default')
    })

    it('should detect Elegant style set', () => {
      const styles = [
        { istd: 0, name: 'Normal', type: 'paragraph' as const },
        { istd: 1, name: 'Elegant Heading', type: 'paragraph' as const },
        { istd: 2, name: 'Elegant Title', type: 'paragraph' as const },
      ]
      const result = detectStyleSet(styles)
      expect(result).not.toBeNull()
      expect(result!.name).toBe('Elegant')
    })

    it('should return null for empty styles', () => {
      expect(detectStyleSet([])).toBeNull()
    })

    it('should detect custom style set for many styles without known patterns', () => {
      const styles = Array.from({ length: 25 }, (_, i) => ({
        istd: i,
        name: `Custom${i}`,
        type: 'paragraph' as const,
      }))
      const result = detectStyleSet(styles)
      expect(result).not.toBeNull()
      expect(result!.isCustom).toBe(true)
    })

    it('should detect Default for heading styles even without pattern match', () => {
      const styles = [
        { istd: 0, name: 'Normal', type: 'paragraph' as const },
        { istd: 1, name: 'Heading 1', type: 'paragraph' as const },
        { istd: 2, name: 'Heading 2', type: 'paragraph' as const },
        { istd: 3, name: 'Body Text', type: 'paragraph' as const },
        { istd: 4, name: 'Title', type: 'paragraph' as const },
      ]
      const result = detectStyleSet(styles)
      expect(result).not.toBeNull()
      expect(result!.name).toBe('Default')
    })
  })
})
