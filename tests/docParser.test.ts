import { describe, it, expect, vi, afterEach } from 'vitest'
import { strictEqual } from 'node:assert'
import { readFileSync } from 'node:fs'
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

    it('should decode CP1252 Latin-1 range accents (0xA0-0xFF) in compressed text', () => {
      const parser = new DocParser(new ArrayBuffer(512))
      // "Nüshu" (ü = 0xFC) + "György" (ö = 0xF6) — regression guard for the
      // piece-table path silently dropping unmapped high bytes
      const data = new Uint8Array([0x4E, 0xFC, 0x73, 0x68, 0x75, 0x0D, 0x47, 0x79, 0xF6, 0x72, 0x67, 0x79])
      const result = (parser as any).extractTextFromRange(data, 0, data.length, true)
      expect(result).toBe('Nüshu\nGyörgy')
    })

    it('should apply Windows-1252 special mappings before Latin-1 fallback', () => {
      const parser = new DocParser(new ArrayBuffer(512))
      // 0x93 → “ (U+201C), 0xE9 → é (Latin-1直通), 0x81 → CP1252 未定义，仍丢弃
      const data = new Uint8Array([0x93, 0x61, 0x94, 0xE9, 0x81, 0x62])
      const result = (parser as any).extractTextFromRange(data, 0, data.length, true)
      expect(result).toBe('\u201Ca\u201Déb')
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

describe('character format title guessing', () => {
  const parser = new DocParser(new ArrayBuffer(512))

  it('treats a short all-Chinese line as a big Chinese title (bold, 36pt)', () => {
    // 5 Chinese chars: not pureName (>4), no sentence punctuation, no
    // English/ALL-CAPS title, chineseRatio>0.5, length<22, count>=2
    const cf = (parser as any).guessCharFormat('中文测试标')
    expect(cf.bold).toBe(true)
    expect(cf.fontSize).toBe(36) // stripped.length < 6
  })

  it('treats a longer Chinese heading as a 22pt title', () => {
    const cf = (parser as any).guessCharFormat('中文测试标题文本')
    expect(cf.bold).toBe(true)
    expect(cf.fontSize).toBe(22) // stripped.length >= 6
  })

  it('does not treat mixed long text as a short Chinese title', () => {
    // chineseRatio 0.5 (not > 0.5) and lowercase start → no title branch fires
    const cf = (parser as any).guessCharFormat('hello 世界这是很长')
    expect(cf.bold).not.toBe(true)
  })
})

describe('extractTextSimple UTF-16 junk filtering', () => {
  const parser = new DocParser(new ArrayBuffer(512))

  it('keeps paragraphs after the significant Chinese start', () => {
    // Two UTF-16LE Chinese paragraphs: the first one (>=3 CJK chars, no
    // junk) anchors the start, the second flows through the post-start
    // keep-branch of the filter loop.
    const text = '这是第一个中文段落开头\r\n后续内容也要保留完整\r\n'
    const data = new Uint8Array(text.length * 2)
    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i)
      data[i * 2] = code & 0xff
      data[i * 2 + 1] = (code >> 8) & 0xff
    }
    const result = (parser as any).extractTextSimple(data)
    expect(result).toContain('这是第一个中文段落开头')
    expect(result).toContain('后续内容也要保留完整')
  })

  it('falls back to the first paragraphs when no Chinese anchor exists', () => {
    // Pure-ASCII text never sets foundStart -> the slice(0,3) fallback runs.
    const ascii = 'Hello world paragraph\r\nSecond plain paragraph\r\n'
    const data = new Uint8Array(ascii.length * 2)
    for (let i = 0; i < ascii.length; i++) {
      const code = ascii.charCodeAt(i)
      data[i * 2] = code & 0xff
      data[i * 2 + 1] = (code >> 8) & 0xff
    }
    const result = (parser as any).extractTextSimple(data)
    expect(result).toContain('Hello world paragraph')
  })
})

describe('paragraph format heuristics', () => {
  const parser = new DocParser(new ArrayBuffer(512))

  it('detects square CJK bullets as unordered list items', () => {
    // ▪ is in the disc set checked earlier, so only ▫◦‣⁃ reach the square rule
    for (const marker of ['▫', '◦', '‣', '⁃']) {
      const info = (parser as any).detectListInfo(`${marker} item`)
      expect(info).toEqual({ listType: 'unordered', listStyle: 'square', listLevel: 0 })
    }
  })

  it('detects disc bullets with a plain-space separator', () => {
    const info = (parser as any).detectListInfo('▪ item')
    expect(info).toEqual({ listType: 'unordered', listStyle: 'disc', listLevel: 0 })
  })

  it('centers paragraphs with a modest leading-space ratio', () => {
    // 2 leading spaces + 5 chars: ratio 2/7 ≈ 0.29 ∈ (0.15, 0.5)
    const alignment = (parser as any).detectAlignment('  Hello', 0, 10)
    expect(alignment).toBe('center')
  })

  it('does not center when leading space is too small or too large', () => {
    expect((parser as any).detectAlignment('Hello', 0, 10)).not.toBe('center')
    // 9 leading spaces + 1 char: ratio 0.9 — outside the window
    expect((parser as any).detectAlignment('         X', 0, 10)).not.toBe('center')
  })

  it('collapses a triple tandem repeat to a single copy', () => {
    // Three consecutive 12-char copies: the inner while loop counts to 3
    // before slicing the repeated span away.
    const collapsed = (parser as any).removeInternalDuplicates(
      'hello abcdefghijklabcdefghijklabcdefghijkl world',
    )
    expect(collapsed).toContain('hello abcdefghijkl world')
    expect(collapsed).not.toContain('abcdefghijklabcdefghijkl')
  })

  it('leaves short tandem repeats untouched', () => {
    // Period 3 < the 12-char threshold: "la la la" stays intact
    const kept = (parser as any).removeInternalDuplicates('la la la la')
    expect(kept).toBe('la la la la')
  })

  it('does not merge a short paragraph when the next is short', () => {
    const paras = [
      { text: 'In non', charFormat: { fontSize: 12 }, paraFormat: {} },
      { text: 'also short', charFormat: { fontSize: 12 }, paraFormat: {} },
    ]
    ;(parser as any).applyStructuralFormats(paras)
    expect(paras.some(p => p.text.includes('In nonalso short'))).toBe(false)
  })
})

