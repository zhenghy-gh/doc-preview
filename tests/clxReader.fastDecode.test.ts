import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, existsSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'
import {
  extractTextFromRange,
  HIGH_BYTE_MAP,
  isValidPrintableChar,
  containsBinarySignature,
  SIGNATURE_CHECK_INTERVAL,
} from '../src/utils/docparser/clxReader'

/**
 * Round 101 差分护栏：`extractTextFromRange` 的快速解码路径 vs 原逐字符实现。
 *
 * 这一轮的映射可以**穷尽**验证，而不是抽样：
 *  - 压缩分支的输入空间只有 256 个字节值；
 *  - 非压缩分支的输入空间只有 65536 个 UTF-16 码元。
 * 两张表都由原 if 链逐项推导，所以把整个输入空间跑一遍就是完整证明——
 * 这比 Round 97–100 用的「真实语料 + 随机模糊」强得多，因此这条护栏常驻。
 *
 * ── 参照实现（oracle）的边界 ────────────────────────────────────────────────
 * 下面 `referenceDecode` 是改动前 `extractTextFromRange` 的**逐行转写**，只保留
 * 解码控制流：两个分支的 if 链、循环边界、护栏的触发时机与截断方式。
 * 它从生产模块借用 `HIGH_BYTE_MAP` / `isValidPrintableChar` /
 * `containsBinarySignature` / `SIGNATURE_CHECK_INTERVAL` 这四个**本轮未改动**、
 * 且各自有独立测试的纯函数——本护栏要抓的是「快速路径的表与码元缓冲逻辑」，
 * 所以让 oracle 独立地重述控制流、共用无争议的查表常量，是恰当的作用域。
 *
 * ── 阴性对照（本轮实测，见 changelog）────────────────────────────────────────
 * 9 个变体：5 个故意改错（漏 0x1e 映射 / 0x0a 不再跳过 / 非压缩上界 end-1→end /
 * 末块上界 n→n-1 / 压缩上界 end→end-1）全部被抓出（247/77/116/79/508 处差异）；
 * 4 个等价改写（多分配一个码元 / 分块 0x8000→0x4000 / 两条判定合成三元式 /
 * 按位或改成加法）全部判为 0 处差异。
 */

/** 改动前实现的逐行转写。仅用于差分比对，不参与生产。 */
function referenceDecode(
  data: Uint8Array,
  start: number,
  end: number,
  isCompressed: boolean,
  guardBinary: boolean,
): string {
  if (start < 0 || end > data.length || start >= end) return ''
  let text = ''
  let sinceCheck = 0
  if (isCompressed) {
    for (let i = start; i < end; i++) {
      const byte = data[i]
      if (byte === 0x0d) text += '\n'
      else if (byte === 0x09) text += '\t'
      else if (byte === 0x0c) text += '\f'
      else if (byte === 0x0b) text += '\v'
      else if (byte === 0x07) text += '\u0007'
      else if (byte === 0x01) text += '\u0001'
      else if (byte === 0xa0) text += '\u00a0'
      else if (byte === 0xad) text += '\u00ad'
      else if (byte === 0x1e) text += '\u2011'
      else if (byte === 0x0a || byte === 0x00) continue
      else if (byte >= 0x80 && byte <= 0xff) {
        const mapped = HIGH_BYTE_MAP[byte - 0x80]
        if (mapped !== null) text += mapped
        else if (byte >= 0xa0) text += String.fromCharCode(byte)
      } else if (byte >= 0x20) text += String.fromCharCode(byte)
      if (guardBinary && ++sinceCheck >= SIGNATURE_CHECK_INTERVAL && text.length >= 8) {
        sinceCheck = 0
        if (containsBinarySignature(text)) {
          const lastNewline = text.lastIndexOf('\n')
          text = lastNewline >= 0 ? text.slice(0, lastNewline) : ''
          return text
        }
      }
    }
  } else {
    for (let i = start; i < end - 1; i += 2) {
      const charCode = (data[i] | (data[i + 1] << 8)) & 0xffff
      if (charCode === 0x000d) text += '\n'
      else if (charCode === 0x0009) text += '\t'
      else if (charCode === 0x000c) text += '\f'
      else if (charCode === 0x000b) text += '\v'
      else if (charCode === 0x0007) text += '\u0007'
      else if (charCode === 0x0001) text += '\u0001'
      else if (charCode === 0x00a0) text += '\u00a0'
      else if (charCode === 0x00ad) text += '\u00ad'
      else if (charCode === 0x001e) text += '\u2011'
      else if (charCode === 0x000a || charCode === 0x0000) continue
      else if (isValidPrintableChar(charCode)) text += String.fromCharCode(charCode)
      if (guardBinary && ++sinceCheck >= SIGNATURE_CHECK_INTERVAL && text.length >= 8) {
        sinceCheck = 0
        if (containsBinarySignature(text)) {
          const lastNewline = text.lastIndexOf('\n')
          text = lastNewline >= 0 ? text.slice(0, lastNewline) : ''
          return text
        }
      }
    }
  }
  if (guardBinary && text.length >= 8 && containsBinarySignature(text)) {
    const lastNewline = text.lastIndexOf('\n')
    text = lastNewline >= 0 ? text.slice(0, lastNewline) : ''
  }
  return text
}

