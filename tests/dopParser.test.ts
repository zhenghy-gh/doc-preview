import { describe, it, expect } from 'vitest'
import { parseDop, EMPTY_DOP } from '../src/utils/dopParser'

describe('parseDop', () => {
  it('should return null for empty data', () => {
    expect(parseDop(new Uint8Array(0))).toBeNull()
  })

  it('should return null for data too short (< 2 bytes)', () => {
    expect(parseDop(new Uint8Array([0x01]))).toBeNull()
  })

  it('should parse all-false flags when bytes are 0', () => {
    const data = new Uint8Array([0x00, 0x00])
    const result = parseDop(data)
    expect(result).toEqual({
      facingPages: false,
      titlePage: false,
      pmhMain: false,
      trackChanges: false,
      ftnRestart: false,
      ftnEnd: false,
      ftnAtEnd: false,
    })
  })

  it('should parse fFacingPages (bit 0 of byte 0)', () => {
    const data = new Uint8Array([0x01, 0x00])
    const result = parseDop(data)
    expect(result?.facingPages).toBe(true)
    expect(result?.titlePage).toBe(false)
    expect(result?.trackChanges).toBe(false)
  })

  it('should parse fTitlePage (bit 1 of byte 0)', () => {
    const data = new Uint8Array([0x02, 0x00])
    const result = parseDop(data)
    expect(result?.titlePage).toBe(true)
    expect(result?.facingPages).toBe(false)
  })

  it('should parse fPMHMain (bit 2 of byte 0)', () => {
    const data = new Uint8Array([0x04, 0x00])
    const result = parseDop(data)
    expect(result?.pmhMain).toBe(true)
  })

  it('should parse fFtnRestart (bit 4 of byte 0)', () => {
    const data = new Uint8Array([0x10, 0x00])
    const result = parseDop(data)
    expect(result?.ftnRestart).toBe(true)
  })

  it('should parse fFtnEnd (bit 5 of byte 0)', () => {
    const data = new Uint8Array([0x20, 0x00])
    const result = parseDop(data)
    expect(result?.ftnEnd).toBe(true)
  })

  it('should parse fFtnAtEnd (bit 6 of byte 0)', () => {
    const data = new Uint8Array([0x40, 0x00])
    const result = parseDop(data)
    expect(result?.ftnAtEnd).toBe(true)
  })

  it('should parse fRMW / trackChanges (bit 0 of byte 1)', () => {
    const data = new Uint8Array([0x00, 0x01])
    const result = parseDop(data)
    expect(result?.trackChanges).toBe(true)
    expect(result?.facingPages).toBe(false)
  })

  it('should parse multiple flags set simultaneously', () => {
    // byte 0: 0x01 | 0x02 | 0x04 | 0x10 = 0x17 (facingPages + titlePage + pmhMain + ftnRestart)
    // byte 1: 0x01 (trackChanges)
    const data = new Uint8Array([0x17, 0x01])
    const result = parseDop(data)
    expect(result).toEqual({
      facingPages: true,
      titlePage: true,
      pmhMain: true,
      trackChanges: true,
      ftnRestart: true,
      ftnEnd: false,
      ftnAtEnd: false,
    })
  })

  it('should ignore reserved bits (bit 3 and bit 7 of byte 0)', () => {
    // 0x08 = bit 3 (reserved), 0x80 = bit 7 (reserved)
    const data = new Uint8Array([0x88, 0x00])
    const result = parseDop(data)
    expect(result?.facingPages).toBe(false)
    expect(result?.titlePage).toBe(false)
    expect(result?.pmhMain).toBe(false)
    expect(result?.ftnRestart).toBe(false)
    expect(result?.ftnEnd).toBe(false)
    expect(result?.ftnAtEnd).toBe(false)
    expect(result?.trackChanges).toBe(false)
  })

  it('should handle extra bytes beyond byte 1 (full DOP structure)', () => {
    // DOP is typically much larger; we only read the first 2 bytes
    const data = new Uint8Array([0x03, 0x01, 0xFF, 0xFF, 0xFF, 0xFF])
    const result = parseDop(data)
    expect(result?.facingPages).toBe(true)
    expect(result?.titlePage).toBe(true)
    expect(result?.trackChanges).toBe(true)
  })

  it('EMPTY_DOP should have all flags false', () => {
    expect(EMPTY_DOP).toEqual({
      facingPages: false,
      titlePage: false,
      pmhMain: false,
      trackChanges: false,
      ftnRestart: false,
      ftnEnd: false,
      ftnAtEnd: false,
    })
  })
})
