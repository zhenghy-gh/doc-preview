import { describe, it, expect } from 'vitest'
import { extractShapesFromDataStream, extractShapesFromWordDocumentStream, spidToShapeType } from '../src/utils/shapeParser'

describe('shapeParser', () => {
  describe('spidToShapeType', () => {
    it('should return rectangle for spid type 0', () => {
      expect(spidToShapeType(0x00000000)).toBe('rectangle')
      expect(spidToShapeType(0x0FFFFFFF)).toBe('rectangle')
    })

    it('should return ellipse for spid type 1', () => {
      expect(spidToShapeType(0x10000000)).toBe('ellipse')
      expect(spidToShapeType(0x1FFFFFFF)).toBe('ellipse')
    })

    it('should return line for spid type 2', () => {
      expect(spidToShapeType(0x20000000)).toBe('line')
    })

    it('should return freeform for spid type 3', () => {
      expect(spidToShapeType(0x30000000)).toBe('freeform')
    })

    it('should return textbox for spid type 4', () => {
      expect(spidToShapeType(0x40000000)).toBe('textbox')
    })

    it('should return picture for spid type 5', () => {
      expect(spidToShapeType(0x50000000)).toBe('picture')
    })

    it('should return group for spid type 6', () => {
      expect(spidToShapeType(0x60000000)).toBe('group')
    })

    it('should return unknown for spid type 7+', () => {
      expect(spidToShapeType(0x70000000)).toBe('unknown')
      expect(spidToShapeType(0xF0000000)).toBe('unknown')
    })
  })

  describe('extractShapesFromDataStream', () => {
    it('should return empty array for empty input', () => {
      const result = extractShapesFromDataStream(new Uint8Array())
      expect(result).toEqual([])
    })

    it('should return empty array for small input', () => {
      const result = extractShapesFromDataStream(new Uint8Array(60))
      expect(result).toEqual([])
    })

    it('should return empty array for data without Office Art signatures', () => {
      const data = new Uint8Array(100)
      for (let i = 0; i < 100; i++) {
        data[i] = i % 256
      }
      const result = extractShapesFromDataStream(data)
      expect(result).toEqual([])
    })
  })

  describe('extractShapesFromWordDocumentStream', () => {
    it('should return empty array for empty input', () => {
      const result = extractShapesFromWordDocumentStream(new Uint8Array())
      expect(result).toEqual([])
    })

    it('should return empty array for small input', () => {
      const result = extractShapesFromWordDocumentStream(new Uint8Array(60))
      expect(result).toEqual([])
    })
  })
})