describe('parseWithFormat field assembly', () => {
  /**
   * A Word 97-style document with HYPERLINK/AUTHOR/PAGE/TOC/INDEX/REF
   * fields, PlcfSed, and a single-piece CLX. The field CPs index the plain
   * text directly (no control chars), so instruction extraction from the
   * raw stream and result slicing from the extracted text stay aligned.
   */
  function buildOleWithFields(withChart = true): ArrayBuffer {
    const SECTOR = 512
    const buf = new ArrayBuffer(SECTOR * 10)
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
    w32(fatBase + 0 * 4, END); w32(fatBase + 1 * 4, 6)
    w32(fatBase + 2 * 4, 3); w32(fatBase + 3 * 4, 4)
    w32(fatBase + 4 * 4, END); w32(fatBase + 5 * 4, END)
    w32(fatBase + 6 * 4, END); w32(fatBase + 7 * 4, END)
    for (let i = 8; i < 128; i++) w32(fatBase + i * 4, FREE)
    w32(fatBase + 8 * 4, END) // sector 8: EquationText stream
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
    writeDir(dirBase + 1 * 128, 'WordDocument', 2, 2, 1536)
    writeDir(dirBase + 2 * 128, '0Table', 2, 5, 512)
    if (withChart) writeDir(dirBase + 3 * 128, 'MSGraph.Chart.8', 1, END, 0)
    // Directory chain continues at sector 6 (physical 3584)
    const dirBase2 = SECTOR * 7
    writeDir(dirBase2 + 0 * 128, 'WordArt.1', 1, END, 0)
    writeDir(dirBase2 + 1 * 128, 'Data', 2, 7, 512)
    // Equation.1 storage + its EquationText payload stream in sector 8
    writeDir(dirBase2 + 2 * 128, 'Equation.1', 1, END, 0)
    const eqnName = 'Equation.1\x00EquationText'
    writeDir(dirBase2 + 3 * 128, eqnName, 2, 8, 24)

    // WordDocument stream (sectors 2-3)
    const wdBase = SECTOR * 3
    w16(0 + wdBase, 0xA5EC)
    w16(2 + wdBase, 0x0101)
    w16(10 + wdBase, 0)
    w16(32 + wdBase, 0)
    w16(34 + wdBase, 22)
    const text = 'X HYPERLINK "a.com" Click AUTHOR John PAGE 1 TOC \\o "1" Head.....1 INDEX A\t1 REF _R1 \\h 1'
    const hddText = 'First Page Header\r\n'
    const hddLen = hddText.length
    // FibBase fcMin/fcMac: text starts at character 300 (byte 600)
    w32(24 + wdBase, 300)
    w32(28 + wdBase, 300 + text.length)
    w32(36 + 12 + wdBase, text.length) // ccpText
    w32(36 + 20 + wdBase, hddLen) // ccpHdd
    w16(124 + wdBase, 52) // cbRgFcLcb
    // pair 11: fcPlcfHdd/lcbPlcfHdd -> 0Table offset 360 (one title range)
    w32(126 + 11 * 8 + wdBase, 360)
    w32(126 + 11 * 8 + 4 + wdBase, 16)
    // pair 31: fcDop/lcbDop -> 0Table offset 350 (fTitlePage set)
    w32(126 + 31 * 8 + wdBase, 350)
    w32(126 + 31 * 8 + 4 + wdBase, 8)
    // pair 6: fcPlcfSed/lcbPlcfSed -> 0Table offset 160, 16 bytes
    w32(126 + 6 * 8 + wdBase, 160)
    w32(126 + 6 * 8 + 4 + wdBase, 16)
    // pair 16: fcPlcfFldMom/lcbPlcfFldMom -> 0Table offset 32, 112 bytes
    w32(126 + 16 * 8 + wdBase, 32)
    w32(126 + 16 * 8 + 4 + wdBase, 112)
    // pair 12: PlcfBteChpx -> 0Table offset 270 (CHPX with a revision mark)
    w32(126 + 12 * 8 + wdBase, 270)
    w32(126 + 12 * 8 + 4 + wdBase, 39)
    // pair 1: Stshf -> 0Table offset 400 (one 'Strong' character style)
    w32(126 + 1 * 8 + wdBase, 400)
    w32(126 + 1 * 8 + 4 + wdBase, 41)
    // pair 15: SttbfFfn -> 0Table offset 441 (one 'Times New Roman' entry)
    w32(126 + 15 * 8 + wdBase, 441)
    w32(126 + 15 * 8 + 4 + wdBase, 51)
    // pairs 21-23: bookmarks (PlcfBkf/PlcfBkl/SttbfBkmk at 0Table 200/216/232)
    // pair 21 = fcSttbfBkmk, 22 = fcPlcfBkf, 23 = fcPlcfBkl
    w32(126 + 21 * 8 + wdBase, 232)
    w32(126 + 21 * 8 + 4 + wdBase, 26)
    w32(126 + 22 * 8 + wdBase, 200)
    w32(126 + 22 * 8 + 4 + wdBase, 12)
    w32(126 + 23 * 8 + wdBase, 216)
    w32(126 + 23 * 8 + 4 + wdBase, 12)
    // pair 51: SttbfRMark (revision authors) -> 0Table offset 320
    w32(126 + 51 * 8 + wdBase, 320)
    w32(126 + 51 * 8 + 4 + wdBase, 18)
    // pair 33: fcClx/lcbClx -> 0Table offset 0
    const clxSize = 33 // clxt + Pcdt(28) + trailing PCD-B prm byte
    w32(126 + 33 * 8 + wdBase, 0)
    w32(126 + 33 * 8 + 4 + wdBase, clxSize)
    // Text at offset 600 (after the 52-pair rgFcLcb blob ending at 542)
    const textOffset = 600
    for (let i = 0; i < text.length; i++) w16(textOffset + i * 2 + wdBase, text.charCodeAt(i))
    w16(textOffset + text.length * 2 + wdBase, 0x0D)
    // Header story bytes parked in the rgFcLcb blob gap [546, 584)
    // (blob ends at 542, main text starts at 600), referenced by PCD B.
    const hddOffset = 546
    for (let i = 0; i < hddText.length; i++) w16(hddOffset + i * 2 + wdBase, hddText.charCodeAt(i))
    w16(hddOffset + hddText.length * 2 + wdBase, 0x0D)
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
    const eq = art + spSize
    eqMagic.forEach((b, i) => { view[wdBase + eq + i] = b })
    const eqn = '\\alpha'
    for (let i = 0; i < eqn.length; i++) w16(wdBase + eq + 6 + i * 2, eqn.charCodeAt(i))
    w16(wdBase + eq + 6 + eqn.length * 2, 0)
    // Embedded-chart OLE magic at stream offset 920 with >500 non-zero bytes
    // so extractChartsFromWordDocumentStream finds a chart
    const chartMagic = [0xD0, 0xCF, 0x11, 0xE0]
    chartMagic.forEach((b, i) => { view[wdBase + 920 + i] = b })
    for (let i = 0; i < 576; i++) view[wdBase + 924 + i] = 0x42

    // 0Table stream (sector 5 -> physical offset (5+1)*512)
    const tblBase = SECTOR * 6
    // CLX: bare Pcdt with TWO pieces — main text [0,len) at 600 and the
    // header story [len, len+hddLen) parked in the free blob gap at 546.
    // (lcb counts only Pcdt data: 12*n + 4*(n+1); total span 1+lcb = 29,
    // the trailing prm byte lands on tblBase+32 which is cps[0]==0.)
    view[tblBase + 0] = 0x02
    w32(tblBase + 1, 12 * 2 + 4) // PlcPcd byte size: 12n+4 with n=2
    w32(tblBase + 5, 0)
    w32(tblBase + 9, text.length)
    w32(tblBase + 13, text.length + hddLen)
    // PCD A: main text at 600, fChp set, prm chpxIndex 0
    w32(tblBase + 17 + 2, textOffset | 0x80000000)
    w16(tblBase + 17 + 6, 0)
    // PCD B: header story bytes at 546
    w32(tblBase + 25 + 2, 546)
    w16(tblBase + 25 + 6, 0)
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
    // SttbfRMark at 320: one author 'Alice'
    const rmarkBase = tblBase + 320
    w16(rmarkBase + 0, 0xFFFF) // fExtend: unicode
    w16(rmarkBase + 2, 1)      // cbSttb
    w16(rmarkBase + 4, 6)      // cbString incl. terminator
    const alice = 'Alice'
    for (let i = 0; i < alice.length; i++) w16(rmarkBase + 6 + i * 2, alice.charCodeAt(i))
    w16(rmarkBase + 6 + alice.length * 2, 0)
    // SttbfFfn at 441: cFfn=1, one FFN entry 'Times New Roman' (cbFfn=49)
    const ffnBase = tblBase + 441
    w16(ffnBase + 0, 1) // cFfn
    view[ffnBase + 2] = 49 // entry cbFfn
    view[ffnBase + 3] = 0
    view[ffnBase + 4] = 49
    const tname = 'Times New Roman'
    for (let i = 0; i < tname.length; i++) w16(ffnBase + 4 + 18 + i * 2, tname.charCodeAt(i))
    w16(ffnBase + 4 + 18 + tname.length * 2, 0)
    // Data stream (sector 7, physical 4096): a second FDG for
    // extractShapesFromDataStream
    const dataBase = SECTOR * 8
    const dRec = (off: number, recVer: number, recInstance: number, recType: number, recLen: number) => {
      view[dataBase + off] = (recVer << 6) | ((recInstance >> 8) & 0x3F)
      view[dataBase + off + 1] = recInstance & 0xff
      view[dataBase + off + 2] = recType & 0xff
      view[dataBase + off + 3] = (recType >> 8) & 0xff
      w32(dataBase + off + 4, recLen)
    }
    const dSpLen = 72
    const dSpSize = 8 + dSpLen
    const dSpcLen = dSpSize
    const dDgLen = 8 + dSpcLen
    const dFdgLen = 8 + dDgLen
    dRec(0, 3, 0x00C0, 0xF000, dFdgLen)
    dRec(8, 3, 0, 0xF002, dDgLen)
    dRec(16, 3, 0, 0xF003, dSpcLen)
    dRec(24, 3, 0, 0x0004, dSpLen)
    w32(dataBase + 32, 0x50000002) // spid
    w16(dataBase + 36, 0x0001)
    w32(dataBase + 40 + 4, 10); w32(dataBase + 40 + 8, 20)
    w32(dataBase + 40 + 28, 30); w32(dataBase + 40 + 32, 40)
    // PICF envelope at Data offset 128 wrapping a minimal PNG (65 bytes):
    // lcb=133 (68-byte PICF header + image), mm=PNG, xExt/yExt = 2x3 px
    const picf = dataBase + 128
    w32(picf + 0, 68 + 65) // FCPic lcb
    w16(picf + 4, 0x000A)  // mm = PNG
    w16(picf + 6, 2)       // xExt
    w16(picf + 8, 3)       // yExt
    const pngAt = picf + 72 // picf+4+68: start of the wrapped image
    const picPng: number[] = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]
    picPng.push(0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52)
    for (let i = 0; i < 13; i++) picPng.push(0)
    for (let i = 0; i < 4; i++) picPng.push(0)
    picPng.push(0, 0, 0, 8, 0x49, 0x44, 0x41, 0x54)
    for (let i = 0; i < 8; i++) picPng.push(0)
    for (let i = 0; i < 4; i++) picPng.push(0)
    picPng.push(0, 0, 0, 0, 0x49, 0x45, 0x4E, 0x44)
    for (let i = 0; i < 4; i++) picPng.push(0)
    picPng.forEach((b, i) => { view[pngAt + i] = b })
    // PlcfBteChpx at 270: one CHPX run over cp [0, 10] with a revision mark
    const chpxBase = tblBase + 270
    w32(chpxBase + 0, 0)
    w32(chpxBase + 4, 10)
    // grpprl: CFRMark on, then IBST_RMARK (author 0), DTTM_RMARK,
    // sprmCIstd pointing at the 'Strong' character style (istd 0),
    // sprmCRgFtc0 pointing at font index 0 in the SttbfFfn table, and
    // sprmCPicLocation pointing at the PICF envelope in the Data stream.
    w16(chpxBase + 8, 29) // aPcb cb = 29; grpprl (27 bytes) follows at +10
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
    view[chpxBase + 23] = 0x30 // sprmCIstd (0x4A30)
    view[chpxBase + 24] = 0x4A
    w16(chpxBase + 25, 0) // istd 0 = Strong
    view[chpxBase + 27] = 0x4F // sprmCRgFtc0 (0x4A4F)
    view[chpxBase + 28] = 0x4A
    w16(chpxBase + 29, 0) // font index 0 = Times New Roman
    view[chpxBase + 31] = 0x03 // sprmCPicLocation (0x6A03)
    view[chpxBase + 32] = 0x6A
    w32(chpxBase + 33, 128) // PICF envelope at Data offset 128
    // STSH at 400: LPStshi (cbStshi=6) + STSHI(cstd=1, cbSTDBaseInFile=10)
    // + one LPStd: 'Strong' character style with a bold CHPX grpprl
    const stshBase = tblBase + 400
    w16(stshBase + 0, 6)     // cbStshi
    w16(stshBase + 2, 1)     // cstd
    w16(stshBase + 4, 10)    // cbSTDBaseInFile
    w16(stshBase + 6, 0)     // stshiExtraData flags
    w16(stshBase + 8, 31)    // cbStd of the first LPStd
    w16(stshBase + 10, 0)    // sti = 0
    w16(stshBase + 12, 0xFFF2) // stk=2 (character) + istdBase=0x0FFF
    w16(stshBase + 14, 0x0001) // cupx=1 + istdNext=0
    w16(stshBase + 16, 0)    // bchUpe
    w16(stshBase + 18, 0)    // grfstd
    const sname = 'Strong'
    w16(stshBase + 20, sname.length)
    for (let i = 0; i < sname.length; i++) w16(stshBase + 22 + i * 2, sname.charCodeAt(i))
    w16(stshBase + 22 + sname.length * 2, 0)
    // UpxChpx: cbUpx=3 (sprmCBold toggle on) at offset 22+12+2=36
    w16(stshBase + 36, 3)
    view[stshBase + 38] = 0x35 // sprmCBold (0x0835)
    view[stshBase + 39] = 0x08
    view[stshBase + 40] = 0x01 // toggle on
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
    // EquationText stream in sector 8: u32 length prefix + ASCII eqn text
    const eqnStream = SECTOR * 9
    const eqnContent = '\\alpha x+y=z'
    w32(eqnStream + 0, eqnContent.length)
    for (let i = 0; i < eqnContent.length; i++) view[eqnStream + 4 + i] = eqnContent.charCodeAt(i)
    view[eqnStream + 4 + eqnContent.length] = 0
    // DOP at 350: byte0 bit1 set -> fTitlePage
    view[tblBase + 350] = 0x02
    view[tblBase + 351] = 0x00
    // PlcfHdd at 360: one subrange covering the whole header story
    w32(tblBase + 360, 0)
    w32(tblBase + 364, hddLen)
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
    expect(doc.charts[0].type).toBe('msgraph')
    expect(doc.wordArts.length).toBe(1)
    expect(doc.shapes.length).toBe(2) // WordDocument FDG + Data stream FDG
    expect(doc.equations.length).toBe(2) // WordDocument magic + Equation.1 storage
    expect(doc.revisions.length).toBe(1)
    expect(doc.revisions[0].type).toBe('insert')
    expect(doc.revisions[0].timestamp).toBe(0x01020304)
    expect(doc.revisions[0].author).toBe('Alice')
    expect(doc.charts.length).toBe(2) // MSGraph storage + embedded magic
    expect(doc.paragraphs.length).toBeGreaterThan(0)
    // PICF picture from the Data stream, anchored to cp 0 via fcPic
    const pics = doc.pictures as Array<{ format: string; widthPx?: number; heightPx?: number; cp?: number }>
    expect(pics.length).toBe(1)
    expect(pics[0].format).toBe('png')
    expect(pics[0].widthPx).toBe(2)
    expect(pics[0].heightPx).toBe(3)
    expect(pics[0].cp).toBe(0)
    // Header story split via PlcfHdd with the DOP fTitlePage flag, plus the
    // image-annotated variant (the PICF picture is scanned for header parts)
    const stories = doc.stories as any
    expect(stories?.headers).toContain('First Page Header')
    expect(stories?.headerParts?.titleHeader).toBe('First Page Header')
    expect(stories?.headerPartsWithImages?.titleHeader?.text).toBe('First Page Header')
  })
})

