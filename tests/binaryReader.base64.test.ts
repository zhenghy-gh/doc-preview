import { describe, it, expect } from 'vitest'
import { bytesToBase64 } from '../src/utils/binaryReader'
import { bytesToBase64DataUrl, imageFormatMime, type ImageFormat } from '../src/utils/imageExtractor'
import { picturesToDataUrls } from '../src/utils/pictureParser'
import { readFileSync, readdirSync, existsSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'

/**
 * Round 103 差分护栏：`bytesToBase64`（共享实现） vs 改动前散落在三个模块里的
 * 逐块 `String.fromCharCode.apply` + `btoa` 循环。
 *
 * 下面 `referenceDataUrl` 是改动前 `bytesToBase64DataUrl` 的**逐行转写**
 * （`chunkSize = 0x8000` + `binary += apply`）。它是本轮被替换掉的那份实现的
 * 完整语义，所以拿它当 oracle 是恰当的：本轮只改了「怎么攒字符串」，没改语义。
 *
 * 输入空间可穷尽的部分（1 字节 256 种、2 字节 65536 种）全部枚举；
 * 分块分支（> 0x2000）用边界与全字节值扫描覆盖——分块大小从 0x8000 改成 0x2000，
 * 最容易出错的正是块与块的交界处。
 */

/** 改动前 `bytesToBase64DataUrl` 的逐行转写。仅用于差分比对。 */
function referenceDataUrl(bytes: Uint8Array, format: ImageFormat): string {
  let binary = ''
  const chunkSize = 0x8000
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const slice = bytes.subarray(i, Math.min(i + chunkSize, bytes.length))
    binary += String.fromCharCode.apply(null, slice as unknown as number[])
  }
  return `data:${imageFormatMime(format)};base64,${btoa(binary)}`
}

/** 最朴素的参照：逐字节拼接，不依赖任何分块假设。 */
function naiveBase64(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i])
  return btoa(s)
}

const FMT: ImageFormat = 'png'
const dataUrl = (b: Uint8Array) => bytesToBase64DataUrl(b, FMT)

describe('round 103 — bytesToBase64 与改动前实现等价', () => {
  it('全部 256 个单字节值', () => {
    for (let b = 0; b < 256; b++) {
      const buf = new Uint8Array([b])
      expect(dataUrl(buf), `byte=0x${b.toString(16).padStart(2, '0')}`).toBe(referenceDataUrl(buf, FMT))
      expect(bytesToBase64(buf), `raw byte=0x${b.toString(16)}`).toBe(naiveBase64(buf))
    }
  })

  it('全部 65536 个双字节组合', () => {
    const buf = new Uint8Array(2)
    for (let v = 0; v < 0x10000; v++) {
      buf[0] = v & 0xff
      buf[1] = v >> 8
      expect(dataUrl(buf), `v=0x${v.toString(16)}`).toBe(referenceDataUrl(buf, FMT))
    }
  })

  it('空输入', () => {
    const empty = new Uint8Array(0)
    expect(dataUrl(empty)).toBe(referenceDataUrl(empty, FMT))
    expect(dataUrl(empty)).toBe('data:image/png;base64,')
  })

  it('分块边界（0x2000 前后）逐字节相同', () => {
    // 分块大小 0x8000 → 0x2000，块交界处是最容易出错的地方
    for (const n of [0x1ffe, 0x1fff, 0x2000, 0x2001, 0x2002, 0x3fff, 0x4000, 0x4001, 0x5fff, 0x6000, 0x6001]) {
      const buf = new Uint8Array(n)
      for (let i = 0; i < n; i++) buf[i] = (i * 31 + 7) & 0xff
      expect(dataUrl(buf), `n=${n}`).toBe(referenceDataUrl(buf, FMT))
      expect(dataUrl(buf).length, `n=${n} 长度`).toBe(referenceDataUrl(buf, FMT).length)
    }
  })

  it('长度 mod 3 的三种余数 × 跨块位置都正确（base64 padding）', () => {
    for (const rem of [0, 1, 2]) {
      for (const base of [0x1fff, 0x2000, 0x2001, 0x4000]) {
        const n = base + rem
        const buf = new Uint8Array(n)
        for (let i = 0; i < n; i++) buf[i] = (i * 131 + 17) & 0xff
        expect(dataUrl(buf), `n=${n}`).toBe(referenceDataUrl(buf, FMT))
      }
    }
  })

  it('每个字节值都跨过 0x2000 分块边界（全 256 值扫描）', () => {
    // 造一段 0x2001 字节的缓冲：位置 0x1fff/0x2000 处分别放每个字节值，
    // 确保「块尾最后一个字节」和「下一块第一个字节」的每种取值都覆盖到
    const n = 0x2001
    for (let b = 0; b < 256; b++) {
      const buf = new Uint8Array(n)
      for (let i = 0; i < n; i++) buf[i] = 0x41
      buf[0x1fff] = b
      buf[0x2000] = (b + 1) & 0xff
      expect(dataUrl(buf), `b=0x${b.toString(16)}`).toBe(referenceDataUrl(buf, FMT))
    }
  })

  it('大输入（1 MB）正确且线性', () => {
    const n = 1024 * 1024
    const buf = new Uint8Array(n)
    for (let i = 0; i < n; i++) buf[i] = (i * 2654435761) & 0xff
    const t = performance.now()
    const got = dataUrl(buf)
    const ms = performance.now() - t
    expect(got).toBe(referenceDataUrl(buf, FMT))
    expect(ms, `1 MB 耗时 ${ms.toFixed(0)} ms`).toBeLessThan(5000)
  })

  it('data URL 前缀与 mime 映射不受影响', () => {
    const buf = new Uint8Array([1, 2, 3])
    for (const f of ['png', 'jpeg', 'bmp', 'gif'] as ImageFormat[]) {
      const url = bytesToBase64DataUrl(buf, f)
      expect(url.startsWith(`data:${imageFormatMime(f)};base64,`)).toBe(true)
      expect(url).toBe(referenceDataUrl(buf, f))
    }
  })
})

