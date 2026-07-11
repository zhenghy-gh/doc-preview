import { describe, it, expect } from 'vitest'
import { extractWordArtFromDirectory, extractWordArtFromDrawingData, getEffectLabel } from '../src/utils/wordArtParser'
import type { DirectoryEntry } from '../src/utils/oleParser'

describe('wordArtParser', () => {
  describe('getEffectLabel', () => {
    it('should return correct labels for all effects', () => {
      expect(getEffectLabel('gradient')).toBe('渐变')
      expect(getEffectLabel('shadow')).toBe('阴影')
      expect(getEffectLabel('emboss')).toBe('浮雕')
      expect(getEffectLabel('bevel')).toBe('斜角')
      expect(getEffectLabel('outline')).toBe('轮廓')
      expect(getEffectLabel('fill')).toBe('填充')
      expect(getEffectLabel('3d')).toBe('3D')
      expect(getEffectLabel('rotate')).toBe('旋转')
      expect(getEffectLabel('flip')).toBe('翻转')
      expect(getEffectLabel('stretch')).toBe('拉伸')
      expect(getEffectLabel('unknown')).toBe('未知')
    })
  })

  describe('extractWordArtFromDirectory', () => {
    it('should extract WordArt objects', () => {
      const directory: DirectoryEntry[] = [
        {
          name: 'WordArt.1',
          objectType: 1,
          leftSibling: -1,
          rightSibling: -1,
          child: -1,
          clsid: new Uint8Array(16),
          stateBits: 0,
          creationTime: 0,
          modificationTime: 0,
          startSector: 1,
          size: 1000,
        },
      ]

      const wordArts = extractWordArtFromDirectory(directory, () => null)
      expect(wordArts.length).toBe(1)
      expect(wordArts[0].name).toBe('WordArt.1')
      expect(wordArts[0].effects).toContain('fill')
    })

    it('should extract WordArt.2', () => {
      const directory: DirectoryEntry[] = [
        {
          name: 'WordArt.2',
          objectType: 1,
          leftSibling: -1,
          rightSibling: -1,
          child: -1,
          clsid: new Uint8Array(16),
          stateBits: 0,
          creationTime: 0,
          modificationTime: 0,
          startSector: 1,
          size: 1000,
        },
      ]

      const wordArts = extractWordArtFromDirectory(directory, () => null)
      expect(wordArts.length).toBe(1)
      expect(wordArts[0].name).toBe('WordArt.2')
    })

    it('should extract Microsoft.WordArt', () => {
      const directory: DirectoryEntry[] = [
        {
          name: 'Microsoft.WordArt',
          objectType: 1,
          leftSibling: -1,
          rightSibling: -1,
          child: -1,
          clsid: new Uint8Array(16),
          stateBits: 0,
          creationTime: 0,
          modificationTime: 0,
          startSector: 1,
          size: 1000,
        },
      ]

      const wordArts = extractWordArtFromDirectory(directory, () => null)
      expect(wordArts.length).toBe(1)
    })

    it('should skip non-WordArt entries', () => {
      const directory: DirectoryEntry[] = [
        {
          name: 'WordDocument',
          objectType: 2,
          leftSibling: -1,
          rightSibling: -1,
          child: -1,
          clsid: new Uint8Array(16),
          stateBits: 0,
          creationTime: 0,
          modificationTime: 0,
          startSector: 0,
          size: 10000,
        },
        {
          name: 'SummaryInformation',
          objectType: 2,
          leftSibling: -1,
          rightSibling: -1,
          child: -1,
          clsid: new Uint8Array(16),
          stateBits: 0,
          creationTime: 0,
          modificationTime: 0,
          startSector: 2,
          size: 512,
        },
      ]

      const wordArts = extractWordArtFromDirectory(directory, () => null)
      expect(wordArts.length).toBe(0)
    })

    it('should handle empty directory', () => {
      const wordArts = extractWordArtFromDirectory([], () => null)
      expect(wordArts.length).toBe(0)
    })

    it('should extract text from data', () => {
      const textData = new Uint8Array([0x54, 0x00, 0x65, 0x00, 0x73, 0x00, 0x74, 0x00])
      const directory: DirectoryEntry[] = [
        {
          name: 'WordArt.1',
          objectType: 1,
          leftSibling: -1,
          rightSibling: -1,
          child: -1,
          clsid: new Uint8Array(16),
          stateBits: 0,
          creationTime: 0,
          modificationTime: 0,
          startSector: 1,
          size: textData.length,
        },
      ]

      const wordArts = extractWordArtFromDirectory(directory, () => ({ data: textData, size: textData.length }))
      expect(wordArts.length).toBe(1)
      expect(wordArts[0].text).toBe('Test')
    })

    it('should detect gradient effect from data', () => {
      const gradientData = new Uint8Array([0x10, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00])
      const directory: DirectoryEntry[] = [
        {
          name: 'WordArt.1',
          objectType: 1,
          leftSibling: -1,
          rightSibling: -1,
          child: -1,
          clsid: new Uint8Array(16),
          stateBits: 0,
          creationTime: 0,
          modificationTime: 0,
          startSector: 1,
          size: gradientData.length,
        },
      ]

      const wordArts = extractWordArtFromDirectory(directory, () => ({ data: gradientData, size: gradientData.length }))
      expect(wordArts.length).toBe(1)
      expect(wordArts[0].effects).toContain('gradient')
    })

    it('should detect shadow effect from data', () => {
      const shadowData = new Uint8Array([0x4B, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00])
      const directory: DirectoryEntry[] = [
        {
          name: 'WordArt.1',
          objectType: 1,
          leftSibling: -1,
          rightSibling: -1,
          child: -1,
          clsid: new Uint8Array(16),
          stateBits: 0,
          creationTime: 0,
          modificationTime: 0,
          startSector: 1,
          size: shadowData.length,
        },
      ]

      const wordArts = extractWordArtFromDirectory(directory, () => ({ data: shadowData, size: shadowData.length }))
      expect(wordArts.length).toBe(1)
      expect(wordArts[0].effects).toContain('shadow')
    })

    it('should detect 3d effect from data', () => {
      const data3d = new Uint8Array([0x4C, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00])
      const directory: DirectoryEntry[] = [
        {
          name: 'WordArt.1',
          objectType: 1,
          leftSibling: -1,
          rightSibling: -1,
          child: -1,
          clsid: new Uint8Array(16),
          stateBits: 0,
          creationTime: 0,
          modificationTime: 0,
          startSector: 1,
          size: data3d.length,
        },
      ]

      const wordArts = extractWordArtFromDirectory(directory, () => ({ data: data3d, size: data3d.length }))
      expect(wordArts.length).toBe(1)
      expect(wordArts[0].effects).toContain('3d')
    })

    it('should extract colors from data', () => {
      const colorData = new Uint8Array([0x00, 0x00, 0xFF, 0xFF, 0xFF, 0x00, 0x00, 0xFF])
      const directory: DirectoryEntry[] = [
        {
          name: 'WordArt.1',
          objectType: 1,
          leftSibling: -1,
          rightSibling: -1,
          child: -1,
          clsid: new Uint8Array(16),
          stateBits: 0,
          creationTime: 0,
          modificationTime: 0,
          startSector: 1,
          size: colorData.length,
        },
      ]

      const wordArts = extractWordArtFromDirectory(directory, () => ({ data: colorData, size: colorData.length }))
      expect(wordArts.length).toBe(1)
      expect(wordArts[0].colors).toBeDefined()
      expect(wordArts[0].colors!.length).toBeGreaterThan(0)
    })
  })

  describe('extractWordArtFromDrawingData', () => {
    it('should handle empty data', () => {
      const data = new Uint8Array(0)
      const wordArts = extractWordArtFromDrawingData(data)
      expect(wordArts.length).toBe(0)
    })

    it('should handle small data', () => {
      const data = new Uint8Array(100)
      const wordArts = extractWordArtFromDrawingData(data)
      expect(wordArts.length).toBe(0)
    })

    it('should detect WordArt markers', () => {
      const data = new Uint8Array([0xE0, 0x00, 0x00, 0x00])
      const wordArts = extractWordArtFromDrawingData(data)
      expect(wordArts.length).toBe(0)
    })
  })
})
