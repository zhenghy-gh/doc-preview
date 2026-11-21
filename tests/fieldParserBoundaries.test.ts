/**
 * fieldParser / headerFooterParser 边界回归（Phase 3 / 任务 A）。
 *
 * 负控纪律：每个「修复」用例在撤回对应源码改动时必须失败。
 */
import { describe, it, expect } from 'vitest'
import { parseIndexResult, parsePlcfFld, extractAllFields } from '../src/utils/fieldParser'
import { splitHeaderText, parsePlcfHdd } from '../src/utils/headerFooterParser'

function writeUtf16le(target: Uint8Array, offset: number, s: string): void {
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i)
    target[offset + i * 2] = code & 0xff
    target[offset + i * 2 + 1] = (code >> 8) & 0xff
  }
}

describe('parseIndexResult 缩进判定边界', () => {
  it('行尾空格不得被当作子项缩进（负控：撤回 trimStart 修复则失败）', () => {
    // 真实 INDEX 结果常含行尾填充空格；缩进应只由「行首」空白决定。
    const result = 'Apple.................1\nBanana................2   '
    const entries = parseIndexResult(result)
    expect(entries).toHaveLength(2)
    expect(entries[1].mainTerm).toBe('Banana')
    expect(entries[1].subTerm).toBeUndefined()
    expect(entries[1].pageNumber).toBe('2')
  })

  it('制表符缩进的子项仍被正确识别', () => {
    const result = 'Main\t5\n\tSub\t6'
    const entries = parseIndexResult(result)
    expect(entries).toHaveLength(2)
    expect(entries[1]).toEqual({ mainTerm: 'Main', subTerm: 'Sub', pageNumber: '6' })
  })

  it('行首空格 + 行尾空格同时存在时仍为子项', () => {
    const result = 'Apple.................1\n   Red apple...........2   '
    const entries = parseIndexResult(result)
    expect(entries[1].mainTerm).toBe('Apple')
    expect(entries[1].subTerm).toBe('Red apple')
  })
})

describe('PlcfFld / PlcfHdd 边界输入不抛异常', () => {
  it('parsePlcfFld 对越界 fc/lcb 返回空', () => {
    expect(parsePlcfFld(new Uint8Array(20), 18, 100)).toEqual([])
    expect(parsePlcfFld(new Uint8Array(20), -1, 10)).toEqual([])
  })

  it('extractAllFields 对非法 CP（sep 早于 begin）不产生字段', () => {
    const entries = [
      { cp: 10, ch: 0x13, flt: 37 },
      { cp: 2, ch: 0x14, flt: 0 },
      { cp: 15, ch: 0x15, flt: 0 },
    ]
    const bytes = new Uint8Array(40)
    writeUtf16le(bytes, 2, 'HYPERLINK "http://x.com"')
    expect(extractAllFields(entries, 'x', bytes)).toHaveLength(0)
  })

  it('splitHeaderText 对负 CP 与超大 CP 做钳制，不返回空范围', () => {
    const split = parsePlcfHdd(
      (() => {
        const data = new Uint8Array(16)
        data[0] = 0; data[4] = 5
        return data
      })(),
      false,
      false,
    )
    expect(split).not.toBeNull()
    // 显式构造含非法 CP 的 split（parsePlcfHdd 自身已跳过空范围）
    const result = splitHeaderText('HelloWorld', {
      parts: [
        { type: 'oddHeader', startCp: -10, endCp: 5 },
        { type: 'oddFooter', startCp: 999, endCp: 1000 },
      ],
    })
    expect(result).not.toBeNull()
    expect(result!.oddHeader).toBe('Hello')
    expect(result!.oddFooter).toBeUndefined()
  })
})
