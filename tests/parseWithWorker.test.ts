import { describe, it, expect, vi, afterEach } from 'vitest'
import { parseWithWorker } from '../src/utils/parseWithWorker'

/** Minimal OLE2 fixture that DocParser can parse (from docParser.test.ts). */
function buildValidOleBuffer(): ArrayBuffer {
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

  view[0] = 0xD0; view[1] = 0xCF; view[2] = 0x11; view[3] = 0xE0
  view[4] = 0xA1; view[5] = 0xB1; view[6] = 0x1A; view[7] = 0xE1
  writeU16(26, 3)
  writeU16(30, 9)
  writeU16(32, 6)
  writeU32(48, 1)
  writeU32(56, 4096)
  writeU32(60, 0xFFFFFFFE)
  writeU32(64, 0)
  writeU32(68, 0xFFFFFFFE)
  writeU32(72, 0)
  writeU32(76, 0)
  for (let i = 1; i < 109; i++) writeU32(76 + i * 4, 0xFFFFFFFF)

  const fatBase = SECTOR
  writeU32(fatBase + 0 * 4, 0xFFFFFFFE)
  writeU32(fatBase + 1 * 4, 0xFFFFFFFE)
  writeU32(fatBase + 2 * 4, 0xFFFFFFFE)
  writeU32(fatBase + 3 * 4, 0xFFFFFFFE)
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
  const textLength = 11
  writeU32(36 + 12 + wdBase, textLength)
  writeU16(124 + wdBase, 34)
  const clxSize = 32
  writeU32(390 + wdBase, 0)
  writeU32(394 + wdBase, clxSize)
  const textOffset = 400
  const text = 'Hello World'
  for (let i = 0; i < text.length; i++) writeU16(textOffset + i * 2 + wdBase, text.charCodeAt(i))

  const tblBase = SECTOR * 4
  view[tblBase + 0] = 0x02
  writeU32(tblBase + 1, 16)
  writeU32(tblBase + 5, 0)
  writeU32(tblBase + 9, textLength)
  writeU32(tblBase + 13 + 2, textOffset)

  return buf
}

/** A controllable Worker mock that records instances. */
class MockWorker {
  static instances: MockWorker[] = []
  static behavior: 'success' | 'error' | 'progress' = 'success'
  onmessage: ((e: { data: any }) => void) | null = null
  onerror: (() => void) | null = null
  terminated = false
  posted: Array<{ buffer: ArrayBuffer; maxScanBytes?: number }> = []

  constructor(_url: URL, _opts?: any) {
    MockWorker.instances.push(this)
    // Simulate async worker response
    setTimeout(() => {
      if (this.terminated) return
      if (MockWorker.behavior === 'error') {
        this.onerror?.()
        return
      }
      if (MockWorker.behavior === 'progress') {
        this.onmessage?.({ data: { type: 'progress', stage: 'parsing_fib', percent: 30 } })
        this.onmessage?.({ data: { type: 'progress', stage: 'finalizing', percent: 100 } })
      }
      this.onmessage?.({
        data: {
          type: 'result',
          success: true,
          document: { paragraphs: [{ text: 'Hi' }] },
          text: 'Hi',
          error: undefined,
        },
      })
    }, 0)
  }

  postMessage(msg: { buffer: ArrayBuffer; maxScanBytes?: number }, _transfer?: any[]) {
    this.posted.push(msg)
  }

  terminate() {
    this.terminated = true
  }
}