describe('libwv fallback mode', () => {
  /** WordDocument with no CLX: lcbClx=0, ccpText>0, text at stream offset 2048. */
  function buildLibwvOle(withTableAndChart = true, customText?: string): ArrayBuffer {
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
    writeDir(dirBase + 2 * 128, '0Table', 2, 7, withTableAndChart ? 512 : 2)
    if (withTableAndChart) writeDir(dirBase + 3 * 128, 'MSGraph.Chart.8', 1, END, 0)
    const wdBase = SECTOR * 3
    w16(0 + wdBase, 0xA5EC)
    w16(2 + wdBase, 0x0101)
    w16(10 + wdBase, 0)
    w16(32 + wdBase, 0)
    w16(34 + wdBase, 22)
    const text = customText ?? 'Hello libwv world\r\nA\u0007B\u0007\u0007C\u0007D\u0007\u0007E\u0007F\r\n'
    w32(36 + 12 + wdBase, text.length) // ccpText
    w16(124 + wdBase, 34) // cbRgFcLcb: all pairs zero (no CLX, no tables)
    // Text at stream offset 2048 (libwv convention), 5-sector WordDocument
    const textStreamOffset = 2048
    for (let i = 0; i < text.length; i++) w16(wdBase + textStreamOffset + i * 2, text.charCodeAt(i))
    w16(wdBase + textStreamOffset + text.length * 2, 0x0D)
    // A tiny JPEG right after the text so extractPictures finds it by
    // scanning the WordDocument stream (libwv embeds images inline).
    const jpeg = wdBase + textStreamOffset + (text.length + 1) * 2
    const jpegBytes: number[] = [0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10]
    for (let i = 0; i < 16; i++) jpegBytes.push(0x11)
    jpegBytes.push(0xFF, 0xD9)
    jpegBytes.forEach((b, i) => { view[jpeg + i] = b })
    // A minimal PNG (signature + IHDR + IDAT + IEND) after the JPEG
    const pngBase = jpeg + jpegBytes.length
    const pngBytes: number[] = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]
    pngBytes.push(0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52)
    for (let i = 0; i < 13; i++) pngBytes.push(0)
    for (let i = 0; i < 4; i++) pngBytes.push(0)
    pngBytes.push(0, 0, 0, 8, 0x49, 0x44, 0x41, 0x54)
    for (let i = 0; i < 8; i++) pngBytes.push(0)
    for (let i = 0; i < 4; i++) pngBytes.push(0)
    pngBytes.push(0, 0, 0, 0, 0x49, 0x45, 0x4E, 0x44)
    for (let i = 0; i < 4; i++) pngBytes.push(0)
    pngBytes.forEach((b, i) => { view[pngBase + i] = b })
    // A minimal GIF (header + logical screen descriptor + trailer) after the PNG
    const gifBase = pngBase + pngBytes.length
    const gifBytes: number[] = [0x47, 0x49, 0x46, 0x38, 0x39, 0x61] // GIF89a
    gifBytes.push(1, 0, 1, 0) // width=1, height=1
    gifBytes.push(0x00, 0x00, 0x00) // packed (no GCT), bgcolor, aspect
    gifBytes.push(0x3B) // trailer
    gifBytes.forEach((b, i) => { view[gifBase + i] = b })
    // A minimal BMP (54-byte file header + DIB header) after the GIF
    const bmpBase = gifBase + gifBytes.length
    const bmpBytes: number[] = [0x42, 0x4D] // 'BM'
    const bmpSize = 54
    bmpBytes.push(bmpSize & 0xff, 0, 0, 0) // file size LE32
    while (bmpBytes.length < bmpSize) bmpBytes.push(0)
    bmpBytes.forEach((b, i) => { view[bmpBase + i] = b })
    // 0Table (sector 7): STTB Ffn header + one 'Times New Roman' FFN entry
    // (cttb=1, cbFfn=49) so tryParseFormatsFromTableStream finds a font table
    const tblBase = SECTOR * 8
    w16(tblBase + 0, 1) // cttb
    view[tblBase + 2] = 49 // FFN cbFfn
    view[tblBase + 3] = 0
    view[tblBase + 4] = 49 // entry[0] = cbFfn
    const fname = 'Times New Roman'
    for (let i = 0; i < fname.length; i++) w16(tblBase + 4 + 18 + i * 2, fname.charCodeAt(i))
    w16(tblBase + 4 + 18 + fname.length * 2, 0)
    return buf
  }

  it('parses a libwv-style document through the no-CLX fallback', () => {
    const parser = new DocParser(buildLibwvOle())
    const result = parser.parseWithFormat()
    expect(result.success).toBe(true)
    const texts = (result.document.paragraphs as Array<{ text: string }>).map(p => p.text).join(' ')
    expect(texts).toContain('Hello libwv world')
    const pics = result.document.pictures as Array<{ format: string }>
    expect(pics.some(p => p.format === 'jpeg')).toBe(true)
    expect(pics.some(p => p.format === 'png')).toBe(true)
    expect(pics.some(p => p.format === 'gif')).toBe(true)
    expect(pics.some(p => p.format === 'bmp')).toBe(true)
    expect(result.document.charts.length).toBe(1)
    expect(texts).toContain('A\u0007B')
    expect(texts).toContain('E\u0007F')
    // Default font from the parsed font table applied to paragraphs
    const para0 = (result.document.paragraphs as Array<{ charFormat?: { fontName?: string } }>)[0]
    expect(para0.charFormat?.fontName).toBe('Times New Roman')
  })

  it('returns structural paragraphs when the libwv table stream is empty', () => {
    // No 0Table content and no MSGraph storage: tryParseFormatsFromTableStream
    // yields nothing, so the fallback returns fixed paragraphs only.
    const parser = new DocParser(buildLibwvOle(false))
    const result = parser.parseWithFormat()
    expect(result.success).toBe(true)
    const texts = (result.document.paragraphs as Array<{ text: string }>).map(p => p.text).join(' ')
    expect(texts).toContain('Hello libwv world')
    expect(result.document.charts?.length ?? 0).toBe(0)
  })

  it('keeps a single table row as one paragraph and strips trailing cell marks', () => {
    // 'RowEnd\u0007\u0007' has a single row (the cell-mark run is only
    // trailing), so splitMultiRowTables falls back to keeping the paragraph
    // with trailing \u0007 removed.
    const parser = new DocParser(buildLibwvOle(true, 'RowEnd\u0007\u0007'))
    const result = parser.parseWithFormat()
    expect(result.success).toBe(true)
    const texts = (result.document.paragraphs as Array<{ text: string }>).map(p => p.text)
    expect(texts.some(t => t.includes('Row') && t.includes('End'))).toBe(true)
    expect(texts.some(t => t.includes('\u0007'))).toBe(false)
  })
})

