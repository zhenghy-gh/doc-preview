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

  describe('table-like extraction', () => {
    it('should preserve tab characters in compressed text ranges', () => {
      const parser = new DocParser(new ArrayBuffer(512))
      const data = new Uint8Array([0x41, 0x09, 0x42, 0x0D])
      const result = (parser as any).extractTextFromRange(data, 0, data.length, true)
      expect(result).toBe('A\tB\n')
    })

    it('should preserve tab characters in UTF-16 text ranges', () => {
      const parser = new DocParser(new ArrayBuffer(512))
      const data = new Uint8Array([0x41, 0x00, 0x09, 0x00, 0x42, 0x00, 0x0D, 0x00])
      const result = (parser as any).extractTextFromRange(data, 0, data.length, false)
      expect(result).toBe('A\tB\n')
    })

    it('should preserve Word table cell marks (0x07) in compressed text', () => {
      const parser = new DocParser(new ArrayBuffer(512))
      // "A\u0007B\u0007" + paragraph mark — a single table row with 2 cells
      const data = new Uint8Array([0x41, 0x07, 0x42, 0x07, 0x0D])
      const result = (parser as any).extractTextFromRange(data, 0, data.length, true)
      expect(result).toBe('A\u0007B\u0007\n')
    })

    it('should preserve Word table cell marks (0x07) in UTF-16 text', () => {
      const parser = new DocParser(new ArrayBuffer(512))
      const data = new Uint8Array([
        0x41, 0x00, 0x07, 0x00, 0x42, 0x00, 0x07, 0x00, 0x0D, 0x00,
      ])
      const result = (parser as any).extractTextFromRange(data, 0, data.length, false)
      expect(result).toBe('A\u0007B\u0007\n')
    })
  })

  describe('CLX from table stream (0Table/1Table)', () => {
    // Builds a minimal OLE2 file with WordDocument + a table stream.
    // The WordDocument stream contains a FIB whose fcClx points into the table
    // stream, and the table stream contains a CLX with one UTF-16LE piece that
    // points back to text inside the WordDocument stream.
    function buildOleWithTableStream(options: {
      tableStreamName: '0Table' | '1Table'
      fWhichTblStm: 0 | 1
    }): ArrayBuffer {
      const SECTOR = 512
      // Layout: header + 4 sectors (FAT, dir, WordDocument, table)
      const buf = new ArrayBuffer(SECTOR * 5)
      const view = new Uint8Array(buf)
      const writeU16 = (off: number, val: number) => {
        view[off] = val & 0xff
        view[off + 1] = (val >> 8) & 0xff
      }
      const writeU32 = (off: number, val: number) => {
        view[off] = val & 0xff
        view[off + 1] = (val >> 8) & 0xff
        view[off + 2] = (val >> 16) & 0xff
        view[off + 3] = (val >> 24) & 0xff
      }

      // ---- Header ----
      view[0] = 0xD0; view[1] = 0xCF; view[2] = 0x11; view[3] = 0xE0
      view[4] = 0xA1; view[5] = 0xB1; view[6] = 0x1A; view[7] = 0xE1
      writeU16(26, 3)            // majorVersion = 3
      writeU16(30, 9)            // sectorSizePower = 9 (512 bytes)
      writeU16(32, 6)            // miniSectorSizePower = 6 (64 bytes)
      writeU32(48, 1)            // firstDirectorySector = 1
      writeU32(56, 4096)         // miniStreamCutoffSize
      writeU32(60, 0xFFFFFFFF)   // firstMiniFatSector = ENDOFCHAIN (project: -1)
      writeU32(64, 0)            // miniFatSectorsCount
      writeU32(68, 0xFFFFFFFF)   // firstDifatSector = ENDOFCHAIN (project: -1)
      writeU32(72, 0)            // difatSectorsCount
      writeU32(76, 0)            // DIFAT[0] = sector 0 (FAT)
      for (let i = 1; i < 109; i++) {
        writeU32(76 + i * 4, 0xFFFFFFFE)  // DIFAT[1..108] = FREESECT (project: -2)
      }

      // ---- Sector 0 (offset 512): FAT ----
      // NOTE: This project's OleParser uses FREESECT=-2 (0xFFFFFFFE) and
      // ENDOFCHAIN=-1 (0xFFFFFFFF), which is the reverse of the MS-CFB spec
      // constants. Match the project's convention here so the FAT chain is
      // read correctly.
      const fatBase = SECTOR
      const ENDOFCHAIN = 0xFFFFFFFF
      const FREESECT = 0xFFFFFFFE
      writeU32(fatBase + 0 * 4, ENDOFCHAIN)  // sector 0: FAT
      writeU32(fatBase + 1 * 4, ENDOFCHAIN)  // sector 1: Directory
      writeU32(fatBase + 2 * 4, ENDOFCHAIN)  // sector 2: WordDocument
      writeU32(fatBase + 3 * 4, ENDOFCHAIN)  // sector 3: table stream
      for (let i = 4; i < 128; i++) writeU32(fatBase + i * 4, FREESECT)

      // ---- Sector 1 (offset 1024): Directory ----
      const dirBase = SECTOR * 2
      const writeDirEntry = (
        entryOffset: number,
        name: string,
        objectType: number,
        startSector: number,
        size: number,
      ) => {
        for (let i = 0; i < name.length; i++) {
          writeU16(entryOffset + i * 2, name.charCodeAt(i))
        }
        writeU16(entryOffset + 64, name.length * 2)  // nameLength (bytes)
        view[entryOffset + 66] = objectType
        view[entryOffset + 67] = 1  // colorFlag
        writeU32(entryOffset + 116, startSector)
        writeU32(entryOffset + 120, size)
      }
      writeDirEntry(dirBase + 0 * 128, 'Root Entry', 5, 0xFFFFFFFF, 0)
      writeDirEntry(dirBase + 1 * 128, 'WordDocument', 2, 2, 512)
      writeDirEntry(dirBase + 2 * 128, options.tableStreamName, 2, 3, 64)

      // ---- Sector 2 (offset 1536): WordDocument stream ----
      const wdBase = SECTOR * 3
      // FIB:
      //   FibBase (32 bytes)
      writeU16(0 + wdBase, 0xA5EC)  // wIdent
      writeU16(2 + wdBase, 0x0101)  // nFib
      // fFlags at byte 10-11: bit 2 = fComplex, bit 9 = fWhichTblStm
      const fFlags = (0 << 2) | (options.fWhichTblStm << 9)  // fComplex=0 (UTF-16LE)
      writeU16(10 + wdBase, fFlags)

      // csw at offset 32 = 0 → FibRgW97 is empty; cslw follows at offset 34.
      writeU16(32 + wdBase, 0)

      // cslw at offset 34 = 22 (spec standard). FibRgLw97 follows at offset 36
      // with no reserved padding.
      writeU16(34 + wdBase, 22)
      //   cbMac(+0), reserved(+4), reserved(+8), ccpText(+12), ccpFtn(+16), ...
      const textLength = 11  // "Hello World" length
      writeU32(36 + 12 + wdBase, textLength)  // ccpText at rgLwStart+12

      // FibRgLw97 ends at 36 + 22*4 = 124. cbRgFcLcb (PAIR count) at offset 124.
      // Use 34 pairs so fcClx (pair 33) is in range.
      writeU16(124 + wdBase, 34)
      // rgFcLcbBlob starts at 126; each (fc,lcb) pair is 8 bytes.
      // fcClx at blobStart + 33*8 = 126 + 264 = 390; lcbClx at 394.
      const clxSize = 32
      writeU32(390 + wdBase, 0)       // fcClx = 0 (offset within table stream)
      writeU32(394 + wdBase, clxSize) // lcbClx = 32

      // Text "Hello World" as UTF-16LE at offset 400 (after the rgFcLcb blob).
      const textOffset = 400
      const text = 'Hello World'
      for (let i = 0; i < text.length; i++) {
        writeU16(textOffset + i * 2 + wdBase, text.charCodeAt(i))
      }

      // ---- Sector 3 (offset 2048): table stream ----
      const tblBase = SECTOR * 4
      // CLX:
      //   clxt (1 byte) = 0x02
      view[tblBase + 0] = 0x02
      //   lcb (4 bytes) = 27 (Pcdt size)
      writeU32(tblBase + 1, 27)
      // Pcdt:
      //   clxt (1 byte) = 0x01
      view[tblBase + 5] = 0x01
      //   reserved (2 bytes) = 0
      //   lcbPlcPcd (4 bytes) = 20
      writeU32(tblBase + 8, 20)
      // PlcPcd:
      //   n (4 bytes) = 1
      writeU32(tblBase + 12, 1)
      //   rgCcp (8 bytes): [0, 11]
      writeU32(tblBase + 16, 0)
      writeU32(tblBase + 20, textLength)
      //   rgPcd (8 bytes): reserved(2) + fc(4) + prm(2)
      //     fc = textOffset (no compression bit)
      writeU32(tblBase + 24 + 2, textOffset)  // fc at offset +2 within PCD entry

      return buf
    }

    it('should read CLX from 0Table when fWhichTblStm=0', () => {
      const buf = buildOleWithTableStream({ tableStreamName: '0Table', fWhichTblStm: 0 })
      const parser = new DocParser(buf)
      const result = parser.parse()
      expect(result.success).toBe(true)
      expect(result.text).toContain('Hello World')
    })

    it('should read CLX from 1Table when fWhichTblStm=1', () => {
      const buf = buildOleWithTableStream({ tableStreamName: '1Table', fWhichTblStm: 1 })
      const parser = new DocParser(buf)
      const result = parser.parse()
      expect(result.success).toBe(true)
      expect(result.text).toContain('Hello World')
    })

    it('should fall back across table streams when the requested one is missing', () => {
      // File says fWhichTblStm=1 (1Table) but only 0Table exists.
      // findTableStream falls back to 0Table, so parsing should still succeed.
      const buf = buildOleWithTableStream({ tableStreamName: '0Table', fWhichTblStm: 1 })
      const parser = new DocParser(buf)
      const result = parser.parse()
      expect(result.success).toBe(true)
      expect(result.text).toContain('Hello World')
    })

    it('should expose fWhichTblStm and rgCcp via parseWithFormat path too', () => {
      const buf = buildOleWithTableStream({ tableStreamName: '0Table', fWhichTblStm: 0 })
      const parser = new DocParser(buf)
      const result = parser.parseWithFormat()
      expect(result.success).toBe(true)
      expect(result.text).toContain('Hello World')
    })
  })

  describe('Story splitting integration', () => {
    /**
     * Build a minimal OLE2 file with main + footnotes + headers stories.
     * The WordDocument stream contains:
     *   - FIB with ccpText=8, ccpFtn=15, ccpHdd=13
     *   - Text: "MainText" + "FootnoteContent" + "HeaderContent" as UTF-16LE
     * The 0Table stream contains a CLX with 3 pieces pointing to each segment.
     */
    function buildOleWithStories(): ArrayBuffer {
      const SECTOR = 512
      const buf = new ArrayBuffer(SECTOR * 5)
      const view = new Uint8Array(buf)
      const writeU16 = (off: number, val: number) => {
        view[off] = val & 0xff
        view[off + 1] = (val >> 8) & 0xff
      }
      const writeU32 = (off: number, val: number) => {
        view[off] = val & 0xff
        view[off + 1] = (val >> 8) & 0xff
        view[off + 2] = (val >> 16) & 0xff
        view[off + 3] = (val >> 24) & 0xff
      }

      const ENDOFCHAIN = 0xFFFFFFFF
      const FREESECT = 0xFFFFFFFE

      // ---- Header ----
      view[0] = 0xD0; view[1] = 0xCF; view[2] = 0x11; view[3] = 0xE0
      view[4] = 0xA1; view[5] = 0xB1; view[6] = 0x1A; view[7] = 0xE1
      writeU16(26, 3)
      writeU16(30, 9)
      writeU16(32, 6)
      writeU32(48, 1)            // firstDirectorySector
      writeU32(56, 4096)
      writeU32(60, ENDOFCHAIN)
      writeU32(64, 0)
      writeU32(68, ENDOFCHAIN)
      writeU32(72, 0)
      writeU32(76, 0)            // DIFAT[0] = FAT
      for (let i = 1; i < 109; i++) writeU32(76 + i * 4, FREESECT)

      // ---- Sector 0: FAT ----
      const fatBase = SECTOR
      writeU32(fatBase + 0 * 4, ENDOFCHAIN)
      writeU32(fatBase + 1 * 4, ENDOFCHAIN)
      writeU32(fatBase + 2 * 4, ENDOFCHAIN)
      writeU32(fatBase + 3 * 4, ENDOFCHAIN)
      for (let i = 4; i < 128; i++) writeU32(fatBase + i * 4, FREESECT)

      // ---- Sector 1: Directory ----
      const dirBase = SECTOR * 2
      const writeDirEntry = (
        entryOffset: number,
        name: string,
        objectType: number,
        startSector: number,
        size: number,
      ) => {
        for (let i = 0; i < name.length; i++) {
          writeU16(entryOffset + i * 2, name.charCodeAt(i))
        }
        writeU16(entryOffset + 64, name.length * 2)
        view[entryOffset + 66] = objectType
        view[entryOffset + 67] = 1
        writeU32(entryOffset + 116, startSector)
        writeU32(entryOffset + 120, size)
      }
      writeDirEntry(dirBase + 0 * 128, 'Root Entry', 5, ENDOFCHAIN, 0)
      writeDirEntry(dirBase + 1 * 128, 'WordDocument', 2, 2, 512)
      writeDirEntry(dirBase + 2 * 128, '0Table', 2, 3, 512)

      // ---- Sector 2: WordDocument stream ----
      const wdBase = SECTOR * 3
      writeU16(0 + wdBase, 0xA5EC)  // wIdent
      writeU16(2 + wdBase, 0x0101)  // nFib
      // fFlags: fComplex=0 (UTF-16LE), fWhichTblStm=0 (0Table)
      writeU16(10 + wdBase, 0)

      // csw at offset 32 = 0 → FibRgW97 empty; cslw at offset 34.
      writeU16(32 + wdBase, 0)
      // cslw at offset 34 = 22. FibRgLw97 follows at offset 36 (no reserved).
      writeU16(34 + wdBase, 22)
      // rgCcp layout relative to FibRgLw: cbMac(+0), reserved(+4), reserved(+8),
      //   ccpText(+12), ccpFtn(+16), ccpHdd(+20), ...
      const rgCcpStart = 36
      writeU32(rgCcpStart + 12 + wdBase, 8)    // ccpText
      writeU32(rgCcpStart + 16 + wdBase, 15)   // ccpFtn
      writeU32(rgCcpStart + 20 + wdBase, 13)   // ccpHdd
      // ccpMcr/ccpAtn/ccpEdn/ccpTxbx/ccpHdrTxbx stay 0

      // FibRgLw97 ends at 36 + 22*4 = 124. cbRgFcLcb (PAIR count) at 124.
      writeU16(124 + wdBase, 34)
      // fcClx at blobStart + 33*8 = 126 + 264 = 390; lcbClx at 394.
      const clxSize = 1 + 4 + (1 + 2 + 4 + (4 + 4 * 4 + 3 * 8))
      writeU32(390 + wdBase, 0)         // fcClx = 0 (within 0Table)
      writeU32(394 + wdBase, clxSize)   // lcbClx

      // Text: "MainText" + "FootnoteContent" + "HeaderContent" as UTF-16LE
      //   8 + 15 + 13 = 36 chars = 72 bytes
      const main = 'MainText'
      const footnote = 'FootnoteContent'
      const header = 'HeaderContent'
      const textOffset = 400
      let textOff = textOffset
      for (const s of [main, footnote, header]) {
        for (let i = 0; i < s.length; i++) {
          writeU16(textOff + wdBase, s.charCodeAt(i))
          textOff += 2
        }
      }
      // Byte offsets within WordDocument stream:
      //   main:     textOffset .. textOffset+16
      //   footnote: textOffset+16 .. textOffset+46
      //   header:   textOffset+46 .. textOffset+72

      // ---- Sector 3: 0Table stream ----
      const tblBase = SECTOR * 4
      // CLX with 3 pieces:
      //   clxt(1)=0x02, lcb(4), Pcdt(clxt=0x01, reserved(2), lcbPlcPcd(4), PlcPcd)
      //   PlcPcd: n(4)=3, rgCcp(4*4)=[0,8,23,36], rgPcd(3*8)
      view[tblBase + 0] = 0x02
      writeU32(tblBase + 1, clxSize - 5)  // lcb = Pcdt size
      view[tblBase + 5] = 0x01
      // reserved 2 bytes at tblBase+6,7 (zero)
      const plcPcdSize = 4 + 4 * 4 + 3 * 8
      writeU32(tblBase + 8, plcPcdSize)
      // n = 3
      writeU32(tblBase + 12, 3)
      // rgCcp = [0, 8, 23, 36]
      writeU32(tblBase + 16, 0)
      writeU32(tblBase + 20, 8)
      writeU32(tblBase + 24, 23)
      writeU32(tblBase + 28, 36)
      // rgPcd: 3 entries, each 8 bytes (2 reserved + 4 fc + 2 prm)
      //   piece 0: fc = textOffset (UTF-16LE, no compression bit)
      //   piece 1: fc = textOffset + 16
      //   piece 2: fc = textOffset + 46
      let pcdOff = tblBase + 32
      const fcValues = [textOffset, textOffset + 16, textOffset + 46]
      for (let i = 0; i < 3; i++) {
        pcdOff += 2 // reserved
        writeU32(pcdOff, fcValues[i])
        pcdOff += 4
        pcdOff += 2 // prm
      }

      return buf
    }

    it('should expose footnotes and headers in document.stories via parseWithFormat', () => {
      const buf = buildOleWithStories()
      const parser = new DocParser(buf)
      const result = parser.parseWithFormat()
      expect(result.success).toBe(true)
      expect(result.text).toContain('MainText')
      // Main text should NOT contain footnote/header content (story splitting worked)
      expect(result.text).not.toContain('FootnoteContent')
      expect(result.text).not.toContain('HeaderContent')
      // Stories should be exposed separately
      expect(result.document?.stories).toBeDefined()
      expect(result.document?.stories?.footnotes).toContain('FootnoteContent')
      expect(result.document?.stories?.headers).toContain('HeaderContent')
    })

    it('should expose footnotes and headers via parse() as well', () => {
      const buf = buildOleWithStories()
      const parser = new DocParser(buf)
      const result = parser.parse()
      expect(result.success).toBe(true)
      expect(result.text).toContain('MainText')
      expect(result.text).not.toContain('FootnoteContent')
      expect(result.text).not.toContain('HeaderContent')
    })
  })
})
