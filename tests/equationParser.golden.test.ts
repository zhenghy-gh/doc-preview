import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, existsSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'
import { extractEquationsFromWordDocumentStream, eqnToLatex } from '../src/utils/equationParser'

/**
 * `extractEquationsFromWordDocumentStream` 的真实样本快照与复杂度护栏。
 *
 * **为什么没有快照夹具文件。** 与 round 97/99 的图片、WordArt 不同，公式扫描在
 * 27 份真实样本（整文件 7.6 MB、WordDocument 流 5.77 MB）上产出恒为 **0** ——
 * 它的前导签名是 UTF-8 的 U+FFFD 重复两次，在真实语料里一次都没出现。
 * 所以「真实语料快照」在这里只能钉住「不产生假阳性」，钉不住正例。
 *
 * 正例由下面的**合成块**承担：它们构造出合法魔数 + UTF-16LE 文本 + 0x0000
 * 终结符，能真的产出公式。合成块的存在是这份测试有意义的前提——若哪天它们
 * 退化成产出 0，说明夹具坏了、测试变成了空转（round 98/99 都踩过这个坑，
 * 所以这里把「必须有产出」写成断言）。
 *
 * 复杂度护栏针对的是本轮引入的 `indexOf` 跳跃：跳跃最怕锚点字节很密
 * （每个字节一次原生调用）或很稀（每次扫到缓冲区末尾）。
 */

const here = dirname(fileURLToPath(import.meta.url))
const docsDir = resolve(here, '../docs')

const MAGIC = [0xef, 0xbf, 0xbd, 0xef, 0xbf, 0xbd]

/**
 * 魔数 + UTF-16LE 文本 + 0x0000 终结符。
 *
 * 解码是 `charCode = (data[i + 1] << 8) | data[i]`，**低字节在前**，
 * 所以 ASCII 字符写成 `[charCode, 0x00]`。写成 `[0x00, charCode]` 会得到
 * `charCode << 8`，被随后的 `[^\x20-\x7E\\]` 过滤干净，一个字都留不下。
 *
 * 另外扫描上限是 `data.length - 100`，所以每个合成缓冲区都要显著长于 100 字节，
 * 否则循环一次都不进、产出恒为 0。
 */
/** 纯 UTF-16LE 文本（低字节在前），不含魔数。 */
function textBytes(text: string): number[] {
  const out: number[] = []
  for (const ch of text) out.push(ch.charCodeAt(0) & 0xff, 0x00)
  return out
}

function eqnBlock(text: string, terminator = true): number[] {
  const out: number[] = [...MAGIC, ...textBytes(text)]
  if (terminator) out.push(0, 0)
  return out
}

function buffer(...parts: number[][]): Uint8Array {
  const flat = parts.flat()
  const pad = Math.max(0, 320 - flat.length)
  return new Uint8Array([...flat, ...new Array(pad).fill(0x41)])
}

describe('extractEquationsFromWordDocumentStream — 真实样本快照', () => {
  it('docs/ 下每份样本都扫描过、且不产生任何假阳性', () => {
    const files = existsSync(docsDir)
      ? readdirSync(docsDir).filter((f) => f.endsWith('.doc')).sort()
      : []
    expect(files.length, '样本数').toBeGreaterThan(20)

    let scanned = 0
    let equations = 0
    for (const f of files) {
      const buf = new Uint8Array(readFileSync(resolve(docsDir, f)))
      scanned += buf.length
      equations += extractEquationsFromWordDocumentStream(buf).length
    }

    // 没有这条断言的话，「一个样本都没读到」也会让下面的 0 通过
    expect(scanned, '实际扫描的字节数').toBeGreaterThan(5 * 1024 * 1024)
    expect(equations, '真实语料上的公式数（已知为 0，见文件头注释）').toBe(0)
  })
})

