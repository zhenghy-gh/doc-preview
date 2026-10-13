/**
 * Round 156 常驻护栏 —— createParagraphsWithRealFormats 的 piece 级 CHPX 路径可用性门控。
 *
 * 被护栏保护的改动：在段落循环前一次性判定「整份 pieceMap 里是否存在可用的
 * piece CHPX（chpxIndex 有值且在 chpxRuns 范围内）」，无则整段跳过 pieceMap
 * 分支（该分支否则对每个段落都分配 overlapping 数组 + 捕获 cpStart/cpEnd 的
 * reduce 闭包并算 ratio，却因 chpxIndex 恒为 undefined 而从不写入 merged，
 * 结果被 fallback mergeCharFormatForParagraph 覆盖）。
 *
 * 等价性主张：**当没有 piece 携带可用 chpxIndex 时，跳过该分支是输出中性的**；
 * 而当确有可用 chpxIndex 时，piece 级格式必须照常生效（分支不得被误跳过）。
 *
 * 本护栏用可区分的合成输入（piece 级格式 = 原始 run.format；fallback = 阈值合并，
 * 二者对本样本给出不同结果）钉死上述两侧，并用「强制跳过」骨架做负控证明断言有鉴别力。
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { DocParser } from '../src/utils/docParser'
import * as formatParser from '../src/utils/formatParser'

// 两个段落：para0 = [0,20) "First paragraph text"；para1 = [21,42) "Second paragraph text"
const TEXT = 'First paragraph text\nSecond paragraph text'

// chpxRuns[0] 只覆盖 para0 的前 5 个字符：低于 fallback 的 bold 阈值（50% → 需 >10），
// 故 fallback 对 para0 返回 {}；而 piece 路径直接取 run.format → {bold:true}。
// 两条路径结果不同 ⇒ 可区分「分支是否生效」。
const CHPX_RUNS = [
  { cpStart: 0, cpEnd: 5, format: { bold: true } },
  { cpStart: 21, cpEnd: 42, format: { underline: true } },
]

function callCreate(pieceMap?: Array<{ start: number; end: number; chpxIndex?: number }>) {
  const parser = new DocParser(new ArrayBuffer(512))
  return (parser as unknown as {
    createParagraphsWithRealFormats: (
      text: string,
      chpxRuns: typeof CHPX_RUNS,
      papxRuns: unknown[],
      styles: unknown[],
      fontNames: string[],
      pieceMap?: Array<{ start: number; end: number; chpxIndex?: number }>,
      listEntries?: unknown[],
      lfoEntries?: unknown[],
    ) => Array<{ text: string; charFormat?: { bold?: boolean; underline?: boolean }; charFormatFromReal?: boolean }>
  }).createParagraphsWithRealFormats(TEXT, CHPX_RUNS, [], [], [], pieceMap, [], [])
}

afterEach(() => vi.restoreAllMocks())

describe('Round 156 piece-CHPX path gating', () => {
  it('no piece carries chpxIndex ⇒ output identical to an empty pieceMap (branch is a no-op)', () => {
    const spy = vi.spyOn(formatParser, 'mergeCharFormatForParagraph')
    const withPieces = callCreate([{ start: 0, end: 20 }, { start: 21, end: 42 }])
    const calledWithPieces = spy.mock.calls.length
    spy.mockClear()
    const noPieces = callCreate([])
    const calledNoPieces = spy.mock.calls.length

    // 输出逐字节相同 ⇒ 跳过的分支是输出中性的
    expect(JSON.stringify(withPieces)).toBe(JSON.stringify(noPieces))
    // 两侧都走了 fallback（分支无产出）
    expect(calledWithPieces).toBeGreaterThan(0)
    expect(calledNoPieces).toBeGreaterThan(0)
    expect(calledWithPieces).toBe(calledNoPieces)
    // 无 piece CHPX ⇒ para0 无真实字符格式
    expect(withPieces[0].charFormatFromReal).toBeFalsy()
  })

  it('a piece with a usable chpxIndex ⇒ piece-level format applies and fallback is skipped', () => {
    const spy = vi.spyOn(formatParser, 'mergeCharFormatForParagraph')
    const out = callCreate([{ start: 0, end: 20, chpxIndex: 0 }, { start: 21, end: 42, chpxIndex: 1 }])
    expect(spy).not.toHaveBeenCalled()
    expect(out[0].charFormatFromReal).toBe(true)
    expect(out[0].charFormat?.bold).toBe(true)
    expect(out[1].charFormatFromReal).toBe(true)
    expect(out[1].charFormat?.underline).toBe(true)
  })

  it('an out-of-range chpxIndex is NOT usable ⇒ treated like no piece CHPX', () => {
    const spy = vi.spyOn(formatParser, 'mergeCharFormatForParagraph')
    const out = callCreate([{ start: 0, end: 20, chpxIndex: 99 }, { start: 21, end: 42, chpxIndex: 99 }])
    expect(spy).toHaveBeenCalled()
    expect(out[0].charFormatFromReal).toBeFalsy()
    // 与空 pieceMap 逐字节一致
    spy.mockClear()
    const empty = callCreate([])
    expect(JSON.stringify(out)).toBe(JSON.stringify(empty))
  })

  it('per-document gate: usable anywhere ⇒ branch runs; a paragraph whose own piece lacks chpxIndex still falls back', () => {
    // piece0 可用（chpxIndex=0），piece1 不可用：整份可用 ⇒ 分支运行；para1 无 piece 产出 ⇒ fallback
    const spy = vi.spyOn(formatParser, 'mergeCharFormatForParagraph')
    const out = callCreate([{ start: 0, end: 20, chpxIndex: 0 }, { start: 21, end: 42 }])
    expect(out[0].charFormatFromReal).toBe(true)
    expect(out[0].charFormat?.bold).toBe(true) // piece 路径
    expect(out[1].charFormatFromReal).toBe(true)
    expect(out[1].charFormat?.underline).toBe(true) // fallback 仍合并出 underline
    expect(spy).toHaveBeenCalledTimes(1) // 仅 para1 走 fallback（para0 走 piece 路径）
  })
})

describe('Round 156 guard discriminating power (negative controls)', () => {
  /**
   * 复刻生产决策的骨架：forceSkip=true 模拟「门控写错、无条件跳过分支」的缺陷。
   * 与生产同一套判定条件（chpxIndex 有值且在范围内）。
   */
  function skeletonMerged(
    pieceMap: Array<{ start: number; end: number; chpxIndex?: number }>,
    chpxRuns: typeof CHPX_RUNS,
    cpStart: number,
    cpEnd: number,
    forceSkip: boolean,
  ): Record<string, unknown> {
    let merged: Record<string, unknown> = {}
    let used = false
    const usable = !forceSkip && pieceMap.some((p) => p.chpxIndex !== undefined && p.chpxIndex < chpxRuns.length)
    if (usable) {
      for (const p of pieceMap) {
        if (p.end > cpStart && p.start < cpEnd && p.chpxIndex !== undefined && p.chpxIndex < chpxRuns.length) {
          const pc = chpxRuns[p.chpxIndex]
          if (pc.format) {
            merged = { ...merged, ...pc.format }
            used = true
          }
        }
      }
    }
    if (!used) {
      merged = formatParser.mergeCharFormatForParagraph(chpxRuns, cpStart, cpEnd)
    }
    return merged
  }

  it('an "always skip" defect is detectable on the usable-chpxIndex case', () => {
    const pieces = [{ start: 0, end: 20, chpxIndex: 0 }]
    const correct = skeletonMerged(pieces, CHPX_RUNS, 0, 20, false)
    const buggy = skeletonMerged(pieces, CHPX_RUNS, 0, 20, true)
    expect(correct).toEqual({ bold: true })
    expect(buggy).toEqual({})
    // 缺陷版本与正确版本**不同** ⇒ 上述「piece 级格式必须生效」断言有鉴别力
    expect(buggy).not.toEqual(correct)
  })

  it('the skip is provably neutral when no piece has chpxIndex', () => {
    const pieces = [{ start: 0, end: 20 }, { start: 21, end: 42 }]
    const correct = skeletonMerged(pieces, CHPX_RUNS, 0, 20, false)
    const skipped = skeletonMerged(pieces, CHPX_RUNS, 0, 20, true)
    expect(correct).toEqual(skipped) // 无可用的 piece CHPX ⇒ 跳过与否结果一致
  })

  it('source still wires the one-time piece-path usability gate (wiring meta-assertion)', () => {
    const src = readFileSync(resolve(__dirname, '../src/utils/docParser.ts'), 'utf8')
    expect(src).toContain('piecePathUsable')
    expect(src).toContain('if (piecePathUsable && pieceMap)')
    // 门控条件必须同时校验 chpxIndex 有值与在范围内（缺一即缺陷）。
    // 只检查「门控区域」内（let piecePathUsable … 主循环前），避免误配分支体内同名判断。
    const gateStart = src.indexOf('let piecePathUsable')
    const gateEnd = src.indexOf('for (let i = 0; i < allParagraphs.length; i++)', gateStart)
    expect(gateStart).toBeGreaterThan(-1)
    expect(gateEnd).toBeGreaterThan(gateStart)
    const gate = src.slice(gateStart, gateEnd)
    expect(gate).toMatch(/p\.chpxIndex !== undefined && p\.chpxIndex < chpxRuns\.length/)
  })
})
