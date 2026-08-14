import { describe, it, expect, vi } from 'vitest'
import { OleParser } from '../src/utils/oleParser'

function createBuffer(signature: number[]): ArrayBuffer {
  const buf = new ArrayBuffer(512)
  const view = new Uint8Array(buf)
  for (let i = 0; i < signature.length && i < buf.byteLength; i++) {
    view[i] = signature[i]
  }
  return buf
}

function writeDirectoryEntry(
  view: Uint8Array,
  offset: number,
  name: string,
  objectType: number,
  startSector: number,
  size: number,
) {
  for (let i = 0; i < name.length && offset + i * 2 + 1 < view.length; i++) {
    const code = name.charCodeAt(i)
    view[offset + i * 2] = code & 0xff
    view[offset + i * 2 + 1] = (code >> 8) & 0xff
  }
  view[offset + 64] = name.length * 2
  view[offset + 65] = 0
  view[offset + 66] = objectType
  view[offset + 67] = 1
  view[offset + 116] = startSector & 0xff
  view[offset + 117] = (startSector >> 8) & 0xff
  view[offset + 118] = (startSector >> 16) & 0xff
  view[offset + 119] = (startSector >> 24) & 0xff
  view[offset + 120] = size & 0xff
  view[offset + 121] = (size >> 8) & 0xff
  view[offset + 122] = (size >> 16) & 0xff
  view[offset + 123] = (size >> 24) & 0xff
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

    it('should detect XML format from the header', () => {
      const buf = new ArrayBuffer(512)
      const view = new Uint8Array(buf)
      const xmlHeader = '<?xml version="1.0"'
      for (let i = 0; i < xmlHeader.length; i++) view[i] = xmlHeader.charCodeAt(i)
      const parser = new OleParser(buf)
      expect(parser.detectFormat()).toBe('xml')
    })

    it('should return the XML-specific error message', () => {
      const buf = new ArrayBuffer(512)
      const view = new Uint8Array(buf)
      const xmlHeader = '<?xml version="1.0"'
      for (let i = 0; i < xmlHeader.length; i++) view[i] = xmlHeader.charCodeAt(i)
      const parser = new OleParser(buf)
      expect(parser.getFormatErrorString()).toContain('XML')
    })

    it('should return the OLE-specific error message for OLE files that fail later', () => {
      const sig = [0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1]
      const parser = new OleParser(createBuffer(sig))
      // detectFormat returns 'ole', so the default branch of getFormatErrorString
      expect(parser.getFormatErrorString()).toContain('OLE')
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

    it('should read 64-bit little-endian values', () => {
      const buf = new ArrayBuffer(12)
      const view = new Uint8Array(buf)
      view[0] = 0x02
      view[4] = 0x01

      const parser = new OleParser(buf)
      expect(parser.safeReadUint64(0)).toBe(0x0000000100000002n)
      expect(parser.safeReadUint64(8)).toBe(0n)
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

    it('should normalize unsafe sector parameters to CFB defaults', () => {
      const buf = new ArrayBuffer(512)
      const view = new DataView(buf)
      view.setUint16(26, 4, true)
      view.setUint16(30, 31, true)
      view.setUint16(32, 15, true)
      view.setUint32(56, 0, true)

      const header = new OleParser(buf).parseHeader()

      expect(header.sectorSizePower).toBe(12)
      expect(header.miniSectorSizePower).toBe(6)
      expect(header.miniStreamCutoffSize).toBe(4096)
    })

    it('should remove duplicate and out-of-range DIFAT entries', () => {
      const sectorSize = 512
      const buf = new ArrayBuffer(sectorSize * 4)
      const view = new DataView(buf)
      view.setUint16(30, 9, true)
      view.setUint32(44, 2, true)
      view.setInt32(76, 0, true)
      view.setInt32(80, 0, true)
      view.setInt32(84, 99, true)
      view.setInt32(88, 1, true)
      view.setInt32(92, -1, true)

      const parser = new OleParser(buf)
      expect(parser.parseHeader().difat).toEqual([0, 1])
    })
  })

  describe('getFatSectors', () => {
    it('should ignore a trailing partial sector when sizing the FAT', () => {
      const buf = new ArrayBuffer(512 + 512 + 100)
      const view = new DataView(buf)
      view.setUint16(26, 3, true)
      view.setUint16(30, 9, true)

      const parser = new OleParser(buf)
      expect(parser.getFatSectors(parser.parseHeader())).toHaveLength(1)
    })

    it('should not count the compound-file header as a FAT sector', () => {
      const buf = new ArrayBuffer(512)
      const view = new Uint8Array(buf)
      view[0] = 0xD0; view[1] = 0xCF; view[2] = 0x11; view[3] = 0xE0
      view[4] = 0xA1; view[5] = 0xB1; view[6] = 0x1A; view[7] = 0xE1
      view[30] = 0x09 // 512-byte sectors

      const parser = new OleParser(buf)
      const header = parser.parseHeader()
      const fat = parser.getFatSectors(header)
      expect(fat).toEqual([])
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
      // Second DIFAT entry: FREESECT (-1) = 0xFFFFFFFF
      view[80] = 0xFF; view[81] = 0xFF; view[82] = 0xFF; view[83] = 0xFF

      // FAT sector 0 starts at byte 512
      // Entry 0: ENDOFCHAIN (-2) = 0xFFFFFFFE
      view[512] = 0xFE; view[513] = 0xFF; view[514] = 0xFF; view[515] = 0xFF
      // Entry 1: chain to sector 2
      view[516] = 0x02; view[517] = 0x00; view[518] = 0x00; view[519] = 0x00
      // Entry 2: ENDOFCHAIN
      view[520] = 0xFE; view[521] = 0xFF; view[522] = 0xFF; view[523] = 0xFF

      const parser = new OleParser(buf)
      const header = parser.parseHeader()
      const fat = parser.getFatSectors(header)
      expect(fat).toHaveLength(3)
      expect(fat[0]).toBe(-2)   // ENDOFCHAIN
      expect(fat[1]).toBe(2)    // next sector
      expect(fat[2]).toBe(-2)   // ENDOFCHAIN
    })

    it('should filter out-of-range DIFAT entries and read the valid FAT', () => {
      const buf = new ArrayBuffer(1024) // header + 1 sector
      const view = new Uint8Array(buf)
      view[0] = 0xD0; view[1] = 0xCF; view[2] = 0x11; view[3] = 0xE0
      view[4] = 0xA1; view[5] = 0xB1; view[6] = 0x1A; view[7] = 0xE1
      view[30] = 0x09 // 512-byte sectors

      // DIFAT[0] = 99 (out of range), DIFAT[1] = 0 (valid FAT sector)
      view[76] = 99
      view[80] = 0x00; view[81] = 0x00; view[82] = 0x00; view[83] = 0x00
      // FAT sector 0: entry 0 = ENDOFCHAIN
      view[512] = 0xFE; view[513] = 0xFF; view[514] = 0xFF; view[515] = 0xFF

      const parser = new OleParser(buf)
      const header = parser.parseHeader()
      const fat = parser.getFatSectors(header)
      // The out-of-range sector is dropped; sector 0 is read normally
      expect(header.difat).toContain(0)
      expect(header.difat).not.toContain(99)
      expect(fat[0]).toBe(-2)
    })

    it('should stop a directory FAT chain that forms a cycle', () => {
      // header + 2 sectors: FAT at 0, directory at 1
      const sectorSize = 512
      const buf = new ArrayBuffer(sectorSize * 3)
      const view = new Uint8Array(buf)
      view[0] = 0xD0; view[1] = 0xCF; view[2] = 0x11; view[3] = 0xE0
      view[4] = 0xA1; view[5] = 0xB1; view[6] = 0x1A; view[7] = 0xE1
      view[26] = 0x03; view[30] = 0x09; view[48] = 0x01 // first directory sector = 1
      view[76] = 0x00 // DIFAT[0] = sector 0 (FAT)
      // FAT: sector 0 → ENDOFCHAIN, sector 1 → 1 (self-cycle)
      view[sectorSize] = 0xFE; view[sectorSize + 1] = 0xFF
      view[sectorSize + 4] = 0x01; view[sectorSize + 5] = 0x00
      view[sectorSize + 6] = 0x00; view[sectorSize + 7] = 0x00

      const parser = new OleParser(buf)
      const header = parser.parseHeader()
      const dirs = parser.getDirectorySectors(header, parser.getFatSectors(header))
      // Cycle detected → at most the entries from one sector
      expect(dirs.length).toBeLessThanOrEqual(4)
    })

    it('should read additional FAT sectors from the DIFAT sector chain', () => {      const sectorSize = 512
      const totalSectors = 140
      const buf = new ArrayBuffer((totalSectors + 1) * sectorSize)
      const view = new Uint8Array(buf)
      const setU32 = (off: number, value: number) => {
        view[off] = value & 0xff
        view[off + 1] = (value >> 8) & 0xff
        view[off + 2] = (value >> 16) & 0xff
        view[off + 3] = (value >> 24) & 0xff
      }

      view[0] = 0xD0; view[1] = 0xCF; view[2] = 0x11; view[3] = 0xE0
      view[4] = 0xA1; view[5] = 0xB1; view[6] = 0x1A; view[7] = 0xE1
      view[26] = 0x03
      view[30] = 0x09
      setU32(44, 2)          // two FAT sectors total
      setU32(68, 2)          // first DIFAT sector is sector 2
      setU32(72, 1)          // one DIFAT sector
      setU32(76, 0)          // header DIFAT[0] -> FAT sector 0
      setU32(80, 0xFFFFFFFF) // header DIFAT terminator

      const fat1Offset = (1 + 1) * sectorSize
      setU32(fat1Offset + 2 * 4, 7) // FAT entry for sector 130 (128 + 2)

      const difatOffset = (2 + 1) * sectorSize
      setU32(difatOffset, 1) // extended DIFAT -> FAT sector 1
      setU32(difatOffset + 4, 0xFFFFFFFF)
      setU32(difatOffset + (sectorSize / 4 - 1) * 4, 0xFFFFFFFE)

      const parser = new OleParser(buf)
      const header = parser.parseHeader()
      const fat = parser.getFatSectors(header)

      expect(header.difat).toEqual([0, 1])
      expect(fat[130]).toBe(7)
    })
  })

  describe('getDirectorySectors', () => {
    it('should decode a CFB name with a terminating UTF-16 NUL', () => {
      const sectorSize = 512
      const buf = new ArrayBuffer(sectorSize * 3)
      const view = new Uint8Array(buf)
      view[0] = 0xD0; view[1] = 0xCF; view[2] = 0x11; view[3] = 0xE0
      view[4] = 0xA1; view[5] = 0xB1; view[6] = 0x1A; view[7] = 0xE1
      view[26] = 0x03; view[30] = 0x09; view[48] = 0x01; view[76] = 0x00
      view[sectorSize] = 0xFE; view[sectorSize + 1] = 0xFF
      view[sectorSize + 4] = 0xFE; view[sectorSize + 5] = 0xFF

      const dirOffset = sectorSize * 2
      writeDirectoryEntry(view, dirOffset, 'Named', 2, 2, 1)
      view[dirOffset + 64] = 12 // five UTF-16 code units plus NUL
      view[dirOffset + 10] = 0
      view[dirOffset + 11] = 0

      const parser = new OleParser(buf)
      const dirs = parser.getDirectorySectors(parser.parseHeader(), parser.getFatSectors(parser.parseHeader()))

      expect(dirs[0].name).toBe('Named')
    })

    it('should cache parsed directory entries and invalidate them with resetCache', () => {
      const parser = new OleParser(new ArrayBuffer(512))
      const header = parser.parseHeader()
      const fat: number[] = []

      const first = parser.getDirectorySectors(header, fat)
      const second = parser.getDirectorySectors(header, fat)
      expect(second).toBe(first)

      parser.resetCache()
      const third = parser.getDirectorySectors(parser.parseHeader(), fat)
      expect(third).not.toBe(first)
    })

    it('should return empty array when no directory sector is reachable', () => {
      const buf = new ArrayBuffer(512)
      const view = new Uint8Array(buf)
      view[0] = 0xD0; view[1] = 0xCF; view[2] = 0x11; view[3] = 0xE0
      view[4] = 0xA1; view[5] = 0xB1; view[6] = 0x1A; view[7] = 0xE1
      view[30] = 0x09 // 512-byte sectors
      // firstDirectorySector (offset 48) = ENDOFCHAIN (-2)
      view[48] = 0xFE; view[49] = 0xFF; view[50] = 0xFF; view[51] = 0xFF

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
      view[512] = 0xFE; view[513] = 0xFF; view[514] = 0xFF; view[515] = 0xFF
      view[516] = 0xFE; view[517] = 0xFF; view[518] = 0xFF; view[519] = 0xFF

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

    it('should skip directory entries whose name length exceeds the 64-byte field', () => {
      const sectorSize = 512
      const buf = new ArrayBuffer(sectorSize * 3)
      const view = new Uint8Array(buf)
      view[0] = 0xD0; view[1] = 0xCF; view[2] = 0x11; view[3] = 0xE0
      view[4] = 0xA1; view[5] = 0xB1; view[6] = 0x1A; view[7] = 0xE1
      view[26] = 0x03
      view[30] = 0x09
      view[48] = 0x01
      view[76] = 0x00
      view[sectorSize] = 0xFE
      view[sectorSize + 1] = 0xFF
      view[sectorSize + 2] = 0xFF
      view[sectorSize + 3] = 0xFF
      view[sectorSize + 4] = 0xFE
      view[sectorSize + 5] = 0xFF
      view[sectorSize + 6] = 0xFF
      view[sectorSize + 7] = 0xFF

      const dirOffset = sectorSize * 2
      writeDirectoryEntry(view, dirOffset, 'WordDocument', 2, 2, 32)
      view[dirOffset + 64] = 66

      const parser = new OleParser(buf)
      const header = parser.parseHeader()
      const dirs = parser.getDirectorySectors(header, parser.getFatSectors(header))

      expect(dirs).toEqual([])
    })

    it('should reject reserved CFB directory object types', () => {
      const sectorSize = 512
      const buf = new ArrayBuffer(sectorSize * 3)
      const view = new Uint8Array(buf)
      view[26] = 0x03; view[30] = 0x09; view[48] = 0x01; view[76] = 0x00
      view[sectorSize] = 0xFE; view[sectorSize + 1] = 0xFF
      view[sectorSize + 4] = 0xFE; view[sectorSize + 5] = 0xFF
      const dirOffset = sectorSize * 2
      writeDirectoryEntry(view, dirOffset, 'Reserved', 3, 0, 0)

      const parser = new OleParser(buf)
      const header = parser.parseHeader()
      expect(parser.getDirectorySectors(header, parser.getFatSectors(header))).toEqual([])
    })

    it('should read v4 directory stream sizes as 64-bit values with a safe cap', () => {
      const sectorSize = 4096
      const buf = new ArrayBuffer(sectorSize * 3)
      const view = new Uint8Array(buf)
      view[0] = 0xD0; view[1] = 0xCF; view[2] = 0x11; view[3] = 0xE0
      view[4] = 0xA1; view[5] = 0xB1; view[6] = 0x1A; view[7] = 0xE1
      view[26] = 0x04
      view[30] = 0x0C
      view[48] = 0x01
      view[76] = 0x00

      const fatOffset = sectorSize
      view[fatOffset] = 0xFE; view[fatOffset + 1] = 0xFF
      view[fatOffset + 2] = 0xFF; view[fatOffset + 3] = 0xFF
      view[fatOffset + 4] = 0xFE; view[fatOffset + 5] = 0xFF
      view[fatOffset + 6] = 0xFF; view[fatOffset + 7] = 0xFF

      const dirOffset = sectorSize * 2
      writeDirectoryEntry(view, dirOffset, 'WordDocument', 2, 2, 32)
      // High 32 bits make the stream claim 4GB + 32 bytes. The parser should
      // read the 64-bit value but cap it to the actual file size for safety.
      view[dirOffset + 124] = 0x01

      const parser = new OleParser(buf)
      const header = parser.parseHeader()
      const fat = parser.getFatSectors(header)
      const dirs = parser.getDirectorySectors(header, fat)

      expect(dirs[0].size).toBe(buf.byteLength)
    })

    it('should cap v3 directory stream sizes to the physical file', () => {
      const sectorSize = 512
      const buf = new ArrayBuffer(sectorSize * 3)
      const view = new Uint8Array(buf)
      view[0] = 0xD0; view[1] = 0xCF; view[2] = 0x11; view[3] = 0xE0
      view[4] = 0xA1; view[5] = 0xB1; view[6] = 0x1A; view[7] = 0xE1
      view[26] = 0x03
      view[30] = 0x09
      view[48] = 0x01
      view[76] = 0x00
      view[sectorSize] = 0xFE
      view[sectorSize + 1] = 0xFF
      view[sectorSize + 2] = 0xFF
      view[sectorSize + 3] = 0xFF
      view[sectorSize + 4] = 0xFE
      view[sectorSize + 5] = 0xFF
      view[sectorSize + 6] = 0xFF
      view[sectorSize + 7] = 0xFF

      const dirOffset = sectorSize * 2
      writeDirectoryEntry(view, dirOffset, 'WordDocument', 2, 2, 0xFFFFFFFF)
      const parser = new OleParser(buf)
      const dirs = parser.getDirectorySectors(parser.parseHeader(), parser.getFatSectors(parser.parseHeader()))

      expect(dirs[0].size).toBe(buf.byteLength)
    })

    it('should read directory chains spanning more than 1000 sectors', () => {
      const sectorSize = 512
      const entriesPerFatSector = sectorSize / 4
      const fatSectorCount = 8
      const dirStart = fatSectorCount
      const dirSectorCount = 1002
      const totalSectors = fatSectorCount + dirSectorCount
      const buf = new ArrayBuffer((totalSectors + 1) * sectorSize)
      const view = new Uint8Array(buf)
      const setU32 = (off: number, value: number) => {
        view[off] = value & 0xff
        view[off + 1] = (value >> 8) & 0xff
        view[off + 2] = (value >> 16) & 0xff
        view[off + 3] = (value >> 24) & 0xff
      }
      const setFat = (idx: number, value: number) => {
        const fatSectorK = Math.floor(idx / entriesPerFatSector)
        const off = (fatSectorK + 1) * sectorSize + (idx % entriesPerFatSector) * 4
        setU32(off, value)
      }

      view[0] = 0xD0; view[1] = 0xCF; view[2] = 0x11; view[3] = 0xE0
      view[4] = 0xA1; view[5] = 0xB1; view[6] = 0x1A; view[7] = 0xE1
      view[26] = 0x03
      view[30] = 0x09
      setU32(44, fatSectorCount)
      setU32(48, dirStart)
      setU32(68, 0xFFFFFFFE)
      setU32(72, 0)
      for (let i = 0; i < fatSectorCount; i++) setU32(76 + i * 4, i)
      setU32(76 + fatSectorCount * 4, 0xFFFFFFFF)

      for (let i = 0; i < fatSectorCount; i++) setFat(i, 0xFFFFFFFE)
      for (let sector = dirStart; sector < dirStart + dirSectorCount - 1; sector++) {
        setFat(sector, sector + 1)
      }
      setFat(dirStart + dirSectorCount - 1, 0xFFFFFFFE)

      const lastDirOffset = (dirStart + dirSectorCount) * sectorSize
      writeDirectoryEntry(view, lastDirOffset, 'WordDocument', 2, 0, 512)

      const parser = new OleParser(buf)
      const header = parser.parseHeader()
      const fat = parser.getFatSectors(header)
      const dirs = parser.getDirectorySectors(header, fat)

      expect(dirs.some(entry => entry.name === 'WordDocument')).toBe(true)
    })
  })

  describe('mini stream support', () => {
    it('should cap a mini-stream allocation to the root mini-stream capacity', () => {
      const parser = new OleParser(new ArrayBuffer(512))
      const result = (parser as any).readMiniStream(
        { name: 'Small', objectType: 2, startSector: 0, size: 0xFFFFFFFF, nameLength: 12 },
        new Uint8Array([1, 2, 3, 4]),
        [-2],
        { miniSectorSizePower: 6 },
      )

      expect(result.size).toBe(4)
      expect(Array.from(result.data)).toEqual([1, 2, 3, 4])
    })

    it('should cap a malicious MiniFAT sector count to the physical file capacity', () => {
      const sectorSize = 512
      const buf = new ArrayBuffer(sectorSize * 2)
      const view = new DataView(buf)
      view.setUint16(26, 3, true)
      view.setUint16(30, 9, true)
      view.setUint16(32, 6, true)
      view.setInt32(60, 0, true)
      view.setUint32(64, 0xFFFFFFFF, true)

      const parser = new OleParser(buf)
      const header = parser.parseHeader()
      const miniFat = parser.getMiniFatSectors(header, [-2])

      expect(miniFat).toHaveLength(128)
    })

    it('should retain every entry described by a MiniFAT sector', () => {
      const sectorSize = 512
      const buf = new ArrayBuffer(sectorSize * 3)
      const view = new Uint8Array(buf)
      const setU32 = (off: number, value: number) => {
        view[off] = value & 0xff
        view[off + 1] = (value >> 8) & 0xff
        view[off + 2] = (value >> 16) & 0xff
        view[off + 3] = (value >> 24) & 0xff
      }

      view[0] = 0xD0; view[1] = 0xCF; view[2] = 0x11; view[3] = 0xE0
      view[4] = 0xA1; view[5] = 0xB1; view[6] = 0x1A; view[7] = 0xE1
      view[26] = 0x03
      view[30] = 0x09
      view[32] = 0x06
      setU32(60, 1)
      setU32(64, 1)

      const miniFatOffset = sectorSize * 2
      setU32(miniFatOffset + 10 * 4, 77)

      const parser = new OleParser(buf)
      const header = parser.parseHeader()
      const fat = [-1, -2]
      const miniFat = parser.getMiniFatSectors(header, fat)

      expect(miniFat).toHaveLength(128)
      expect(miniFat[10]).toBe(77)
    })

    it('should read WordDocument from mini-stream when the stream is smaller than the cutoff', () => {
      const sectorSize = 512
      const buf = new ArrayBuffer(sectorSize * 6)
      const view = new Uint8Array(buf)

      // OLE signature
      view[0] = 0xD0; view[1] = 0xCF; view[2] = 0x11; view[3] = 0xE0
      view[4] = 0xA1; view[5] = 0xB1; view[6] = 0x1A; view[7] = 0xE1
      // v3 + 512-byte sectors
      view[26] = 0x03; view[27] = 0x00
      view[30] = 0x09; view[31] = 0x00
      // mini sector size = 64 bytes
      view[32] = 0x06; view[33] = 0x00
      // first directory sector = 2
      view[48] = 0x02; view[49] = 0x00; view[50] = 0x00; view[51] = 0x00
      // mini stream cutoff = 4096
      view[56] = 0x00; view[57] = 0x10; view[58] = 0x00; view[59] = 0x00
      // first miniFAT sector = 3, count = 1
      view[60] = 0x03; view[61] = 0x00; view[62] = 0x00; view[63] = 0x00
      view[64] = 0x01; view[65] = 0x00; view[66] = 0x00; view[67] = 0x00
      // first DIFAT sector = ENDOFCHAIN, count = 0
      view[68] = 0xFE; view[69] = 0xFF; view[70] = 0xFF; view[71] = 0xFF
      view[72] = 0x00; view[73] = 0x00; view[74] = 0x00; view[75] = 0x00
      // DIFAT[0] = FAT sector 0
      view[76] = 0x00; view[77] = 0x00; view[78] = 0x00; view[79] = 0x00

      const fatOffset = sectorSize
      const setFat = (idx: number, value: number) => {
        const off = fatOffset + idx * 4
        view[off] = value & 0xff
        view[off + 1] = (value >> 8) & 0xff
        view[off + 2] = (value >> 16) & 0xff
        view[off + 3] = (value >> 24) & 0xff
      }
      // FAT sector 0
      setFat(0, 0xFFFFFFFE)
      setFat(1, 0xFFFFFFFE)
      setFat(2, 0xFFFFFFFE)
      setFat(3, 0xFFFFFFFE)
      setFat(4, 0xFFFFFFFE)

      const dirOffset = sectorSize * 3
      writeDirectoryEntry(view, dirOffset, 'Root Entry', 5, 4, 128)
      writeDirectoryEntry(view, dirOffset + 128, 'WordDocument', 2, 0, 70)

      const miniFatOffset = sectorSize * 4
      // mini-sector 0 -> 1 -> end of chain
      view[miniFatOffset] = 0x01
      view[miniFatOffset + 4] = 0xFE; view[miniFatOffset + 5] = 0xFF
      view[miniFatOffset + 6] = 0xFF; view[miniFatOffset + 7] = 0xFF

      const rootMiniStreamOffset = sectorSize * 5
      const content = `Hello${'x'.repeat(65)}`
      for (let i = 0; i < content.length; i++) {
        view[rootMiniStreamOffset + i] = content.charCodeAt(i)
      }

      const parser = new OleParser(buf)
      const header = parser.parseHeader()
      const fat = parser.getFatSectors(header)
      const dirs = parser.getDirectorySectors(header, fat)
      const stream = parser.findWordDocumentStream(dirs)

      expect(stream).not.toBeNull()
      expect(stream?.size).toBe(70)
      expect(new TextDecoder('latin1').decode(stream!.data.slice(0, 5))).toBe('Hello')
      expect(stream?.data[69]).toBe('x'.charCodeAt(0))
    })
  })

  describe('large regular stream reads', () => {
    it('should not initialize MiniFAT when reading a regular stream', () => {
      const sectorSize = 512
      const buf = new ArrayBuffer(sectorSize * 2)
      const view = new DataView(buf)
      view.setUint16(26, 3, true)
      view.setUint16(30, 9, true)
      view.setUint16(32, 6, true)
      view.setUint32(56, 4096, true)

      const parser = new OleParser(buf)
      const miniFatSpy = vi.spyOn(parser, 'getMiniFatSectors')
      parser.readStream({
        name: 'WordDocument', objectType: 2, startSector: 0,
        size: 4096, nameLength: 26,
      })

      expect(miniFatSpy).not.toHaveBeenCalled()
    })

    it('should stop a cyclic FAT stream without duplicating sector contents', () => {
      const sectorSize = 512
      const buf = new ArrayBuffer(sectorSize * 4)
      const view = new Uint8Array(buf)
      const setU32 = (off: number, value: number) => {
        view[off] = value & 0xff
        view[off + 1] = (value >> 8) & 0xff
        view[off + 2] = (value >> 16) & 0xff
        view[off + 3] = (value >> 24) & 0xff
      }

      view[0] = 0xD0; view[1] = 0xCF; view[2] = 0x11; view[3] = 0xE0
      view[4] = 0xA1; view[5] = 0xB1; view[6] = 0x1A; view[7] = 0xE1
      view[26] = 0x03
      view[30] = 0x09
      setU32(48, 1)
      setU32(56, 4096)
      setU32(60, 0xFFFFFFFE)
      setU32(76, 0)

      const fatOffset = sectorSize
      setU32(fatOffset, 0xFFFFFFFE)
      setU32(fatOffset + 4, 0xFFFFFFFE)
      setU32(fatOffset + 8, 2)

      const dirOffset = sectorSize * 2
      writeDirectoryEntry(view, dirOffset, 'WordDocument', 2, 2, 1024)
      view.fill(0x41, sectorSize * 3, sectorSize * 4)

      const parser = new OleParser(buf)
      const header = parser.parseHeader()
      const dirs = parser.getDirectorySectors(header, parser.getFatSectors(header))
      const stream = parser.findWordDocumentStream(dirs)

      expect(stream?.size).toBe(512)
      expect(stream?.data.every(byte => byte === 0x41)).toBe(true)
    })

    it('reads a stream spanning more than 1000 sectors without truncating', () => {
      // Regression guard: readRegularStream once capped iterations at a fixed
      // 1000, silently truncating any stream larger than 1000 sectors
      // (1000 * 512 = 512000 bytes). Build a contiguous 1100-sector stream and
      // assert every byte is returned.
      const sectorSize = 512
      const entriesPerSector = sectorSize / 4 // 128
      // MS-CFB sector chain markers.
      const ENDOFCHAIN = 0xfffffffe
      const FREESECT = 0xffffffff

      const fatSectorCount = 9 // sectors 0..8
      const dirSector = 9
      const dataStart = 10
      const dataSectorCount = 1100 // > 1000 → tripped the old ceiling
      const dataEnd = dataStart + dataSectorCount - 1 // 1109
      const totalSectors = dataEnd + 1 // 1110
      const buf = new ArrayBuffer((totalSectors + 1) * sectorSize)
      const view = new Uint8Array(buf)

      // OLE signature + v3 512-byte sectors
      view[0] = 0xd0; view[1] = 0xcf; view[2] = 0x11; view[3] = 0xe0
      view[4] = 0xa1; view[5] = 0xb1; view[6] = 0x1a; view[7] = 0xe1
      view[26] = 0x03
      view[30] = 0x09
      view[32] = 0x06
      const setU32 = (off: number, value: number) => {
        view[off] = value & 0xff
        view[off + 1] = (value >> 8) & 0xff
        view[off + 2] = (value >> 16) & 0xff
        view[off + 3] = (value >> 24) & 0xff
      }
      setU32(44, fatSectorCount)   // fatSectorsCount
      setU32(48, dirSector)        // firstDirectorySector
      setU32(56, 4096)             // miniStreamCutoffSize
      setU32(60, ENDOFCHAIN)       // firstMiniFatSector
      setU32(64, 0)                // miniFatSectorsCount
      setU32(68, ENDOFCHAIN)       // firstDifatSector
      setU32(72, 0)                // difatSectorsCount

      // DIFAT: FAT sectors are 0..8, terminated by FREESECT
      for (let k = 0; k < fatSectorCount; k++) setU32(76 + k * 4, k)
      setU32(76 + fatSectorCount * 4, FREESECT)

      // FAT: sectorToOffset(sector) = (sector + 1) * sectorSize
      const setFat = (idx: number, value: number) => {
        const fatSectorK = Math.floor(idx / entriesPerSector)
        const off = (fatSectorK + 1) * sectorSize + (idx % entriesPerSector) * 4
        setU32(off, value)
      }
      for (let idx = 0; idx <= dirSector; idx++) setFat(idx, ENDOFCHAIN) // FAT + dir sectors
      for (let idx = dataStart; idx < dataEnd; idx++) setFat(idx, idx + 1) // contiguous chain
      setFat(dataEnd, ENDOFCHAIN)

      // Directory sector: Root Entry + the big stream
      const dirOffset = (dirSector + 1) * sectorSize
      const dataSize = dataSectorCount * sectorSize // 563200
      writeDirectoryEntry(view, dirOffset, 'Root Entry', 5, 0, 0)
      writeDirectoryEntry(view, dirOffset + 128, 'WordDocument', 2, dataStart, dataSize)

      // Fill the data region with a known marker byte
      const dataByteStart = (dataStart + 1) * sectorSize
      for (let i = dataByteStart; i < dataByteStart + dataSize; i++) view[i] = 0x41

      const parser = new OleParser(buf)
      const header = parser.parseHeader()
      const fat = parser.getFatSectors(header)
      const dirs = parser.getDirectorySectors(header, fat)
      const stream = parser.findWordDocumentStream(dirs)

      expect(stream).not.toBeNull()
      expect(stream!.size).toBe(dataSize) // not clipped at 512000
      expect(stream!.data.length).toBe(dataSize)
      expect(stream!.data[dataSize - 1]).toBe(0x41) // last byte present
      expect(stream!.data.every(b => b === 0x41)).toBe(true)
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

    it('should find a normalized WordDocument stream name', () => {
      const buf = new ArrayBuffer(512)
      const view = new Uint8Array(buf)
      view[0] = 0xD0; view[1] = 0xCF; view[2] = 0x11; view[3] = 0xE0
      view[4] = 0xA1; view[5] = 0xB1; view[6] = 0x1A; view[7] = 0xE1
      const parser = new OleParser(buf)

      const dirs = [makeEntry('Word Document', 2, 512)]
      const result = parser.findWordDocumentStream(dirs)
      expect(result).not.toBeNull()
    })

    it('should not treat an unrelated largest stream as WordDocument', () => {
      const parser = new OleParser(new ArrayBuffer(512))
      const dirs = [makeEntry('Data', 2, 4096), makeEntry('SummaryInformation', 2, 1024)]

      expect(parser.findWordDocumentStream(dirs)).toBeNull()
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

  describe('findStreamByName', () => {
    function makeEntry(name: string, objectType: number, size: number = 0, startSector: number = 0): any {
      return { name, objectType, size, startSector, nameLength: name.length * 2 }
    }

    it('should find a stream by exact name', () => {
      const parser = new OleParser(createBuffer([0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1]))
      const dirs = [makeEntry('Root Entry', 5), makeEntry('0Table', 2, 512)]
      const entry = parser.findStreamByName(dirs, '0Table')
      expect(entry).not.toBeNull()
      expect(entry?.name).toBe('0Table')
    })

    it('should match case-insensitively', () => {
      const parser = new OleParser(createBuffer([0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1]))
      const dirs = [makeEntry('1table', 2, 512)]
      const entry = parser.findStreamByName(dirs, '1TABLE')
      expect(entry).not.toBeNull()
      expect(entry?.name).toBe('1table')
    })

    it('should skip non-stream entries (objectType !== 2)', () => {
      const parser = new OleParser(createBuffer([0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1]))
      const dirs = [makeEntry('0Table', 5, 512)] // root storage, not a stream
      const entry = parser.findStreamByName(dirs, '0Table')
      expect(entry).toBeNull()
    })

    it('should return null when name is empty', () => {
      const parser = new OleParser(createBuffer([0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1]))
      const dirs = [makeEntry('0Table', 2, 512)]
      expect(parser.findStreamByName(dirs, '')).toBeNull()
    })

    it('should return null when no entry matches', () => {
      const parser = new OleParser(createBuffer([0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1]))
      const dirs = [makeEntry('WordDocument', 2, 512)]
      expect(parser.findStreamByName(dirs, '0Table')).toBeNull()
    })
  })

  describe('findTableStream', () => {
    function makeEntry(name: string, objectType: number, size: number = 0, startSector: number = 0): any {
      return { name, objectType, size, startSector, nameLength: name.length * 2 }
    }

    function makeParser(): OleParser {
      return new OleParser(createBuffer([0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1]))
    }

    it('should return null when neither 0Table nor 1Table exists', () => {
      const parser = makeParser()
      const dirs = [makeEntry('Root Entry', 5), makeEntry('WordDocument', 2, 1024)]
      const result = parser.findTableStream(dirs, 0)
      expect(result).toBeNull()
    })

    it('should locate 0Table when which=0', () => {
      const parser = makeParser()
      const dirs = [makeEntry('Root Entry', 5), makeEntry('0Table', 2, 1024, 1)]
      const result = parser.findTableStream(dirs, 0)
      expect(result).not.toBeNull()
    })

    it('should locate 1Table when which=1', () => {
      const parser = makeParser()
      const dirs = [makeEntry('Root Entry', 5), makeEntry('1Table', 2, 1024, 1)]
      const result = parser.findTableStream(dirs, 1)
      expect(result).not.toBeNull()
    })

    it('should fall back to the other table stream when the requested one is missing', () => {
      const parser = makeParser()
      // Request 1Table but only 0Table exists
      const dirs = [makeEntry('Root Entry', 5), makeEntry('0Table', 2, 1024, 1)]
      const result = parser.findTableStream(dirs, 1)
      expect(result).not.toBeNull()
    })

    it('should match table stream names case-insensitively', () => {
      const parser = makeParser()
      const dirs = [makeEntry('Root Entry', 5), makeEntry('1table', 2, 1024, 1)]
      const result = parser.findTableStream(dirs, 1)
      expect(result).not.toBeNull()
    })
  })
})

describe('OleParser header bounds', () => {
  it('should tolerate a truncated header buffer during DIFAT reads', () => {
    // OLE signature in a 300-byte buffer: the 109-entry DIFAT walk at
    // offset 76 overruns the buffer and must stop gracefully.
    const buf = new ArrayBuffer(300)
    const view = new Uint8Array(buf)
    view[0] = 0xD0; view[1] = 0xCF; view[2] = 0x11; view[3] = 0xE0
    view[4] = 0xA1; view[5] = 0xB1; view[6] = 0x1A; view[7] = 0xE1
    const parser = new OleParser(buf)
    const header = parser.parseHeader()
    expect(header).not.toBeNull()
    // The truncated DIFAT read simply stops early — no crash
    expect(Array.isArray(header.difat)).toBe(true)
  })

  it('should tolerate a truncated header buffer during string reads', () => {
    // _getString with an offset past the buffer end must not throw
    const buf = new ArrayBuffer(64)
    const parser = new OleParser(buf)
    const parserAny = parser as any
    expect(() => parserAny._getString(60, 20)).not.toThrow()
    expect(parserAny._getString(60, 20)).toBe('')
  })
})

describe('OleParser mini-stream safety', () => {
  it('should stop a cyclic mini-stream chain without infinite looping', () => {
    const parser = new OleParser(new ArrayBuffer(512))
    // miniFat: sector 0 → 0 (self-cycle)
    const miniFat = [0, 0, 0, 0]
    const rootStream = new Uint8Array(256)
    const result = (parser as any).readMiniStream(
      { name: 'Cyclic', objectType: 2, startSector: 0, size: 128, nameLength: 6 },
      rootStream,
      miniFat,
      { miniSectorSizePower: 6 }, // 64-byte mini sectors
    )
    // The cycle guard limits iterations; reading completes without hanging
    expect(result.size).toBeLessThanOrEqual(128)
  })

  it('should stop when a mini sector offset is out of bounds', () => {
    const parser = new OleParser(new ArrayBuffer(512))
    // sector 0 reads fine (64 bytes); miniFat[0]=10 points beyond the
    // 256-byte root stream → second iteration breaks out
    const miniFat = [10, -2]
    const rootStream = new Uint8Array(256)
    const result = (parser as any).readMiniStream(
      { name: 'Oob', objectType: 2, startSector: 0, size: 200, nameLength: 3 },
      rootStream,
      miniFat,
      { miniSectorSizePower: 6 },
    )
    expect(result.size).toBe(64)
  })
})

describe('OleParser MiniFAT chain safety', () => {
  it('should stop a cyclic MiniFAT sector chain', () => {
    const sectorSize = 512
    const buf = new ArrayBuffer(sectorSize * 3)
    const view = new Uint8Array(buf)
    const setU32 = (off: number, value: number) => {
      view[off] = value & 0xff
      view[off + 1] = (value >> 8) & 0xff
      view[off + 2] = (value >> 16) & 0xff
      view[off + 3] = (value >> 24) & 0xff
    }
    view[0] = 0xD0; view[1] = 0xCF; view[2] = 0x11; view[3] = 0xE0
    view[4] = 0xA1; view[5] = 0xB1; view[6] = 0x1A; view[7] = 0xE1
    view[26] = 0x03
    view[30] = 0x09
    view[32] = 0x06
    // firstMiniFatSector = 1, miniFatSectorsCount = 1
    setU32(60, 1)
    setU32(64, 1)
    setU32(76, 0) // DIFAT[0] = FAT at sector 0
    // FAT: sector 0 → END, sector 1 → 1 (self-cycle)
    setU32(sectorSize, 0xFFFFFFFE)
    setU32(sectorSize + 4, 1)

    const parser = new OleParser(buf)
    const header = parser.parseHeader()
    const miniFat = parser.getMiniFatSectors(header, [-2, 1])
    // The chain guard stops the cycle; entries still get filled
    expect(miniFat.length).toBeGreaterThan(0)
  })
})
