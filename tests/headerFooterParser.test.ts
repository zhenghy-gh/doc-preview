import { describe, it, expect } from 'vitest'
import {
  parsePlcfHdd,
  splitHeaderText,
  splitHeaderTextHeuristic,
  splitHeaderTextWithImages,
  getActivePartTypes,
  getPartLabel,
} from '../src/utils/headerFooterParser'
import type { HeaderFooterPartType } from '../src/utils/docFormat'
import type { ParsedPicture } from '../src/utils/pictureParser'

function makePic(overrides: Partial<ParsedPicture> = {}): ParsedPicture {
  return {
    format: 'png',
    data: new Uint8Array([0x89, 0x50, 0x4E, 0x47]),
    type: 'inline',
    widthPx: 10,
    heightPx: 20,
    floating: false,
    dataOffset: 0,
    ...overrides,
  }
}

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

    it('should return null when the sub-range count is invalid (n=0)', () => {
      // 8 bytes → n = floor((8-4)/12) = 0 → invalid
      const data = new Uint8Array(8)
      expect(parsePlcfHdd(data, false, false)).toBeNull()
    })

    it('should return null for 12-byte data (still n=0)', () => {
      // 12 bytes → n = floor((12-4)/12) = 0
      const data = new Uint8Array(12)
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

  describe('splitHeaderTextWithImages', () => {
    const split = {
      parts: [
        { type: 'oddHeader' as HeaderFooterPartType, startCp: 0, endCp: 5 },
        { type: 'oddFooter' as HeaderFooterPartType, startCp: 5, endCp: 10 },
      ],
    }

    it('should return null for empty text', () => {
      expect(splitHeaderTextWithImages('', split)).toBeNull()
    })

    it('should return null for empty parts', () => {
      expect(splitHeaderTextWithImages('HelloWorld', { parts: [] })).toBeNull()
    })

    it('should split text and attach pictures by dataOffset within range', () => {
      const pics = [
        makePic({ dataOffset: 2, format: 'png' }),
        makePic({ dataOffset: 20 }), // outside both ranges
      ]
      const result = splitHeaderTextWithImages('HelloWorld', split, pics)
      expect(result).not.toBeNull()
      expect(result!.oddHeader!.text).toBe('Hello')
      expect(result!.oddHeader!.images).toHaveLength(1)
      expect(result!.oddHeader!.images![0].format).toBe('png')
      expect(result!.oddHeader!.images![0].dataUrl).toContain('data:image/png;base64,')
      expect(result!.oddFooter!.text).toBe('World')
      expect(result!.oddFooter!.images).toBeUndefined()
    })

    it('should produce correct data URL mime types per format', () => {
      const pics = [
        makePic({ dataOffset: 1, format: 'jpeg' }),
        makePic({ dataOffset: 2, format: 'gif' }),
        makePic({ dataOffset: 3, format: 'bmp' }),
        makePic({ dataOffset: 4, format: 'emf' }),
      ]
      const result = splitHeaderTextWithImages('HelloWorld', split, pics)
      const images = result!.oddHeader!.images!
      expect(images[0].dataUrl).toContain('data:image/jpeg;base64,')
      expect(images[1].dataUrl).toContain('data:image/gif;base64,')
      expect(images[2].dataUrl).toContain('data:image/bmp;base64,')
      expect(images[3].dataUrl).toContain('data:application/octet-stream;base64,')
    })

    it('should skip pictures with unknown format', () => {
      const pics = [makePic({ dataOffset: 1, format: 'unknown' })]
      const result = splitHeaderTextWithImages('HelloWorld', split, pics)
      expect(result!.oddHeader!.images).toBeUndefined()
    })

    it('should skip empty text ranges', () => {
      const emptySplit = {
        parts: [
          { type: 'oddHeader' as HeaderFooterPartType, startCp: 5, endCp: 5 },
        ],
      }
      expect(splitHeaderTextWithImages('HelloWorld', emptySplit)).toBeNull()
    })

    it('should return part with only images when text is blank', () => {
      const blankSplit = {
        parts: [
          { type: 'oddHeader' as HeaderFooterPartType, startCp: 0, endCp: 5 },
        ],
      }
      const result = splitHeaderTextWithImages('     ', blankSplit, [makePic({ dataOffset: 2 })])
      expect(result).not.toBeNull()
      expect(result!.oddHeader!.text).toBe('')
      expect(result!.oddHeader!.images).toHaveLength(1)
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
