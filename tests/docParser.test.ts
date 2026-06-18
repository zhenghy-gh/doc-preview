import { describe, it, expect } from 'vitest'
import { DocParser, parseDocFileFromBuffer } from '../src/utils/docParser'

describe('DocParser', () => {
  describe('parseDocFileFromBuffer', () => {
    it('should fail gracefully for empty buffer', () => {
      const result = parseDocFileFromBuffer(new ArrayBuffer(0))
      expect(result.success).toBe(false)
      expect(result.error).toBeTruthy()
    })

    it('should fail for DOCX (ZIP) signature', () => {
      const buf = new ArrayBuffer(512)
      const view = new Uint8Array(buf)
      // PK\x03\x04 signature
      view[0] = 0x50; view[1] = 0x4B; view[2] = 0x03; view[3] = 0x04
      const result = parseDocFileFromBuffer(buf)
      expect(result.success).toBe(false)
      expect(result.error).toContain('docx')
    })

    it('should fail for non-OLE data', () => {
      const buf = new ArrayBuffer(512)
      const view = new Uint8Array(buf)
      for (let i = 0; i < buf.byteLength; i++) view[i] = 0xFF
      const result = parseDocFileFromBuffer(buf)
      expect(result.success).toBe(false)
      expect(result.error).toBeTruthy()
    })

    it('should fail for tiny buffer', () => {
      const result = parseDocFileFromBuffer(new ArrayBuffer(4))
      expect(result.success).toBe(false)
      expect(result.error).toBeTruthy()
    })
  })

  describe('maxScanBytes', () => {
    it('should use default maxScanBytes when not specified', () => {
      const parser = new DocParser(new ArrayBuffer(512))
      expect(parser.maxScanBytes).toBe(10 * 1024 * 1024)
    })

    it('should accept custom maxScanBytes', () => {
      const parser = new DocParser(new ArrayBuffer(512), 1000)
      expect(parser.maxScanBytes).toBe(1000)
    })
  })

  describe('parse', () => {
    it('should fail gracefully for non-OLE buffer', () => {
      const parser = new DocParser(new ArrayBuffer(512))
      const result = parser.parse()
      expect(result.success).toBe(false)
      expect(result.error).toBeTruthy()
    })
  })

  describe('parseWithFormat', () => {
    it('should fail gracefully for non-OLE buffer', () => {
      const parser = new DocParser(new ArrayBuffer(512))
      const result = parser.parseWithFormat()
      expect(result.success).toBe(false)
      expect(result.error).toBeTruthy()
    })
  })
})
