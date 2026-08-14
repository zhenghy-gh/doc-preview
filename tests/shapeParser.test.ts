import { describe, it, expect } from 'vitest'
import { extractShapesFromDataStream, extractShapesFromWordDocumentStream, spidToShapeType } from '../src/utils/shapeParser'

/** Write a little-endian u16 into a buffer. */
function writeU16(data: Uint8Array, off: number, v: number) {
  data[off] = v & 0xff
  data[off + 1] = (v >> 8) & 0xff
}

/** Write a little-endian u32 into a buffer. */
function writeU32(data: Uint8Array, off: number, v: number) {
  data[off] = v & 0xff
  data[off + 1] = (v >> 8) & 0xff
  data[off + 2] = (v >> 16) & 0xff
  data[off + 3] = (v >> 24) & 0xff
}

/** Write an OfficeArtRecordHeader at off. recVer=3 is required by the FDG magic scan. */
function writeRecHeader(data: Uint8Array, off: number, recVer: number, recInstance: number, recType: number, recLen: number) {
  data[off] = (recVer << 6) | ((recInstance >> 8) & 0x3F)
  data[off + 1] = recInstance & 0xff
  data[off + 2] = recType & 0xff
  data[off + 3] = (recType >> 8) & 0xff
  writeU32(data, off + 4, recLen)
}

/**
 * Build a complete OfficeArt structure:
 *   FDG → DG container → SP container → [SP, FillPicture, LinePicture, BlkPicture, ClientData]
 */