describe('CLX-unreachable fallback paths', () => {
  /** WordDocument with an out-of-range CLX pointer and text at offset 2048. */
  function buildNoClxOle(fcMinBase: number, fcMacBase: number, utf16Text = false, customText?: string, withCcpText = true): ArrayBuffer {
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
    const text = customText ?? 'Hello libwv world\r\nHello libwv world\r\nhello abcdefghijklhello abcdefghijkl\r\ntest abcdeabcdeabcde end\r\nA\u0007B\u0007\u0007C\u0007D\u0007\u0007E\u0007F\r\n'
    w32(24 + wdBase, fcMinBase)
    w32(28 + wdBase, fcMacBase)
    if (withCcpText) w32(36 + 12 + wdBase, text.length) // ccpText
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
    // span == ccpText (8-bit): fcMinBase=2048, text is 118 chars
    const parser = new DocParser(buildNoClxOle(2048, 2048 + 117))

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

  it('falls back with no text-end limit when ccpText is absent', () => {
    // withCcpText=false leaves FibRgLw ccpText at 0, so the auto-detect
    // branch scans to the end of the stream (textEnd stays undefined).
    const parser = new DocParser(buildNoClxOle(0, 0, true, undefined, false))
    const result = parser.parseWithFormat()
    expect(result.success).toBe(true)
    const texts = (result.document.paragraphs as Array<{ text: string }>).map(p => p.text).join(' ')
    expect(texts).toContain('Hello libwv world')
  })

  /** WordDocument stream (8192 bytes) whose scan region holds 8-bit filler
   *  with ~6.5% NUL bytes and NO paragraph marks, so both heuristics in
   *  detectEncodingFromBinary are inconclusive and the scoring fallback
   *  decides the encoding. lcbClx points at a zeroed Pcdt (no pieces) while
   *  ccpText stays >0 to skip the libwv gate. */
  function buildScoringNullOle(opts: { ccpText?: number; complex?: boolean; withChart?: boolean; utf16Text?: boolean } = {}): ArrayBuffer {
    const SECTOR = 512
    // Layout: sector 0=FAT, 1=directory, 2..17 = WordDocument (8192 bytes)
    const buf = new ArrayBuffer(SECTOR * 20)
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
    w32(fatBase + 0 * 4, END)
    for (let s = 2; s < 17; s++) w32(fatBase + s * 4, s + 1)
    w32(fatBase + 17 * 4, END)
    w32(fatBase + 1 * 4, END)
    for (let i = 18; i < 128; i++) w32(fatBase + i * 4, FREE)
    // Sector 18: minimal (zeroed) 0Table so readClxData/tryParseFormats find it
    w32(fatBase + 18 * 4, END)
    const bufViewLimit = SECTOR * 20
    void bufViewLimit
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
    writeDir(dirBase + 1 * 128, 'WordDocument', 2, 2, 8192)
    writeDir(dirBase + 2 * 128, '0Table', 2, 18, 16)
    if (opts.withChart !== false) writeDir(dirBase + 3 * 128, 'MSGraph.Chart.8', 1, END, 0)
    // FIB at stream offset 0
    const wdBase = SECTOR * 3
    w16(0 + wdBase, 0xA5EC)
    w16(2 + wdBase, 0x0101)
    w16(10 + wdBase, 0)
    w16(32 + wdBase, 0)
    w16(34 + wdBase, 22)
    const ccpText = opts.ccpText ?? 300
    w32(36 + 12 + wdBase, ccpText) // >0 keeps scoring's textEnd bound active
    w16(124 + wdBase, 34)
    // CLX pair pointing at 'A' filler inside WordDocument ([500,510)):
    // clxt != 2 -> no pieces, while lcbClx > 0 skips the libwv gate.
    w32(126 + 33 * 8 + wdBase, 500)
    w32(126 + 33 * 8 + 4 + wdBase, 10)
    // Scan region [2048, 8192): 'A' filler with every 15th byte NUL (~6.7%),
    // strictly no 0x0D so both encoding heuristics stay inconclusive.
    // The first 600 bytes also get periodic spaces so the 8-bit decode wins
    // the scoring step with multiple dictionary-ish words.
    view[wdBase + 10] = opts.complex === false ? 0x00 : 0x04 // fComplex -> suggestedComplex
    if (opts.utf16Text) {
      // Real ASCII prose stored as UTF-16LE in the ccpText-bounded region
      // [2048, 2648): the 16-bit decode yields dictionary words and scores
      // high, while the 8-bit decode breaks every word with NUL bytes and
      // scores low — so the flipped suggestedComplex=false comparison arm
      // selects raw16. Still no 0x0D anywhere, keeping both heuristics
      // in detectEncodingFromBinary inconclusive.
      const sentence = 'The quick brown fox jumps over the lazy dog. '
      for (let i = 0; i < 600; i += 2) {
        view[wdBase + 2048 + i] = sentence.charCodeAt((i / 2) % sentence.length)
      }
    } else {
      for (let i = 2048; i < 8192; i++) {
        const rel = i - 2048
        if (rel % 15 === 14) view[wdBase + i] = 0x00
        else if (rel < 600 && rel % 8 === 7) view[wdBase + i] = 0x20
        else view[wdBase + i] = 0x41
      }
    }
    return buf
  }

  it('resolves encoding via the scoring fallback when detection is null', () => {
    const parser = new DocParser(buildScoringNullOle())
    const result = parser.parseWithFormat()
    expect(result.success).toBe(true)
    const paras = result.document.paragraphs as Array<{ text: string }>
    expect(paras.length).toBeGreaterThan(0)
    // MSGraph storage keeps tryParseFormatsFromTableStream non-null, so the
    // scored paragraphs flow through applyParsedStylesToParagraphs.
    expect(result.document.charts.length).toBe(1)
  })

  it('scoring fallback scans unbounded when ccpText is absent', () => {
    // ccpText=0 leaves textEnd undefined; extraction runs to the stream end.
    const parser = new DocParser(buildScoringNullOle({ ccpText: 0 }))
    const result = parser.parseWithFormat()
    expect(result.success).toBe(true)
    expect((result.document.paragraphs as Array<{ text: string }>).length).toBeGreaterThan(0)
  })

  it('scoring fallback can pick UTF-16 and return without format data', () => {
    // fComplex=false flips the useComplex comparison arm; the utf16Text
    // fixture makes the 16-bit decode outscore the NUL-broken 8-bit decode
    // so raw16 wins. Dropping the MSGraph storage leaves no charts so the
    // plain paragraph-only result is returned.
    const parser = new DocParser(buildScoringNullOle({ complex: false, withChart: false, utf16Text: true }))
    const result = parser.parseWithFormat()
    expect(result.success).toBe(true)
    const paras = result.document.paragraphs as Array<{ text: string }>
    expect(paras.length).toBeGreaterThan(0)
    // The sentence text proves raw16 (not the NUL-broken raw8) was selected.
    expect(paras.map(p => p.text).join('')).toContain('quick brown fox')
    expect(result.document.charts?.length ?? 0).toBe(0)
  })

})

describe('form feed page breaks', () => {
  // Builds a minimal 5-sector OLE with a single UTF-16 paragraph whose text
  // may contain \f form feeds, plus one CHPX run and one PAPX run so the
  // real-formats path (createParagraphsWithRealFormats) parses it.
  const buildFormFeedOle = (text: string) => {
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
    w32(36 + 12 + wdBase, text.length) // ccpText
    w16(124 + wdBase, 34)
    // pair 12: PlcfBteChpx with one empty-CHPX run covering the text
    w32(126 + 12 * 8 + wdBase, 120)
    w32(126 + 12 * 8 + 4 + wdBase, 12)
    // pair 13: PlcfBtePapx with one PAPX run over cp [0, 3]
    w32(126 + 13 * 8 + wdBase, 140)
    w32(126 + 13 * 8 + 4 + wdBase, 14)
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
    // PlcfBteChpx at 120: aCP [0, n], aPcb [2], CHPX cb=2 (empty grpprl)
    w32(tblBase + 120, 0)
    w32(tblBase + 124, Math.min(text.length, 8))
    w16(tblBase + 128, 2)
    // PlcfBtePapx at 140: aCP [0,3], aPcb [4], PAPX cb=4 (istd=0, no grpprl)
    w32(tblBase + 140, 0)
    w32(tblBase + 144, 3)
    w16(tblBase + 148, 4)
    w16(tblBase + 150, 0) // istd = 0
    return buf
  }

  const parseFormFeed = (text: string) => {
    const parser = new DocParser(buildFormFeedOle(text))
    const result = parser.parseWithFormat()
    expect(result.success).toBe(true)
    return result.document.paragraphs as Array<{ text: string; paraFormat?: { pageBreakBefore?: boolean } }>
  }

  it('splits paragraphs on embedded form feeds with real CHPX runs', () => {
    const paras = parseFormFeed('\f\fWorld')
    const texts = paras.map(p => p.text)
    expect(texts.join(' ')).toContain('World')
    expect(paras[0].paraFormat?.pageBreakBefore).toBe(true)
  })

  it('keeps the leading segment when a form feed follows real text', () => {
    // \f in the middle of a paragraph: the non-empty leading segment is kept
    // as-is (no page break), the trailing segment is dropped.
    const paras = parseFormFeed('Hello\fWorld')
    const texts = paras.map(p => p.text)
    expect(texts).toContain('Hello')
    expect(texts.join(' ')).not.toContain('World')
    expect(paras[0].paraFormat?.pageBreakBefore).not.toBe(true)
  })
})

describe('dop and paragraph-scan guards', () => {
  const parser = new DocParser(new ArrayBuffer(512))

  it('extractDop returns null when no table stream exists', () => {
    // lcbDop/fcDop are set but the directory carries no 0Table/1Table entry.
    const fib = { lcbDop: 100, fcDop: 50, fWhichTblStm: false }
    expect((parser as any).extractDop(fib, [])).toBeNull()
  })

  it('extractDop returns null when the DOP range exceeds the table stream', () => {
    // Minimal 4-sector OLE with a real 512-byte 0Table so readStream can
    // resolve it; fcDop+lcbDop then points past the stream end.
    const SECTOR = 512
    const buf = new ArrayBuffer(SECTOR * 4)
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
    for (let i = 0; i < 3; i++) w32(fatBase + i * 4, END)
    for (let i = 3; i < 128; i++) w32(fatBase + i * 4, FREE)
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
    writeDir(dirBase + 1 * 128, 'WordDocument', 2, END, 0)
    writeDir(dirBase + 2 * 128, '0Table', 2, 2, 512)
    const docParser = new DocParser(buf)
    const ole = (docParser as any).ole
    const header = ole.parseHeader()
    const fat = ole.getFatSectors(header)
    const directory = ole.getDirectorySectors(header, fat)
    const fib = { lcbDop: 200, fcDop: 400, fWhichTblStm: false }
    expect((docParser as any).extractDop(fib, directory)).toBeNull()
  })

  it('extractParagraphsWithFormat applies the 2048 floor when fcMin is absent', () => {
    // No options: startOffset defaults to 0 and is floored to 2048 before
    // scanning; UTF-16 text placed past the floor is still extracted.
    const prefix = new Uint8Array(2048)
    const text = 'Floor test body text'
    const data = new Uint8Array(2048 + text.length * 2 + 2)
    data.set(prefix)
    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i)
      data[2048 + i * 2] = code & 0xff
      data[2048 + i * 2 + 1] = (code >> 8) & 0xff
    }
    data[2048 + text.length * 2] = 0x0d
    const paras = (parser as any).extractParagraphsWithFormat(data)
    expect(paras.some((p: any) => p.text.includes('Floor test body text'))).toBe(true)
  })
})