describe('parseWithWorker', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    MockWorker.instances = []
    MockWorker.behavior = 'success'
  })

  it('should fall back to main-thread parsing for empty buffer', async () => {
    const result = await parseWithWorker(new ArrayBuffer(0))
    expect(result.success).toBe(false)
    expect(result.error).toBeTruthy()
  })

  it('should fall back to main-thread parsing for non-OLE data', async () => {
    const buf = new ArrayBuffer(512)
    const view = new Uint8Array(buf)
    for (let i = 0; i < buf.byteLength; i++) view[i] = 0xFF
    const result = await parseWithWorker(buf)
    expect(result.success).toBe(false)
    expect(result.error).toBeTruthy()
  })

  it('should reject DOCX (ZIP) signature', async () => {
    const buf = new ArrayBuffer(512)
    const view = new Uint8Array(buf)
    view[0] = 0x50; view[1] = 0x4B; view[2] = 0x03; view[3] = 0x04
    const result = await parseWithWorker(buf)
    expect(result.success).toBe(false)
    expect(result.error).toContain('docx')
  })

  it('should accept custom maxScanBytes', async () => {
    const result = await parseWithWorker(new ArrayBuffer(4), 1024)
    expect(result).toBeDefined()
  })

  it('should resolve successfully via the worker result message', async () => {
    vi.stubGlobal('Worker', MockWorker)
    const result = await parseWithWorker(new ArrayBuffer(64))
    expect(result.success).toBe(true)
    expect(result.text).toBe('Hi')
    expect(result.document).toBeDefined()
    // Worker should be terminated after the result
    expect(MockWorker.instances[0].terminated).toBe(true)
    // Buffer should be transferred
    expect(MockWorker.instances[0].posted[0].buffer).toBeInstanceOf(ArrayBuffer)
  })

  it('should forward progress messages to the callback', async () => {
    vi.stubGlobal('Worker', MockWorker)
    MockWorker.behavior = 'progress'
    const stages: Array<[string, number]> = []
    const result = await parseWithWorker(new ArrayBuffer(64), undefined, (stage, percent) => {
      stages.push([stage, percent])
    })
    expect(result.success).toBe(true)
    expect(stages).toEqual([
      ['parsing_fib', 30],
      ['finalizing', 100],
    ])
  })

  it('should fall back to main-thread parsing when the worker errors', async () => {
    vi.stubGlobal('Worker', MockWorker)
    MockWorker.behavior = 'error'
    const result = await parseWithWorker(buildValidOleBuffer())
    expect(result.success).toBe(true)
    expect(result.text).toContain('Hello World')
  })

  it('should fall back to main-thread parsing when Worker constructor throws', async () => {
    class ThrowingWorker {
      constructor() {
        throw new Error('workers unsupported')
      }
    }
    vi.stubGlobal('Worker', ThrowingWorker)
    const result = await parseWithWorker(buildValidOleBuffer())
    expect(result.success).toBe(true)
    expect(result.text).toContain('Hello World')
  })

  it('should fall back to main-thread parsing and report failure for garbage buffer', async () => {
    class ThrowingWorker {
      constructor() {
        throw new Error('workers unsupported')
      }
    }
    vi.stubGlobal('Worker', ThrowingWorker)
    const buf = new ArrayBuffer(512)
    new Uint8Array(buf).fill(0xFF)
    const result = await parseWithWorker(buf)
    expect(result.success).toBe(false)
    expect(result.error).toBeTruthy()
  })

  it('should pass maxScanBytes to the worker', async () => {
    vi.stubGlobal('Worker', MockWorker)
    await parseWithWorker(new ArrayBuffer(64), 777)
    expect(MockWorker.instances[0].posted[0].maxScanBytes).toBe(777)
  })
})

describe('parseWithWorker timeout and crash paths', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('should fall back to main-thread parsing when the worker times out', async () => {
    class SilentWorker {
      onmessage: ((e: { data: any }) => void) | null = null
      onerror: (() => void) | null = null
      terminated = false
      postMessage() { /* never responds */ }
      terminate() { this.terminated = true }
    }
    vi.stubGlobal('Worker', SilentWorker)
    vi.useFakeTimers()
    const promise = parseWithWorker(buildValidOleBuffer())
    await vi.advanceTimersByTimeAsync(30_000)
    const result = await promise
    expect(result.success).toBe(true)
    expect(result.text).toContain('Hello World')
    expect(MockWorker.instances.length).toBe(0)
  })

  it('should report failure when main-thread fallback parsing throws', async () => {
    class ThrowingWorker {
      constructor() {
        throw new Error('workers unsupported')
      }
    }
    vi.stubGlobal('Worker', ThrowingWorker)
    vi.resetModules()
    vi.doMock('../src/utils/docParser', () => ({
      DocParser: class {
        constructor() {
          throw new Error('synthetic crash')
        }
      },
    }))
    const { parseWithWorker: reloaded } = await import('../src/utils/parseWithWorker')
    const result = await reloaded(new ArrayBuffer(64))
    expect(result.success).toBe(false)
    expect(result.error).toContain('synthetic crash')
    vi.doUnmock('../src/utils/docParser')
  })
})
