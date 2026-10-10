// Round 107 护栏：`extractChartsFromWordDocumentStream` 由「逐字节遍历 + 两次首字节比较」
// 改成「用 indexOf 跳到下一个候选首字节」后，输出必须与改动前逐项一致。
//
// 参照实现是**改动前**的逐行转写（for 循环 + 每字节比较 + `offset = endOffset + 4`）。
// 输入空间不可穷尽，故用「合成语料（真的产出图表）+ 随机流 + 边界长度」三类覆盖，
// 并显式断言产出数 > 0 —— 否则护栏可能只是空转（Round 100/102 的教训）。
import { describe, it, expect } from 'vitest'
import { extractChartsFromWordDocumentStream } from '../src/utils/chartParser'
import type { ChartInfo } from '../src/utils/docFormat'
import fs from 'node:fs'
import { OleParser } from '../src/utils/oleParser'

/** 改动前实现逐行转写（Round 107 之前）。 */
function referenceExtractCharts(data: Uint8Array): ChartInfo[] {
  const charts: ChartInfo[] = []
  for (let offset = 0; offset < data.length - 100; offset++) {
    const firstByte = data[offset]
    let type: 'oleobject' | 'excel' | undefined
    if (firstByte === 0xd0 && data[offset + 1] === 0xcf && data[offset + 2] === 0x11 && data[offset + 3] === 0xe0) {
      type = 'oleobject'
    } else if (firstByte === 0x50 && data[offset + 1] === 0x4b && data[offset + 2] === 0x03 && data[offset + 3] === 0x04) {
      type = 'excel'
    }
    if (!type) continue
    let endOffset = offset + 100
    while (endOffset < data.length && endOffset - offset < 10000) {
      if (data[endOffset] === 0 && data[endOffset + 1] === 0 &&
          data[endOffset + 2] === 0 && data[endOffset + 3] === 0) {
        break
      }
      endOffset++
    }
    const chartSize = endOffset - offset
    if (chartSize > 500) {
      charts.push({
        id: charts.length + 1,
        name: `Embedded ${type === 'excel' ? 'Excel' : 'OLE'} Object ${charts.length + 1}`,
        type,
        subtype: 'chart',
        hasData: true,
        dataSize: chartSize,
      })
      offset = endOffset + 4
    }
  }
  return charts
}

const OLE_SIG = [0xd0, 0xcf, 0x11, 0xe0]
const ZIP_SIG = [0x50, 0x4b, 0x03, 0x04]

/** 线性同余伪随机（与既有护栏同款），保证用例可复现。 */
function makeRnd(seed: number) {
  let s = seed
  return () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff
}

function buildSynthetic(seed: number, count: number): Uint8Array[] {
  const rnd = makeRnd(seed)
  const out: Uint8Array[] = []
  for (let t = 0; t < count; t++) {
    const n = 50 + Math.floor(rnd() * 3000)
    const buf = new Uint8Array(n)
    for (let i = 0; i < n; i++) buf[i] = Math.floor(rnd() * 256)
    const k = Math.floor(rnd() * 4)
    for (let j = 0; j < k; j++) {
      const at = Math.floor(rnd() * Math.max(1, n - 20))
      const sig = rnd() < 0.5 ? OLE_SIG : ZIP_SIG
      for (let x = 0; x < sig.length; x++) if (at + x < n) buf[at + x] = sig[x]
    }
    // 一半样本里再埋一段「长非零区 + OLE 签名」，用来触发真正的图表产出路径
    // （含 `offset = endOffset + 4` 的跳过语义）。
    if (rnd() < 0.5) {
      const at = 20 + Math.floor(rnd() * Math.max(1, n - 700))
      for (let x = 0; x < 600 && at + x < n; x++) buf[at + x] = 0x41
      for (let x = 0; x < OLE_SIG.length; x++) if (at + x < n) buf[at + x] = OLE_SIG[x]
    }
    out.push(buf)
  }
  return out
}

function buildBoundaryCases(): Uint8Array[] {
  const cases: Uint8Array[] = [
    new Uint8Array(0),
    new Uint8Array(8),
    new Uint8Array(99),
    new Uint8Array(100), // data.length - 100 === 0 → 循环不执行
    new Uint8Array(101),
  ]
  // 签名紧贴 limit 边界（limit = length - 100）
  const nearLimitOle = new Uint8Array(200).fill(1)
  for (let x = 0; x < OLE_SIG.length; x++) nearLimitOle[99 + x] = OLE_SIG[x]
  cases.push(nearLimitOle)
  const nearLimitZip = new Uint8Array(200).fill(1)
  for (let x = 0; x < ZIP_SIG.length; x++) nearLimitZip[96 + x] = ZIP_SIG[x]
  cases.push(nearLimitZip)
  // 恰好跨越 limit 的签名：offset = limit 之后不应被考察
  const pastLimit = new Uint8Array(200).fill(1)
  for (let x = 0; x < OLE_SIG.length; x++) pastLimit[100 + x] = OLE_SIG[x]
  cases.push(pastLimit)
  return cases
}

