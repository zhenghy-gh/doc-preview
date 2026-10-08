/**
 * PERF-T3 去重护栏验收：removeInternalDuplicates 限长护栏 + 整段折叠。
 *
 * 语义契约：
 * - ≤ REMOVE_DUP_EXACT_MAX_LEN(4096)：与既有任意周期算法逐字节同结果；
 * - > 4096：仅做整段二分/三分幂等折叠（纯幂串最终输出与旧算法一致——
 *   旧算法最大周期优先同样收敛到原语块），其余超长输入原样快速返回。
 */
import { describe, it, expect } from 'vitest'
import { DocParser } from '../src/utils/docParser'

const SECTOR = 512

function makeParser(): DocParser {
  return new DocParser(new ArrayBuffer(SECTOR))
}

function getFn(parser: DocParser): (t: string) => string {
  return (parser as unknown as { removeInternalDuplicates: (t: string) => string }).removeInternalDuplicates.bind(parser)
}

/** 无整块重复的长文生成器（词表拼接+伪随机扰动）。 */
function makeJunk(n: number): string {
  let s = ''
  let x = 12345
  const words = ['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta', 'eta', 'theta']
  while (s.length < n) {
    x = (x * 1103515245 + 12345) >>> 0
    s += words[x % words.length] + (x % 7 === 0 ? '.' : '')
  }
  return s.slice(0, n)
}

describe('PERF-T3 病态样本护栏', () => {
  it('20k 无匹配长段：<1s 完成且原样返回（改前实测 54s；阈值留并发裕量防抖动）', () => {
    const parser = makeParser()
    const fn = getFn(parser)
    const s = makeJunk(20000)
    const t0 = performance.now()
    const out = fn(s)
    const ms = performance.now() - t0
    expect(out).toBe(s) // 非幂超长段护栏放行
    expect(ms).toBeLessThan(1000)
  })

  it('50k 无匹配长段：<1s', () => {
    const parser = makeParser()
    const fn = getFn(parser)
    const s = makeJunk(50000)
    const t0 = performance.now()
    expect(fn(s)).toBe(s)
    expect(performance.now() - t0).toBeLessThan(1000)
  })
})

describe('PERF-T3 语义等价性', () => {
  it('纯幂串（整段×8）：坍缩到与旧算法一致的原语块定点', () => {
    const parser = makeParser()
    const fn = getFn(parser)
    const blk = makeJunk(800) // <4096，blk 自身走精确路径
    const rep = blk.repeat(8)
    const t0 = performance.now()
    const out = fn(rep)
    expect(performance.now() - t0).toBeLessThan(1000)
    // 定点等价：fn(blk×8) === fn(blk)（旧算法最大周期优先同样收敛到该定点）
    expect(out).toBe(fn(blk))
    expect(out.length).toBeLessThan(blk.length) // blk 内部含可折叠 tandem
  })

  it('整段×3（奇余量形态）：三分折叠收敛到单块', () => {
    const parser = makeParser()
    const fn = getFn(parser)
    const blk = 'ABCDEFGHIJ' + 'KLMNOPQRST' + 'UVWXYZ0123' + '456789abcd' // 40 chars ≥12
    const out = fn(blk.repeat(3))
    expect(out).toBe(fn(blk))
  })

  it('经典双句复制：相邻重复块折叠为单份', () => {
    const parser = makeParser()
    const fn = getFn(parser)
    const s = 'The quick brown fox jumps over the lazy dog near the river bank.'
    expect(fn(s + s)).toBe(s)
  })

  it('短周期散文保护不变（n<24 时 floor(n/2)<12，任何周期都不扫描）', () => {
    const parser = makeParser()
    const fn = getFn(parser)
    const prose = 'had had had had had ' // 20 chars，仅含短周期合法重复
    expect(fn(prose)).toBe(prose)
  })
})

describe('PERF-T3 阈值边界', () => {
  it('2048（阈值内）快速收敛且幂等；2049（阈值外）junk 原样通过', () => {
    const parser = makeParser()
    const fn = getFn(parser)
    // 阈值内：完整算法可能合法折叠伪随机文本中的偶发 tandem——
    // 验证快速 + 幂等收敛即可。
    const sIn = makeJunk(2048)
    let t0 = performance.now()
    const once = fn(sIn)
    expect(performance.now() - t0).toBeLessThan(1000)
    expect(fn(once)).toBe(once)
    // 阈值外：护栏直接放行非幂长段（字节级原样）
    const sOut = makeJunk(2049)
    t0 = performance.now()
    expect(fn(sOut)).toBe(sOut)
    expect(performance.now() - t0).toBeLessThan(1000)
  })

  it('2049 的纯幂串仍被折叠（护栏路径生效）', () => {
    const parser = makeParser()
    const fn = getFn(parser)
    const blk = makeJunk(700)
    const rep = blk.repeat(3) // 2100 > 2048 且为整块×3
    const out = fn(rep)
    expect(out).toBe(fn(blk))
  })
})
