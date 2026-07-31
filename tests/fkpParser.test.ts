import { describe, it, expect } from 'vitest'
import { parseChpxRunsFromFkp, parsePapxRunsFromFkp } from '../src/utils/formatParser'
import type { PieceFcRange } from '../src/utils/formatParser'

// ---- Spec-level fixtures (MS-DOC §2.4.2) ----
//
// Layout under test:
//   table stream: PlcBteChpx/PlcBtePapx = aFC[(n+1)] + aPnBte[n] (4 bytes each)
//   WordDocument stream: 512-byte FKPs at pn*512
//     ChpxFkp: rgfc[crun+1] + rgb[crun] (1 byte, word offset) + crun @ 511
//     PapxFkp: rgfc[cpara+1] + rgbx[cpara] (13 bytes, bOffset first) + cpara @ 511

function u32(view: DataView, offset: number, value: number) {
  view.setUint32(offset, value, true)
}

/** Build a table stream containing one bin-table entry pointing at page `pn`. */
function buildBinTable(fcStart: number, fcEnd: number, pn: number): Uint8Array {
  const buf = new Uint8Array(12)
  const view = new DataView(buf.buffer)
  u32(view, 0, fcStart)
  u32(view, 4, fcEnd)
  u32(view, 8, pn)
  return buf
}

/**
 * Build a WordDocument stream with a single ChpxFkp at page 1 (offset 512).
 * Two runs: [1024,1034) bold (grpprl sprmCFBold=1), [1034,1044) no CHPX.
 */
function buildChpxFkpStream(): Uint8Array {
  const stream = new Uint8Array(1024)
  const view = new DataView(stream.buffer)
  const base = 512
  const crun = 2
  // rgfc[3]
  u32(view, base + 0, 1024)
  u32(view, base + 4, 1034)
  u32(view, base + 8, 1044)
  // CHPX payload: cb=3, grpprl = sprmCFBold(0x0801) + operand 1
  // Placed at word offset 250 → byte 500
  stream[base + 500] = 3
  stream[base + 501] = 0x01
  stream[base + 502] = 0x08
  stream[base + 503] = 1
  // rgb[2] right after rgfc
  stream[base + 12] = 250 // run 0 → CHPX at byte 500
  stream[base + 13] = 0   // run 1 → no CHPX
  stream[base + 511] = crun
  return stream
}

/**
 * Build a WordDocument stream with a single PapxFkp at page 1.
 * Two paragraphs: [1024,1034) centered (sprmPJc=1) istd=5, [1034,1044) no PAPX.
 */
function buildPapxFkpStream(): Uint8Array {
  const stream = new Uint8Array(1024)
  const view = new DataView(stream.buffer)
  const base = 512
  const cpara = 2
  // rgfc[3]
  u32(view, base + 0, 1024)
  u32(view, base + 4, 1034)
  u32(view, base + 8, 1044)
  // PapxInFkp at word offset 248 → byte 496:
  //   cb=3 → payload 2*3-1 = 5 bytes: istd(2) + grpprl(3)
  //   grpprl = sprmPJc(0x2401) + operand 1 (center)
  stream[base + 496] = 3
  stream[base + 497] = 5    // istd low byte
  stream[base + 498] = 0    // istd high byte
  stream[base + 499] = 0x01
  stream[base + 500] = 0x24
  stream[base + 501] = 1
  // rgbx[2] (13 bytes each), bOffset is byte 0 of each entry
  stream[base + 12] = 248 // para 0 → PAPX at byte 496
  stream[base + 25] = 0   // para 1 → no PAPX
  stream[base + 511] = cpara
  return stream
}

/** One 8-bit piece: CP [0,100) ↔ FC [1024,1124). */
const PIECES_8BIT: PieceFcRange[] = [
  { cpStart: 0, cpEnd: 100, fcStart: 1024, compressed: true },
]

/** One UTF-16LE piece: CP [0,100) ↔ FC [1024,1224). */
const PIECES_UTF16: PieceFcRange[] = [
  { cpStart: 0, cpEnd: 100, fcStart: 1024, compressed: false },
]

