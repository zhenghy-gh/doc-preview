import { describe, it, expect } from 'vitest'
import { OleParser } from '../src/utils/oleParser'

function createBuffer(signature: number[]): ArrayBuffer {
  const buf = new ArrayBuffer(512)
  const view = new Uint8Array(buf)
  for (let i = 0; i < signature.length && i < buf.byteLength; i++) {
    view[i] = signature[i]
  }
  return buf
}

describe('OleParser', () => {
  describe('detectFormat', () => {
    it('should detect OLE format', () => {
      const sig = [0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1]
      const parser = new OleParser(createBuffer(sig))
      expect(parser.detectFormat()).toBe('ole')
    })

    it('should detect DOCX (ZIP) format', () => {
      const sig = [0x50, 0x4B, 0x03, 0x04]
      const parser = new OleParser(createBuffer(sig))
      expect(parser.detectFormat()).toBe('docx')
    })

    it('should return unknown for empty buffer', () => {
      const parser = new OleParser(new ArrayBuffer(2))
      expect(parser.detectFormat()).toBe('unknown')
    })

    it('should return unknown for random data', () => {
      const buf = new ArrayBuffer(512)
      const view = new Uint8Array(buf)
      for (let i = 0; i < 512; i++) view[i] = (i * 7 + 13) & 0xff
      const parser = new OleParser(buf)
      expect(parser.detectFormat()).toBe('unknown')
    })
  })

  describe('isOleFile', () => {
    it('should return true for OLE file', () => {
      const sig = [0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1]
      const parser = new OleParser(createBuffer(sig))
      expect(parser.isOleFile()).toBe(true)
    })

    it('should return false for DOCX file', () => {
      const sig = [0x50, 0x4B, 0x03, 0x04]
      const parser = new OleParser(createBuffer(sig))
      expect(parser.isOleFile()).toBe(false)
    })

    it('should return false for too small file', () => {
      const parser = new OleParser(new ArrayBuffer(4))
      expect(parser.isOleFile()).toBe(false)
    })
  })

  describe('getFormatErrorString', () => {
    it('should return DOCX error for PK signature', () => {
      const sig = [0x50, 0x4B, 0x03, 0x04]
      const parser = new OleParser(createBuffer(sig))
      const err = parser.getFormatErrorString()
      expect(err).toContain('docx')
      expect(err).toContain('OLE2')
    })

    it('should return generic error for unknown format', () => {
      const parser = new OleParser(new ArrayBuffer(2))
      const err = parser.getFormatErrorString()
      expect(err).toContain('无法识别')
    })

    it('should return unknown format error for random data', () => {
      const buf = new ArrayBuffer(512)
      const view = new Uint8Array(buf)
      for (let i = 0; i < 512; i++) view[i] = (i * 7 + 13) & 0xff
      const parser = new OleParser(buf)
      const err = parser.getFormatErrorString()
      expect(err).toContain('无法识别')
    })
  })

  describe('safeRead methods', () => {
    it('should handle out-of-bounds reads', () => {
      const parser = new OleParser(new ArrayBuffer(10))
      expect(parser.safeReadUint8(100)).toBe(0)
      expect(parser.safeReadUint16(100)).toBe(0)
      expect(parser.safeReadInt32(100)).toBe(0)
      expect(parser.safeReadUint32(100)).toBe(0)
    })

    it('should read valid values', () => {
      const buf = new ArrayBuffer(10)
      const view = new Uint8Array(buf)
      view[0] = 0x42
      view[1] = 0x01
      const parser = new OleParser(buf)
      expect(parser.safeReadUint8(0)).toBe(0x42)
      expect(parser.safeReadUint16(0)).toBe(0x0142)
    })
  })

  describe('parseHeader', () => {
    it('should parse a valid header with sector size 512 (power=9)', () => {
      const buf = new ArrayBuffer(512)
      const view = new Uint8Array(buf)
      // OLE signature
      view[0] = 0xD0; view[1] = 0xCF; view[2] = 0x11; view[3] = 0xE0
      view[4] = 0xA1; view[5] = 0xB1; view[6] = 0x1A; view[7] = 0xE1
      // sectorSizePower at offset 30 = 9 → 512 byte sectors
      view[30] = 0x09; view[31] = 0x00
      // majorVersion at offset 26
      view[26] = 0x03; view[27] = 0x00
      // firstDirectorySector at offset 48
      view[48] = 0x01; view[49] = 0x00; view[50] = 0x00; view[51] = 0x00

      const parser = new OleParser(buf)
      const header = parser.parseHeader()
      expect(header.sectorSizePower).toBe(9)
      expect(header.majorVersion).toBe(3)
      expect(header.firstDirectorySector).toBe(1)
    })

    it('should cache the header on repeated calls', () => {
      const buf = new ArrayBuffer(512)
      const view = new Uint8Array(buf)
      view[0] = 0xD0; view[1] = 0xCF; view[2] = 0x11; view[3] = 0xE0
      view[4] = 0xA1; view[5] = 0xB1; view[6] = 0x1A; view[7] = 0xE1

      const parser = new OleParser(buf)
      const h1 = parser.parseHeader()
      const h2 = parser.parseHeader()
      // Same object reference (cached)
      expect(h1).toBe(h2)
    })

    it('should resetCache() to force re-parse', () => {
      const buf = new ArrayBuffer(512)
      const view = new Uint8Array(buf)
      view[0] = 0xD0; view[1] = 0xCF; view[2] = 0x11; view[3] = 0xE0
      view[4] = 0xA1; view[5] = 0xB1; view[6] = 0x1A; view[7] = 0xE1
      view[30] = 0x09

      const parser = new OleParser(buf)
      parser.parseHeader()
      parser.resetCache()
      // After resetCache, header is recomputed but still valid
      const header = parser.parseHeader()
      expect(header.sectorSizePower).toBe(9)
    })
  })

  describe('getFatSectors', () => {
    it('should return a FAT array filled with FREESECT (-2) for empty DIFAT', () => {
      const buf = new ArrayBuffer(512)
      const view = new Uint8Array(buf)
      view[0] = 0xD0; view[1] = 0xCF; view[2] = 0x11; view[3] = 0xE0
      view[4] = 0xA1; view[5] = 0xB1; view[6] = 0x1A; view[7] = 0xE1
      view[30] = 0x09 // 512-byte sectors

      const parser = new OleParser(buf)
      const header = parser.parseHeader()
      const fat = parser.getFatSectors(header)
      // All entries are FREESECT (-2) since no FAT sectors are referenced
      expect(fat.length).toBeGreaterThan(0)
      expect(fat.every(entry => entry === -2)).toBe(true)
    })

    it('should cache FAT array on repeated calls', () => {
      const buf = new ArrayBuffer(512)
      const view = new Uint8Array(buf)
      view[0] = 0xD0; view[1] = 0xCF; view[2] = 0x11; view[3] = 0xE0
      view[4] = 0xA1; view[5] = 0xB1; view[6] = 0x1A; view[7] = 0xE1
      view[30] = 0x09

      const parser = new OleParser(buf)
      const header = parser.parseHeader()
      const fat1 = parser.getFatSectors(header)
      const fat2 = parser.getFatSectors(header)
      expect(fat1).toBe(fat2)
    })

    it('should read FAT entries from DIFAT[0] sector', () => {
      const buf = new ArrayBuffer(2048) // 4 sectors: header + 3 data sectors
      const view = new Uint8Array(buf)
      view[0] = 0xD0; view[1] = 0xCF; view[2] = 0x11; view[3] = 0xE0
      view[4] = 0xA1; view[5] = 0xB1; view[6] = 0x1A; view[7] = 0xE1
      view[30] = 0x09 // 512-byte sectors

      // DIFAT[0] at offset 76 = sector 0 → FAT sector is at byte 512
      view[76] = 0x00; view[77] = 0x00; view[78] = 0x00; view[79] = 0x00
      // Second DIFAT entry: FREESECT (-2) = 0xFFFFFFFE
      view[80] = 0xFE; view[81] = 0xFF; view[82] = 0xFF; view[83] = 0xFF

      // FAT sector 0 starts at byte 512
      // Entry 0: ENDOFCHAIN (-1) = 0xFFFFFFFF
      view[512] = 0xFF; view[513] = 0xFF; view[514] = 0xFF; view[515] = 0xFF
      // Entry 1: chain to sector 2
      view[516] = 0x02; view[517] = 0x00; view[518] = 0x00; view[519] = 0x00
      // Entry 2: ENDOFCHAIN
      view[520] = 0xFF; view[521] = 0xFF; view[522] = 0xFF; view[523] = 0xFF

      const parser = new OleParser(buf)
      const header = parser.parseHeader()
      const fat = parser.getFatSectors(header)
      expect(fat.length).toBeGreaterThanOrEqual(3)
      expect(fat[0]).toBe(-1)   // ENDOFCHAIN
      expect(fat[1]).toBe(2)    // next sector
      expect(fat[2]).toBe(-1)   // ENDOFCHAIN
    })
  })

  describe('getDirectorySectors', () => {
    it('should return empty array when no directory sector is reachable', () => {
      const buf = new ArrayBuffer(512)
      const view = new Uint8Array(buf)
      view[0] = 0xD0; view[1] = 0xCF; view[2] = 0x11; view[3] = 0xE0
      view[4] = 0xA1; view[5] = 0xB1; view[6] = 0x1A; view[7] = 0xE1
      view[30] = 0x09 // 512-byte sectors
      // firstDirectorySector (offset 48) = ENDOFCHAIN (-1)
      view[48] = 0xFF; view[49] = 0xFF; view[50] = 0xFF; view[51] = 0xFF

      const parser = new OleParser(buf)
      const header = parser.parseHeader()
      const fat = parser.getFatSectors(header)
      const dirs = parser.getDirectorySectors(header, fat)
      expect(dirs).toEqual([])
    })

    it('should parse a directory entry containing a valid stream', () => {
      // 4-sector buffer: header, FAT, dir, spare
      const buf = new ArrayBuffer(2048)
      const view = new Uint8Array(buf)
      view[0] = 0xD0; view[1] = 0xCF; view[2] = 0x11; view[3] = 0xE0
      view[4] = 0xA1; view[5] = 0xB1; view[6] = 0x1A; view[7] = 0xE1
      view[30] = 0x09 // 512-byte sectors
      // firstDirectorySector = 1 (sector 1 is the directory)
      view[48] = 0x01; view[49] = 0x00; view[50] = 0x00; view[51] = 0x00

      // DIFAT[0] = 0 → FAT sector 0
      view[76] = 0x00; view[77] = 0x00; view[78] = 0x00; view[79] = 0x00

      // FAT sector 0 at byte 512: entry 0 = ENDOFCHAIN (FAT itself)
      // entry 1 = ENDOFCHAIN (directory sector has no chain)
      view[512] = 0xFF; view[513] = 0xFF; view[514] = 0xFF; view[515] = 0xFF
      view[516] = 0xFF; view[517] = 0xFF; view[518] = 0xFF; view[519] = 0xFF

      // Directory sector 1 at byte 1024: build one "WordDocument" entry
      // Entry layout: 128 bytes per entry
      // offset 0: name (UTF-16LE), offset 64: nameLength, offset 66: objectType, offset 67: colorFlag
      // offset 116: startSector, offset 120: size
      const dirOffset = 1024
      // Name: "WordDocument" (13 chars × 2 bytes = 26 bytes)
      const name = 'WordDocument'
      for (let i = 0; i < name.length; i++) {
        view[dirOffset + i * 2] = name.charCodeAt(i) & 0xff
        view[dirOffset + i * 2 + 1] = (name.charCodeAt(i) >> 8) & 0xff
      }
      // nameLength = 26 (UTF-16LE, in bytes) at offset 64
      view[dirOffset + 64] = 26
      view[dirOffset + 65] = 0
      // objectType = 2 (stream) at offset 66
      view[dirOffset + 66] = 2
      // colorFlag = 1 (black) at offset 67
      view[dirOffset + 67] = 1
      // startSector = 2 at offset 116
      view[dirOffset + 116] = 0x02; view[dirOffset + 117] = 0x00
      view[dirOffset + 118] = 0x00; view[dirOffset + 119] = 0x00
      // size = 1024 at offset 120
      view[dirOffset + 120] = 0x00; view[dirOffset + 121] = 0x04
      view[dirOffset + 122] = 0x00; view[dirOffset + 123] = 0x00

      const parser = new OleParser(buf)
      const header = parser.parseHeader()
      const fat = parser.getFatSectors(header)
      const dirs = parser.getDirectorySectors(header, fat)
      expect(dirs.length).toBeGreaterThan(0)
      const entry = dirs[0]
      expect(entry.name).toBe('WordDocument')
      expect(entry.objectType).toBe(2)
      expect(entry.startSector).toBe(2)
      expect(entry.size).toBe(1024)
    })
  })

  describe('findWordDocumentStream', () => {
    function makeEntry(name: string, objectType: number, size: number = 0, startSector: number = 0): any {
      return { name, objectType, size, startSector, nameLength: name.length * 2 }
    }

    it('should find exact "WordDocument" stream', () => {
      const buf = new ArrayBuffer(512)
      const view = new Uint8Array(buf)
      view[0] = 0xD0; view[1] = 0xCF; view[2] = 0x11; view[3] = 0xE0
      view[4] = 0xA1; view[5] = 0xB1; view[6] = 0x1A; view[7] = 0xE1
      const parser = new OleParser(buf)

      const dirs = [makeEntry('Root Entry', 5), makeEntry('WordDocument', 2, 1024)]
      const result = parser.findWordDocumentStream(dirs)
      expect(result).not.toBeNull()
    })

    it('should find case-insensitive "worddocument"', () => {
      const buf = new ArrayBuffer(512)
      const view = new Uint8Array(buf)
      view[0] = 0xD0; view[1] = 0xCF; view[2] = 0x11; view[3] = 0xE0
      view[4] = 0xA1; view[5] = 0xB1; view[6] = 0x1A; view[7] = 0xE1
      const parser = new OleParser(buf)

      const dirs = [makeEntry('WORDDOCUMENT', 2, 1024)]
      const result = parser.findWordDocumentStream(dirs)
      expect(result).not.toBeNull()
    })

    it('should find stream with "word" in the name', () => {
      const buf = new ArrayBuffer(512)
      const view = new Uint8Array(buf)
      view[0] = 0xD0; view[1] = 0xCF; view[2] = 0x11; view[3] = 0xE0
      view[4] = 0xA1; view[5] = 0xB1; view[6] = 0x1A; view[7] = 0xE1
      const parser = new OleParser(buf)

      const dirs = [makeEntry('MyWordStream', 2, 512)]
      const result = parser.findWordDocumentStream(dirs)
      expect(result).not.toBeNull()
    })

    it('should return null when no streams found', () => {
      const buf = new ArrayBuffer(512)
      const view = new Uint8Array(buf)
      view[0] = 0xD0; view[1] = 0xCF; view[2] = 0x11; view[3] = 0xE0
      view[4] = 0xA1; view[5] = 0xB1; view[6] = 0x1A; view[7] = 0xE1
      const parser = new OleParser(buf)

      // Empty stream (size=0) is excluded from the size > 0 fallback
      const dirs = [makeEntry('Root Entry', 5), makeEntry('DataStream', 2, 0)]
      const result = parser.findWordDocumentStream(dirs)
      expect(result).toBeNull()
    })

    it('should return null for empty directory', () => {
      const buf = new ArrayBuffer(512)
      const view = new Uint8Array(buf)
      view[0] = 0xD0; view[1] = 0xCF; view[2] = 0x11; view[3] = 0xE0
      view[4] = 0xA1; view[5] = 0xB1; view[6] = 0x1A; view[7] = 0xE1
      const parser = new OleParser(buf)

      const result = parser.findWordDocumentStream([])
      expect(result).toBeNull()
    })
  })
})