const newExtract = (d: Uint8Array, s: number, e: number, comp: boolean, guard: boolean) =>
  extractTextFromRange(d, s, e, comp, guard)

const here = dirname(fileURLToPath(import.meta.url))
const docsDir = resolve(here, '../docs')

describe('round 101 — 压缩分支：全部 256 个字节值穷尽比对', () => {
  it('每个字节值单独出现时的输出完全一致', () => {
    for (let b = 0; b < 256; b++) {
      const buf = new Uint8Array([b])
      const a = referenceDecode(buf, 0, 1, true, false)
      const c = newExtract(buf, 0, 1, true, false)
      expect(c, `byte=0x${b.toString(16).padStart(2, '0')}`).toBe(a)
    }
  })

  it('全部 256 个字节值依次出现（含前后相邻上下文）输出完全一致', () => {
    const cases: Uint8Array[] = []
    // 顺序、逆序、三连（每个值重复 3 次，制造「相邻同值」上下文）
    cases.push(Uint8Array.from({ length: 256 }, (_, i) => i))
    cases.push(Uint8Array.from({ length: 256 }, (_, i) => 255 - i))
    cases.push(Uint8Array.from({ length: 768 }, (_, i) => (i / 3) | 0))
    // 每个值前面垫一个可打印 ASCII，制造「前一个字符已累积」的上下文
    {
      const b = new Uint8Array(512)
      for (let i = 0; i < 256; i++) { b[i * 2] = 0x41; b[i * 2 + 1] = i }
      cases.push(b)
    }
    for (const buf of cases) {
      const a = referenceDecode(buf, 0, buf.length, true, false)
      const c = newExtract(buf, 0, buf.length, true, false)
      expect(c, `len=${buf.length}`).toBe(a)
    }
  })

  it('随机子区间（起点/终点任意切）输出完全一致', () => {
    const buf = new Uint8Array(1024)
    let seed = 0x1010101
    const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff }
    for (let i = 0; i < buf.length; i++) buf[i] = Math.floor(rnd() * 256)
    for (let t = 0; t < 500; t++) {
      const s = Math.floor(rnd() * buf.length)
      const e = s + Math.floor(rnd() * (buf.length - s))
      expect(newExtract(buf, s, e, true, false), `range ${s}..${e}`)
        .toBe(referenceDecode(buf, s, e, true, false))
    }
  })
})

describe('round 101 — 非压缩分支：全部 65536 个 UTF-16 码元穷尽比对', () => {
  it('每个码元单独出现时的输出完全一致', () => {
    const buf = new Uint8Array(2)
    for (let c = 0; c < 0x10000; c++) {
      buf[0] = c & 0xff
      buf[1] = (c >> 8) & 0xff
      const a = referenceDecode(buf, 0, 2, false, false)
      const n = newExtract(buf, 0, 2, false, false)
      if (n !== a) {
        expect.fail(`charCode=0x${c.toString(16)} 不一致: ref=${JSON.stringify(a)} new=${JSON.stringify(n)}`)
      }
    }
  })

  it('全部 65536 个码元依次出现时输出完全一致', () => {
    const buf = new Uint8Array(0x10000 * 2)
    for (let c = 0; c < 0x10000; c++) {
      buf[c * 2] = c & 0xff
      buf[c * 2 + 1] = (c >> 8) & 0xff
    }
    const a = referenceDecode(buf, 0, buf.length, false, false)
    const n = newExtract(buf, 0, buf.length, false, false)
    expect(n.length).toBe(a.length)
    expect(n).toBe(a)
  })

  it('每个码元后面垫一个可打印字符（制造相邻上下文）输出完全一致', () => {
    const buf = new Uint8Array(0x10000 * 4)
    for (let c = 0; c < 0x10000; c++) {
      buf[c * 4] = c & 0xff
      buf[c * 4 + 1] = (c >> 8) & 0xff
      buf[c * 4 + 2] = 0x41
      buf[c * 4 + 3] = 0x00
    }
    const a = referenceDecode(buf, 0, buf.length, false, false)
    const n = newExtract(buf, 0, buf.length, false, false)
    expect(n).toBe(a)
  })

  it('随机子区间（含奇数长度与错位起点）输出完全一致', () => {
    const buf = new Uint8Array(2048)
    let seed = 0x2020202
    const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff }
    for (let i = 0; i < buf.length; i++) buf[i] = Math.floor(rnd() * 256)
    for (let t = 0; t < 500; t++) {
      const s = Math.floor(rnd() * buf.length)
      const e = s + Math.floor(rnd() * (buf.length - s))
      expect(newExtract(buf, s, e, false, false), `range ${s}..${e}`)
        .toBe(referenceDecode(buf, s, e, false, false))
    }
  })
})

