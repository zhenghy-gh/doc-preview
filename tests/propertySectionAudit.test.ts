import { describe, it, expect } from 'vitest'
import { parseSummaryInformation } from '../src/utils/propertyParser'
import { extractSections } from '../src/utils/sectionParser'

/**
 * 属性 / 分节解析边界审计（任务 B）补充用例。
 * 覆盖：非法 CodePage 类型、多节 PlcfSed 中夹带畸形 SEPX。
 */

type RawProp = { id: number; type: number; valueBytes: number[] }
const dword = (v: number): number[] => [v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >> 24) & 0xff]
const VT_LPSTR = 0x001e

function buildStream(props: RawProp[]): Uint8Array {
  const headerSize = 48
  const encoded = props.map((p) => [...dword(p.type), ...p.valueBytes])
  let sectionSize = 8 + props.length * 8
  for (const bytes of encoded) sectionSize += bytes.length
  const data = new Uint8Array(headerSize + sectionSize)
  const view = new DataView(data.buffer)
  view.setUint16(0, 0xfffe, true)
  view.setUint32(24, 1, true)
  view.setUint32(44, headerSize, true)
  const so = headerSize
  view.setUint32(so, sectionSize, true)
  view.setUint32(so + 4, props.length, true)
  let valueOffset = so + 8 + props.length * 8
  props.forEach((p, i) => {
    view.setUint32(so + 8 + i * 8, p.id, true)
    view.setUint32(so + 8 + i * 8 + 4, valueOffset - so, true)
    data.set(encoded[i], valueOffset)
    valueOffset += encoded[i].length
  })
  return data
}

describe('propertyParser 边界审计', () => {
  it('PID=1 类型非法（非 VT_I4）时忽略 CodePage，回退 windows-1252', () => {
    const data = buildStream([
      { id: 0x01, type: 0x9999, valueBytes: dword(936) }, // 类型非法，不得当作 CodePage
      { id: 0x02, type: VT_LPSTR, valueBytes: [0x80, 0x00] }, // windows-1252 €
    ])
    // 若误把非法类型当 CodePage=936，0x80 单字节在 GBK 下不是合法前导字节，
    // 解码结果将不是 '€'；回退 1252 才是正确行为。
    expect(parseSummaryInformation(data)?.title).toBe('€')
  })
})

describe('sectionParser 边界审计', () => {
  it('多节 PlcfSed 中夹带畸形 SEPX：坏节走默认值，相邻好节仍正确解析', () => {
    // 2 个节 → 3 个 CP + 2 个 SED。PlcfSed 长度 = 12*2+4 = 28，放在偏移 16。
    const fcPlcfSed = 16
    const lcb = 28
    const table = new Array(fcPlcfSed + lcb).fill(0)
    const w32 = (o: number, v: number) => { table[o] = v & 0xff; table[o + 1] = (v >> 8) & 0xff; table[o + 2] = (v >> 16) & 0xff; table[o + 3] = (v >> 24) & 0xff }
    const w16 = (o: number, v: number) => { table[o] = v & 0xff; table[o + 1] = (v >> 8) & 0xff }
    w32(fcPlcfSed + 0, 0)    // aFC[0]
    w32(fcPlcfSed + 4, 50)   // aFC[1]
    w32(fcPlcfSed + 8, 100)  // aFC[2]
    // SED[0]: fcSepx = 8，但 WordDocument 流里 cb 声明 400 > 流长度 → 畸形，走默认值
    w16(fcPlcfSed + 12, 0)
    w32(fcPlcfSed + 14, 8)
    // SED[1]: fcSepx = 32，正常 A4 宽度 SPRM
    w16(fcPlcfSed + 20, 0)
    w32(fcPlcfSed + 22, 32)

    const word = new Array(64).fill(0)
    const ww16 = (o: number, v: number) => { word[o] = v & 0xff; word[o + 1] = (v >> 8) & 0xff }
    ww16(8, 400) // SED[0] 的畸形 cb：8+2+400 远超 64
    ww16(32, 4)  // SED[1] 的 cb
    // grpprl: sprm 0xB002 (A4 width 11906twips)
    word[34] = 0x02; word[35] = 0xb0; word[36] = 11906 & 0xff; word[37] = (11906 >> 8) & 0xff

    const sections = extractSections(new Uint8Array(table), new Uint8Array(word), fcPlcfSed, lcb)
    expect(sections).toHaveLength(2)
    expect(sections[0].cpStart).toBe(0)
    expect(sections[0].cpEnd).toBe(50)
    expect(sections[0].pageWidthPt).toBeUndefined() // 畸形 SEPX → 默认值
    expect(sections[1].cpStart).toBe(50)
    expect(sections[1].cpEnd).toBe(100)
    expect(sections[1].pageWidthPt).toBeCloseTo(595.3, 0) // 好节不受影响
  })
})
