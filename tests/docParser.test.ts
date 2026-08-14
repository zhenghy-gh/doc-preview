import { describe, it, expect, vi, afterEach } from 'vitest'
import { DocParser, parseDocFileFromBuffer, parseDocFileWithFormat, parseDocFile } from '../src/utils/docParser'

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

  describe('missing WordDocument stream', () => {
    /** OLE2 file whose directory has no WordDocument stream (only Data). */
    function buildOleWithoutWordDocument(): ArrayBuffer {
      const SECTOR = 512
      const buf = new ArrayBuffer(SECTOR * 4)
      const view = new Uint8Array(buf)
      const w16 = (off: number, v: number) => { view[off] = v & 0xff; view[off + 1] = (v >> 8) & 0xff }
      const w32 = (off: number, v: number) => {
        view[off] = v & 0xff; view[off + 1] = (v >> 8) & 0xff
        view[off + 2] = (v >> 16) & 0xff; view[off + 3] = (v >> 24) & 0xff
      }
      view[0] = 0xD0; view[1] = 0xCF; view[2] = 0x11; view[3] = 0xE0
      view[4] = 0xA1; view[5] = 0xB1; view[6] = 0x1A; view[7] = 0xE1
      w16(26, 3); w16(30, 9); w16(32, 6)
      w32(48, 1); w32(56, 4096)
      w32(60, 0xFFFFFFFE); w32(64, 0); w32(68, 0xFFFFFFFE); w32(72, 0)
      w32(76, 0)
      for (let i = 1; i < 109; i++) w32(76 + i * 4, 0xFFFFFFFF)
      w32(SECTOR + 0 * 4, 0xFFFFFFFE)
      w32(SECTOR + 1 * 4, 0xFFFFFFFE)
      for (let i = 2; i < 128; i++) w32(SECTOR + i * 4, 0xFFFFFFFF)
      const dirBase = SECTOR * 2
      const writeDir = (off: number, name: string, type: number, start: number, size: number) => {
        for (let i = 0; i < name.length; i++) w16(off + i * 2, name.charCodeAt(i))
        w16(off + 64, name.length * 2)
        view[off + 66] = type
        view[off + 67] = 1
        w32(off + 116, start)
        w32(off + 120, size)
      }
      writeDir(dirBase + 0 * 128, 'Root Entry', 5, 0xFFFFFFFE, 0)
      writeDir(dirBase + 1 * 128, 'Data', 2, 2, 512)
      for (let i = 0; i < 100; i++) view[SECTOR * 3 + i] = 0x41 + (i % 26)
      return buf
    }

    it('should fail parseWithFormat with a clear error when WordDocument is missing', () => {
      const parser = new DocParser(buildOleWithoutWordDocument())
      const result = parser.parseWithFormat()
      expect(result.success).toBe(false)
      expect(result.error).toContain('WordDocument')
    })

    it('should fail parse() with a clear error when WordDocument is missing', () => {
      const parser = new DocParser(buildOleWithoutWordDocument())
      const result = parser.parse()
      expect(result.success).toBe(false)
      expect(result.error).toContain('WordDocument')
    })
  })

  describe('extractTextSimple', () => {
    it('should extract 8-bit text with paragraph marks', () => {
      const parser = new DocParser(new ArrayBuffer(512))
      // 中文段（≥3 汉字）触发 foundStart，后续英文段被保留
      const data = new Uint8Array([
        0xE8, 0xBF, 0x99, 0xE6, 0x98, 0xAF, 0xE4, 0xB8, 0xAD, 0xE6, 0x96, 0x87, 0x0D,
        // 上面的 UTF-8 字节在 8-bit 模式下是"逐字节"字符，会乱码；
        // 改用真实 GBK 不可行，这里用 ASCII 数字+字母组合保证长度
        0x41, 0x42, 0x43, 0x44, 0x45, 0x46, 0x0D, // "ABCDEF\r"
      ])
      const result = (parser as any).extractTextSimple(data, { fComplex: true })
      expect(typeof result).toBe('string')
    })

    it('should preserve tabs in 8-bit mode', () => {
      const parser = new DocParser(new ArrayBuffer(512))
      const data = new Uint8Array([
        0x41, 0x09, 0x42, 0x0D, // "A\tB\r"
      ])
      const result = (parser as any).extractTextSimple(data, { fComplex: true })
      expect(result).toBe('A\tB')
    })

    it('should extract UTF-16LE text with Chinese content', () => {
      const parser = new DocParser(new ArrayBuffer(512))
      const text = '这是一段测试文本'
      const data = new Uint8Array(text.length * 2 + 4)
      for (let i = 0; i < text.length; i++) {
        const code = text.charCodeAt(i)
        data[i * 2] = code & 0xFF
        data[i * 2 + 1] = (code >> 8) & 0xFF
      }
      data[text.length * 2] = 0x0D
      data[text.length * 2 + 1] = 0x00
      const result = (parser as any).extractTextSimple(data)
      expect(result).toBe(text)
    })

    it('should respect fcMin offset and skip binary noise prefix', () => {
      const parser = new DocParser(new ArrayBuffer(512))
      const data = new Uint8Array([
        0x00, 0x00, 0x00, 0x00, 0x00, 0x00, // noise
        0xE8, 0xBF, 0x99, 0xE6, 0x98, 0xAF, 0xE4, 0xB8, 0xAD, 0xE6, 0x96, 0x87, 0x0D, // "这是中文\r" (UTF-8 bytes, will not decode well)
      ])
      const result = (parser as any).extractTextSimple(data, { fcMin: 6, fComplex: true })
      // Garbage bytes should be filtered by the junk/Chinese logic; at minimum
      // the method must not throw and returns a string.
      expect(typeof result).toBe('string')
    })

    it('should return empty string for all-noise input', () => {
      const parser = new DocParser(new ArrayBuffer(512))
      const data = new Uint8Array([0x00, 0x01, 0x02, 0x03, 0x00, 0x0D])
      const result = (parser as any).extractTextSimple(data, { fComplex: true })
      expect(result).toBe('')
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

  describe('stripBinaryPrefix (CJK noise)', () => {
    const para = (text: string) => ({ text, charFormat: {} })

    it('should not treat a single stray CJK noise char as the body start', () => {
      // FIB noise decodes to control chars plus an occasional CJK char; the
      // old strategy (first CJK char) would keep the noise char as the start.
      const parser = new DocParser(new ArrayBuffer(512))
      const result = (parser as any).stripBinaryPrefix(para('\u0002龿\u0002这是真实的中文正文内容'))
      expect(result.text).toBe('这是真实的中文正文内容')
    })

    it('should prefer a 4+ CJK body run over a short noise run', () => {
      const parser = new DocParser(new ArrayBuffer(512))
      // Two noise CJK chars (short run) followed by the real body run of 4+.
      const result = (parser as any).stripBinaryPrefix(para('\u0002龿龿\u0002这是真实的中文正文内容'))
      expect(result.text).toBe('这是真实的中文正文内容')
    })

    it('should keep CJK text that already starts at position 0', () => {
      const parser = new DocParser(new ArrayBuffer(512))
      const result = (parser as any).stripBinaryPrefix(para('这是真实的中文正文内容'))
      expect(result.text).toBe('这是真实的中文正文内容')
    })

    it('should not strip ASCII leading text before CJK', () => {
      // English body followed by a Chinese paragraph: the CJK run starts inside
      // the longest valid ASCII run, so it must not be chosen as the body start.
      const parser = new DocParser(new ArrayBuffer(512))
      const result = (parser as any).stripBinaryPrefix(para('Introduction这是正文'))
      expect(result.text).toBe('Introduction这是正文')
    })

    it('should realign charFormat styles after stripping', () => {
      const parser = new DocParser(new ArrayBuffer(512))
      const result = (parser as any).stripBinaryPrefix({
        text: '\u0002龿\u0002这是真实的中文正文内容',
        charFormat: { styles: [
          { start: 0, end: 5, style: { bold: true } },
          { start: 4, end: 12, style: { italic: true } },
        ] },
      })
      expect(result.text).toBe('这是真实的中文正文内容')
      expect(result.charFormat.styles).toEqual([
        { start: 0, end: 2, style: { bold: true } },
        { start: 1, end: 9, style: { italic: true } },
      ])
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

    it('should truncate compressed text at a binary signature', () => {
      const parser = new DocParser(new ArrayBuffer(512))
      // ASCII text + paragraph mark, then a PNG signature on the next line
      const prefix = 'This is plain text content'
      const data = new Uint8Array([
        ...prefix.split('').map(c => c.charCodeAt(0)),
        0x0D, // paragraph break — truncation keeps text up to this point
        0x89, 0x50, 0x4E, 0x47, // PNG signature bytes
        0x41, 0x42, 0x43,
      ])
      const result = (parser as any).extractTextFromRange(data, 0, data.length, true)
      // Text before the signature (up to the last paragraph break) is kept;
      // the truncation slices up to (not including) the break.
      expect(result).toBe('This is plain text content')
    })

    it('should truncate UTF-16 text at a binary signature', () => {
      const parser = new DocParser(new ArrayBuffer(512))
      const prefix = 'Some body text here'
      const bytes: number[] = []
      for (const ch of prefix) {
        const code = ch.charCodeAt(0)
        bytes.push(code & 0xFF, (code >> 8) & 0xFF)
      }
      // UTF-16LE "PNG" (0x5047 = 'GP'...) — use a raw JPEG signature FFD8FF in UTF-16
      // which the signature list catches via '\xFF\xD8\xFF' on the decoded chars
      bytes.push(0xFF, 0xD8, 0xFF, 0x00, 0x41, 0x00)
      const data = new Uint8Array(bytes)
      const result = (parser as any).extractTextFromRange(data, 0, data.length, false)
      expect(result).toContain('Some body text')
    })

    it('should handle empty and invalid ranges', () => {
      const parser = new DocParser(new ArrayBuffer(512))
      const data = new Uint8Array([0x41, 0x42, 0x43])
      expect((parser as any).extractTextFromRange(data, 0, 0)).toBe('')
      expect((parser as any).extractTextFromRange(data, -1, 2)).toBe('')
      expect((parser as any).extractTextFromRange(data, 0, 99)).toBe('')
    })
  })

  describe('text cleaning helpers', () => {
    const parser = new DocParser(new ArrayBuffer(512))

    describe('replacePageFieldsInText', () => {
      it('should replace instruction+result concatenations with the result', () => {
        // In extracted text the 0x13/0x14/0x15 field markers are stripped, so
        // instruction and result concatenate: "PAGE \\* MERGEFORMAT1".
        const text = '第 PAGE \\* MERGEFORMAT1 页 共 NUMPAGES \\* MERGEFORMAT5 页'
        const fields = [
          { instruction: 'PAGE \\* MERGEFORMAT', result: '1' },
          { instruction: 'NUMPAGES \\* MERGEFORMAT', result: '5' },
        ]
        const result = (parser as any).replacePageFieldsInText(text, fields)
        expect(result).toBe('第 1 页 共 5 页')
      })

      it('should leave text untouched when no match is found', () => {
        const result = (parser as any).replacePageFieldsInText('普通文本', [
          { instruction: 'PAGE', result: '9' },
        ])
        expect(result).toBe('普通文本')
      })

      it('should skip fields with empty instruction+result', () => {
        const result = (parser as any).replacePageFieldsInText('abc', [
          { instruction: '', result: '' },
        ])
        expect(result).toBe('abc')
      })
    })

    describe('cleanWordFieldCodes', () => {
      it('should convert Chinese page field pattern to readable text', () => {
        const result = (parser as any).cleanWordFieldCodes({
          text: '第 PAGE 3 页 共 NUMPAGES 10 页',
          charFormat: {},
        })
        expect(result.text).toBe('第 3 页 共 10 页')
      })

      it('should strip English field codes and clean multiple spaces', () => {
        const result = (parser as any).cleanWordFieldCodes({
          text: 'HYPERLINK "https://example.com" 显示文本  PAGE  DOCPROPERTY Author',
          charFormat: {},
        })
        expect(result.text).not.toContain('HYPERLINK')
        expect(result.text).not.toContain('PAGE')
        expect(result.text).not.toContain('DOCPROPERTY')
        expect(result.text).not.toContain('  ')
      })

      it('should drop charFormat.styles when text is modified', () => {
        const result = (parser as any).cleanWordFieldCodes({
          text: 'AUTHOR 内容',
          charFormat: { styles: [{ start: 0, end: 6, style: { bold: true } }] },
        })
        expect(result.text).not.toContain('AUTHOR')
        expect(result.charFormat.styles).toBeUndefined()
      })

      it('should keep original paragraph when nothing changes', () => {
        const para = { text: '干净的正文内容', charFormat: { styles: [] } }
        const result = (parser as any).cleanWordFieldCodes(para)
        expect(result).toBe(para)
      })

      it('should remove HYPERLINK URLs and EMBED class names around placeholders', () => {
        const result = (parser as any).cleanWordFieldCodes({
          text: 'HYPERLINK "http://x.com"\u0001ChartDocumentMauris 正文内容',
          charFormat: {},
        })
        expect(result.text).toContain('正文内容')
        expect(result.text).not.toContain('HYPERLINK')
        expect(result.text).not.toContain('http://')
        expect(result.text).not.toContain('ChartDocument')
      })
    })

    describe('hasSignificantContent', () => {
      it('should accept table rows and Chinese/English content', () => {
        expect((parser as any).hasSignificantContent('姓名\u0007年龄\u0007')).toBe(true)
        expect((parser as any).hasSignificantContent('这是中文内容')).toBe(true)
        expect((parser as any).hasSignificantContent('hello world foo')).toBe(true)
      })

      it('should reject short or meaningless text', () => {
        expect((parser as any).hasSignificantContent('')).toBe(false)
        expect((parser as any).hasSignificantContent('a')).toBe(false)
        expect((parser as any).hasSignificantContent('!!!')).toBe(false)
      })
    })

    describe('isValidChar', () => {
      it('should accept CJK, ASCII and common punctuation', () => {
        expect((parser as any).isValidChar('中'.charCodeAt(0))).toBe(true)
        expect((parser as any).isValidChar('A'.charCodeAt(0))).toBe(true)
        expect((parser as any).isValidChar(0x3001)).toBe(true) // 、
      })

      it('should reject control chars and exotic ranges', () => {
        expect((parser as any).isValidChar(0x00)).toBe(false)
        expect((parser as any).isValidChar(0x07)).toBe(false)
        expect((parser as any).isValidChar(0xE000)).toBe(false)
      })
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
      writeU32(60, 0xFFFFFFFE)   // firstMiniFatSector = ENDOFCHAIN
      writeU32(64, 0)            // miniFatSectorsCount
      writeU32(68, 0xFFFFFFFE)   // firstDifatSector = ENDOFCHAIN
      writeU32(72, 0)            // difatSectorsCount
      writeU32(76, 0)            // DIFAT[0] = sector 0 (FAT)
      for (let i = 1; i < 109; i++) {
        writeU32(76 + i * 4, 0xFFFFFFFF)  // DIFAT[1..108] = FREESECT
      }

      // ---- Sector 0 (offset 512): FAT ----
      // MS-CFB sector chain markers.
      const fatBase = SECTOR
      const ENDOFCHAIN = 0xFFFFFFFE
      const FREESECT = 0xFFFFFFFF
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
      writeDirEntry(dirBase + 0 * 128, 'Root Entry', 5, 0xFFFFFFFE, 0)
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
      // CLX (bare Pcdt, MS-DOC §2.9.38/§2.9.72):
      //   clxt (1 byte) = 0x02
      view[tblBase + 0] = 0x02
      //   lcb (4 bytes) = PlcPcd byte size = 4*(n+1) + 8*n = 16 for n=1
      writeU32(tblBase + 1, 16)
      // PlcPcd:
      //   aCP (8 bytes): [0, 11]
      writeU32(tblBase + 5, 0)
      writeU32(tblBase + 9, textLength)
      //   aPcd (8 bytes): reserved(2) + fc(4) + prm(2)
      //     fc = textOffset (no compression bit → UTF-16LE at that byte offset)
      writeU32(tblBase + 13 + 2, textOffset)  // fc at offset +2 within PCD entry

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

      const ENDOFCHAIN = 0xFFFFFFFE
      const FREESECT = 0xFFFFFFFF

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
      // CLX = bare Pcdt: clxt(1) + lcb(4) + PlcPcd(4*(n+1) + 8*n) for n=3.
      const plcPcdSize = 4 * 4 + 3 * 8
      const clxSize = 1 + 4 + plcPcdSize
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
      // CLX = bare Pcdt (MS-DOC §2.9.38/§2.9.72):
      //   clxt(1)=0x02, lcb(4)=PlcPcd size, PlcPcd
      //   PlcPcd: aCP(4*4)=[0,8,23,36], aPcd(3*8)
      view[tblBase + 0] = 0x02
      writeU32(tblBase + 1, plcPcdSize)  // lcb = PlcPcd size
      // aCP = [0, 8, 23, 36] at tblBase+5
      writeU32(tblBase + 5, 0)
      writeU32(tblBase + 9, 8)
      writeU32(tblBase + 13, 23)
      writeU32(tblBase + 17, 36)
      // aPcd: 3 entries, each 8 bytes (2 reserved + 4 fc + 2 prm), at tblBase+21
      //   piece 0: fc = textOffset (UTF-16LE, no compression bit)
      //   piece 1: fc = textOffset + 16
      //   piece 2: fc = textOffset + 46
      let pcdOff = tblBase + 21
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

describe('parseDocFileWithFormat', () => {
  class MockFileReader {
    onload: ((e: { target: { result: ArrayBuffer } }) => void) | null = null
    onerror: (() => void) | null = null
    result: ArrayBuffer | null = null
    static behavior: 'success' | 'error' | 'empty' = 'success'
    readAsArrayBuffer(_file: File) {
      setTimeout(() => {
        if (MockFileReader.behavior === 'error') {
          this.onerror?.()
          return
        }
        const buf = new ArrayBuffer(0)
        this.result = MockFileReader.behavior === 'empty' ? null : buf
        this.onload?.({ target: { result: this.result! } })
      }, 0)
    }
  }

  afterEach(() => {
    vi.unstubAllGlobals()
    MockFileReader.behavior = 'success'
  })

  it('should parse a file via FileReader', async () => {
    vi.stubGlobal('FileReader', MockFileReader)
    const file = { name: 'test.doc', size: 0 } as File
    const result = await parseDocFileWithFormat(file)
    expect(result.success).toBe(false) // empty buffer → parse failure
    expect(result.error).toBeTruthy()
  })

  it('should resolve with a read error when FileReader fails', async () => {
    vi.stubGlobal('FileReader', MockFileReader)
    MockFileReader.behavior = 'error'
    const result = await parseDocFileWithFormat({ name: 'x.doc' } as File)
    expect(result.success).toBe(false)
    expect(result.error).toContain('文件读取失败')
  })

  it('should handle a null result buffer', async () => {
    vi.stubGlobal('FileReader', MockFileReader)
    MockFileReader.behavior = 'empty'
    const result = await parseDocFileWithFormat({ name: 'x.doc' } as File)
    expect(result.success).toBe(false)
    expect(result.error).toBeTruthy()
  })
})

describe('parseDocFile (plain text path)', () => {
  class MockFileReader2 {
    onload: ((e: { target: { result: ArrayBuffer } }) => void) | null = null
    onerror: (() => void) | null = null
    static behavior: 'success' | 'error' = 'success'
    readAsArrayBuffer(_file: File) {
      setTimeout(() => {
        if (MockFileReader2.behavior === 'error') {
          this.onerror?.()
          return
        }
        this.onload?.({ target: { result: new ArrayBuffer(0) } })
      }, 0)
    }
  }

  afterEach(() => {
    vi.unstubAllGlobals()
    MockFileReader2.behavior = 'success'
  })

  it('should parse text via FileReader and fail gracefully on empty buffer', async () => {
    vi.stubGlobal('FileReader', MockFileReader2)
    const result = await parseDocFile({ name: 'test.doc' } as File)
    expect(result.success).toBe(false)
    expect(result.error).toBeTruthy()
  })

  it('should resolve with a read error when FileReader fails', async () => {
    vi.stubGlobal('FileReader', MockFileReader2)
    MockFileReader2.behavior = 'error'
    const result = await parseDocFile({ name: 'x.doc' } as File)
    expect(result.success).toBe(false)
    expect(result.error).toContain('文件读取失败')
  })
})

describe('parseDocFileFromBuffer with file name', () => {
  it('should keep failing gracefully even with an oversized sector size', () => {
    // OLE signature with sector size power 12 (4096-byte sectors) in a
    // 512-byte buffer — must fail gracefully, never throw.
    const buf = new ArrayBuffer(512)
    const view = new Uint8Array(buf)
    view[0] = 0xD0; view[1] = 0xCF; view[2] = 0x11; view[3] = 0xE0
    view[4] = 0xA1; view[5] = 0xB1; view[6] = 0x1A; view[7] = 0xE1
    view[30] = 12
    const result = parseDocFileFromBuffer(buf, 'broken.doc')
    expect(result.success).toBe(false)
  })

  it('should not include a file name when omitted', () => {
    const result = parseDocFileFromBuffer(new ArrayBuffer(0))
    expect(result.success).toBe(false)
    expect(result.error).not.toContain('（文件:')
  })
})

describe('encoding scoring helpers', () => {
  const parser = new DocParser(new ArrayBuffer(512))

  it('scoreRawParagraphs should score English and Chinese content', () => {
    const paras = [
      { text: 'This is a paragraph with several english words here' },
      { text: '这是一段包含多个中文词汇的测试文本内容' },
      { text: 'short' },
    ]
    const score = (parser as any).scoreRawParagraphs(paras)
    expect(score).toBeGreaterThan(0)
    // English word bonus (30) + length bonus + punctuation bonus
    expect(score).toBeGreaterThanOrEqual(40)
  })

  it('scoreRawParagraphs should return 0 for empty or short input', () => {
    expect((parser as any).scoreRawParagraphs([])).toBe(0)
    expect((parser as any).scoreRawParagraphs(null)).toBe(0)
    expect((parser as any).scoreRawParagraphs([{ text: 'abc' }])).toBe(0)
  })

  it('scoreRawParagraphs should give capital-letter bonus', () => {
    const paras = [{ text: 'Capitalized Start Of Sentence' }]
    const score = (parser as any).scoreRawParagraphs(paras)
    // 4 english words (30) + length (min(29/2,50)=14.5) + capital (5) = 49.5
    expect(score).toBe(49.5)
  })

  it('scorePlainText should score paragraph text', () => {
    const score = (parser as any).scorePlainText('First paragraph here.\n\nSecond one with more words.')
    expect(score).toBeGreaterThan(0)
  })

  it('scorePlainText should return 0 for empty text', () => {
    expect((parser as any).scorePlainText('')).toBe(0)
    expect((parser as any).scorePlainText('   \n\n  ')).toBe(0)
  })

  it('scorePlainText should handle CJK content', () => {
    const score = (parser as any).scorePlainText('这是第一段测试文本。\n\n这是第二段也有内容。')
    expect(score).toBeGreaterThan(0)
  })

  it('detectEncodingFromBinary should classify UTF-16LE by null ratio', () => {
    // UTF-16LE: every ASCII char followed by 0x00. The scan starts at
    // offset 2048, so pad the buffer to at least that size.
    const prefix = new Uint8Array(2048)
    const bytes: number[] = []
    for (const ch of 'Hello world this is a test of the encoding detector') {
      bytes.push(ch.charCodeAt(0), 0)
    }
    const data = new Uint8Array(prefix.length + bytes.length)
    data.set(prefix, 0)
    data.set(new Uint8Array(bytes), prefix.length)
    const result = (parser as any).detectEncodingFromBinary(data)
    expect(result).toBe(false) // UTF-16LE
  })

  it('detectEncodingFromBinary should classify 8-bit by null ratio', () => {
    // Fill the pre-scan region with 0x41 so the null ratio is not polluted
    const text = 'Hello world this is a test of the encoding detector'
    const data = new Uint8Array(2048 + text.length)
    data.fill(0x41)
    for (let i = 0; i < text.length; i++) data[2048 + i] = text.charCodeAt(i)
    const result = (parser as any).detectEncodingFromBinary(data)
    expect(result).toBe(true) // 8-bit compressed
  })
})

describe('detectEncodingFromBinary paragraph-marker fallback', () => {
  const parser = new DocParser(new ArrayBuffer(512))

  it('should classify 8-bit by 0x0D markers when null ratio is ambiguous', () => {
    // nullRatio between 0.05 and 0.10 (ambiguous) → falls to 0x0D heuristic
    // 8-bit text: 0x0D paragraph marks NOT followed by 0x00
    const size = 9000
    const data = new Uint8Array(size)
    data.fill(0x41)
    // ~6% nulls across the whole scan region (6952 bytes): 420 nulls
    for (let i = 0; i < 420; i++) data[2048 + i * 16] = 0x00
    // 8-bit paragraph marks: 0x0D NOT followed by 0x00
    for (let i = 0; i < 20; i++) data[2048 + 100 + i * 20] = 0x0D
    const result = (parser as any).detectEncodingFromBinary(data)
    expect(result).toBe(true) // 8-bit
  })

  it('should classify UTF-16 by 0x0D markers followed by null', () => {
    const size = 9000
    const data = new Uint8Array(size)
    data.fill(0x41)
    // ~6% nulls across the scan region
    for (let i = 0; i < 420; i++) data[2048 + i * 16] = 0x00
    // UTF-16 paragraph marks: 0x0D 0x00
    for (let i = 0; i < 20; i++) {
      data[2048 + 100 + i * 20] = 0x0D
      data[2048 + 101 + i * 20] = 0x00
    }
    const result = (parser as any).detectEncodingFromBinary(data)
    expect(result).toBe(false) // UTF-16LE
  })

  it('should return null when no markers and ambiguous null ratio', () => {
    const size = 9000
    const data = new Uint8Array(size)
    data.fill(0x41)
    for (let i = 0; i < 420; i++) data[2048 + i * 16] = 0x00
    // no 0x0D markers at all
    const result = (parser as any).detectEncodingFromBinary(data)
    expect(result).toBeNull()
  })
})

describe('fallback text paths', () => {
  /** OLE2 without a WordDocument stream whose 8-bit ASCII text sits right
   *  after the OLE signature: the 4 signature pairs keep the UTF-16LE
   *  scanner aligned, so the isolated paragraph is extracted as fallback. */
  function buildOleWithoutWordDocumentText(): ArrayBuffer {
    const SECTOR = 512
    const buf = new ArrayBuffer(SECTOR * 4)
    const view = new Uint8Array(buf)
    const w16 = (off: number, v: number) => { view[off] = v & 0xff; view[off + 1] = (v >> 8) & 0xff }
    const w32 = (off: number, v: number) => {
      view[off] = v & 0xff; view[off + 1] = (v >> 8) & 0xff
      view[off + 2] = (v >> 16) & 0xff; view[off + 3] = (v >> 24) & 0xff
    }
    view[0] = 0xD0; view[1] = 0xCF; view[2] = 0x11; view[3] = 0xE0
    view[4] = 0xA1; view[5] = 0xB1; view[6] = 0x1A; view[7] = 0xE1
    // 8-bit ASCII text right after the signature: each byte pair is a
    // valid UTF-16LE unit and the signature pairs keep the scan aligned.
    const text = 'Hello World from fallback'
    view[8] = 0x0D
    for (let i = 0; i < text.length; i++) view[10 + i * 2] = text.charCodeAt(i)
    view[10 + text.length * 2] = 0x0D
    // FAT sector (all FREESECT), directory sector (all zero, empty)
    for (let i = 0; i < 128; i++) w32(SECTOR + i * 4, 0xFFFFFFFF)
    return buf
  }

  it('parse() falls back to full-file text when WordDocument is missing', () => {
    const parser = new DocParser(buildOleWithoutWordDocumentText())
    const result = parser.parse()
    expect(result.success).toBe(true)
    expect(result.text).toContain('Hello World from fallback')
  })

  it('parseWithFormat() builds paragraphs from full-file fallback text', () => {
    const parser = new DocParser(buildOleWithoutWordDocumentText())
    const result = parser.parseWithFormat()
    expect(result.success).toBe(true)
    expect(result.text).toContain('Hello World from fallback')
    expect(result.document.paragraphs.length).toBeGreaterThan(0)
  })

  it('returns 文档内容为空 when nothing can be extracted', () => {
    const SECTOR = 512
    const buf = new ArrayBuffer(SECTOR * 5)
    const view = new Uint8Array(buf)
    const writeU16 = (off: number, val: number) => {
      view[off] = val & 0xff; view[off + 1] = (val >> 8) & 0xff
    }
    const writeU32 = (off: number, val: number) => {
      view[off] = val & 0xff; view[off + 1] = (val >> 8) & 0xff
      view[off + 2] = (val >> 16) & 0xff; view[off + 3] = (val >> 24) & 0xff
    }
    view[0] = 0xD0; view[1] = 0xCF; view[2] = 0x11; view[3] = 0xE0
    view[4] = 0xA1; view[5] = 0xB1; view[6] = 0x1A; view[7] = 0xE1
    writeU16(26, 3); writeU16(30, 9); writeU16(32, 6)
    writeU32(48, 1); writeU32(56, 4096)
    writeU32(60, 0xFFFFFFFE); writeU32(64, 0); writeU32(68, 0xFFFFFFFE); writeU32(72, 0)
    writeU32(76, 0)
    for (let i = 1; i < 109; i++) writeU32(76 + i * 4, 0xFFFFFFFF)
    const fatBase = SECTOR
    for (let i = 0; i < 4; i++) writeU32(fatBase + i * 4, 0xFFFFFFFE)
    for (let i = 4; i < 128; i++) writeU32(fatBase + i * 4, 0xFFFFFFFF)
    const dirBase = SECTOR * 2
    const writeDirEntry = (entryOffset: number, name: string, objectType: number, startSector: number, size: number) => {
      for (let i = 0; i < name.length; i++) writeU16(entryOffset + i * 2, name.charCodeAt(i))
      writeU16(entryOffset + 64, name.length * 2)
      view[entryOffset + 66] = objectType
      view[entryOffset + 67] = 1
      writeU32(entryOffset + 116, startSector)
      writeU32(entryOffset + 120, size)
    }
    writeDirEntry(dirBase + 0 * 128, 'Root Entry', 5, 0xFFFFFFFE, 0)
    writeDirEntry(dirBase + 1 * 128, 'WordDocument', 2, 2, 512)
    writeDirEntry(dirBase + 2 * 128, '0Table', 2, 3, 64)
    const wdBase = SECTOR * 3
    writeU16(0 + wdBase, 0xA5EC)
    writeU16(2 + wdBase, 0x0101)
    writeU16(10 + wdBase, 0)
    writeU16(32 + wdBase, 0)
    writeU16(34 + wdBase, 22)
    writeU32(36 + 12 + wdBase, 0) // ccpText = 0
    writeU16(124 + wdBase, 34)
    writeU32(390 + wdBase, 0)
    writeU32(394 + wdBase, 0) // no CLX
    const parser = new DocParser(buf)
    const result = parser.parse()
    expect(result.success).toBe(false)
    expect(result.error).toContain('文档内容为空')
  })

  it('reports a parse failure when the progress callback throws', () => {
    const buf = buildOleWithoutWordDocumentText()
    const parser = new DocParser(buf)
    const result = parser.parseWithFormat(() => {
      throw new Error('progress boom')
    })
    expect(result.success).toBe(false)
    expect(result.error).toContain('progress boom')
  })
})

describe('parseWithFormat field assembly', () => {
  /**
   * A Word 97-style document with HYPERLINK/AUTHOR/PAGE/TOC/INDEX/REF
   * fields, PlcfSed, and a single-piece CLX. The field CPs index the plain
   * text directly (no control chars), so instruction extraction from the
   * raw stream and result slicing from the extracted text stay aligned.
   */
  function buildOleWithFields(): ArrayBuffer {
    const SECTOR = 512
    const buf = new ArrayBuffer(SECTOR * 7)
    const view = new Uint8Array(buf)
    const w16 = (off: number, v: number) => { view[off] = v & 0xff; view[off + 1] = (v >> 8) & 0xff }
    const w32 = (off: number, v: number) => {
      view[off] = v & 0xff; view[off + 1] = (v >> 8) & 0xff
      view[off + 2] = (v >> 16) & 0xff; view[off + 3] = (v >> 24) & 0xff
    }
    const END = 0xFFFFFFFE, FREE = 0xFFFFFFFF
    view[0] = 0xD0; view[1] = 0xCF; view[2] = 0x11; view[3] = 0xE0
    view[4] = 0xA1; view[5] = 0xB1; view[6] = 0x1A; view[7] = 0xE1
    w16(26, 3); w16(30, 9); w16(32, 6)
    w32(48, 1); w32(56, 4096)
    w32(60, END); w32(64, 0); w32(68, END); w32(72, 0)
    w32(76, 0)
    for (let i = 1; i < 109; i++) w32(76 + i * 4, FREE)
    // FAT: 0=FAT, 1=dir, 2->3=WordDocument, 4=0Table
    const fatBase = SECTOR
    w32(fatBase + 0 * 4, END); w32(fatBase + 1 * 4, 5)
    w32(fatBase + 2 * 4, 3); w32(fatBase + 3 * 4, END); w32(fatBase + 4 * 4, END)
    w32(fatBase + 5 * 4, END)
    for (let i = 6; i < 128; i++) w32(fatBase + i * 4, FREE)
    // Directory
    const dirBase = SECTOR * 2
    const writeDir = (off: number, name: string, type: number, start: number, size: number) => {
      for (let i = 0; i < name.length; i++) w16(off + i * 2, name.charCodeAt(i))
      w16(off + 64, name.length * 2)
      view[off + 66] = type
      view[off + 67] = 1
      w32(off + 116, start)
      w32(off + 120, size)
    }
    writeDir(dirBase + 0 * 128, 'Root Entry', 5, END, 0)
    writeDir(dirBase + 1 * 128, 'WordDocument', 2, 2, 1024)
    writeDir(dirBase + 2 * 128, '0Table', 2, 4, 512)
    writeDir(dirBase + 3 * 128, 'MSGraph.Chart.8', 1, END, 0)
    // Directory chain continues at sector 5 (physical 3072)
    const dirBase2 = SECTOR * 6
    writeDir(dirBase2 + 0 * 128, 'WordArt.1', 1, END, 0)

    // WordDocument stream (sectors 2-3)
    const wdBase = SECTOR * 3
    w16(0 + wdBase, 0xA5EC)
    w16(2 + wdBase, 0x0101)
    w16(10 + wdBase, 0)
    w16(32 + wdBase, 0)
    w16(34 + wdBase, 22)
    const text = 'X HYPERLINK "a.com" Click AUTHOR John PAGE 1 TOC \\o "1" Head.....1 INDEX A\t1 REF _R1 \\h 1'
    // FibBase fcMin/fcMac: text starts at character 200 (byte 400)
    w32(24 + wdBase, 200)
    w32(28 + wdBase, 200 + text.length)
    w32(36 + 12 + wdBase, text.length) // ccpText
    w16(124 + wdBase, 34) // cbRgFcLcb
    // pair 6: fcPlcfSed/lcbPlcfSed -> 0Table offset 160, 16 bytes
    w32(126 + 6 * 8 + wdBase, 160)
    w32(126 + 6 * 8 + 4 + wdBase, 16)
    // pair 16: fcPlcfFldMom/lcbPlcfFldMom -> 0Table offset 32, 112 bytes
    w32(126 + 16 * 8 + wdBase, 32)
    w32(126 + 16 * 8 + 4 + wdBase, 112)
    // pair 12: PlcfBteChpx -> 0Table offset 270 (CHPX with a revision mark)
    w32(126 + 12 * 8 + wdBase, 270)
    w32(126 + 12 * 8 + 4 + wdBase, 25)
    // pairs 21-23: bookmarks (PlcfBkf/PlcfBkl/SttbfBkmk at 0Table 200/216/232)
    // pair 21 = fcSttbfBkmk, 22 = fcPlcfBkf, 23 = fcPlcfBkl
    w32(126 + 21 * 8 + wdBase, 232)
    w32(126 + 21 * 8 + 4 + wdBase, 26)
    w32(126 + 22 * 8 + wdBase, 200)
    w32(126 + 22 * 8 + 4 + wdBase, 12)
    w32(126 + 23 * 8 + wdBase, 216)
    w32(126 + 23 * 8 + 4 + wdBase, 12)
    // pair 33: fcClx/lcbClx -> 0Table offset 0
    const clxSize = 1 + 4 + 4 * 2 + 8
    w32(126 + 33 * 8 + wdBase, 0)
    w32(126 + 33 * 8 + 4 + wdBase, clxSize)
    // Text at offset 400
    const textOffset = 400
    for (let i = 0; i < text.length; i++) w16(textOffset + i * 2 + wdBase, text.charCodeAt(i))
    w16(textOffset + text.length * 2 + wdBase, 0x0D)
    // Office Art FDG (rectangle) after the text so shapes are detected
    const recHeader = (off: number, recVer: number, recInstance: number, recType: number, recLen: number) => {
      view[wdBase + off] = (recVer << 6) | ((recInstance >> 8) & 0x3F)
      view[wdBase + off + 1] = recInstance & 0xff
      view[wdBase + off + 2] = recType & 0xff
      view[wdBase + off + 3] = (recType >> 8) & 0xff
      w32(wdBase + off + 4, recLen)
    }
    let art = textOffset + text.length * 2 + 2
    const spRecLen = 72
    const spSize = 8 + spRecLen
    const spContainerLen = spSize
    const dgLen = 8 + spContainerLen
    const fdgLen = 8 + dgLen
    recHeader(art, 3, 0x00C0, 0xF000, fdgLen)
    art += 8
    recHeader(art, 3, 0, 0xF002, dgLen)
    art += 8
    recHeader(art, 3, 0, 0xF003, spContainerLen)
    art += 8
    recHeader(art, 3, 0, 0x0004, spRecLen)
    art += 8
    w32(wdBase + art, 0x50000001) // spid
    w16(wdBase + art + 4, 0x0001) // grfSp: rectangle-ish
    w32(wdBase + art + 8 + 4, 100)  // x
    w32(wdBase + art + 8 + 8, 200)  // y
    w32(wdBase + art + 8 + 28, 300) // width
    w32(wdBase + art + 8 + 32, 400) // height
    // Equation magic + UTF-16LE formula text
    const eqMagic = [0xEF, 0xBF, 0xBD, 0xEF, 0xBF, 0xBD]
    let eq = art + spSize
    eqMagic.forEach((b, i) => { view[wdBase + eq + i] = b })
    const eqn = '\\alpha'
    for (let i = 0; i < eqn.length; i++) w16(wdBase + eq + 6 + i * 2, eqn.charCodeAt(i))
    w16(wdBase + eq + 6 + eqn.length * 2, 0)

    // 0Table stream (sector 4 -> physical offset (4+1)*512)
    const tblBase = SECTOR * 5
    // CLX: bare Pcdt, single piece
    view[tblBase + 0] = 0x02
    w32(tblBase + 1, 16)
    w32(tblBase + 5, 0)
    w32(tblBase + 9, text.length)
    w32(tblBase + 13 + 2, textOffset) // PCD fc (UTF-16LE)
    // PlcfFld at offset 32: 6 fields, 19 CPs + 18 (ch, flt) pairs
    const fldBase = tblBase + 32
    const cps = [0, 19, 25, 25, 32, 37, 37, 42, 44, 44, 55, 66, 66, 72, 76, 76, 87, 89, 89]
    const pairs: Array<[number, number]> = [
      [0x13, 37], [0x14, 0], [0x15, 0],
      [0x13, 1], [0x14, 0], [0x15, 0],
      [0x13, 0], [0x14, 0], [0x15, 0],
      [0x13, 19], [0x14, 0], [0x15, 0],
      [0x13, 14], [0x14, 0], [0x15, 0],
      [0x13, 0], [0x14, 0], [0x15, 0],
    ]
    cps.forEach((cp, i) => w32(fldBase + i * 4, cp))
    pairs.forEach(([ch, flt], i) => {
      view[fldBase + cps.length * 4 + i * 2] = ch
      view[fldBase + cps.length * 4 + i * 2 + 1] = flt
    })
    // PlcfSed at offset 160: 1 section, cp [0, text.length], SED fn=0 fcSepx=END
    const sedBase = tblBase + 160
    w32(sedBase + 0, 0)
    w32(sedBase + 4, text.length)
    w16(sedBase + 8, 0)
    w32(sedBase + 10, END)
    w16(sedBase + 14, 0)
    // PlcfBteChpx at 270: one CHPX run over cp [0, 10] with a revision mark
    const chpxBase = tblBase + 270
    w32(chpxBase + 0, 0)
    w32(chpxBase + 4, 10)
    // grpprl: CFRMark on, then IBST_RMARK (author 0) and DTTM_RMARK
    w16(chpxBase + 8, 15) // aPcb cb = 15; grpprl (13 bytes) follows at +10
    view[chpxBase + 10] = 0x01 // sprmCFRMark (0x0801)
    view[chpxBase + 11] = 0x08
    view[chpxBase + 12] = 0x01 // toggle on -> insert revision
    view[chpxBase + 13] = 0x04 // sprmCIbstRMark (0x4804)
    view[chpxBase + 14] = 0x48
    view[chpxBase + 15] = 0x00 // author index 0
    view[chpxBase + 16] = 0x00
    view[chpxBase + 17] = 0x05 // sprmCDttmRMark (0x6805)
    view[chpxBase + 18] = 0x68
    w32(chpxBase + 19, 0x01020304) // dttm timestamp
    // Bookmark tables: one bookmark over cp [0, 10]
    const bkfBase = tblBase + 200
    w32(bkfBase + 0, 0)
    w32(bkfBase + 4, 10)
    w16(bkfBase + 8, 1) // ibkl = 1 -> bkl CP[1] = 10
    const bklBase = tblBase + 216
    w32(bklBase + 0, 0)
    w32(bklBase + 4, 10)
    const bkmkBase = tblBase + 232
    w16(bkmkBase + 0, 0xFFFF) // fExtend: UTF-16 names
    w16(bkmkBase + 2, 1)      // count
    w16(bkmkBase + 4, 11)     // cch (incl. terminator)
    const bname = 'MyBookmark'
    for (let i = 0; i < bname.length; i++) w16(bkmkBase + 6 + i * 2, bname.charCodeAt(i))
    w16(bkmkBase + 6 + bname.length * 2, 0)
    return buf
  }

  it('assembles hyperlinks, toc, index, fields, page fields, cross references and sections', () => {
    const parser = new DocParser(buildOleWithFields())
    const result = parser.parseWithFormat()
    expect(result.success).toBe(true)
    const doc = result.document
    expect(doc.hyperlinks.length).toBe(1)
    expect(doc.hyperlinks[0].url).toBe('a.com')
    expect(doc.toc.length).toBeGreaterThan(0)
    expect(doc.index.length).toBeGreaterThan(0)
    expect(doc.documentFields.author).toBe('John')
    expect(doc.pageFields.length).toBeGreaterThan(0)
    expect(doc.crossReferences.length).toBe(1)
    expect(doc.sections.length).toBe(1)
    expect(doc.bookmarks.length).toBe(1)
    expect(doc.bookmarks[0].name).toBe('MyBookmark')
    expect(doc.charts.length).toBe(1)
    expect(doc.charts[0].type).toBe('msgraph')
    expect(doc.wordArts.length).toBe(1)
    expect(doc.shapes.length).toBe(1)
    expect(doc.equations.length).toBe(1)
    expect(doc.revisions.length).toBe(1)
    expect(doc.revisions[0].type).toBe('insert')
    expect(doc.revisions[0].timestamp).toBe(0x01020304)
    expect(doc.paragraphs.length).toBeGreaterThan(0)
  })
})

describe('libwv fallback mode', () => {
  /** WordDocument with no CLX: lcbClx=0, ccpText>0, text at stream offset 2048. */
  function buildLibwvOle(): ArrayBuffer {
    const SECTOR = 512
    const buf = new ArrayBuffer(SECTOR * 9)
    const view = new Uint8Array(buf)
    const w16 = (off: number, v: number) => { view[off] = v & 0xff; view[off + 1] = (v >> 8) & 0xff }
    const w32 = (off: number, v: number) => {
      view[off] = v & 0xff; view[off + 1] = (v >> 8) & 0xff
      view[off + 2] = (v >> 16) & 0xff; view[off + 3] = (v >> 24) & 0xff
    }
    const END = 0xFFFFFFFE, FREE = 0xFFFFFFFF
    view[0] = 0xD0; view[1] = 0xCF; view[2] = 0x11; view[3] = 0xE0
    view[4] = 0xA1; view[5] = 0xB1; view[6] = 0x1A; view[7] = 0xE1
    w16(26, 3); w16(30, 9); w16(32, 6)
    w32(48, 1); w32(56, 4096)
    w32(60, END); w32(64, 0); w32(68, END); w32(72, 0)
    w32(76, 0)
    for (let i = 1; i < 109; i++) w32(76 + i * 4, FREE)
    const fatBase = SECTOR
    w32(fatBase + 0 * 4, END); w32(fatBase + 1 * 4, END)
    w32(fatBase + 2 * 4, 3); w32(fatBase + 3 * 4, 4)
    w32(fatBase + 4 * 4, 5); w32(fatBase + 5 * 4, 6)
    w32(fatBase + 6 * 4, END); w32(fatBase + 7 * 4, END)
    for (let i = 8; i < 128; i++) w32(fatBase + i * 4, FREE)
    const dirBase = SECTOR * 2
    const writeDir = (off: number, name: string, type: number, start: number, size: number) => {
      for (let i = 0; i < name.length; i++) w16(off + i * 2, name.charCodeAt(i))
      w16(off + 64, name.length * 2)
      view[off + 66] = type
      view[off + 67] = 1
      w32(off + 116, start)
      w32(off + 120, size)
    }
    writeDir(dirBase + 0 * 128, 'Root Entry', 5, END, 0)
    writeDir(dirBase + 1 * 128, 'WordDocument', 2, 2, 2560)
    writeDir(dirBase + 2 * 128, '0Table', 2, 7, 512)
    writeDir(dirBase + 3 * 128, 'MSGraph.Chart.8', 1, END, 0)
    const wdBase = SECTOR * 3
    w16(0 + wdBase, 0xA5EC)
    w16(2 + wdBase, 0x0101)
    w16(10 + wdBase, 0)
    w16(32 + wdBase, 0)
    w16(34 + wdBase, 22)
    const text = 'Hello libwv world'
    w32(36 + 12 + wdBase, text.length) // ccpText
    w16(124 + wdBase, 34) // cbRgFcLcb: all pairs zero (no CLX, no tables)
    // Text at stream offset 2048 (libwv convention), 5-sector WordDocument
    const textStreamOffset = 2048
    for (let i = 0; i < text.length; i++) w16(wdBase + textStreamOffset + i * 2, text.charCodeAt(i))
    w16(wdBase + textStreamOffset + text.length * 2, 0x0D)
    // A tiny JPEG right after the text so extractPictures finds it by
    // scanning the WordDocument stream (libwv embeds images inline).
    let jpeg = wdBase + textStreamOffset + (text.length + 1) * 2
    const jpegBytes: number[] = [0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10]
    for (let i = 0; i < 16; i++) jpegBytes.push(0x11)
    jpegBytes.push(0xFF, 0xD9)
    jpegBytes.forEach((b, i) => { view[jpeg + i] = b })
    // 0Table (sector 7): all zeros -> format fallback finds nothing
    return buf
  }

  it('parses a libwv-style document through the no-CLX fallback', () => {
    const parser = new DocParser(buildLibwvOle())
    const result = parser.parseWithFormat()
    expect(result.success).toBe(true)
    const texts = (result.document.paragraphs as Array<{ text: string }>).map(p => p.text).join(' ')
    expect(texts).toContain('Hello libwv world')
    expect(result.document.pictures.length).toBeGreaterThan(0)
    expect(result.document.charts.length).toBe(1)
  })
})

describe('CLX-unreachable fallback paths', () => {
  /** WordDocument with an out-of-range CLX pointer and text at offset 2048. */
  function buildNoClxOle(fcMinBase: number, fcMacBase: number, utf16Text = false, customText?: string): ArrayBuffer {
    const SECTOR = 512
    const buf = new ArrayBuffer(SECTOR * 9)
    const view = new Uint8Array(buf)
    const w16 = (off: number, v: number) => { view[off] = v & 0xff; view[off + 1] = (v >> 8) & 0xff }
    const w32 = (off: number, v: number) => {
      view[off] = v & 0xff; view[off + 1] = (v >> 8) & 0xff
      view[off + 2] = (v >> 16) & 0xff; view[off + 3] = (v >> 24) & 0xff
    }
    const END = 0xFFFFFFFE, FREE = 0xFFFFFFFF
    view[0] = 0xD0; view[1] = 0xCF; view[2] = 0x11; view[3] = 0xE0
    view[4] = 0xA1; view[5] = 0xB1; view[6] = 0x1A; view[7] = 0xE1
    w16(26, 3); w16(30, 9); w16(32, 6)
    w32(48, 1); w32(56, 4096)
    w32(60, END); w32(64, 0); w32(68, END); w32(72, 0)
    w32(76, 0)
    for (let i = 1; i < 109; i++) w32(76 + i * 4, FREE)
    const fatBase = SECTOR
    w32(fatBase + 0 * 4, END); w32(fatBase + 1 * 4, END)
    w32(fatBase + 2 * 4, 3); w32(fatBase + 3 * 4, 4)
    w32(fatBase + 4 * 4, 5); w32(fatBase + 5 * 4, 6)
    w32(fatBase + 6 * 4, END); w32(fatBase + 7 * 4, END)
    for (let i = 8; i < 128; i++) w32(fatBase + i * 4, FREE)
    const dirBase = SECTOR * 2
    const writeDir = (off: number, name: string, type: number, start: number, size: number) => {
      for (let i = 0; i < name.length; i++) w16(off + i * 2, name.charCodeAt(i))
      w16(off + 64, name.length * 2)
      view[off + 66] = type
      view[off + 67] = 1
      w32(off + 116, start)
      w32(off + 120, size)
    }
    writeDir(dirBase + 0 * 128, 'Root Entry', 5, END, 0)
    writeDir(dirBase + 1 * 128, 'WordDocument', 2, 2, 2560)
    writeDir(dirBase + 2 * 128, '0Table', 2, 7, 512)
    writeDir(dirBase + 3 * 128, 'MSGraph.Chart.8', 1, END, 0)
    const wdBase = SECTOR * 3
    w16(0 + wdBase, 0xA5EC)
    w16(2 + wdBase, 0x0101)
    w16(10 + wdBase, 0)
    w16(32 + wdBase, 0)
    w16(34 + wdBase, 22)
    // Consecutive duplicate paragraph (consecutive-dedup branch) and a
    // 12-char tandem repeat (removeInternalDuplicates branch)
    const text = customText ?? 'Hello libwv world\r\nHello libwv world\r\nabcdefghijklabcdefghijkl\r\n'
    w32(24 + wdBase, fcMinBase)
    w32(28 + wdBase, fcMacBase)
    w32(36 + 12 + wdBase, text.length) // ccpText
    w16(124 + wdBase, 34)
    // fcClx=500/lcbClx=10 -> subarray lands inside 0Table zeros (invalid Pcdt)
    w32(126 + 33 * 8 + wdBase, 500)
    w32(126 + 33 * 8 + 4 + wdBase, 10)
    // Text at stream offset 2048: 8-bit by default, UTF-16LE when requested
    const textStreamOffset = 2048
    if (utf16Text) {
      for (let i = 0; i < text.length; i++) w16(wdBase + textStreamOffset + i * 2, text.charCodeAt(i))
      w16(wdBase + textStreamOffset + text.length * 2, 0x0D)
    } else {
      for (let i = 0; i < text.length; i++) view[wdBase + textStreamOffset + i] = text.charCodeAt(i)
      view[wdBase + textStreamOffset + text.length] = 0x0D
    }
    return buf
  }

  it('falls back to the FibBase fcMin/fcMac range when CLX is unreachable', () => {
    // span == ccpText (8-bit): fcMinBase=2048, text is 61 chars
    const parser = new DocParser(buildNoClxOle(2048, 2048 + 61))
    const result = parser.parseWithFormat()
    expect(result.success).toBe(true)
    const texts = (result.document.paragraphs as Array<{ text: string }>).map(p => p.text).join(' ')
    expect(texts).toContain('Hello libwv world')
  })

  it('falls back to binary encoding detection when CLX is unreachable', () => {
    const parser = new DocParser(buildNoClxOle(0, 0, true))
    const result = parser.parseWithFormat()
    expect(result.success).toBe(true)
    const texts = (result.document.paragraphs as Array<{ text: string }>).map(p => p.text).join(' ')
    expect(texts).toContain('Hello libwv world')
  })

  it('keeps a few paragraphs when no significant start is found', () => {
    const parser = new DocParser(buildNoClxOle(2048, 2048 + 9, false, 'ab\r\ncd\r\n'))
    const result = parser.parseWithFormat()
    expect(result.success).toBe(true)
    expect((result.document.paragraphs as Array<{ text: string }>).length).toBeGreaterThan(0)
  })
})

describe('form feed page breaks', () => {
  it('splits paragraphs on embedded form feeds with real CHPX runs', () => {
    const SECTOR = 512
    const buf = new ArrayBuffer(SECTOR * 5)
    const view = new Uint8Array(buf)
    const w16 = (off: number, v: number) => { view[off] = v & 0xff; view[off + 1] = (v >> 8) & 0xff }
    const w32 = (off: number, v: number) => {
      view[off] = v & 0xff; view[off + 1] = (v >> 8) & 0xff
      view[off + 2] = (v >> 16) & 0xff; view[off + 3] = (v >> 24) & 0xff
    }
    const END = 0xFFFFFFFE, FREE = 0xFFFFFFFF
    view[0] = 0xD0; view[1] = 0xCF; view[2] = 0x11; view[3] = 0xE0
    view[4] = 0xA1; view[5] = 0xB1; view[6] = 0x1A; view[7] = 0xE1
    w16(26, 3); w16(30, 9); w16(32, 6)
    w32(48, 1); w32(56, 4096)
    w32(60, END); w32(64, 0); w32(68, END); w32(72, 0)
    w32(76, 0)
    for (let i = 1; i < 109; i++) w32(76 + i * 4, FREE)
    const fatBase = SECTOR
    for (let i = 0; i < 4; i++) w32(fatBase + i * 4, END)
    for (let i = 4; i < 128; i++) w32(fatBase + i * 4, FREE)
    const dirBase = SECTOR * 2
    const writeDir = (off: number, name: string, type: number, start: number, size: number) => {
      for (let i = 0; i < name.length; i++) w16(off + i * 2, name.charCodeAt(i))
      w16(off + 64, name.length * 2)
      view[off + 66] = type
      view[off + 67] = 1
      w32(off + 116, start)
      w32(off + 120, size)
    }
    writeDir(dirBase + 0 * 128, 'Root Entry', 5, END, 0)
    writeDir(dirBase + 1 * 128, 'WordDocument', 2, 2, 512)
    writeDir(dirBase + 2 * 128, '0Table', 2, 3, 512)
    const wdBase = SECTOR * 3
    w16(0 + wdBase, 0xA5EC)
    w16(2 + wdBase, 0x0101)
    w16(10 + wdBase, 0)
    w16(32 + wdBase, 0)
    w16(34 + wdBase, 22)
    const text = 'Hello\fWorld'
    w32(36 + 12 + wdBase, text.length) // ccpText
    w16(124 + wdBase, 34)
    // pair 12: PlcfBteChpx with one empty-CHPX run over cp [0, 11]
    w32(126 + 12 * 8 + wdBase, 120)
    w32(126 + 12 * 8 + 4 + wdBase, 12)
    const clxSize = 1 + 4 + 4 * 2 + 8
    w32(126 + 33 * 8 + wdBase, 0)
    w32(126 + 33 * 8 + 4 + wdBase, clxSize)
    const textOffset = 400
    for (let i = 0; i < text.length; i++) w16(textOffset + i * 2 + wdBase, text.charCodeAt(i))
    w16(textOffset + text.length * 2 + wdBase, 0x0D)
    const tblBase = SECTOR * 4
    view[tblBase + 0] = 0x02
    w32(tblBase + 1, 16)
    w32(tblBase + 5, 0)
    w32(tblBase + 9, text.length)
    w32(tblBase + 13 + 2, textOffset)
    // PlcfBteChpx at 120: aCP [0,11], aPcb [2], CHPX cb=2 (empty grpprl)
    w32(tblBase + 120, 0)
    w32(tblBase + 124, 11)
    w16(tblBase + 128, 2)
    const parser = new DocParser(buf)
    const result = parser.parseWithFormat()
    expect(result.success).toBe(true)
    const texts = (result.document.paragraphs as Array<{ text: string; paraFormat?: { pageBreakBefore?: boolean } }>).map(p => p.text)
    expect(texts.join(' ')).toContain('Hello')
  })
})