describe('FKP parsing (spec-level bin table → FKP pages)', () => {
  describe('parseChpxRunsFromFkp', () => {
    it('parses bold run from a ChpxFkp and converts FC to CP (8-bit)', () => {
      const tableData = buildBinTable(1024, 1044, 1)
      const wordDoc = buildChpxFkpStream()
      const runs = parseChpxRunsFromFkp(tableData, wordDoc, 0, tableData.length, PIECES_8BIT)
      expect(runs).toHaveLength(1)
      expect(runs[0].cpStart).toBe(0)
      expect(runs[0].cpEnd).toBe(10)
      expect(runs[0].format.bold).toBe(true)
    })

    it('converts FC to CP for UTF-16LE pieces (2 bytes per char)', () => {
      const tableData = buildBinTable(1024, 1044, 1)
      const wordDoc = buildChpxFkpStream()
      const runs = parseChpxRunsFromFkp(tableData, wordDoc, 0, tableData.length, PIECES_UTF16)
      expect(runs).toHaveLength(1)
      expect(runs[0].cpStart).toBe(0)
      expect(runs[0].cpEnd).toBe(5) // 10 bytes / 2
      expect(runs[0].format.bold).toBe(true)
    })

    it('splits an FC range that spans two pieces into two CP runs', () => {
      const tableData = buildBinTable(1024, 1044, 1)
      const wordDoc = buildChpxFkpStream()
      const pieces: PieceFcRange[] = [
        { cpStart: 0, cpEnd: 5, fcStart: 1024, compressed: true },   // FC [1024,1029)
        { cpStart: 50, cpEnd: 55, fcStart: 1029, compressed: true }, // FC [1029,1034)
      ]
      const runs = parseChpxRunsFromFkp(tableData, wordDoc, 0, tableData.length, pieces)
      expect(runs).toHaveLength(2)
      expect(runs[0].cpStart).toBe(0)
      expect(runs[0].cpEnd).toBe(5)
      expect(runs[1].cpStart).toBe(50)
      expect(runs[1].cpEnd).toBe(55)
    })

    it('returns empty for empty pieces or malformed bin table', () => {
      const tableData = buildBinTable(1024, 1044, 1)
      const wordDoc = buildChpxFkpStream()
      expect(parseChpxRunsFromFkp(tableData, wordDoc, 0, tableData.length, [])).toEqual([])
      // fcEnd <= fcStart → invalid bin table
      const bad = buildBinTable(1044, 1024, 1)
      expect(parseChpxRunsFromFkp(bad, wordDoc, 0, bad.length, PIECES_8BIT)).toEqual([])
    })

    it('ignores pages that lie outside the WordDocument stream', () => {
      const tableData = buildBinTable(1024, 1044, 99) // pn 99 → offset 50688
      const wordDoc = buildChpxFkpStream()
      expect(parseChpxRunsFromFkp(tableData, wordDoc, 0, tableData.length, PIECES_8BIT)).toEqual([])
    })
  })

  describe('parsePapxRunsFromFkp', () => {
    it('parses istd and alignment from a PapxFkp (cb != 0 form)', () => {
      const tableData = buildBinTable(1024, 1044, 1)
      const wordDoc = buildPapxFkpStream()
      const runs = parsePapxRunsFromFkp(tableData, wordDoc, 0, tableData.length, PIECES_8BIT)
      expect(runs).toHaveLength(1)
      expect(runs[0].cpStart).toBe(0)
      expect(runs[0].cpEnd).toBe(10)
      expect(runs[0].istd).toBe(5)
      expect(runs[0].format.alignment).toBe('center')
    })

    it('parses the cb == 0 / cb-prime form', () => {
      const tableData = buildBinTable(1024, 1044, 1)
      const wordDoc = buildPapxFkpStream()
      const base = 512
      // Rewrite the PapxInFkp with the cb==0 form: cb=0, cb'=3 → payload 6
      // bytes: istd(2) + grpprl(4) = sprmPJc + jc(2=right) + padding sprm skipped
      wordDoc[base + 496] = 0
      wordDoc[base + 497] = 3 // cb' → payload 6 bytes
      wordDoc[base + 498] = 7 // istd low
      wordDoc[base + 499] = 0 // istd high
      wordDoc[base + 500] = 0x01
      wordDoc[base + 501] = 0x24
      wordDoc[base + 502] = 2 // right
      wordDoc[base + 503] = 0 // trailing pad
      const runs = parsePapxRunsFromFkp(tableData, wordDoc, 0, tableData.length, PIECES_8BIT)
      expect(runs).toHaveLength(1)
      expect(runs[0].istd).toBe(7)
      expect(runs[0].format.alignment).toBe('right')
    })

    it('returns empty when cpara is zero', () => {
      const tableData = buildBinTable(1024, 1044, 1)
      const wordDoc = buildPapxFkpStream()
      wordDoc[512 + 511] = 0
      expect(parsePapxRunsFromFkp(tableData, wordDoc, 0, tableData.length, PIECES_8BIT)).toEqual([])
    })
  })
})