describe('extractEquationsFromWordDocumentStream — 合成块（正例，保证测试有鉴别力）', () => {
  it('单个合法公式块被提取，且 latex 与 eqnText 逐字段正确', () => {
    const eqs = extractEquationsFromWordDocumentStream(buffer(eqnBlock('\\frac{a}{b}')))
    expect(eqs).toHaveLength(1)
    expect(eqs[0]).toEqual({
      id: 1,
      eqnText: '\\frac{a}{b}',
      latex: '\\frac{a}{b}',
    })
  })

  it('前缀填充不影响结果（跳跃必须精确落到魔数上）', () => {
    const eqs = extractEquationsFromWordDocumentStream(
      buffer(new Array(37).fill(0x41), eqnBlock('\\alpha+\\beta')),
    )
    expect(eqs).toHaveLength(1)
    expect(eqs[0].eqnText).toBe('\\alpha+\\beta')
  })

  it('两个公式块都提取，id 依次递增', () => {
    const eqs = extractEquationsFromWordDocumentStream(
      buffer(eqnBlock('\\alpha+\\beta'), new Array(23).fill(0x42), eqnBlock('\\gamma^2')),
    )
    expect(eqs.map((e) => e.eqnText)).toEqual(['\\alpha+\\beta', '\\gamma^2'])
    expect(eqs.map((e) => e.id)).toEqual([1, 2])
  })

  it('eqnToLatex 的既有变换在产出路径上生效', () => {
    const eqs = extractEquationsFromWordDocumentStream(
      buffer(eqnBlock('\\sumfrom{i=0}{n} x_i^2')),
    )
    expect(eqs).toHaveLength(1)
    expect(eqs[0].eqnText).toBe('\\sumfrom{i=0}{n} x_i^2')
    expect(eqs[0].latex).toBe(eqnToLatex('\\sumfrom{i=0}{n} x_i^2'))
    expect(eqs[0].latex).toBe('\\sum_{i=0}^{n} x_{i}^{2}')
  })

  it('被拒的形态一条都不产出（不产生假阳性）', () => {
    const rejected: Record<string, Uint8Array> = {
      // 注意：这里**不能**在后面拼一个真的 `eqnBlock`，否则缓冲区里就又有
      // 一个合法魔数了，用例会以「本来就有正例」的方式失败。文本单独给。
      '只有前 5 字节匹配（第 6 字节错）': buffer([0xef, 0xbf, 0xbd, 0xef, 0xbf, 0x00], textBytes('\\frac{a}{b}')),
      '只有首字节匹配': buffer([0xef, 0x41, 0x42, 0x43, 0x44, 0x45], textBytes('\\frac{a}{b}')),
      '魔数后紧跟 0x0000（长度不足 10）': buffer([...MAGIC, 0, 0]),
      '无反斜杠的文本': buffer(eqnBlock('plain text here')),
      '超长文本（> 2000 字节）': buffer(eqnBlock('\\' + 'a'.repeat(2500))),
      '魔数落在 limit 之外（最后 100 字节内）': (() => {
        const b = new Uint8Array(512).fill(0x41)
        MAGIC.forEach((v, k) => { b[462 + k] = v })
        for (let k = 6; k < 40; k += 2) { b[462 + k] = 0x5c; b[463 + k] = 0x00 }
        return b
      })(),
    }
    for (const [name, buf] of Object.entries(rejected)) {
      expect(extractEquationsFromWordDocumentStream(buf).length, name).toBe(0)
    }
  })
})

describe('extractEquationsFromWordDocumentStream — 复杂度护栏', () => {
  // 1 MB 输入的线性扫描约 1–7 ms；5000 ms 上限有约三个数量级余量，
  // 不会因并行测试的机器争用而误报，但能拦住超线性退化。
  const N = 1024 * 1024

  it('单一字节铺满 1MB 在线性时间内完成（含锚点最密的 0xEF）', () => {
    for (const fill of [0x00, 0xef, 0xff, 0x41, 0x5c, 0xbd, 0xbf, 0x89]) {
      const buf = new Uint8Array(N).fill(fill)
      const t = performance.now()
      const eqs = extractEquationsFromWordDocumentStream(buf)
      const ms = performance.now() - t
      expect(eqs, `fill=0x${fill.toString(16)} 不应产出公式`).toEqual([])
      expect(ms, `fill=0x${fill.toString(16)} 耗时 ${ms.toFixed(0)} ms`).toBeLessThan(5000)
    }
  })

  it('每 16 字节一个 0xEF（跳跃路径全程生效）的 1MB 缓冲区在线性时间内完成', () => {
    const buf = new Uint8Array(N).fill(0x41)
    for (let o = 0; o < buf.length; o += 16) buf[o] = 0xef
    const t = performance.now()
    const eqs = extractEquationsFromWordDocumentStream(buf)
    const ms = performance.now() - t
    expect(eqs).toEqual([])
    expect(ms, `密集锚点耗时 ${ms.toFixed(0)} ms`).toBeLessThan(5000)
  })

  it('每 128 字节一个真公式块的 1MB 缓冲区在线性时间内完成（走产出路径）', () => {
    const block = eqnBlock('\\frac{x}{y}')
    const buf = new Uint8Array(N).fill(0x41)
    for (let o = 0; o + block.length + 100 < buf.length; o += 128) {
      block.forEach((v, k) => { buf[o + k] = v })
    }
    const t = performance.now()
    const eqs = extractEquationsFromWordDocumentStream(buf)
    const ms = performance.now() - t
    expect(eqs.length, '密集真块必须真的产出').toBeGreaterThan(1000)
    expect(ms, `密集真块耗时 ${ms.toFixed(0)} ms`).toBeLessThan(5000)
  })

  it('极短输入直接返回空数组', () => {
    for (const n of [0, 1, 63, 99, 100]) {
      expect(extractEquationsFromWordDocumentStream(new Uint8Array(n)), `n=${n}`).toEqual([])
    }
  })
})