describe('readClxData WordDocument fallback', () => {
  it('falls back to the WordDocument stream when the table stream is too small', () => {
    const SECTOR = 512
    const buf = new ArrayBuffer(SECTOR * 4)
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
    w32(fatBase + 2 * 4, END)
    for (let i = 3; i < 128; i++) w32(fatBase + i * 4, FREE)
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
    writeDir(dirBase + 2 * 128, '0Table', 2, 3, 16)
    // WordDocument stream: marker bytes so the subarray is distinguishable
    for (let i = 0; i < 32; i++) view[SECTOR * 3 + i] = 0xAB
    const parser = new DocParser(buf) as any
    const header = parser.ole.parseHeader()
    const fat = parser.ole.getFatSectors(header)
    const dir = parser.ole.getDirectorySectors(header, fat)
    const ws = parser.ole.findWordDocumentStream(dir)
    const clx = parser.readClxData({ lcbClx: 32, fcClx: 0, fWhichTblStm: 0 }, ws.data, dir)
    expect(clx).not.toBeNull()
    expect(clx!.length).toBe(32)
    expect(clx![0]).toBe(0xAB)
  })
})

describe('real list format from LFO', () => {
  it('applies list format via PAPX ilfo, LST and LFO tables', () => {
    const SECTOR = 512
    const buf = new ArrayBuffer(SECTOR * 8)
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
    for (let i = 0; i < 5; i++) w32(fatBase + i * 4, i < 4 ? (i === 2 ? 3 : i === 3 ? 4 : i === 4 ? 5 : END) : END)
    w32(fatBase + 2 * 4, 3); w32(fatBase + 3 * 4, 4); w32(fatBase + 4 * 4, 5); w32(fatBase + 5 * 4, END); w32(fatBase + 6 * 4, END)
    for (let i = 7; i < 128; i++) w32(fatBase + i * 4, FREE)
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
    writeDir(dirBase + 1 * 128, 'WordDocument', 2, 2, 2048)
    writeDir(dirBase + 2 * 128, '0Table', 2, 6, 512)
    const wdBase = SECTOR * 3
    w16(0 + wdBase, 0xA5EC)
    w16(2 + wdBase, 0x0101)
    w16(10 + wdBase, 0)
    w16(32 + wdBase, 0)
    w16(34 + wdBase, 22)
    const text = 'List item'
    w32(36 + 12 + wdBase, text.length) // ccpText
    w16(124 + wdBase, 75) // cbRgFcLcb: 75 pairs covers fcLst(73)/fcPlcfLfo(74)
    // pair 13: PlcfBtePapx -> 0Table 140, lcb 18
    w32(126 + 13 * 8 + wdBase, 140)
    w32(126 + 13 * 8 + 4 + wdBase, 21)
    // pair 73: fcLst -> 0Table 200, lcb 70
    w32(126 + 73 * 8 + wdBase, 200)
    w32(126 + 73 * 8 + 4 + wdBase, 70)
    // pair 74: fcPlcfLfo -> 0Table 280, lcb 16
    w32(126 + 74 * 8 + wdBase, 280)
    w32(126 + 74 * 8 + 4 + wdBase, 16)
    const clxSize = 1 + 4 + 4 * 2 + 8
    w32(126 + 33 * 8 + wdBase, 0)
    w32(126 + 33 * 8 + 4 + wdBase, clxSize)
    const textOffset = 900
    for (let i = 0; i < text.length; i++) w16(textOffset + i * 2 + wdBase, text.charCodeAt(i))
    w16(textOffset + text.length * 2 + wdBase, 0x0D)
    const tblBase = SECTOR * 7
    view[tblBase + 0] = 0x02
    w32(tblBase + 1, 16)
    w32(tblBase + 5, 0)
    w32(tblBase + 9, text.length)
    w32(tblBase + 13 + 2, textOffset)
    // PlcfBtePapx at 140: aCP [0,3], aPcb [8], PAPX istd=1 + grpprl ilst=0
    w32(tblBase + 140, 0)
    w32(tblBase + 144, 3)
    w16(tblBase + 148, 11)
    w16(tblBase + 150, 1) // istd
    view[tblBase + 152] = 0x0E // sprmPIlstLegacy (0x460E)
    view[tblBase + 153] = 0x46
    w16(tblBase + 154, 0) // ilst = 0
    view[tblBase + 156] = 0x16 // sprmPFInTable (0x2416)
    view[tblBase + 157] = 0x24
    view[tblBase + 158] = 0x01 // in table
    // LST at 200: lsid=0x12345678, fSimpleList=1, one LVLF (decimal)
    w32(tblBase + 200, 0x12345678) // lsid
    w32(tblBase + 204, 0)          // tplc
    view[tblBase + 226] = 1        // fSimpleList
    const lvlf = tblBase + 228
    w16(lvlf + 0, 1)   // iStartAt
    view[lvlf + 2] = 0 // nfc = decimal
    w16(lvlf + 40, 0)  // number text length
    // PlcfLfo at 280: 1 LFO with matching lsid
    w32(tblBase + 280, 0)
    w32(tblBase + 284, 1)
    w32(tblBase + 288, 0x12345678) // lsid
    view[tblBase + 292] = 1        // clfoLvl
    const parser = new DocParser(buf)
    const result = parser.parseWithFormat()
    expect(result.success).toBe(true)
    const para = (result.document.paragraphs as Array<{ text: string; paraFormat?: { listType?: string; listStyle?: string; listId?: number } }>)[0]
    expect(para.paraFormat?.listType).toBe('ordered')
    expect(para.paraFormat?.listStyle).toBe('decimal')
    expect(para.paraFormat?.listId).toBe(0)
    expect((para.paraFormat as any)?.table?.inTable).toBe(true)
  })
})

describe('real list format via ilfo', () => {
  it('applies list format through the LFO override path', () => {
    const SECTOR = 512
    const buf = new ArrayBuffer(SECTOR * 8)
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
    w32(fatBase + 2 * 4, 3); w32(fatBase + 3 * 4, 4); w32(fatBase + 4 * 4, 5); w32(fatBase + 5 * 4, END); w32(fatBase + 6 * 4, END)
    for (let i = 7; i < 128; i++) w32(fatBase + i * 4, FREE)
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
    writeDir(dirBase + 1 * 128, 'WordDocument', 2, 2, 2048)
    writeDir(dirBase + 2 * 128, '0Table', 2, 6, 512)
    const wdBase = SECTOR * 3
    w16(0 + wdBase, 0xA5EC)
    w16(2 + wdBase, 0x0101)
    w16(10 + wdBase, 0)
    w16(32 + wdBase, 0)
    w16(34 + wdBase, 22)
    const text = 'List item'
    w32(36 + 12 + wdBase, text.length)
    w16(124 + wdBase, 75)
    w32(126 + 13 * 8 + wdBase, 140)
    w32(126 + 13 * 8 + 4 + wdBase, 18)
    w32(126 + 73 * 8 + wdBase, 200)
    w32(126 + 73 * 8 + 4 + wdBase, 70)
    w32(126 + 74 * 8 + wdBase, 280)
    w32(126 + 74 * 8 + 4 + wdBase, 16)
    const clxSize = 1 + 4 + 4 * 2 + 8
    w32(126 + 33 * 8 + wdBase, 0)
    w32(126 + 33 * 8 + 4 + wdBase, clxSize)
    const textOffset = 900
    for (let i = 0; i < text.length; i++) w16(textOffset + i * 2 + wdBase, text.charCodeAt(i))
    w16(textOffset + text.length * 2 + wdBase, 0x0D)
    const tblBase = SECTOR * 7
    view[tblBase + 0] = 0x02
    w32(tblBase + 1, 16)
    w32(tblBase + 5, 0)
    w32(tblBase + 9, text.length)
    w32(tblBase + 13 + 2, textOffset)
    // PAPX grpprl: ilfo = 1
    w32(tblBase + 140, 0)
    w32(tblBase + 144, 3)
    w16(tblBase + 148, 8)
    w16(tblBase + 150, 1)
    view[tblBase + 152] = 0x0B
    view[tblBase + 153] = 0x46
    w16(tblBase + 154, 1)
    // LST + LFO (same as the ilst fixture)
    w32(tblBase + 200, 0x12345678)
    w32(tblBase + 204, 0)
    view[tblBase + 226] = 1
    const lvlf = tblBase + 228
    w16(lvlf + 0, 1)
    view[lvlf + 2] = 0
    w16(lvlf + 40, 0)
    w32(tblBase + 280, 0)
    w32(tblBase + 284, 1)
    w32(tblBase + 288, 0x12345678)
    view[tblBase + 292] = 1
    const parser = new DocParser(buf)
    const result = parser.parseWithFormat()
    expect(result.success).toBe(true)
    const para = (result.document.paragraphs as Array<{ text: string; paraFormat?: { listType?: string; listId?: number } }>)[0]
    expect(para.paraFormat?.listType).toBe('ordered')
    expect(para.paraFormat?.listId).toBe(1)
  })
})

