import { describe, it, expect } from 'vitest'
import {
  parsePlcfHdd,
  splitHeaderText,
  splitHeaderTextHeuristic,
  getActivePartTypes,
  getPartLabel,
} from '../src/utils/headerFooterParser'
import type { HeaderFooterPartType } from '../src/utils/docFormat'

describe('headerFooterParser', () => {
  describe('getPartLabel', () => {
    it('should return correct labels for all part types', () => {
      expect(getPartLabel('titleHeader')).toBe('首页页眉')
      expect(getPartLabel('titleFooter')).toBe('首页页脚')
      expect(getPartLabel('oddHeader')).toBe('奇数页页眉')
      expect(getPartLabel('oddFooter')).toBe('奇数页页脚')
      expect(getPartLabel('evenHeader')).toBe('偶数页页眉')
      expect(getPartLabel('evenFooter')).toBe('偶数页页脚')
    })
  })

  describe('getActivePartTypes', () => {
    it('should return 2 types when no titlePage and no facingPages', () => {
      const types = getActivePartTypes(false, false)
      expect(types).toEqual(['oddHeader', 'oddFooter'])
      expect(types.length).toBe(2)
    })

    it('should return 4 types when titlePage but no facingPages', () => {
      const types = getActivePartTypes(true, false)
      expect(types).toEqual(['titleHeader', 'titleFooter', 'oddHeader', 'oddFooter'])
      expect(types.length).toBe(4)
    })

    it('should return 4 types when facingPages but no titlePage', () => {
      const types = getActivePartTypes(false, true)
      expect(types).toEqual(['oddHeader', 'oddFooter', 'evenHeader', 'evenFooter'])
      expect(types.length).toBe(4)
    })

    it('should return 6 types when both titlePage and facingPages', () => {
      const types = getActivePartTypes(true, true)
      expect(types).toEqual([
        'titleHeader', 'titleFooter',
        'oddHeader', 'oddFooter',
        'evenHeader', 'evenFooter',
      ])
      expect(types.length).toBe(6)
    })
  })

  describe('parsePlcfHdd', () => {
    it('should return null for empty data', () => {
      const data = new Uint8Array(0)
      expect(parsePlcfHdd(data, false, false)).toBeNull()
    })

    it('should return null for too short data', () => {
      const data = new Uint8Array([0x01, 0x00, 0x00, 0x00])
      expect(parsePlcfHdd(data, false, false)).toBeNull()
    })

    it('should parse PlcfHdd with 2 sub-ranges (no titlePage, no facingPages)', () => {
      // n=1, cps = [0, 10]
      // data = 4 bytes CP[0] + 4 bytes CP[1] + 8 bytes SED[0] = 16 bytes
      const data = new Uint8Array(16)
      // CP[0] = 0
      data[0] = 0; data[1] = 0; data[2] = 0; data[3] = 0
      // CP[1] = 10
      data[4] = 10; data[5] = 0; data[6] = 0; data[7] = 0
      // SED[0] = zeros (8 bytes, already 0)

      const result = parsePlcfHdd(data, false, false)
      expect(result).not.toBeNull()
      expect(result!.parts.length).toBe(1) // oddHeader (0..10), oddFooter skipped (no CP[2])
    })

    it('should parse PlcfHdd with 4 sub-ranges (titlePage, no facingPages)', () => {
      // n=3, cps = [0, 5, 10, 15]
      // data = 4*4 bytes CP + 3*8 bytes SED = 16 + 24 = 40 bytes
      const data = new Uint8Array(40)
      // CP[0] = 0
      data[0] = 0; data[1] = 0; data[2] = 0; data[3] = 0
      // CP[1] = 5
      data[4] = 5; data[5] = 0; data[6] = 0; data[7] = 0
      // CP[2] = 10
      data[8] = 10; data[9] = 0; data[10] = 0; data[11] = 0
      // CP[3] = 15
      data[12] = 15; data[13] = 0; data[14] = 0; data[15] = 0

      const result = parsePlcfHdd(data, true, false)
      expect(result).not.toBeNull()
      expect(result!.parts.length).toBe(3) // titleHeader, titleFooter, oddHeader (oddFooter skipped)
    })

    it('should skip empty sub-ranges (startCp >= endCp)', () => {
      // n=1, cps = [5, 5] (empty range)
      const data = new Uint8Array(16)
      // CP[0] = 5
      data[0] = 5; data[1] = 0; data[2] = 0; data[3] = 0
      // CP[1] = 5
      data[4] = 5; data[5] = 0; data[6] = 0; data[7] = 0

      const result = parsePlcfHdd(data, false, false)
      expect(result).not.toBeNull()
      expect(result!.parts.length).toBe(0) // empty range skipped
    })
  })

  describe('splitHeaderText', () => {
    it('should return null for empty text', () => {
      const result = splitHeaderText('', { parts: [] })
      expect(result).toBeNull()
    })

    it('should return null for empty parts', () => {
      const result = splitHeaderText('test', { parts: [] })
      expect(result).toBeNull()
    })

    it('should split text by CP boundaries', () => {
      const split = {
        parts: [
          { type: 'oddHeader' as HeaderFooterPartType, startCp: 0, endCp: 5 },
          { type: 'oddFooter' as HeaderFooterPartType, startCp: 5, endCp: 10 },
        ],
      }
      const result = splitHeaderText('HelloWorld', split)
      expect(result).not.toBeNull()
      expect(result!.oddHeader).toBe('Hello')
      expect(result!.oddFooter).toBe('World')
    })

    it('should handle CP beyond text length', () => {
      const split = {
        parts: [
          { type: 'oddHeader' as HeaderFooterPartType, startCp: 0, endCp: 100 },
        ],
      }
      const result = splitHeaderText('Short', split)
      expect(result).not.toBeNull()
      expect(result!.oddHeader).toBe('Short')
    })

    it('should skip empty text segments', () => {
      const split = {
        parts: [
          { type: 'oddHeader' as HeaderFooterPartType, startCp: 0, endCp: 5 },
          { type: 'oddFooter' as HeaderFooterPartType, startCp: 5, endCp: 5 },
        ],
      }
      const result = splitHeaderText('HelloWorld', split)
      expect(result).not.toBeNull()
      expect(result!.oddHeader).toBe('Hello')
      expect(result!.oddFooter).toBeUndefined()
    })
  })

  describe('splitHeaderTextHeuristic', () => {
    it('should return null for empty text', () => {
      expect(splitHeaderTextHeuristic('', false, false)).toBeNull()
    })

    it('should return null for whitespace-only text', () => {
      expect(splitHeaderTextHeuristic('   \n  \n  ', false, false)).toBeNull()
    })

    it('should split by paragraphs for 2 parts (no titlePage, no facingPages)', () => {
      const text = 'Header line\nFooter line'
      const result = splitHeaderTextHeuristic(text, false, false)
      expect(result).not.toBeNull()
      expect(result!.oddHeader).toBe('Header line')
      expect(result!.oddFooter).toBe('Footer line')
    })

    it('should split by paragraphs for 4 parts (titlePage, no facingPages)', () => {
      const text = 'Title Header\nTitle Footer\nOdd Header\nOdd Footer'
      const result = splitHeaderTextHeuristic(text, true, false)
      expect(result).not.toBeNull()
      expect(result!.titleHeader).toBe('Title Header')
      expect(result!.titleFooter).toBe('Title Footer')
      expect(result!.oddHeader).toBe('Odd Header')
      expect(result!.oddFooter).toBe('Odd Footer')
    })

    it('should split by paragraphs for 6 parts (titlePage and facingPages)', () => {
      const text = 'TH\nTF\nOH\nOF\nEH\nEF'
      const result = splitHeaderTextHeuristic(text, true, true)
      expect(result).not.toBeNull()
      expect(result!.titleHeader).toBe('TH')
      expect(result!.titleFooter).toBe('TF')
      expect(result!.oddHeader).toBe('OH')
      expect(result!.oddFooter).toBe('OF')
      expect(result!.evenHeader).toBe('EH')
      expect(result!.evenFooter).toBe('EF')
    })

    it('should append extra paragraphs to oddHeader', () => {
      const text = 'Header\nFooter\nExtra1\nExtra2'
      const result = splitHeaderTextHeuristic(text, false, false)
      expect(result).not.toBeNull()
      expect(result!.oddHeader).toContain('Header')
      expect(result!.oddHeader).toContain('Extra1')
      expect(result!.oddHeader).toContain('Extra2')
      expect(result!.oddFooter).toBe('Footer')
    })

    it('should handle single paragraph text', () => {
      const text = 'Only one paragraph'
      const result = splitHeaderTextHeuristic(text, false, false)
      expect(result).not.toBeNull()
      expect(result!.oddHeader).toBe('Only one paragraph')
    })

    it('should handle \r\n line endings', () => {
      const text = 'Header\r\nFooter'
      const result = splitHeaderTextHeuristic(text, false, false)
      expect(result).not.toBeNull()
      expect(result!.oddHeader).toBe('Header')
      expect(result!.oddFooter).toBe('Footer')
    })
  })
})
