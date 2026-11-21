import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DocParser } from '../src/utils/docParser'

const here = dirname(fileURLToPath(import.meta.url))
const docsDir = resolve(here, '../docs')

/** 确定性伪随机（避免测试因 Math.random 抖动）。 */
function lcg(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 0x100000000
  }
}

function mutate(bytes: Uint8Array, rand: () => number): Uint8Array {
  const out = new Uint8Array(bytes)
  const kind = Math.floor(rand() * 4)
  if (kind === 0) {
    // flip a handful of bytes anywhere (including FIB/FAT headers)
    for (let i = 0; i < 8; i++) out[Math.floor(rand() * out.length)] ^= 1 << Math.floor(rand() * 8)
  } else if (kind === 1) {
    // truncate
    return out.subarray(0, Math.max(1, Math.floor(rand() * out.length)))
  } else if (kind === 2) {
    // zero a random range
    const start = Math.floor(rand() * out.length)
    const len = Math.max(1, Math.floor(rand() * 512))
    out.fill(0, start, Math.min(out.length, start + len))
  } else {
    // append garbage
    const extra = new Uint8Array(Math.floor(rand() * 256))
    for (let i = 0; i < extra.length; i++) extra[i] = Math.floor(rand() * 256)
    const merged = new Uint8Array(out.length + extra.length)
    merged.set(out)
    merged.set(extra, out.length)
    return merged
  }
  return out
}

describe('deterministic fuzz parse', () => {
  it('never throws or hangs on mutated real documents', () => {
    const rand = lcg(0xdec0de)
    const seeds = ['doc-101.doc', 'doc-100kb.doc', 'fsample3.doc', 'openstd-n961.doc']
      .map(name => {
        const b = readFileSync(resolve(docsDir, name))
        return new Uint8Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength))
      })
    const started = Date.now()
    let count = 0
    for (const seed of seeds) {
      for (let i = 0; i < 16; i++) {
        const mutated = mutate(seed, rand)
        const buffer = mutated.buffer.slice(mutated.byteOffset, mutated.byteOffset + mutated.byteLength) as ArrayBuffer
        expect(() => new DocParser(buffer).parse()).not.toThrow()
        expect(() => new DocParser(buffer).parseWithFormat()).not.toThrow()
        count++
      }
    }
    expect(count).toBe(64)
    expect(Date.now() - started).toBeLessThan(20000)
  }, 60000)
})