describe('round 103 — 三处调用点都走共享实现', () => {
  const here = dirname(fileURLToPath(import.meta.url))
  const docsDir = resolve(here, '../docs')

  it('pictureParser.picturesToDataUrls 与参照实现一致', () => {
    // 这一处改动前多了一层 Array.from，是三个副本里唯一行为不同的那个
    const pics = [
      { data: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]), format: 'png' },
      { data: new Uint8Array(0x2500).fill(0xab), format: 'jpeg' },
      { data: new Uint8Array([1]), format: 'gif' },
      { data: new Uint8Array([0xff, 0xd8, 0xff]), format: 'unknown' }, // 应被过滤掉
    ] as unknown as Parameters<typeof picturesToDataUrls>[0]
    const got = picturesToDataUrls(pics)
    expect(got.length).toBe(3)
    expect(got[0]).toBe(referenceDataUrl(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]), 'png'))
    expect(got[1]).toBe(referenceDataUrl(new Uint8Array(0x2500).fill(0xab), 'jpeg'))
    expect(got[2]).toBe(referenceDataUrl(new Uint8Array([1]), 'gif'))
  })

  it('真实语料里的图片字节编码结果与参照实现一致', () => {
    const files = existsSync(docsDir) ? readdirSync(docsDir).filter((f) => f.endsWith('.doc')).sort() : []
    expect(files.length, '样本数').toBeGreaterThan(20)
    let total = 0
    for (const f of files) {
      const buf = new Uint8Array(readFileSync(resolve(docsDir, f)))
      // 取若干真实区间（含大块），直接比 base64 文本
      const ranges: [number, number][] = []
      const step = Math.max(1, Math.floor(buf.length / 6))
      for (let s = 0; s < buf.length; s += step) ranges.push([s, Math.min(s + step, buf.length)])
      for (const [s, e] of ranges) {
        if (e <= s) continue
        const slice = buf.subarray(s, e)
        expect(bytesToBase64(slice), `${f} ${s}..${e}`).toBe(naiveBase64(slice))
        total += slice.length
      }
    }
    expect(total, '实际比对字节数').toBeGreaterThan(5 * 1024 * 1024)
  })
})
