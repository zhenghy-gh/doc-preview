import { describe, it, expect } from 'vitest'
import { parsePlcfFld, extractHyperlinks, extractDocumentFields, extractPageFields, extractCrossReferences, parseIndexResult, parseTocInstruction } from '../src/utils/fieldParser'

function writeUint32(buffer: Uint8Array, offset: number, value: number): void {
  buffer[offset] = value & 0xFF
  buffer[offset + 1] = (value >> 8) & 0xFF
  buffer[offset + 2] = (value >> 16) & 0xFF
  buffer[offset + 3] = (value >> 24) & 0xFF
}

function writeUtf16le(buffer: Uint8Array, offset: number, str: string): number {
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i)
    buffer[offset + i * 2] = code & 0xFF
    buffer[offset + i * 2 + 1] = (code >> 8) & 0xFF
  }
  return str.length * 2
}

describe('fieldParser', () => {
  describe('parsePlcfFld', () => {
    it('should return empty array for zero-length input', () => {
      expect(parsePlcfFld(new Uint8Array(0), 0, 0)).toEqual([])
    })

    it('should return empty array for too-small input', () => {
      expect(parsePlcfFld(new Uint8Array(8), 0, 8)).toEqual([])
    })

    it('should parse a single field entry', () => {
      // Create PlcfFld with 1 field entry (but actually needs 3 for begin/sep/end)
      // For simplicity, test with 3 entries
      const n = 3
      const totalSize = (n + 1) * 4 + n * 2 // 16 + 6 = 22
      const buf = new Uint8Array(totalSize)
      let pos = 0

      // CPs: 0, 10, 20, 30
      writeUint32(buf, pos, 0); pos += 4
      writeUint32(buf, pos, 10); pos += 4
      writeUint32(buf, pos, 20); pos += 4
      writeUint32(buf, pos, 30); pos += 4

      // FLD entries
      buf[pos++] = 0x13 // ch = begin
      buf[pos++] = 37   // flt = HYPERLINK
      buf[pos++] = 0x14 // ch = sep
      buf[pos++] = 0
      buf[pos++] = 0x15 // ch = end
      buf[pos++] = 0

      const result = parsePlcfFld(buf, 0, totalSize)
      expect(result.length).toBe(3)
      expect(result[0]).toEqual({ cp: 0, ch: 0x13, flt: 37 })
      expect(result[1]).toEqual({ cp: 10, ch: 0x14, flt: 0 })
      expect(result[2]).toEqual({ cp: 20, ch: 0x15, flt: 0 })
    })

    it('should respect fc offset', () => {
      const n = 1
      const totalSize = (n + 1) * 4 + n * 2 // 8 + 2 = 10
      const buf = new Uint8Array(totalSize + 10)
      let pos = 5

      writeUint32(buf, pos, 100); pos += 4
      writeUint32(buf, pos, 200); pos += 4
      buf[pos++] = 0x13
      buf[pos++] = 37

      const result = parsePlcfFld(buf, 5, totalSize)
      expect(result.length).toBe(1)
      expect(result[0].cp).toBe(100)
    })
  })

  describe('extractHyperlinks', () => {
    it('should return empty array for empty field list', () => {
      expect(extractHyperlinks([], '')).toEqual([])
    })

    it('should extract a HYPERLINK field', () => {
      const fldEntries = [
        { cp: 0, ch: 0x13, flt: 37 },  // begin
        { cp: 35, ch: 0x14, flt: 0 },  // sep (after instruction)
        { cp: 50, ch: 0x15, flt: 0 },  // end
      ]

      // Instruction: 'HYPERLINK "https://example.com"' = 34 chars
      // CP range: 1 to 35 (skip 0x13 at cp=0)
      const textBytes = new Uint8Array(120)
      const instr = 'HYPERLINK "https://example.com"'
      // Write at CP=1 (byte offset 2)
      writeUtf16le(textBytes, 2, instr)

      // Result text at CP=36 to 50
      const result = extractHyperlinks(fldEntries, 'Click here', textBytes)
      expect(result.length).toBe(1)
      expect(result[0].flt).toBe(37)
      expect(result[0].url).toBe('https://example.com')
    })

    it('should skip non-HYPERLINK fields', () => {
      const fldEntries = [
        { cp: 0, ch: 0x13, flt: 19 },  // begin (PAGE field)
        { cp: 5, ch: 0x14, flt: 0 },   // sep
        { cp: 10, ch: 0x15, flt: 0 },  // end
      ]

      const result = extractHyperlinks(fldEntries, 'Page 1', new Uint8Array(20))
      expect(result.length).toBe(0)
    })

    it('should handle malformed field triples gracefully', () => {
      const fldEntries = [
        { cp: 0, ch: 0x13, flt: 37 },
        { cp: 10, ch: 0x15, flt: 0 }, // Wrong: should be 0x14
        { cp: 20, ch: 0x14, flt: 0 },
      ]

      const result = extractHyperlinks(fldEntries, 'text', new Uint8Array(50))
      expect(result.length).toBe(0)
    })

    it('should extract multiple HYPERLINK fields', () => {
      const fldEntries = [
        { cp: 0, ch: 0x13, flt: 37 },
        { cp: 25, ch: 0x14, flt: 0 },
        { cp: 35, ch: 0x15, flt: 0 },
        { cp: 40, ch: 0x13, flt: 37 },
        { cp: 60, ch: 0x14, flt: 0 },
        { cp: 70, ch: 0x15, flt: 0 },
      ]

      const textBytes = new Uint8Array(160)
      writeUtf16le(textBytes, 2, 'HYPERLINK "http://a.com"')
      writeUtf16le(textBytes, 82, 'HYPERLINK "http://b.com"')

      const result = extractHyperlinks(fldEntries, 'Link1Link2', textBytes)
      expect(result.length).toBe(2)
    })
  })

  describe('extractDocumentFields', () => {
    it('should return empty object for empty field list', () => {
      expect(extractDocumentFields([], '')).toEqual({})
    })

    it('should extract AUTHOR field', () => {
      const text = '\x13AUTHOR\x14John Doe\x15'
      const fldEntries = [
        { cp: 0, ch: 0x13, flt: 1 },
        { cp: 7, ch: 0x14, flt: 0 },
        { cp: 16, ch: 0x15, flt: 0 },
      ]
      const textBytes = new Uint8Array(40)
      writeUtf16le(textBytes, 2, 'AUTHOR')
      writeUtf16le(textBytes, 16, 'John Doe')
      const result = extractDocumentFields(fldEntries, text, textBytes)
      expect(result.author).toBe('John Doe')
    })

    it('should extract TITLE field', () => {
      const text = '\x13TITLE\x14My Document Title\x15'
      const fldEntries = [
        { cp: 0, ch: 0x13, flt: 5 },
        { cp: 6, ch: 0x14, flt: 0 },
        { cp: 24, ch: 0x15, flt: 0 },
      ]
      const textBytes = new Uint8Array(60)
      writeUtf16le(textBytes, 2, 'TITLE')
      writeUtf16le(textBytes, 14, 'My Document Title')
      const result = extractDocumentFields(fldEntries, text, textBytes)
      expect(result.title).toBe('My Document Title')
    })

    it('should extract DATE and TIME fields', () => {
      const text = '\x13DATE\x142024-01-15\x15\x13TIME\x1414:30:00\x15'
      const fldEntries = [
        { cp: 0, ch: 0x13, flt: 29 },
        { cp: 5, ch: 0x14, flt: 0 },
        { cp: 16, ch: 0x15, flt: 0 },
        { cp: 17, ch: 0x13, flt: 30 },
        { cp: 22, ch: 0x14, flt: 0 },
        { cp: 31, ch: 0x15, flt: 0 },
      ]
      const textBytes = new Uint8Array(80)
      writeUtf16le(textBytes, 2, 'DATE')
      writeUtf16le(textBytes, 12, '2024-01-15')
      writeUtf16le(textBytes, 36, 'TIME')
      writeUtf16le(textBytes, 46, '14:30:00')
      const result = extractDocumentFields(fldEntries, text, textBytes)
      expect(result.date).toBe('2024-01-15')
      expect(result.time).toBe('14:30:00')
    })

    it('should extract CREATEDATE and LASTSAVEDATE fields', () => {
      const text = '\x13CREATEDATE\x142024-01-01\x15\x13LASTSAVEDATE\x142024-06-15\x15'
      const fldEntries = [
        { cp: 0, ch: 0x13, flt: 13 },
        { cp: 11, ch: 0x14, flt: 0 },
        { cp: 22, ch: 0x15, flt: 0 },
        { cp: 23, ch: 0x13, flt: 15 },
        { cp: 36, ch: 0x14, flt: 0 },
        { cp: 47, ch: 0x15, flt: 0 },
      ]
      const textBytes = new Uint8Array(120)
      writeUtf16le(textBytes, 2, 'CREATEDATE')
      writeUtf16le(textBytes, 24, '2024-01-01')
      writeUtf16le(textBytes, 48, 'LASTSAVEDATE')
      writeUtf16le(textBytes, 72, '2024-06-15')
      const result = extractDocumentFields(fldEntries, text, textBytes)
      expect(result.createDate).toBe('2024-01-01')
      expect(result.lastSavedDate).toBe('2024-06-15')
    })

    it('should extract REVNUM field', () => {
      const text = '\x13REVNUM\x145\x15'
      const fldEntries = [
        { cp: 0, ch: 0x13, flt: 42 },
        { cp: 7, ch: 0x14, flt: 0 },
        { cp: 9, ch: 0x15, flt: 0 },
      ]
      const textBytes = new Uint8Array(30)
      writeUtf16le(textBytes, 2, 'REVNUM')
      writeUtf16le(textBytes, 14, '5')
      const result = extractDocumentFields(fldEntries, text, textBytes)
      expect(result.revisionNumber).toBe('5')
    })

    it('should skip empty field results', () => {
      const text = '\x13AUTHOR\x14\x15'
      const fldEntries = [
        { cp: 0, ch: 0x13, flt: 1 },
        { cp: 7, ch: 0x14, flt: 0 },
        { cp: 7, ch: 0x15, flt: 0 },
      ]
      const textBytes = new Uint8Array(20)
      writeUtf16le(textBytes, 2, 'AUTHOR')
      const result = extractDocumentFields(fldEntries, text, textBytes)
      expect(result).toEqual({})
    })

    it('should extract multiple different fields', () => {
      const text = '\x13AUTHOR\x14Jane Smith\x15\x13TITLE\x14Project Proposal\x15\x13REVNUM\x143\x15'
      const fldEntries = [
        { cp: 0, ch: 0x13, flt: 1 },
        { cp: 7, ch: 0x14, flt: 0 },
        { cp: 18, ch: 0x15, flt: 0 },
        { cp: 19, ch: 0x13, flt: 5 },
        { cp: 25, ch: 0x14, flt: 0 },
        { cp: 42, ch: 0x15, flt: 0 },
        { cp: 43, ch: 0x13, flt: 42 },
        { cp: 50, ch: 0x14, flt: 0 },
        { cp: 52, ch: 0x15, flt: 0 },
      ]
      const textBytes = new Uint8Array(120)
      writeUtf16le(textBytes, 2, 'AUTHOR')
      writeUtf16le(textBytes, 16, 'Jane Smith')
      writeUtf16le(textBytes, 40, 'TITLE')
      writeUtf16le(textBytes, 52, 'Project Proposal')
      writeUtf16le(textBytes, 86, 'REVNUM')
      writeUtf16le(textBytes, 98, '3')
      const result = extractDocumentFields(fldEntries, text, textBytes)
      expect(result.author).toBe('Jane Smith')
      expect(result.title).toBe('Project Proposal')
      expect(result.revisionNumber).toBe('3')
    })
  })

  describe('extractPageFields', () => {
    it('should return empty array for empty field list', () => {
      expect(extractPageFields([], '')).toEqual([])
    })

    it('should extract a PAGE field', () => {
      // Layout: 0x13@0, "PAGE"@1-4, 0x14@5, "1"@6, 0x15@7
      const text = '\x13PAGE\x141\x15'
      const fldEntries = [
        { cp: 0, ch: 0x13, flt: 1 },   // begin
        { cp: 5, ch: 0x14, flt: 0 },   // sep (after "PAGE")
        { cp: 7, ch: 0x15, flt: 0 },   // end (after "1")
      ]
      const textBytes = new Uint8Array(20)
      writeUtf16le(textBytes, 2, 'PAGE')      // instruction at cp=1
      writeUtf16le(textBytes, 12, '1')        // result at cp=6
      const result = extractPageFields(fldEntries, text, textBytes)
      expect(result.length).toBe(1)
      expect(result[0].type).toBe('page')
      expect(result[0].instruction).toBe('PAGE')
      expect(result[0].result).toBe('1')
      expect(result[0].cpStart).toBe(0)
      expect(result[0].cpEnd).toBe(8) // end.cp + 1
    })

    it('should extract a NUMPAGES field', () => {
      // Layout: 0x13@0, "NUMPAGES"@1-8, 0x14@9, "5"@10, 0x15@11
      const text = '\x13NUMPAGES\x145\x15'
      const fldEntries = [
        { cp: 0, ch: 0x13, flt: 1 },
        { cp: 9, ch: 0x14, flt: 0 },
        { cp: 11, ch: 0x15, flt: 0 },
      ]
      const textBytes = new Uint8Array(26)
      writeUtf16le(textBytes, 2, 'NUMPAGES')
      writeUtf16le(textBytes, 20, '5')
      const result = extractPageFields(fldEntries, text, textBytes)
      expect(result.length).toBe(1)
      expect(result[0].type).toBe('numPages')
      expect(result[0].result).toBe('5')
    })

    it('should extract a SECTION field', () => {
      // Layout: 0x13@0, "SECTION"@1-7, 0x14@8, "2"@9, 0x15@10
      const text = '\x13SECTION\x142\x15'
      const fldEntries = [
        { cp: 0, ch: 0x13, flt: 1 },
        { cp: 8, ch: 0x14, flt: 0 },
        { cp: 10, ch: 0x15, flt: 0 },
      ]
      const textBytes = new Uint8Array(24)
      writeUtf16le(textBytes, 2, 'SECTION')
      writeUtf16le(textBytes, 18, '2')
      const result = extractPageFields(fldEntries, text, textBytes)
      expect(result.length).toBe(1)
      expect(result[0].type).toBe('section')
      expect(result[0].result).toBe('2')
    })

    it('should extract SECTIONPAGES (not confuse with SECTION)', () => {
      // Layout: 0x13@0, "SECTIONPAGES"@1-12, 0x14@13, "3"@14, 0x15@15
      const text = '\x13SECTIONPAGES\x143\x15'
      const fldEntries = [
        { cp: 0, ch: 0x13, flt: 1 },
        { cp: 13, ch: 0x14, flt: 0 },
        { cp: 15, ch: 0x15, flt: 0 },
      ]
      const textBytes = new Uint8Array(34)
      writeUtf16le(textBytes, 2, 'SECTIONPAGES')
      writeUtf16le(textBytes, 28, '3')
      const result = extractPageFields(fldEntries, text, textBytes)
      expect(result.length).toBe(1)
      expect(result[0].type).toBe('sectionPages')
      expect(result[0].result).toBe('3')
    })

    it('should handle instruction with switches (PAGE \\* MERGEFORMAT)', () => {
      const instr = 'PAGE \\* MERGEFORMAT'  // 19 chars
      // Layout: 0x13@0, instr@1-19, 0x14@20, "7"@21, 0x15@22
      const text = '\x13' + instr + '\x147\x15'
      const fldEntries = [
        { cp: 0, ch: 0x13, flt: 1 },
        { cp: instr.length + 1, ch: 0x14, flt: 0 },          // cp=20
        { cp: instr.length + 3, ch: 0x15, flt: 0 },          // cp=22
      ]
      const textBytes = new Uint8Array(50)
      writeUtf16le(textBytes, 2, instr)
      writeUtf16le(textBytes, (instr.length + 1) * 2, '7')
      const result = extractPageFields(fldEntries, text, textBytes)
      expect(result.length).toBe(1)
      expect(result[0].type).toBe('page')
      expect(result[0].instruction).toBe(instr)
      expect(result[0].result).toBe('7')
    })

    it('should be case-insensitive for instruction keyword', () => {
      // Layout: 0x13@0, "page"@1-4, 0x14@5, "4"@6, 0x15@7
      const text = '\x13page\x144\x15'
      const fldEntries = [
        { cp: 0, ch: 0x13, flt: 1 },
        { cp: 5, ch: 0x14, flt: 0 },
        { cp: 7, ch: 0x15, flt: 0 },
      ]
      const textBytes = new Uint8Array(20)
      writeUtf16le(textBytes, 2, 'page')  // lowercase
      writeUtf16le(textBytes, 12, '4')
      const result = extractPageFields(fldEntries, text, textBytes)
      expect(result.length).toBe(1)
      expect(result[0].type).toBe('page')
    })

    it('should extract multiple page fields of different types', () => {
      // PAGE: 0x13@0, "PAGE"@1-4, 0x14@5, "1"@6, 0x15@7
      // NUMPAGES: 0x13@8, "NUMPAGES"@9-16, 0x14@17, "10"@18-19, 0x15@20
      const fldEntries = [
        { cp: 0, ch: 0x13, flt: 1 },    // PAGE begin
        { cp: 5, ch: 0x14, flt: 0 },    // PAGE sep
        { cp: 7, ch: 0x15, flt: 0 },    // PAGE end
        { cp: 8, ch: 0x13, flt: 1 },    // NUMPAGES begin
        { cp: 17, ch: 0x14, flt: 0 },   // NUMPAGES sep
        { cp: 20, ch: 0x15, flt: 0 },   // NUMPAGES end
      ]
      const textBytes = new Uint8Array(44)
      writeUtf16le(textBytes, 2, 'PAGE')           // cp=1
      writeUtf16le(textBytes, 12, '1')             // cp=6
      writeUtf16le(textBytes, 18, 'NUMPAGES')      // cp=9
      writeUtf16le(textBytes, 38, '10')            // cp=19 (start of "10")
      // text passed to extractPageFields: result is sliced from text, not textBytes
      // PAGE result at cp 6-7 = "1", NUMPAGES result at cp 18-20 = "10"
      // Build a text string that matches: chars 0-20
      const textStr = '\x13PAGE\x141\x15\x13NUMPAGES\x1410\x15'
      const result = extractPageFields(fldEntries, textStr, textBytes)
      expect(result.length).toBe(2)
      expect(result[0].type).toBe('page')
      expect(result[0].result).toBe('1')
      expect(result[1].type).toBe('numPages')
      expect(result[1].result).toBe('10')
    })

    it('should skip non-page fields (AUTHOR, HYPERLINK, etc.)', () => {
      const fldEntries = [
        { cp: 0, ch: 0x13, flt: 1 },     // AUTHOR begin
        { cp: 7, ch: 0x14, flt: 0 },     // AUTHOR sep
        { cp: 16, ch: 0x15, flt: 0 },    // AUTHOR end
      ]
      const textBytes = new Uint8Array(40)
      writeUtf16le(textBytes, 2, 'AUTHOR')
      writeUtf16le(textBytes, 16, 'John Doe')
      const result = extractPageFields(fldEntries, 'John Doe', textBytes)
      expect(result.length).toBe(0)
    })

    it('should handle empty instruction gracefully', () => {
      const fldEntries = [
        { cp: 0, ch: 0x13, flt: 1 },
        { cp: 1, ch: 0x14, flt: 0 },  // empty instruction
        { cp: 2, ch: 0x15, flt: 0 },
      ]
      const result = extractPageFields(fldEntries, 'x', new Uint8Array(10))
      expect(result.length).toBe(0)
    })
  })

  describe('extractCrossReferences', () => {
    it('should return empty array for empty field list', () => {
      expect(extractCrossReferences([], '')).toEqual([])
    })

    it('should extract a REF field with bookmark name', () => {
      // Layout: 0x13@0, "REF _Ref1"@1-9, 0x14@10, "图 1"@11-13, 0x15@14
      const text = '\x13REF _Ref1\x14图 1\x15'
      const fldEntries = [
        { cp: 0, ch: 0x13, flt: 1 },   // begin
        { cp: 10, ch: 0x14, flt: 0 },  // sep (after "REF _Ref1", 9 chars)
        { cp: 14, ch: 0x15, flt: 0 },  // end (after "图 1", 3 chars)
      ]
      const textBytes = new Uint8Array(40)
      writeUtf16le(textBytes, 2, 'REF _Ref1')
      writeUtf16le(textBytes, 22, '图 1')
      const result = extractCrossReferences(fldEntries, text, textBytes)
      expect(result.length).toBe(1)
      expect(result[0].type).toBe('ref')
      expect(result[0].targetBookmarkName).toBe('_Ref1')
      expect(result[0].result).toBe('图 1')
      expect(result[0].switches).toEqual([])
      expect(result[0].cpStart).toBe(0)
      expect(result[0].cpEnd).toBe(15) // end.cp + 1
    })

    it('should extract a REF field with switches', () => {
      // Layout: 0x13@0, "REF _Ref1 \h"@1-10, 0x14@11, "1"@12, 0x15@13
      const instr = 'REF _Ref1 \\h'  // 11 chars
      const text = '\x13' + instr + '\x141\x15'
      const fldEntries = [
        { cp: 0, ch: 0x13, flt: 1 },
        { cp: instr.length + 1, ch: 0x14, flt: 0 },  // cp=12
        { cp: instr.length + 3, ch: 0x15, flt: 0 },  // cp=14
      ]
      const textBytes = new Uint8Array(40)
      writeUtf16le(textBytes, 2, instr)
      writeUtf16le(textBytes, (instr.length + 1) * 2, '1')
      const result = extractCrossReferences(fldEntries, text, textBytes)
      expect(result.length).toBe(1)
      expect(result[0].type).toBe('ref')
      expect(result[0].targetBookmarkName).toBe('_Ref1')
      expect(result[0].switches).toEqual(['\\h'])
      expect(result[0].result).toBe('1')
    })

    it('should extract a NOTEREF field', () => {
      // Layout: 0x13@0, "NOTEREF FootnoteRef"@1-18, 0x14@19, "1"@20, 0x15@21
      const instr = 'NOTEREF FootnoteRef'  // 18 chars
      const text = '\x13' + instr + '\x141\x15'
      const fldEntries = [
        { cp: 0, ch: 0x13, flt: 1 },
        { cp: instr.length + 1, ch: 0x14, flt: 0 },  // cp=19
        { cp: instr.length + 3, ch: 0x15, flt: 0 },  // cp=21
      ]
      const textBytes = new Uint8Array(50)
      writeUtf16le(textBytes, 2, instr)
      writeUtf16le(textBytes, (instr.length + 1) * 2, '1')
      const result = extractCrossReferences(fldEntries, text, textBytes)
      expect(result.length).toBe(1)
      expect(result[0].type).toBe('noteref')
      expect(result[0].targetBookmarkName).toBe('FootnoteRef')
      expect(result[0].result).toBe('1')
    })

    it('should be case-insensitive for instruction keyword', () => {
      // Layout: 0x13@0, "ref _Ref1"@1-9, 0x14@10, "1"@11, 0x15@12
      const text = '\x13ref _Ref1\x141\x15'
      const fldEntries = [
        { cp: 0, ch: 0x13, flt: 1 },
        { cp: 10, ch: 0x14, flt: 0 },
        { cp: 12, ch: 0x15, flt: 0 },
      ]
      const textBytes = new Uint8Array(30)
      writeUtf16le(textBytes, 2, 'ref _Ref1')
      writeUtf16le(textBytes, 22, '1')
      const result = extractCrossReferences(fldEntries, text, textBytes)
      expect(result.length).toBe(1)
      expect(result[0].type).toBe('ref')
    })

    it('should extract multiple REF fields with multiple switches', () => {
      // Field 1: 0x13@0, "REF _A \h \n"@1-9, 0x14@10, "1"@11, 0x15@12
      // Field 2: 0x13@13, "REF _B"@14-17, 0x14@18, "2"@19, 0x15@20
      const instr1 = 'REF _A \\h \\n'  // 11 chars
      const instr2 = 'REF _B'         // 6 chars
      const text = '\x13' + instr1 + '\x141\x15\x13' + instr2 + '\x142\x15'
      const fldEntries = [
        { cp: 0, ch: 0x13, flt: 1 },
        { cp: instr1.length + 1, ch: 0x14, flt: 0 },  // cp=12
        { cp: instr1.length + 3, ch: 0x15, flt: 0 },  // cp=14
        { cp: instr1.length + 4, ch: 0x13, flt: 1 },  // cp=15
        { cp: instr1.length + 4 + instr2.length + 1, ch: 0x14, flt: 0 },  // cp=22
        { cp: instr1.length + 4 + instr2.length + 3, ch: 0x15, flt: 0 },  // cp=24
      ]
      const textBytes = new Uint8Array(80)
      writeUtf16le(textBytes, 2, instr1)
      writeUtf16le(textBytes, (instr1.length + 1) * 2, '1')
      writeUtf16le(textBytes, (instr1.length + 4 + 1) * 2, instr2)
      writeUtf16le(textBytes, (instr1.length + 4 + instr2.length + 1 + 1) * 2, '2')
      const result = extractCrossReferences(fldEntries, text, textBytes)
      expect(result.length).toBe(2)
      expect(result[0].targetBookmarkName).toBe('_A')
      expect(result[0].switches).toEqual(['\\h', '\\n'])
      expect(result[1].targetBookmarkName).toBe('_B')
      expect(result[1].switches).toEqual([])
    })

    it('should skip non-REF fields (AUTHOR, HYPERLINK, PAGE, etc.)', () => {
      const fldEntries = [
        { cp: 0, ch: 0x13, flt: 1 },     // AUTHOR begin
        { cp: 7, ch: 0x14, flt: 0 },     // AUTHOR sep
        { cp: 16, ch: 0x15, flt: 0 },    // AUTHOR end
      ]
      const textBytes = new Uint8Array(40)
      writeUtf16le(textBytes, 2, 'AUTHOR')
      writeUtf16le(textBytes, 16, 'John Doe')
      const result = extractCrossReferences(fldEntries, 'John Doe', textBytes)
      expect(result.length).toBe(0)
    })

    it('should skip REF field with no target bookmark name', () => {
      // Layout: 0x13@0, "REF"@1-3, 0x14@4, "x"@5, 0x15@6
      const text = '\x13REF\x14x\x15'
      const fldEntries = [
        { cp: 0, ch: 0x13, flt: 1 },
        { cp: 4, ch: 0x14, flt: 0 },
        { cp: 6, ch: 0x15, flt: 0 },
      ]
      const textBytes = new Uint8Array(20)
      writeUtf16le(textBytes, 2, 'REF')
      writeUtf16le(textBytes, 10, 'x')
      const result = extractCrossReferences(fldEntries, text, textBytes)
      expect(result.length).toBe(0)
    })

    it('should handle empty instruction gracefully', () => {
      const fldEntries = [
        { cp: 0, ch: 0x13, flt: 1 },
        { cp: 1, ch: 0x14, flt: 0 },  // empty instruction
        { cp: 2, ch: 0x15, flt: 0 },
      ]
      const result = extractCrossReferences(fldEntries, 'x', new Uint8Array(10))
      expect(result.length).toBe(0)
    })
  })

  describe('parseIndexResult', () => {
    it('should parse simple index entries with dot leaders', () => {
      const result = `Apple.................1
Banana................2
Cherry................3`
      const entries = parseIndexResult(result)
      expect(entries.length).toBe(3)
      expect(entries[0].mainTerm).toBe('Apple')
      expect(entries[0].pageNumber).toBe('1')
      expect(entries[1].mainTerm).toBe('Banana')
      expect(entries[1].pageNumber).toBe('2')
    })

    it('should parse entries with sub-terms (indented)', () => {
      const result = `Apple.................1
  Red apple...........2
  Green apple.........3
Banana................4`
      const entries = parseIndexResult(result)
      expect(entries.length).toBe(4)
      expect(entries[0].mainTerm).toBe('Apple')
      expect(entries[0].pageNumber).toBe('1')
      expect(entries[1].mainTerm).toBe('Apple')
      expect(entries[1].subTerm).toBe('Red apple')
      expect(entries[1].pageNumber).toBe('2')
      expect(entries[3].mainTerm).toBe('Banana')
      expect(entries[3].pageNumber).toBe('4')
    })

    it('should parse tab-separated entries', () => {
      const result = `Apple\t1
Banana\t2`
      const entries = parseIndexResult(result)
      expect(entries.length).toBe(2)
      expect(entries[0].mainTerm).toBe('Apple')
      expect(entries[0].pageNumber).toBe('1')
    })

    it('should handle entries without page numbers', () => {
      const result = `Apple
Banana`
      const entries = parseIndexResult(result)
      expect(entries.length).toBe(2)
      expect(entries[0].mainTerm).toBe('Apple')
      expect(entries[0].pageNumber).toBeUndefined()
    })

    it('should return empty array for empty result', () => {
      expect(parseIndexResult('')).toEqual([])
      expect(parseIndexResult('   \n   ')).toEqual([])
    })

    it('should handle CJK index entries', () => {
      const result = `苹果.................1
  红苹果...............2
香蕉..................3`
      const entries = parseIndexResult(result)
      expect(entries.length).toBe(3)
      expect(entries[0].mainTerm).toBe('苹果')
      expect(entries[0].pageNumber).toBe('1')
      expect(entries[1].mainTerm).toBe('苹果')
      expect(entries[1].subTerm).toBe('红苹果')
      expect(entries[2].mainTerm).toBe('香蕉')
    })
  })

  describe('parseTocInstruction', () => {
    it('should return empty options for empty instruction', () => {
      expect(parseTocInstruction('')).toEqual({})
      expect(parseTocInstruction('   ')).toEqual({})
    })

    it('should parse outline level range with quotes', () => {
      const opts = parseTocInstruction('TOC \\o "1-3" \\h \\z \\u')
      expect(opts.outlineLevels).toEqual({ start: 1, end: 3 })
      expect(opts.hyperlinks).toBe(true)
      expect(opts.hideTabLeader).toBe(true)
      expect(opts.useAppliedOutlineLevel).toBe(true)
    })

    it('should parse outline level range without quotes', () => {
      const opts = parseTocInstruction('TOC \\o 1-3')
      expect(opts.outlineLevels).toEqual({ start: 1, end: 3 })
    })

    it('should parse custom styles switch', () => {
      const opts = parseTocInstruction('TOC \\t "Heading 1;1;Heading 2;2"')
      expect(opts.customStyles).toBe('Heading 1;1;Heading 2;2')
    })

    it('should parse separator switch', () => {
      const opts = parseTocInstruction('TOC \\p "-"')
      expect(opts.separator).toBe('-')
    })

    it('should parse levelsOnly switch', () => {
      const opts = parseTocInstruction('TOC \\l "1-1"')
      expect(opts.levelsOnly).toEqual({ start: 1, end: 1 })
    })

    it('should parse boolean switches', () => {
      const opts = parseTocInstruction('TOC \\f \\h \\n \\z \\u')
      expect(opts.includeTc).toBe(true)
      expect(opts.hyperlinks).toBe(true)
      expect(opts.hidePageNumbers).toBe(true)
      expect(opts.hideTabLeader).toBe(true)
      expect(opts.useAppliedOutlineLevel).toBe(true)
    })

    it('should not set boolean switches when absent', () => {
      const opts = parseTocInstruction('TOC \\o "1-3"')
      expect(opts.includeTc).toBeUndefined()
      expect(opts.hyperlinks).toBeUndefined()
      expect(opts.hidePageNumbers).toBeUndefined()
      expect(opts.hideTabLeader).toBeUndefined()
      expect(opts.useAppliedOutlineLevel).toBeUndefined()
    })

    it('should handle complex instruction with all switches', () => {
      const opts = parseTocInstruction('TOC \\o "1-3" \\t "Custom;1" \\f \\p "—" \\h \\n \\z \\u \\l "2-2"')
      expect(opts.outlineLevels).toEqual({ start: 1, end: 3 })
      expect(opts.customStyles).toBe('Custom;1')
      expect(opts.includeTc).toBe(true)
      expect(opts.separator).toBe('—')
      expect(opts.hyperlinks).toBe(true)
      expect(opts.hidePageNumbers).toBe(true)
      expect(opts.hideTabLeader).toBe(true)
      expect(opts.useAppliedOutlineLevel).toBe(true)
      expect(opts.levelsOnly).toEqual({ start: 2, end: 2 })
    })

    it('should be case-insensitive for switch letters', () => {
      const opts = parseTocInstruction('TOC \\O "1-3" \\H \\Z')
      expect(opts.outlineLevels).toEqual({ start: 1, end: 3 })
      expect(opts.hyperlinks).toBe(true)
      expect(opts.hideTabLeader).toBe(true)
    })

    it('should not misinterpret unrelated text as switches', () => {
      // "officer" contains "o" but should not match \\o
      const opts = parseTocInstruction('TOC officer \\h')
      expect(opts.outlineLevels).toBeUndefined()
      expect(opts.hyperlinks).toBe(true)
    })
  })
})