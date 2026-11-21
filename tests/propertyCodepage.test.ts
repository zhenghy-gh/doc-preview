import { describe, it, expect } from 'vitest'
import { parseSummaryInformation } from '../src/utils/propertyParser'

/**
 * CODEPAGE 负控（任务 B）：MS-OLEPS 规定每节的属性 PID=1（VT_I4）是 CodePage，
 * 决定本节 VT_LPSTR 字符串的编码。原实现固定用 latin1 解码，导致以 GBK / Shift-JIS
 * 写入 ANSI 元数据（如标题、作者）的文件被解成乱码。
 *
 * 撤回修复（readAnsiString 固定 latin1）后，前两项断言失败；
 * 无 CodePage 属性时须保持 windows-1252 行为（与 latin1 别名一致）。
 */
type RawProp = { id: number; type: number; valueBytes: number[] }

function dword(v: number): number[] {
  return [v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >> 24) & 0xff]
}

function buildStream(props: RawProp[]): Uint8Array {
  const headerSize = 48
  const encoded = props.map((p) => [...dword(p.type), ...p.valueBytes])
  let sectionSize = 8 + props.length * 8
  for (const bytes of encoded) sectionSize += bytes.length
  const data = new Uint8Array(headerSize + sectionSize)
  const view = new DataView(data.buffer)

  view.setUint16(0, 0xfffe, true) // little-endian marker
  view.setUint32(24, 1, true) // section count
  view.setUint32(44, headerSize, true) // section offset

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

const VT_I4 = 0x0003
const VT_LPSTR = 0x001e

describe('propertyParser - LPSTR 按节 CodePage 解码（负控）', () => {
  it('CodePage=936(GBK) 的 LPSTR 标题正确解码为中文', () => {
    const data = buildStream([
      { id: 0x01, type: VT_I4, valueBytes: dword(936) }, // CodePage
      { id: 0x02, type: VT_LPSTR, valueBytes: [0xd6, 0xd0, 0xce, 0xc4, 0x00] }, // "中文" GBK
    ])
    expect(parseSummaryInformation(data)?.title).toBe('中文')
  })

  it('CodePage=932(Shift-JIS) 的 LPSTR 标题正确解码为日文', () => {
    const data = buildStream([
      { id: 0x01, type: VT_I4, valueBytes: dword(932) }, // CodePage
      { id: 0x02, type: VT_LPSTR, valueBytes: [0x93, 0xfa, 0x96, 0x7b, 0x00] }, // "日本" Shift-JIS
    ])
    expect(parseSummaryInformation(data)?.title).toBe('日本')
  })

  it('无 CodePage 属性时保持 windows-1252 行为（协议兼容）', () => {
    const data = buildStream([
      { id: 0x02, type: VT_LPSTR, valueBytes: [0x80, 0x00] }, // windows-1252 的 €
    ])
    expect(parseSummaryInformation(data)?.title).toBe('€')
  })
})