describe('Round126 real character format merge guards', () => {
  function expectLegacyMerge(base: Record<PropertyKey, unknown>, merged: Record<PropertyKey, unknown>) {
    const text = 'Valid paragraph text here'
    const parser = new DocParser(new ArrayBuffer(512))
    const baseBefore = Object.getOwnPropertyDescriptors(base)
    const mergedBefore = Object.getOwnPropertyDescriptors(merged)
    const baseKeysBefore = Reflect.ownKeys(base)
    const mergedKeysBefore = Reflect.ownKeys(merged)
    const { styles: _styles, ...expected } = { ...base, ...merged }
    const guessCharFormat = vi.spyOn(parser as any, 'guessCharFormat').mockReturnValue(base)

    try {
      const paragraphs = (parser as any).createParagraphsWithRealFormats(
        text,
        [{ cpStart: 0, cpEnd: text.length, format: merged }],
        [],
        [],
        [],
        [{ start: 0, end: text.length, chpxIndex: 0 }],
        [],
        [],
      )

      expect(paragraphs).toHaveLength(1)
      expect(paragraphs[0].text).toBe(text)
      expect(paragraphs[0].charFormatFromReal).toBe(true)
      expect(guessCharFormat).toHaveBeenCalledWith(text, 0)
      const actual = paragraphs[0].charFormat
      expect(JSON.stringify(actual)).toBe(JSON.stringify(expected))
      expect(actual).toEqual(expected)
      expect(Reflect.ownKeys(actual)).toEqual(Reflect.ownKeys(expected))
      expect(Object.prototype.hasOwnProperty.call(actual, 'styles')).toBe(false)
      expect(actual).not.toBe(base)
      expect(actual).not.toBe(merged)
      expect(Object.getOwnPropertyDescriptors(base)).toEqual(baseBefore)
      expect(Object.getOwnPropertyDescriptors(merged)).toEqual(mergedBefore)
      expect(Reflect.ownKeys(base)).toEqual(baseKeysBefore)
      expect(Reflect.ownKeys(merged)).toEqual(mergedKeysBefore)
      return actual
    } finally {
      guessCharFormat.mockRestore()
    }
  }

  it('Round133 preserves a symbol named styles and an own __proto__ data key', () => {
    const symbolStyles = Symbol('styles')
    const base: Record<PropertyKey, unknown> = { styles: ['bold'], fontName: 'Base', [symbolStyles]: 'base' }
    const merged: Record<PropertyKey, unknown> = { bold: false, [symbolStyles]: 'real' }
    Object.defineProperty(merged, '__proto__', { value: { marker: 'data' }, enumerable: true })
    const actual = expectLegacyMerge(base, merged)
    expect(actual[symbolStyles]).toBe('real')
    expect(Object.getPrototypeOf(actual)).toBe(Object.prototype)
    expect(Object.hasOwn(actual, '__proto__')).toBe(true)
    expect(actual.__proto__).toEqual({ marker: 'data' })
  })

  it('Round133 excludes inherited and nonenumerable styles without mutating descriptors', () => {
    const base = Object.create({ styles: ['inherited'], italic: true })
    Object.defineProperty(base, 'styles', { value: ['hidden'], enumerable: false, configurable: false })
    base.fontName = 'Base'
    const merged = Object.create({ color: '#ffffff' })
    merged.bold = false
    Object.defineProperty(merged, 'styles', { value: ['hidden-real'], enumerable: false, configurable: false })
    const actual = expectLegacyMerge(base, merged)
    expect(Reflect.ownKeys(actual)).toEqual(['fontName', 'bold'])
  })

  it('removes heuristic styles without real styles at every base insertion position', () => {
    const bases = [
      { styles: ['bold'], fontName: 'Base', bold: true, fontSize: 12 },
      { fontName: 'Base', styles: ['bold'], bold: true, fontSize: 12 },
      { fontName: 'Base', bold: true, fontSize: 12, styles: ['bold'] },
    ]
    for (const base of bases) {
      expectLegacyMerge(base, { fontSize: 20, italic: true })
      expectLegacyMerge(base, { italic: true, fontSize: 20 })
    }
  })

  it('strips real styles arrays and explicit undefined at every insertion position', () => {
    for (const styles of [['italic'], undefined]) {
      const realFormats = [
        { styles, fontSize: 0, bold: false },
        { fontSize: 0, styles, bold: false },
        { fontSize: 0, bold: false, styles },
      ]
      const bases = [
        { styles: ['bold'], fontName: 'Base', bold: true },
        { fontName: 'Base', styles: ['bold'], bold: true },
        { fontName: 'Base', bold: true, styles: ['bold'] },
        { fontName: 'Base', bold: true },
      ]
      for (const base of bases) {
        for (const merged of realFormats) expectLegacyMerge(base, merged)
      }
    }
  })

  it('keeps false zero and own undefined overrides instead of heuristic values', () => {
    const actual = expectLegacyMerge(
      { styles: ['bold', 'italic'], bold: true, italic: true, fontSize: 12, fontName: 'Base' },
      { bold: false, italic: undefined, fontSize: 0, fontName: undefined },
    )
    expect(actual.bold).toBe(false)
    expect(actual.fontSize).toBe(0)
    expect(Object.prototype.hasOwnProperty.call(actual, 'italic')).toBe(true)
    expect(Object.prototype.hasOwnProperty.call(actual, 'fontName')).toBe(true)
    expect(actual.italic).toBeUndefined()
    expect(actual.fontName).toBeUndefined()
  })

  it('preserves base key positions and appends new real keys in insertion order', () => {
    const actual = expectLegacyMerge(
      { fontName: 'Base', styles: ['bold'], bold: true, fontSize: 12 },
      { color: '#123456', fontSize: 18, italic: true, bold: false, underline: 'single' },
    )
    expect(JSON.stringify(actual)).toBe(
      '{"fontName":"Base","bold":false,"fontSize":18,"color":"#123456","italic":true,"underline":"single"}',
    )
    expectLegacyMerge(
      { fontSize: 12, bold: true, styles: ['bold'], fontName: 'Base' },
      { underline: 'single', bold: false, italic: true, fontSize: 18, color: '#123456' },
    )
  })

  it('preserves unknown enumerable string numeric and symbol keys', () => {
    const extension = Symbol('extension')
    const base = { styles: ['bold'], extraBase: 'base', 10: 'ten', [extension]: 'base-symbol' }
    const merged = {
      extraReal: 'real',
      2: 'two',
      extraBase: undefined,
      [extension]: 'real-symbol',
    }
    Object.defineProperty(merged, 'enumerableExtension', { value: 0, enumerable: true })
    Object.defineProperty(merged, 'hiddenExtension', { value: 'hidden', enumerable: false })
    const actual = expectLegacyMerge(base, merged)
    expect(actual[extension]).toBe('real-symbol')
    expect(actual.enumerableExtension).toBe(0)
    expect(Object.prototype.hasOwnProperty.call(actual, 'extraBase')).toBe(true)
    expect(Object.prototype.hasOwnProperty.call(actual, 'hiddenExtension')).toBe(false)
  })

  it('does not mutate frozen base real formats or their styles arrays', () => {
    const baseStyles = Object.freeze(['bold'])
    const realStyles = Object.freeze(['italic'])
    const base = Object.freeze({ fontName: 'Base', styles: baseStyles, bold: true })
    const withoutStyles = Object.freeze({ fontSize: 0, bold: false })
    const withStyles = Object.freeze({ fontSize: 0, styles: realStyles, bold: false })
    expectLegacyMerge(base, withoutStyles)
    expectLegacyMerge(base, withStyles)
    expect(base.styles).toBe(baseStyles)
    expect(withStyles.styles).toBe(realStyles)
    expect(baseStyles).toEqual(['bold'])
    expect(realStyles).toEqual(['italic'])
  })

  it('matches the legacy oracle for all 256 pairs of common four-field subsets', () => {
    const fields = ['bold', 'italic', 'fontSize', 'fontName']
    const baseValues = [true, true, 12, 'Base']
    const realValues = [false, undefined, 0, undefined]
    let combinations = 0
    for (let baseMask = 0; baseMask < 16; baseMask++) {
      for (let realMask = 0; realMask < 16; realMask++) {
        const base: Record<string, unknown> = { styles: ['bold'] }
        const merged: Record<string, unknown> = { color: '#123456' }
        for (let index = 0; index < fields.length; index++) {
          if (baseMask & (1 << index)) base[fields[index]] = baseValues[index]
        }
        for (let index = fields.length - 1; index >= 0; index--) {
          if (realMask & (1 << index)) merged[fields[index]] = realValues[index]
        }
        expectLegacyMerge(base, merged)
        combinations++
      }
    }
    expect(combinations).toBe(256)
  })
})