function buildShapeBuffer(options: {
  spid?: number
  grfSp?: number
  includeClientData?: boolean
  includePictures?: boolean
  spRecLen?: number
} = {}): { buffer: Uint8Array; spid: number } {
  const {
    spid = 0x50000001,
    grfSp = 0x0001,
    includeClientData = true,
    includePictures = true,
    spRecLen = 72,
  } = options

  const SP_SIZE = 8 + spRecLen
  const FILL_SIZE = includePictures ? 8 + 4 : 0
  const LINE_SIZE = includePictures ? 8 + 4 : 0
  const BLK_SIZE = includePictures ? 8 + 4 : 0
  const CD_SIZE = includeClientData ? 8 + 8 : 0
  const spContainerLen = SP_SIZE + FILL_SIZE + LINE_SIZE + BLK_SIZE + CD_SIZE
  const dgLen = 8 + spContainerLen
  const fdgLen = 8 + dgLen
  const total = 8 + fdgLen

  const buffer = new Uint8Array(total + 64) // extra slack so scans do not run past data
  let off = 0

  // FDG — recInstance bit 6-7 set (0x00C0) so the little-endian magic scan
  // `(readUint16 & 0xC000) === 0xC000` in extractShapesFrom* matches.
  writeRecHeader(buffer, off, 3, 0x00C0, 0xF000, fdgLen)
  off += 8
  // DG container
  writeRecHeader(buffer, off, 3, 0, 0xF002, dgLen)
  off += 8
  // SP container
  writeRecHeader(buffer, off, 3, 0, 0xF003, spContainerLen)
  off += 8
  // SP record: spid(4) + grfSp(2) + reserved(2) + xfrm(60)
  writeRecHeader(buffer, off, 3, 0, 0x0004, spRecLen)
  off += 8
  writeU32(buffer, off, spid)
  writeU16(buffer, off + 4, grfSp)
  // xfrm layout used by parseXfrm: x at +4, y at +8, width at +28, height at +32
  writeU32(buffer, off + 8 + 4, 100)  // x
  writeU32(buffer, off + 8 + 8, 200)  // y
  writeU32(buffer, off + 8 + 28, 300) // width
  writeU32(buffer, off + 8 + 32, 400) // height
  off += SP_SIZE

  if (includePictures) {
    // Fill picture record with fcPic
    writeRecHeader(buffer, off, 3, 0, 0x0016, 4)
    writeU32(buffer, off + 8, 0x12345678)
    off += FILL_SIZE
    // Line picture record
    writeRecHeader(buffer, off, 3, 0, 0x0017, 4)
    writeU32(buffer, off + 8, 0x0ABCDEF0)
    off += LINE_SIZE
    // Blk picture record
    writeRecHeader(buffer, off, 3, 0, 0x0018, 4)
    writeU32(buffer, off + 8, 0x11111111)
    off += BLK_SIZE
  }

  if (includeClientData) {
    // ClientData with anchor CP — recLen must be >= 8 for the parser to read it
    writeRecHeader(buffer, off, 3, 0, 0x0010, 8)
    writeU32(buffer, off + 8, 42)
  }

  return { buffer, spid }
}

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

    it('should parse a full FDG→DG→SP container chain', () => {
      const { buffer, spid } = buildShapeBuffer()
      const shapes = extractShapesFromDataStream(buffer)
      expect(shapes).toHaveLength(1)
      const shape = shapes[0]
      expect(shape.spid).toBe(spid)
      expect(shape.type).toBe('picture')
      expect(shape.floating).toBe(true)
      expect(shape.x).toBe(100)
      expect(shape.y).toBe(200)
      expect(shape.width).toBe(300)
      expect(shape.height).toBe(400)
      expect(shape.hasPicture).toBe(true)
      // Three picture records (FILL/LINE/BLK) each set fcPic; the last one wins.
      expect(shape.fcPic).toBe(0x11111111)
      expect(shape.anchorCp).toBe(42)
      expect(shape.anchorType).toBe('char')
    })

    it('should set floating=false when grfSp bit 0 is clear', () => {
      const { buffer } = buildShapeBuffer({ grfSp: 0x0000 })
      const shapes = extractShapesFromDataStream(buffer)
      expect(shapes[0].floating).toBe(false)
    })

    it('should skip shapes with recLen < 72 (no valid SP record)', () => {
      const { buffer } = buildShapeBuffer({ spRecLen: 60 })
      const shapes = extractShapesFromDataStream(buffer)
      expect(shapes).toEqual([])
    })

    it('should leave anchorType unknown when ClientData is absent', () => {
      const { buffer } = buildShapeBuffer({ includeClientData: false })
      const shapes = extractShapesFromDataStream(buffer)
      expect(shapes).toHaveLength(1)
      expect(shapes[0].anchorCp).toBeUndefined()
      expect(shapes[0].anchorType).toBe('unknown')
    })

    it('should leave hasPicture unset when no picture records exist', () => {
      const { buffer } = buildShapeBuffer({ includePictures: false })
      const shapes = extractShapesFromDataStream(buffer)
      expect(shapes[0].hasPicture).toBeUndefined()
      expect(shapes[0].fcPic).toBeUndefined()
    })

    it('should deduplicate shapes by spid', () => {
      const { buffer, spid } = buildShapeBuffer()
      // Append a second FDG with the same spid (no anchor this time)
      const second = buildShapeBuffer({ spid, includeClientData: false })
      const combined = new Uint8Array(buffer.length + second.buffer.length)
      combined.set(buffer)
      combined.set(second.buffer, buffer.length)
      const shapes = extractShapesFromDataStream(combined)
      expect(shapes).toHaveLength(1)
    })

    it('should parse multiple distinct shapes', () => {
      const first = buildShapeBuffer({ spid: 0x40000001 })
      const second = buildShapeBuffer({ spid: 0x10000002 })
      const combined = new Uint8Array(first.buffer.length + second.buffer.length)
      combined.set(first.buffer)
      combined.set(second.buffer, first.buffer.length)
      const shapes = extractShapesFromDataStream(combined)
      expect(shapes).toHaveLength(2)
      expect(shapes.map(s => s.spid).sort((a, b) => a - b)).toEqual([0x10000002, 0x40000001])
    })

    it('should handle truncated records without throwing', () => {
      const { buffer } = buildShapeBuffer()
      const truncated = buffer.slice(0, buffer.length - 30)
      expect(() => extractShapesFromDataStream(truncated)).not.toThrow()
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

    it('should parse a full FDG→DG→SP container chain', () => {
      const { buffer, spid } = buildShapeBuffer()
      const shapes = extractShapesFromWordDocumentStream(buffer)
      expect(shapes).toHaveLength(1)
      expect(shapes[0].spid).toBe(spid)
      expect(shapes[0].type).toBe('picture')
      expect(shapes[0].anchorCp).toBe(42)
    })

    it('should ignore non-FDG Office Art records', () => {
      const { buffer } = buildShapeBuffer()
      // Patch the FDG record type to something else (0xF001)
      buffer[2] = 0x01
      buffer[3] = 0xF0
      const shapes = extractShapesFromWordDocumentStream(buffer)
      expect(shapes).toEqual([])
    })
  })
})