describe('round 101 — 带护栏路径必须一字未动', () => {
  it('guardBinary=true（公开默认值）时新旧完全一致', () => {
    const cases: Uint8Array[] = [
      new Uint8Array(0),
      new Uint8Array([0x41]),
      Uint8Array.from({ length: 256 }, (_, i) => i),
      (() => {
        // 塞一段二进制签名，触发护栏的截断分支
        const b = new Uint8Array(400).fill(0x41)
        b[100] = 0x0d
        b[200] = 0x89; b[201] = 0x50; b[202] = 0x4e; b[203] = 0x47
        return b
      })(),
      (() => {
        const b = new Uint8Array(600)
        for (let i = 0; i < 300; i++) { b[i * 2] = 0x42; b[i * 2 + 1] = 0x00 }
        b[400] = 0x25; b[401] = 0x50; b[402] = 0x44; b[403] = 0x46
        return b
      })(),
    ]
    for (const buf of cases) {
      for (const comp of [true, false]) {
        const a = referenceDecode(buf, 0, buf.length, comp, true)
        const n = newExtract(buf, 0, buf.length, comp, true)
        expect(n, `len=${buf.length} comp=${comp}`).toBe(a)
      }
    }
  })

  it('越界与空区间一律返回空串（新旧一致）', () => {
    const buf = new Uint8Array(64).fill(0x41)
    for (const [s, e] of [[0, 0], [-1, 2], [0, 99], [64, 64], [10, 5]] as [number, number][]) {
      for (const comp of [true, false]) {
        for (const guard of [true, false]) {
          expect(newExtract(buf, s, e, comp, guard), `${s}..${e} comp=${comp} guard=${guard}`)
            .toBe(referenceDecode(buf, s, e, comp, guard))
        }
      }
    }
  })
})

describe('round 101 — 真实语料差分', () => {
  it('docs/ 下每份样本的多个区间新旧一致（两个分支都覆盖）', () => {
    const files = existsSync(docsDir)
      ? readdirSync(docsDir).filter((f) => f.endsWith('.doc')).sort()
      : []
    expect(files.length, '样本数').toBeGreaterThan(20)

    let bytes = 0
    for (const f of files) {
      const buf = new Uint8Array(readFileSync(resolve(docsDir, f)))
      // 整文件、以及若干等分区间，两个分支各跑一遍
      const ranges: [number, number][] = [[0, buf.length]]
      const step = Math.max(1, Math.floor(buf.length / 8))
      for (let s = 0; s < buf.length; s += step) ranges.push([s, Math.min(s + step, buf.length)])
      for (const [s, e] of ranges) {
        for (const comp of [true, false]) {
          const a = referenceDecode(buf, s, e, comp, false)
          const n = newExtract(buf, s, e, comp, false)
          if (n !== a) expect.fail(`${f} range ${s}..${e} comp=${comp} 不一致`)
        }
        bytes += e - s
      }
    }
    expect(bytes, '实际比对字节数').toBeGreaterThan(5 * 1024 * 1024)
  })
})