describe('Round127 重复 trim 清洗差分护栏', () => {
  // 逐句转写 HEAD d541539；常量也固定在测试内，避免与待测清洗/切分共用实现。
  const legacyJunkChars = '伀倀藠俹醫蠀耀頀琀餀栀儀騀甀攀爀愀氀攀漀漀渀'
  const legacyExtraJunkChars = '伇倈俼俿儀儜厬唀唕嘀噀圀堀嬀崀崜帀幀弰彀戀戀'
  const legacyJunkPrefix = new RegExp(`^[${legacyJunkChars}]+`)
  const legacyJunkAny = new RegExp(`[${legacyJunkChars}${legacyExtraJunkChars}]`, 'g')
  const jsWhitespace = [
    '\u0009', '\u000a', '\u000b', '\u000c', '\u000d', '\u0020', '\u00a0', '\u1680',
    '\u2000', '\u2001', '\u2002', '\u2003', '\u2004', '\u2005', '\u2006', '\u2007',
    '\u2008', '\u2009', '\u200a', '\u2028', '\u2029', '\u202f', '\u205f', '\u3000', '\ufeff',
  ]
  type LegacyParagraph = { text: string; _cpStart: number; pageBreakBefore: boolean }

  function legacyCleanParagraph(p: string): string {
    const t = p.trim()
    const stripped = t.replace(legacyJunkPrefix, '')
    return stripped === t ? t : stripped.trim()
  }

  function legacySkipParagraph(text: string): boolean {
    const junkCount = (text.match(legacyJunkAny) || []).length
    if (junkCount > 0) {
      const totalLength = text.trim().length
      if (junkCount > 2 || (totalLength > 0 && junkCount / totalLength > 0.2)) return true
    }
    return false
  }

  function legacyParagraphs(input: string): LegacyParagraph[] {
    const result: LegacyParagraph[] = []
    let cp = 0
    // 用 split 独立计算 CP，不调用待测 splitTextByParagraphMark。
    for (const paragraph of input.split('\n')) {
      const subParts = paragraph.includes('\u0007\u0007')
        ? paragraph.split(/(?<=\u0007\u0007)/)
        : [paragraph]
      let subOffset = 0
      for (const rawText of subParts) {
        let pageBreakBefore = false
        let textToClean = rawText
        if (rawText.startsWith('\f')) {
          pageBreakBefore = true
          textToClean = rawText.slice(1)
        }
        if (textToClean.includes('\f')) {
          const firstPart = textToClean.split('\f')[0]
          const remaining = textToClean.slice(firstPart.length + 1)
          if (firstPart.trim().length > 0) {
            textToClean = firstPart
          } else {
            pageBreakBefore = true
            textToClean = remaining
          }
        }
        const cleaned = legacyCleanParagraph(textToClean.trim())
        if (!legacySkipParagraph(cleaned) && cleaned.length > 0) {
          result.push({ text: cleaned, _cpStart: cp + subOffset, pageBreakBefore })
        }
        subOffset += rawText.length
      }
      cp += paragraph.length + 1
    }
    return result
  }

  function expectLegacyParagraphs(input: string, expected: LegacyParagraph[]): void {
    const parser = new DocParser(new ArrayBuffer(512))
    const paragraphs = (parser as any).createParagraphsWithRealFormats(input, [], [], [], [])
    const actual = paragraphs.map((paragraph: {
      text: string; _cpStart: number; paraFormat: { pageBreakBefore?: boolean }
    }) => ({
      text: paragraph.text,
      _cpStart: paragraph._cpStart,
      pageBreakBefore: paragraph.paraFormat.pageBreakBefore === true,
    }))
    expect(paragraphs).toHaveLength(expected.length)
    expect(actual).toEqual(expected)
    expect(actual).toEqual(legacyParagraphs(input))
    for (let index = 0; index < paragraphs.length; index++) {
      expect(paragraphs[index].text.length).toBeGreaterThan(0)
      expect(paragraphs[index].text).toBe(expected[index].text)
      expect(paragraphs[index]._cpStart).toBe(expected[index]._cpStart)
      if (expected[index].pageBreakBefore) {
        expect(paragraphs[index].paraFormat.pageBreakBefore).toBe(true)
      } else {
        expect(paragraphs[index].paraFormat.pageBreakBefore).toBeUndefined()
      }
    }
  }

  const body = 'MiXeD ASCII 大小写 AbCd 正文内容'
  const one = (text = body, pageBreakBefore = false): LegacyParagraph[] => [
    { text, _cpStart: 0, pageBreakBefore },
  ]

  it('覆盖全部 25 种 JS whitespace，并区分段落标记与分页符', () => {
    expect(jsWhitespace).toHaveLength(25)
    for (const whitespace of jsWhitespace) {
      const input = whitespace + body + whitespace
      expectLegacyParagraphs(input, whitespace === '\n'
        ? [{ text: body, _cpStart: 1, pageBreakBefore: false }]
        : one(body, whitespace === '\f'))
    }
    const edges = jsWhitespace.filter(char => char !== '\n' && char !== '\f').join('')
    expectLegacyParagraphs(edges + body + edges, one())
  })

  it('删除每一种垃圾前缀，并再次 trim 垃圾后的空白但不改变大小写', () => {
    for (const junk of new Set(legacyJunkChars)) {
      expectLegacyParagraphs('\ufeff\u3000' + junk + '\t\u2028\u2029' + body + '\u00a0', one())
    }
    expectLegacyParagraphs(' \t' + legacyJunkChars + '\ufeff\u3000' + body + '\u2029', one())
    expectLegacyParagraphs('伀倀\t伀' + body, one('伀' + body))
  })

  it('保留非 JS whitespace 边界与正文内部空白、垃圾字符和 ASCII 大小写', () => {
    for (const edge of ['\u0085', '\u180e', '\u200b', '\u2060', '\ud800', '\udfff']) {
      expectLegacyParagraphs(' \t' + edge + body + edge + '\ufeff', one(edge + body + edge))
    }
    const internal = 'AbCd\t中文\u3000正文\ufeff大写Zz\u2028分隔\u2029伀结束'
    expectLegacyParagraphs('\u3000' + internal + '\u3000', one(internal))
  })

  it('空、纯白、纯垃圾及真实 skip 路径不会产生空段落', () => {
    const emptyInputs = ['', ...jsWhitespace, jsWhitespace.join(''), legacyJunkChars,
      ' \ufeff' + legacyJunkChars + '\u3000', '伀倀 \t\ufeff', '\f伀倀\t', 'Ab伀倀藠Cd']
    for (const input of emptyInputs) expectLegacyParagraphs(input, [])
    expectLegacyParagraphs(' \t' + body + '\ufeff', one())
  })

  it('以分页符开头时保留 pageBreakBefore 与原始 CP', () => {
    for (const input of ['\f' + body, '\f\ufeff伀倀\u3000' + body + '\u2029', '\f\f' + body]) {
      expectLegacyParagraphs(input, one(body, true))
    }
    expectLegacyParagraphs('\f\f\f' + body + '\fDiscarded Tail', one(body + '\fDiscarded Tail', true))
  })

  it('段中与多处分页按旧分支选择 firstPart 或 remaining，不提前 trim', () => {
    expectLegacyParagraphs(' \t伀倀\u3000' + body + '\fDiscarded Tail', one())
    expectLegacyParagraphs(body + '\fDiscarded\fAnother Tail', one())
    expectLegacyParagraphs(' \ufeff\u3000\f伀倀\t' + body, one(body, true))
    expectLegacyParagraphs(' \f伀倀\t' + body + '\fKept Tail', one(body + '\fKept Tail', true))
    expectLegacyParagraphs('\f伀倀\t' + body + '\fDiscarded Tail', one(body, true))
    // 非空垃圾 firstPart 会被选中后清空，不能错误地改用 remaining。
    expectLegacyParagraphs('伀倀\f' + body, [])
  })

  it('Round135 多分页只消费首个位置，长尾不改变第一段和 CP', () => {
    const tail = ('Discarded Tail\f').repeat(2000)
    expectLegacyParagraphs(body + '\f' + tail, one())
    expectLegacyParagraphs(' \f' + body + '\fKept Tail', one(body + '\fKept Tail', true))
    expectLegacyParagraphs('\f\f\f' + body, one(body, true))
  })

  it('Round135 分页位于任一码元之后时，旧 split oracle 与真实路径相等', () => {
    let checked = 0
    for (let code = 0; code <= 0xffff; code++) {
      const prefix = String.fromCharCode(code)
      if (prefix === '\n' || prefix === '\u0007') continue
      const input = prefix + '\f' + body + '\fKept Tail'
      expectLegacyParagraphs(input, legacyParagraphs(input))
      checked++
    }
    expect(checked).toBe(65534)
  })

  it('跳过段落后 CP 仍取原始文本长度，含 CR、代理对和表格行边界', () => {
    const first = ' \ufeff伀倀\t' + body + '\u3000'
    const skipped = '伀倀\t'
    const second = '\f伀倀\u3000Second CASE 中文正文\ud83d\ude00\r'
    const input = '\n' + first + '\n' + skipped + '\n' + second + '\n'
    expectLegacyParagraphs(input, [
      { text: body, _cpStart: 1, pageBreakBefore: false },
      { text: 'Second CASE 中文正文\ud83d\ude00', _cpStart: first.length + skipped.length + 3, pageBreakBefore: true },
    ])
    const row = body + '\u0007\u0007'
    expectLegacyParagraphs(row + '\ufeff伀倀\t' + body, [
      { text: row, _cpStart: 0, pageBreakBefore: false },
      { text: body, _cpStart: row.length, pageBreakBefore: false },
    ])
  })

  it('真实 DOC 抽取的三段正文经过真实清洗路径仍非空且逐字保留', () => {
    const data = readFileSync(new URL('../docs/doc-100kb.doc', import.meta.url))
    const parsed = new DocParser(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)).parse()
    expect(parsed.success).toBe(true)
    expect(parsed.text.length).toBeGreaterThan(0)
    const texts = parsed.text.split('\n').filter(text =>
      text.length >= 10 && text.length <= 300 && !/[\f\u0007]/.test(text)
      && legacyCleanParagraph(text) === text && !legacySkipParagraph(text),
    ).slice(0, 3)
    expect(texts).toHaveLength(3)
    for (const text of texts) {
      expectLegacyParagraphs('\ufeff伀倀\u3000' + text + '\u2029', one(text))
    }
  })

  it('穷尽 65536 首尾码元，直接清洗与旧重复 trim 调用逐字相等', () => {
    const parser = new DocParser(new ArrayBuffer(512)) as any
    let checked = 0
    for (let code = 0; code <= 0xffff; code++) {
      const char = String.fromCharCode(code)
      for (const input of [char + body, body + char, char + '伀倀\ufeff\u3000' + body + char]) {
        const expected = legacyCleanParagraph(input.trim())
        strictEqual(parser.cleanParagraph(input), expected, `码元 ${code} 直接清洗`)
        strictEqual(parser.cleanParagraph(input.trim()), expected, `码元 ${code} 旧重复 trim`)
        checked++
      }
    }
    expect(checked).toBe(65536 * 3)
    expectLegacyParagraphs('伀倀\ufeff' + body + '\u3000', one())
  })
})

