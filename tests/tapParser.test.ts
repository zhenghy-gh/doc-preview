import { describe, it, expect } from 'vitest'
import { parsePapxRuns } from '../src/utils/formatParser'

/**
 * Build a PlcfBtePapx test fixture with optional TAP SPRMs.
 *
 * Each entry can carry:
 *   - cpStart: paragraph CP start
 *   - istd: style index
 *   - inTable: if true, emit sprmPFInTable (0x240C) = 1
 *   - tableDepth: if set, emit sprmPTableDepth (0x4410) = depth
 *   - cells: TableCellInfo[] → emit sprmTDefTable (0xD608) with rgtc[]
 *       each cell: { verticalMerge: 'none' | 'restart' | 'continue' }
 *   - borders: TableBorders → emit sprmTTableBorders (0xD612) with 6 Brc
 */
function buildPlcfBtePapxWithTable(entries: Array<{
  cpStart: number
  istd?: number
  inTable?: boolean
  tableDepth?: number
  cells?: Array<{ verticalMerge: 'none' | 'restart' | 'continue' }>
  borders?: {
    top?: { colorIndex?: number; lineWidth?: number; borderType?: number }
    left?: { colorIndex?: number; lineWidth?: number; borderType?: number }
    bottom?: { colorIndex?: number; lineWidth?: number; borderType?: number }
    right?: { colorIndex?: number; lineWidth?: number; borderType?: number }
    insideH?: { colorIndex?: number; lineWidth?: number; borderType?: number }
    insideV?: { colorIndex?: number; lineWidth?: number; borderType?: number }
  }
}>): Uint8Array {
  const n = entries.length
  const aPcbParts: Uint8Array[] = []

  for (const entry of entries) {
    const prls: number[] = []

    if (entry.inTable) {
      // sprmPFInTable = 0x240C, toggle (1 byte)
      prls.push(0x0C, 0x24, 0x01)
    }
    if (entry.tableDepth !== undefined) {
      // sprmPTableDepth = 0x4410, 1 byte
      prls.push(0x10, 0x44, entry.tableDepth & 0xFF)
    }
    if (entry.cells && entry.cells.length > 0) {
      // sprmTDefTable = 0xD608, variable length (spra=6)
      // Layout:
      //   byte 0: cb (后续数据长度，不含此字节)
      //   byte 1: itcMac
      //   bytes 2..: rgdxaCenter[itcMac+1] (每个 2 字节)
      //   bytes 后: rgtc[itcMac] (每个 20 字节)
      const itcMac = entry.cells.length
      const rgdxaSize = (itcMac + 1) * 2
      const rgtcSize = itcMac * 20
      const payloadSize = 1 + rgdxaSize + rgtcSize
      prls.push(0x08, 0xD6, payloadSize & 0xFF)
      // itcMac
      prls.push(itcMac & 0xFF)
      // rgdxaCenter: 简单递增的列边界（每个 1000 缇）
      for (let i = 0; i <= itcMac; i++) {
        const dxa = i * 1000
        prls.push(dxa & 0xFF, (dxa >> 8) & 0xFF)
      }
      // rgtc: 每个 TC 20 字节，前 4 字节是位域，bits 0-2 = fVertMerge
      for (const cell of entry.cells) {
        const fVertMerge = cell.verticalMerge === 'none' ? 0
          : cell.verticalMerge === 'continue' ? 1
            : 2
        // TC 的前 4 字节（位域），其余 16 字节填 0
        prls.push(fVertMerge & 0x07, 0x00, 0x00, 0x00)
        for (let j = 0; j < 16; j++) prls.push(0x00)
      }
    }
    if (entry.borders) {
      // sprmTTableBorders = 0xD612, variable length (spra=6)
      // Layout:
      //   byte 0: cb (后续长度 = 6 * 4 = 24)
      //   之后: 6 个 Brc (每个 4 字节): top, left, bottom, right, insideH, insideV
      const order = ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'] as const
      const payloadSize = 6 * 4
      prls.push(0x12, 0xD6, payloadSize & 0xFF)
      for (const key of order) {
        const b = entry.borders[key]
        if (!b) {
          // 4 字节 0 = 无边框
          prls.push(0x00, 0x00, 0x00, 0x00)
          continue
        }
        // Brc 4 字节:
        //   bits 0-7: dptLineWidth (1/8 pt)
        //   bits 8-11: brcType
        //   bits 12-15: ico (colorIndex)
        const lineWidth = b.lineWidth ?? 0
        const borderType = b.borderType ?? 0
        const colorIndex = b.colorIndex ?? 0
        const dword = (lineWidth & 0xFF) | ((borderType & 0x0F) << 8) | ((colorIndex & 0x0F) << 12)
        prls.push(dword & 0xFF, (dword >> 8) & 0xFF, (dword >> 16) & 0xFF, (dword >> 24) & 0xFF)
      }
    }

    const grpprlSize = prls.length
    const istd = entry.istd ?? 0
    const cbOffset = 4 + grpprlSize
    const papx = new Uint8Array(cbOffset)
    papx[0] = cbOffset & 0xFF
    papx[1] = (cbOffset >> 8) & 0xFF
    papx[2] = istd & 0xFF
    papx[3] = (istd >> 8) & 0xFF
    for (let i = 0; i < grpprlSize; i++) {
      papx[4 + i] = prls[i]
    }
    aPcbParts.push(papx)
  }

  const aPcbLen = aPcbParts.reduce((sum, p) => sum + p.length, 0)
  const totalLen = (n + 1) * 4 + aPcbLen
  const result = new Uint8Array(totalLen)

  for (let i = 0; i < n; i++) {
    const cp = entries[i].cpStart
    const offset = i * 4
    result[offset] = cp & 0xFF
    result[offset + 1] = (cp >> 8) & 0xFF
    result[offset + 2] = (cp >> 16) & 0xFF
    result[offset + 3] = (cp >> 24) & 0xFF
  }
  const lastCp = entries[n - 1].cpStart + 50
  const lastOffset = n * 4
  result[lastOffset] = lastCp & 0xFF
  result[lastOffset + 1] = (lastCp >> 8) & 0xFF
  result[lastOffset + 2] = (lastCp >> 16) & 0xFF
  result[lastOffset + 3] = (lastCp >> 24) & 0xFF

  let pcbOffset = (n + 1) * 4
  for (const papx of aPcbParts) {
    result.set(papx, pcbOffset)
    pcbOffset += papx.length
  }

  return result
}

