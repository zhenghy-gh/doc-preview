import { describe, it, expect } from 'vitest'
import { parseWithWorker } from '../src/utils/parseWithWorker'

describe('parseWithWorker', () => {
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
    // Just verify it doesn't throw when passing custom param
    const result = await parseWithWorker(new ArrayBuffer(4), 1024)
    expect(result).toBeDefined()
  })
})