describe('round 102 — TextDecoder 路径的前提', () => {
  it('参照实现产出的字符里没有代理项', () => {
    // 快速路径用 TextDecoder('utf-16le') 转字符串，它会把**孤立代理项**替换成
    // U+FFFD；参照实现的 String.fromCharCode 原样保留。所以「这个输入空间上
    // 不会产出代理项」是快路径成立的前提。
    //
    // 这里必须从**参照实现**收集，不能从快路径的输出收集：快路径的输出已经
    // 被 TextDecoder 净化过，代理项早就变成 U+FFFD 了，从那里收集永远看不到
    // 代理项——那样的断言是**空的**。这一点是阴性对照 D 抓出来的：
    // 往 LOW_CODES 里塞 0xD800 后，差分测试报出 82 处差异，而「从输出收集」
    // 版本的断言一个都没触发。
    //
    // 职责划分：本条覆盖两个实现**共用**的纯函数（HIGH_BYTE_MAP /
    // isValidPrintableChar）；快路径私有的两张表由上面的穷尽差分覆盖——
    // 代理项一旦进入快路径，TextDecoder 会把它变成 U+FFFD 而参照实现不会，
    // 必然产生差异。
    const seen = new Set<number>()
    const collect = (s: string) => {
      for (let i = 0; i < s.length; i++) seen.add(s.charCodeAt(i))
    }
    // 压缩分支：256 个字节值单独出现 + 依次出现
    for (let b = 0; b < 256; b++) collect(referenceDecode(new Uint8Array([b]), 0, 1, true, false))
    const seq = Uint8Array.from({ length: 256 }, (_, i) => i)
    collect(referenceDecode(seq, 0, seq.length, true, false))
    // 非压缩分支：65536 个码元单独出现
    const two = new Uint8Array(2)
    for (let c = 0; c < 0x10000; c++) {
      two[0] = c & 0xff
      two[1] = (c >> 8) & 0xff
      collect(referenceDecode(two, 0, 2, false, false))
    }
    // 先确认真的收集到了东西（否则「没有代理项」是空转结论）
    expect(seen.size, '收集到的不同码元数').toBeGreaterThan(100)
    const surrogates = [...seen].filter((c) => c >= 0xd800 && c <= 0xdfff)
    expect(
      surrogates.map((c) => `0x${c.toString(16)}`),
      '参照实现产出了代理项 —— TextDecoder 会把它换成 U+FFFD，快路径不再等价',
    ).toEqual([])
  })

  it('开头的 U+FEFF 原样保留', () => {
    // TextDecoder 默认会把**开头的** U+FEFF 当 BOM 吃掉（"\uFEFFA" → "A"）。
    // 非压缩分支的 isValidPrintableChar 对 0xFEFF 返回 true，所以它完全可能
    // 出现在真实文本里；这一条正是穷尽测试抓出来的（charCode=0xfeff 不一致）。
    const buf = new Uint8Array([0xff, 0xfe, 0x41, 0x00, 0x42, 0x00]) // U+FEFF, 'A', 'B'
    expect(referenceDecode(buf, 0, buf.length, false, false)).toBe('\uFEFFAB')
    expect(newExtract(buf, 0, buf.length, false, false)).toBe('\uFEFFAB')
  })
})

describe('round 101 — 表与 if 链的构造前提', () => {
  it('HIGH_BYTE_MAP 的每个非 null 项都是单个 UTF-16 码元', () => {
    // 快速路径用 `charCodeAt(0)` 取值；若某项是多个字符就会静默丢数据
    for (let i = 0; i < HIGH_BYTE_MAP.length; i++) {
      const v = HIGH_BYTE_MAP[i]
      if (v === null) continue
      expect(v.length, `HIGH_BYTE_MAP[${i}] = ${JSON.stringify(v)}`).toBe(1)
    }
  })
})

describe('round 101 — 复杂度护栏', () => {
  const N = 4 * 1024 * 1024

  it('4 MB 输入在线性时间内完成（两个分支）', () => {
    for (const comp of [true, false]) {
      const buf = new Uint8Array(N)
      for (let i = 0; i < N; i++) buf[i] = 0x41 + (i % 26)
      const t = performance.now()
      const s = newExtract(buf, 0, N, comp, false)
      const ms = performance.now() - t
      expect(s.length).toBeGreaterThan(0)
      expect(ms, `comp=${comp} 耗时 ${ms.toFixed(0)} ms`).toBeLessThan(5000)
    }
  })

  it('分块边界（0x8000 附近）输出正确且在线性时间内完成', () => {
    for (const n of [0x7ffe, 0x7fff, 0x8000, 0x8001, 0x10000, 0x18000]) {
      const buf = new Uint8Array(n)
      for (let i = 0; i < n; i++) buf[i] = 0x41 + (i % 26)
      const t = performance.now()
      const s = newExtract(buf, 0, n, true, false)
      const ms = performance.now() - t
      expect(s.length, `n=${n}`).toBe(n)
      expect(s, `n=${n} 内容`).toBe(referenceDecode(buf, 0, n, true, false))
      expect(ms, `n=${n} 耗时`).toBeLessThan(5000)
    }
  })
})