describe('Round128 resolved style presence guards', () => {
  type Style = import('../src/utils/styleParser').StyleDefinition
  type Papx = import('../src/utils/formatParser').PapxRun
  const basePara = { alignment: 'left', spaceBefore: 2 }
  const baseChar = { fontName: 'Base', bold: true, styles: ['bold'] }
  const style = (istd: number, paraFormat?: Style['paraFormat'], charFormat?: Style['charFormat'],
    istdBase?: number): Style => ({ istd, name: `Custom ${istd}`, type: 'paragraph',
    istdBase, paraFormat, charFormat })

  // 独立旧 oracle：每段重新解析受控继承链，并保留原有 Object.keys 判空与展开顺序。
  function legacyFormats(styles: Style[], run: Papx, chpx: Record<string, unknown>) {
    const chain: Style[] = []
    let current = styles.find(candidate => candidate.istd === run.istd)
    while (current) {
      chain.unshift(current)
      current = styles.find(candidate => candidate.istd === current!.istdBase)
    }
    let resolvedPara: Record<string, unknown> = {}
    let resolvedChar: Record<string, unknown> = {}
    for (const ancestor of chain) {
      if (ancestor.paraFormat && Object.keys(ancestor.paraFormat).length > 0) {
        resolvedPara = { ...resolvedPara, ...ancestor.paraFormat }
      }
      if (ancestor.charFormat && Object.keys(ancestor.charFormat).length > 0) {
        resolvedChar = { ...resolvedChar, ...ancestor.charFormat }
      }
    }
    let paraFormat: Record<string, unknown> = { ...basePara }
    let charFormat: Record<string, unknown> = { ...baseChar }
    if (Object.keys(run.format).length > 0) paraFormat = { ...paraFormat, ...run.format }
    paraFormat.styleName = styles.find(candidate => candidate.istd === run.istd)!.name
    if (Object.keys(resolvedPara).length > 0) paraFormat = { ...resolvedPara, ...paraFormat }
    if (Object.keys(resolvedChar).length > 0) charFormat = { ...resolvedChar, ...charFormat }
    if (Object.keys(chpx).length > 0) {
      const { styles: _styles, ...real } = { ...charFormat, ...chpx }
      charFormat = real
    }
    return { paraFormat, charFormat }
  }

  function check(styles: Style[], ids = [1, 1, 1], direct: Papx['format'][] = [],
    chars: Record<string, unknown>[] = [], parser = new DocParser(new ArrayBuffer(512))) {
    const before = structuredClone(styles)
    const texts = ids.map((_, index) => `Valid Round128 paragraph ${index}`)
    let cp = 0
    const runs: Papx[] = ids.map((istd, index) => {
      const cpStart = cp
      cp += texts[index].length + 1
      return { cpStart, cpEnd: cp, istd, format: direct[index] ?? {} }
    })
    const chpx = runs.map((run, index) => ({ cpStart: run.cpStart, cpEnd: run.cpEnd,
      format: chars[index] ?? {} }))
    const pieces = runs.map((run, index) => ({ start: run.cpStart,
      end: run.cpEnd - 1, chpxIndex: index }))
    const paraSpy = vi.spyOn(parser as any, 'detectParagraphFormat').mockImplementation(() => ({ ...basePara }))
    const charSpy = vi.spyOn(parser as any, 'guessCharFormat').mockImplementation(() => ({ ...baseChar }))
    try {
      const paragraphs = (parser as any).createParagraphsWithRealFormats(
        texts.join('\n'), chars.length ? chpx : [], runs, styles, [], chars.length ? pieces : undefined,
      )
      expect(paragraphs).toHaveLength(ids.length)
      for (let index = 0; index < ids.length; index++) {
        const actual = paragraphs[index]
        const expected = legacyFormats(styles, runs[index], chars[index] ?? {})
        expect(actual.text).toBe(texts[index])
        expect(actual.text.length).toBeGreaterThan(0)
        expect(actual._cpStart).toBe(runs[index].cpStart)
        for (const key of ['paraFormat', 'charFormat'] as const) {
          expect(actual[key]).toEqual(expected[key])
          expect(Object.keys(actual[key])).toEqual(Object.keys(expected[key]))
          expect(JSON.stringify(actual[key])).toBe(JSON.stringify(expected[key]))
        }
        expect(actual.paraFormatFromReal).toBe(Object.keys(runs[index].format).length ? true : undefined)
        expect(actual.charFormatFromReal).toBe(Object.keys(chars[index] ?? {}).length ? true : undefined)
      }
      expect(paraSpy).toHaveBeenCalledTimes(ids.length)
      expect(charSpy).toHaveBeenCalledTimes(ids.length)
      expect(styles).toEqual(before)
      expect(JSON.stringify(styles)).toBe(JSON.stringify(before))
      return paragraphs
    } finally {
      paraSpy.mockRestore()
      charSpy.mockRestore()
    }
  }

  const paras: Style['paraFormat'][] = [undefined, {}, { spaceAfter: 9 }, { spaceAfter: undefined }]
  const chars: Style['charFormat'][] = [undefined, {}, { italic: true }, { italic: undefined }]
  const cases = paras.flatMap((para, p) => chars.map((char, c) => ({ p, c, para, char })))
  it.each(cases)('段落/字符存在性组合 $p/$c 保持旧语义与重复样式结果', ({ para, char }) => {
    const paragraphs = check([style(1, para, char)])
    expect(Object.hasOwn(paragraphs[0].paraFormat, 'spaceAfter')).toBe(!!para && Object.hasOwn(para, 'spaceAfter'))
    expect(Object.hasOwn(paragraphs[0].charFormat, 'italic')).toBe(!!char && Object.hasOwn(char, 'italic'))
  })

  it('首样式全空、第二样式非空，交错与连续重复缓存互不污染', () => {
    const paragraphs = check([style(1, {}, {}), style(2, { spaceAfter: 19 }, { italic: true })],
      [1, 2, 1, 2, 2])
    expect(paragraphs[0].paraFormat.spaceAfter).toBeUndefined()
    expect(paragraphs[1].paraFormat.spaceAfter).toBe(19)
    expect(paragraphs[1].charFormat.italic).toBe(true)
    expect(paragraphs[2].charFormat.italic).toBeUndefined()
  })

  it('不同非空样式的段落与字符值不能复用常数缓存键', () => {
    const paragraphs = check([style(1, { spaceAfter: 3 }, { italic: false }),
      style(2, { spaceAfter: 7 }, { italic: true })], [2, 1, 2, 1])
    expect(paragraphs.map((p: any) => p.paraFormat.spaceAfter)).toEqual([7, 3, 7, 3])
    expect(paragraphs.map((p: any) => p.charFormat.italic)).toEqual([true, false, true, false])
  })

  it('样式低于启发式与直接 PAPX/CHPX，键序及 false/0/undefined 覆盖保持不变', () => {
    const paragraphs = check([style(1, { spaceAfter: 9, alignment: 'right', spaceBefore: 8 },
      { italic: true, bold: false, fontName: 'Style' })], [1, 1, 1],
    [{ alignment: 'center', spaceBefore: 0 }, {}, { spaceAfter: undefined }],
    [{ bold: false, italic: undefined }, {}, { fontName: 'Direct', italic: false }])
    expect(paragraphs[0].paraFormat.spaceBefore).toBe(0)
    expect(paragraphs[0].paraFormat.alignment).toBe('center')
    expect(paragraphs[1].paraFormat.alignment).toBe('left')
    expect(paragraphs[1].charFormat.fontName).toBe('Base')
    expect(paragraphs[0].charFormat.bold).toBe(false)
    expect(Object.hasOwn(paragraphs[0].charFormat, 'italic')).toBe(true)
    expect(paragraphs[2].charFormat.fontName).toBe('Direct')
  })

  it('空派生样式继承非空基样式，派生覆盖只影响自己的缓存项', () => {
    const paragraphs = check([style(1, { spaceAfter: 4 }, { italic: true }), style(2, {}, {}, 1),
      style(3, { spaceAfter: 0 }, { italic: false }, 2)], [2, 3, 1, 2, 3])
    expect(paragraphs.map((p: any) => p.paraFormat.spaceAfter)).toEqual([4, 0, 4, 4, 0])
    expect(paragraphs.map((p: any) => p.charFormat.italic)).toEqual([true, false, true, true, false])
  })

  it('同一 parser 两次调用间的样式变更重新计算存在性与内容', () => {
    const parser = new DocParser(new ArrayBuffer(512))
    const styles = [style(1, {}, {}), style(2, { spaceAfter: 11 }, { italic: true })]
    check(styles, [1, 2, 1], [], [], parser)
    styles[0].paraFormat = { spaceAfter: 23 }
    styles[0].charFormat = { italic: false }
    styles[1].paraFormat = {}
    styles[1].charFormat = {}
    const paragraphs = check(styles, [1, 2, 1], [], [], parser)
    expect(paragraphs[0].paraFormat.spaceAfter).toBe(23)
    expect(paragraphs[0].charFormat.italic).toBe(false)
    expect(Object.hasOwn(paragraphs[1].paraFormat, 'spaceAfter')).toBe(false)
    expect(Object.hasOwn(paragraphs[1].charFormat, 'italic')).toBe(false)
  })

  it('冻结的样式与继承格式不会被段落直接覆盖或缓存复用突变', () => {
    const styles = [style(1, Object.freeze({ spaceAfter: undefined }), Object.freeze({ italic: undefined })),
      style(2, Object.freeze({ spaceAfter: 12 }), Object.freeze({ italic: true }), 1)]
    styles.forEach(Object.freeze)
    check(styles, [1, 2, 2, 1], [{ spaceAfter: 0 }, { spaceAfter: 7 }, {}, {}],
      [{ italic: false }, { italic: undefined }, {}, {}])
  })
})