describe('extractChartsFromWordDocumentStream 签名跳跃等价性', () => {
  it('27份真实 WordDocument 流与逐字节 oracle 相同（产出路径另有确定断言）', () => {
    const docs = new URL('../docs/', import.meta.url)
    const files = fs.readdirSync(docs).filter(name => /\.(doc|dot)$/.test(name))
    expect(files).toHaveLength(27)
    for (const name of files) {
      const buf = fs.readFileSync(new URL(name, docs))
      const ole = new OleParser(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength))
      const header = ole.parseHeader()
      const directory = ole.getDirectorySectors(header, ole.getFatSectors(header))
      const stream = ole.findWordDocumentStream(directory)
      expect(stream).not.toBeNull()
      expect(extractChartsFromWordDocumentStream(stream!.data)).toEqual(referenceExtractCharts(stream!.data))
    }
  })
  it('合成语料（含真实产出路径）与改动前参照逐项一致', () => {
    const inputs = buildSynthetic(777, 300)
    let produced = 0
    for (const buf of inputs) {
      const expected = referenceExtractCharts(buf)
      expect(extractChartsFromWordDocumentStream(buf)).toEqual(expected)
      produced += expected.length
    }
    // 鉴别力：合成语料必须真的产出图表，否则本用例只是空转
    expect(produced).toBeGreaterThan(0)
  })

  it('另一批随机种子仍一致', () => {
    const inputs = buildSynthetic(20261009, 200)
    for (const buf of inputs) {
      expect(extractChartsFromWordDocumentStream(buf)).toEqual(referenceExtractCharts(buf))
    }
  })

  it('边界长度与 limit 附近签名一致', () => {
    for (const buf of buildBoundaryCases()) {
      expect(extractChartsFromWordDocumentStream(buf)).toEqual(referenceExtractCharts(buf))
    }
  })

  it('埋入可产出的 OLE 对象时给出确定的期望值', () => {
    // 700 字节全 1，offset 10 起埋 OLE 签名：内部 while 找不到 4 个连续零字节，
    // 走到流末尾 → chartSize = 700 - 10 = 690 > 500，应产出 1 个 oleobject 图表。
    const buf = new Uint8Array(700).fill(1)
    for (let x = 0; x < OLE_SIG.length; x++) buf[10 + x] = OLE_SIG[x]
    const out = extractChartsFromWordDocumentStream(buf)
    expect(out).toEqual(referenceExtractCharts(buf))
    expect(out).toHaveLength(1)
    expect(out[0].type).toBe('oleobject')
    expect(out[0].name).toBe('Embedded OLE Object 1')
    expect(out[0].dataSize).toBe(690)
  })

  it('第二字节位于流开头不能伪造负偏移签名，offset 0 真签名仍可产出', () => {
    for (const sig of [OLE_SIG, ZIP_SIG]) {
      const atZero = new Uint8Array(700).fill(1)
      atZero.set(sig, 0)
      expect(extractChartsFromWordDocumentStream(atZero)).toEqual(referenceExtractCharts(atZero))
      expect(extractChartsFromWordDocumentStream(atZero)[0].dataSize).toBe(700)
      const falseAnchor = new Uint8Array(700).fill(1)
      falseAnchor[0] = sig[1]
      falseAnchor.set(sig.slice(1), 11)
      expect(extractChartsFromWordDocumentStream(falseAnchor)).toEqual([])
    }
  })

  it('成功产出后跳过 endOffset+4，保留 endOffset+5 的第二对象', () => {
    for (const gap of [4, 5]) {
      const buf = new Uint8Array(1400).fill(1)
      buf.set(OLE_SIG, 0)
      buf.fill(0, 600, 604)
      buf.set(ZIP_SIG, 600 + gap)
      const out = extractChartsFromWordDocumentStream(buf)
      expect(out).toEqual(referenceExtractCharts(buf))
      expect(out).toHaveLength(gap === 4 ? 1 : 2)
    }
  })

  it('图表长度恰好500不产出，501才产出', () => {
    for (const size of [500, 501]) {
      const buf = new Uint8Array(700).fill(1)
      buf.set(OLE_SIG, 0)
      buf.fill(0, size, size + 4)
      expect(extractChartsFromWordDocumentStream(buf)).toEqual(referenceExtractCharts(buf))
      expect(extractChartsFromWordDocumentStream(buf)).toHaveLength(size === 500 ? 0 : 1)
    }
  })

  it('ZIP 签名产出 excel 类型', () => {
    const buf = new Uint8Array(700).fill(1)
    for (let x = 0; x < ZIP_SIG.length; x++) buf[10 + x] = ZIP_SIG[x]
    const out = extractChartsFromWordDocumentStream(buf)
    expect(out).toEqual(referenceExtractCharts(buf))
    expect(out).toHaveLength(1)
    expect(out[0].type).toBe('excel')
    expect(out[0].dataSize).toBe(690)
  })
})