describe('TAP SPRM parsing (sprmPFInTable / sprmTDefTable / sprmTTableBorders)', () => {
  it('should return no table info for paragraphs without TAP SPRMs', () => {
    const data = buildPlcfBtePapxWithTable([
      { cpStart: 0 },
    ])
    const runs = parsePapxRuns(data, 0, data.length)
    expect(runs.length).toBe(1)
    expect(runs[0].table).toBeUndefined()
  })

  it('should parse sprmPFInTable (0x240C) toggle', () => {
    const data = buildPlcfBtePapxWithTable([
      { cpStart: 0, inTable: true },
    ])
    const runs = parsePapxRuns(data, 0, data.length)
    expect(runs.length).toBe(1)
    expect(runs[0].table).toBeDefined()
    expect(runs[0].table!.inTable).toBe(true)
  })

  it('should parse sprmPTableDepth (0x4410)', () => {
    const data = buildPlcfBtePapxWithTable([
      { cpStart: 0, inTable: true, tableDepth: 2 },
    ])
    const runs = parsePapxRuns(data, 0, data.length)
    expect(runs[0].table!.depth).toBe(2)
  })

  it('should set inTable=true when only tableDepth is present', () => {
    const data = buildPlcfBtePapxWithTable([
      { cpStart: 0, tableDepth: 1 },
    ])
    const runs = parsePapxRuns(data, 0, data.length)
    expect(runs[0].table).toBeDefined()
    expect(runs[0].table!.inTable).toBe(true)
    expect(runs[0].table!.depth).toBe(1)
  })

  it('should parse sprmTDefTable with all-none verticalMerge', () => {
    const data = buildPlcfBtePapxWithTable([
      {
        cpStart: 0,
        inTable: true,
        cells: [
          { verticalMerge: 'none' },
          { verticalMerge: 'none' },
          { verticalMerge: 'none' },
        ],
      },
    ])
    const runs = parsePapxRuns(data, 0, data.length)
    expect(runs[0].table!.cells).toBeDefined()
    expect(runs[0].table!.cells!.length).toBe(3)
    expect(runs[0].table!.cells![0]).toEqual({ column: 0, verticalMerge: 'none' })
    expect(runs[0].table!.cells![1]).toEqual({ column: 1, verticalMerge: 'none' })
    expect(runs[0].table!.cells![2]).toEqual({ column: 2, verticalMerge: 'none' })
  })

  it('should parse sprmTDefTable with restart and continue merge states', () => {
    const data = buildPlcfBtePapxWithTable([
      {
        cpStart: 0,
        inTable: true,
        cells: [
          { verticalMerge: 'restart' },
          { verticalMerge: 'continue' },
          { verticalMerge: 'none' },
        ],
      },
    ])
    const runs = parsePapxRuns(data, 0, data.length)
    expect(runs[0].table!.cells!.length).toBe(3)
    expect(runs[0].table!.cells![0].verticalMerge).toBe('restart')
    expect(runs[0].table!.cells![1].verticalMerge).toBe('continue')
    expect(runs[0].table!.cells![2].verticalMerge).toBe('none')
    // Column indices should be 0-based sequential.
    expect(runs[0].table!.cells![0].column).toBe(0)
    expect(runs[0].table!.cells![1].column).toBe(1)
    expect(runs[0].table!.cells![2].column).toBe(2)
  })

  it('should parse sprmTTableBorders with all 6 borders', () => {
    const data = buildPlcfBtePapxWithTable([
      {
        cpStart: 0,
        inTable: true,
        borders: {
          top: { colorIndex: 1, lineWidth: 8, borderType: 1 },      // 1pt solid black
          left: { colorIndex: 2, lineWidth: 4, borderType: 1 },     // 0.5pt solid blue
          bottom: { colorIndex: 1, lineWidth: 8, borderType: 1 },
          right: { colorIndex: 2, lineWidth: 4, borderType: 1 },
          insideH: { colorIndex: 1, lineWidth: 4, borderType: 1 },
          insideV: { colorIndex: 1, lineWidth: 4, borderType: 1 },
        },
      },
    ])
    const runs = parsePapxRuns(data, 0, data.length)
    expect(runs[0].table!.borders).toBeDefined()
    expect(runs[0].table!.borders!.top).toEqual({ colorIndex: 1, lineWidth: 8, borderType: 1 })
    expect(runs[0].table!.borders!.left).toEqual({ colorIndex: 2, lineWidth: 4, borderType: 1 })
    expect(runs[0].table!.borders!.insideH).toEqual({ colorIndex: 1, lineWidth: 4, borderType: 1 })
    expect(runs[0].table!.borders!.insideV).toEqual({ colorIndex: 1, lineWidth: 4, borderType: 1 })
  })

  it('should skip zero (empty) borders in sprmTTableBorders', () => {
    const data = buildPlcfBtePapxWithTable([
      {
        cpStart: 0,
        inTable: true,
        borders: {
          top: { colorIndex: 1, lineWidth: 8, borderType: 1 },
          // left, bottom, right, insideH, insideV all zero → omitted
        },
      },
    ])
    const runs = parsePapxRuns(data, 0, data.length)
    expect(runs[0].table!.borders!.top).toEqual({ colorIndex: 1, lineWidth: 8, borderType: 1 })
    expect(runs[0].table!.borders!.left).toBeUndefined()
    expect(runs[0].table!.borders!.bottom).toBeUndefined()
    expect(runs[0].table!.borders!.insideH).toBeUndefined()
  })

  it('should combine inTable + tableDepth + cells + borders in one paragraph', () => {
    const data = buildPlcfBtePapxWithTable([
      {
        cpStart: 0,
        inTable: true,
        tableDepth: 1,
        cells: [
          { verticalMerge: 'restart' },
          { verticalMerge: 'none' },
        ],
        borders: {
          top: { colorIndex: 1, lineWidth: 8, borderType: 1 },
          bottom: { colorIndex: 1, lineWidth: 8, borderType: 1 },
        },
      },
    ])
    const runs = parsePapxRuns(data, 0, data.length)
    const table = runs[0].table!
    expect(table.inTable).toBe(true)
    expect(table.depth).toBe(1)
    expect(table.cells!.length).toBe(2)
    expect(table.cells![0].verticalMerge).toBe('restart')
    expect(table.cells![1].verticalMerge).toBe('none')
    expect(table.borders!.top).toEqual({ colorIndex: 1, lineWidth: 8, borderType: 1 })
    expect(table.borders!.bottom).toEqual({ colorIndex: 1, lineWidth: 8, borderType: 1 })
  })

  it('should handle multiple table rows with merge across rows', () => {
    // Row 0: cell 0 = restart (merge start), cell 1 = none
    // Row 1: cell 0 = continue (merged into row 0), cell 1 = none
    const data = buildPlcfBtePapxWithTable([
      {
        cpStart: 0,
        inTable: true,
        cells: [
          { verticalMerge: 'restart' },
          { verticalMerge: 'none' },
        ],
      },
      {
        cpStart: 50,
        inTable: true,
        cells: [
          { verticalMerge: 'continue' },
          { verticalMerge: 'none' },
        ],
      },
    ])
    const runs = parsePapxRuns(data, 0, data.length)
    expect(runs.length).toBe(2)
    expect(runs[0].table!.cells![0].verticalMerge).toBe('restart')
    expect(runs[1].table!.cells![0].verticalMerge).toBe('continue')
  })

  it('should not crash on malformed sprmTDefTable (zero itcMac)', () => {
    // Manually craft a PAPX with sprmTDefTable whose itcMac = 0.
    const prls: number[] = []
    // sprmPFInTable
    prls.push(0x0C, 0x24, 0x01)
    // sprmTDefTable = 0xD608, cb=1, itcMac=0
    prls.push(0x08, 0xD6, 0x01, 0x00)
    const grpprlSize = prls.length
    const cbOffset = 4 + grpprlSize
    const papx = new Uint8Array(cbOffset)
    papx[0] = cbOffset & 0xFF
    papx[1] = (cbOffset >> 8) & 0xFF
    papx[2] = 0x00 // istd low
    papx[3] = 0x00 // istd high
    for (let i = 0; i < grpprlSize; i++) papx[4 + i] = prls[i]

    // Wrap in a PlcfBtePapx with 1 entry.
    const totalLen = 8 + papx.length
    const data = new Uint8Array(totalLen)
    // aCP[0] = 0
    data[0] = 0; data[1] = 0; data[2] = 0; data[3] = 0
    // aCP[1] = 50
    data[4] = 50; data[5] = 0; data[6] = 0; data[7] = 0
    data.set(papx, 8)

    const runs = parsePapxRuns(data, 0, data.length)
    expect(runs.length).toBe(1)
    expect(runs[0].table).toBeDefined()
    expect(runs[0].table!.inTable).toBe(true)
    // cells should be empty (itcMac=0 → no cells)
    expect(runs[0].table!.cells).toBeUndefined()
  })

  it('should not crash on malformed sprmTTableBorders (truncated payload)', () => {
    // Craft a PAPX with sprmTTableBorders whose payload is too short.
    const prls: number[] = []
    prls.push(0x0C, 0x24, 0x01) // sprmPFInTable
    // sprmTTableBorders = 0xD612, cb=4 (too short, need 24)
    prls.push(0x12, 0xD6, 0x04, 0x00, 0x00, 0x00, 0x00)
    const grpprlSize = prls.length
    const cbOffset = 4 + grpprlSize
    const papx = new Uint8Array(cbOffset)
    papx[0] = cbOffset & 0xFF
    papx[1] = (cbOffset >> 8) & 0xFF
    papx[2] = 0x00
    papx[3] = 0x00
    for (let i = 0; i < grpprlSize; i++) papx[4 + i] = prls[i]

    const totalLen = 8 + papx.length
    const data = new Uint8Array(totalLen)
    data[0] = 0; data[1] = 0; data[2] = 0; data[3] = 0
    data[4] = 50; data[5] = 0; data[6] = 0; data[7] = 0
    data.set(papx, 8)

    const runs = parsePapxRuns(data, 0, data.length)
    expect(runs.length).toBe(1)
    expect(runs[0].table).toBeDefined()
    expect(runs[0].table!.inTable).toBe(true)
    // borders should be null (truncated) → not set
    expect(runs[0].table!.borders).toBeUndefined()
  })
})
