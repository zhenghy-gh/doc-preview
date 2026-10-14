// Round 168 护栏：`getHeadingLevel` 的**按样式名记忆化**（src/utils/styleParser.ts）。
//
// 背景（先量后改）：
//   * `getHeadingLevel` 真实 **33,690 次/轮**（`createParagraphsWithRealFormats`
//     对每个「sprmPOutlineLvl 未定级」的段落调一次），但整轮只有 **25 个不同样式名**，
//     且 **95.9% 是 `"Normal"`**（32,317 次）。
//   * 每次调用白跑 2 个锚定正则（`/^heading\s*(\d+)$/i`、`/^标题\s*(\d+)$/`）；
//     `"Normal"` 两个都在首字符即失配 ⇒ 纯粹白算。
//   * 隔离实测（真实单轮样式名多重集回放）：0.95 ms → 0.20 ms（**4.6×**，中位数）。
//
// 等价性前提：`getHeadingLevel` 是**样式名的纯函数**（只读入参、无模块状态、无副作用）
// ⇒「同名 ⇒ 同结果」可自证；缓存命中与重算逐位相同；缓存上界只丢缓存、不改语义。
//
// 本文件守住三件事：
//
//   A 组 **原语等价**：真实样式名多重集（锚定 33,690 次调用 / 25 个不同名）+
//      顺序无关性 + 前缀×分隔×数字×后缀的**穷举** + 对抗性名字 + 随机模糊 +
//      缓存上界路径，逐次与改动前实现（本文件内逐行转写的
//      `round168OldGetHeadingLevel`）相同。
//   B 组 **鉴别力**：骨架负控（丢 1..9 界 / 丢中文分支 / 丢 `i` 标志 / 缓存键塌缩 /
//      缓存键 trim）必须与 oracle 不同 —— 证明本护栏抓得住「记忆化写错」。
//   C 组 **接线元断言**：缓存声明、上界、纯函数分离、原正则原样保留、判据非真值判定、
//      调用点仍在。记忆化是**行为保持型**改动，「比输出」的测试抓不住它被整体回退
//      （见 Round 164 教训 10），只能靠源码文本断言 + 离树负控。
//
// 本轮同时**否决**了「`mergeCharFormatForParagraph` 按身份格式签名表」候选：
// 它与既有 Round 134 契约（跨调用必须观察到 `run.format` / `fontNames` / `styleFormats`
// 的**原地改动**，且非法 format 只在被取用时抛 TypeError）结构性冲突，全量门禁
// 实测 3 项失败 ⇒ 整段撤回，未落地任何生产代码（详见本轮 changelog）。
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import { getHeadingLevel } from '../src/utils/styleParser'

// ══════════════════════════════════════════════════════════════════════════
// oracle：改动前实现（逐行转写自 HEAD，仅改函数名）
// ══════════════════════════════════════════════════════════════════════════

function round168OldGetHeadingLevel(styleName: string): number | null {
  const match = styleName.match(/^heading\s*(\d+)$/i)
  if (match) {
    const level = parseInt(match[1], 10)
    if (level >= 1 && level <= 9) return level
  }
  const zhMatch = styleName.match(/^标题\s*(\d+)$/)
  if (zhMatch) {
    const level = parseInt(zhMatch[1], 10)
    if (level >= 1 && level <= 9) return level
  }
  return null
}

// ══════════════════════════════════════════════════════════════════════════
// 夹具
// ══════════════════════════════════════════════════════════════════════════

/** 真实单轮 33,690 次调用的样式名多重集（取自 Round 168 计数插桩）。 */
const REAL_DIST: Array<[string, number]> = [
  ['Normal', 32317], ['Normal (Web)', 769], ['Plain Text', 189], ['Standard (Web)', 85],
  ['Heading 2', 82], ['Text Body', 56], ['Heading 1', 48], ['Table Contents', 33],
  ['Normal,text', 30], ['Body Text 2', 19], ['Heading 3', 17], ['Body Text', 10],
  ['Body Text Indent 3', 8], ['Title', 5], ['Header', 5], ['BlockStyleTest', 4],
  ['Heading 8', 3], ['Footer', 2], ['Heading 4', 2], ['title', 1], ['author', 1],
  ['status', 1], ['action', 1], ['Heading 7', 1], ['Paper title', 1],
]

/** 真实调用序列（保持插桩时的原始顺序）。 */
const REAL_SEQ: string[] = (() => {
  const out: string[] = []
  for (const [n, c] of REAL_DIST) for (let i = 0; i < c; i++) out.push(n)
  return out
})()

/** 对抗性名字：边界、大小写、空白、中文、非 ASCII。 */
const ADVERSARIAL: string[] = [
  'heading 1', 'HEADING 1', 'HeAdInG 1', 'heading  1', 'heading\t1', 'heading\n1',
  'heading 1 ', ' heading 1', 'heading1', 'heading 0', 'heading 10', 'heading 9',
  'heading 99', 'heading -1', 'heading 1.5', 'heading 00001', 'heading 99999999999',
  'heading', 'headin 1', 'heading x', 'heading 1X', 'xheading 1', 'heading 1\n',
  '标题 1', '标题 9', '标题 0', '标题 10', '标题1', '标题  1', '标题 1 ', ' 标题 1',
  '标题\t1', '标题', '标 题 1', '標題 1', '标题 １', '标题 1\n',
  '', ' ', '\t', '\n', 'h', 'H', 'N', 'Normal', 'Normal (Web)', 'Title', 'title',
  '見出し 1', 'Überschrift 1', 'Heading ½', '\u00a0heading 1', 'heading\u20281',
]

/** 确定性 LCG（可复现）。 */
function lcg(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 4294967296
  }
}

/** 穷举表：前缀 × 分隔 × 数字 × 后缀 的完整叉积。 */
const PREFIXES = ['heading', 'Heading', 'HEADING', 'HeAdInG', '标题', '標題', 'head', 'h', '', 'x', 'headingx']
const SEPS = ['', ' ', '  ', '\t', '\n', ' \t']
const DIGITS = ['', '0', '1', '5', '9', '10', '01', '007', '99', '99999999999', '-1', '1.5', '1a', 'x', '１']
const SUFFIXES = ['', ' ', '  ', '\n', '\t', 'X', '.5', ' (Web)', ',text', ' 1']

const EXHAUSTIVE: string[] = (() => {
  const out: string[] = []
  for (const p of PREFIXES) {
    for (const s of SEPS) {
      for (const d of DIGITS) {
        for (const sfx of SUFFIXES) out.push(p + s + d + sfx)
      }
    }
  }
  return out
})()

/** 逐名比对：返回比对次数与失配清单（用聚合断言避免上万次 expect 的开销）。 */
function diffNames(names: Iterable<string>): { compared: number; mismatches: string[] } {
  let compared = 0
  const mismatches: string[] = []
  for (const n of names) {
    const got = getHeadingLevel(n)
    const want = round168OldGetHeadingLevel(n)
    if (got !== want) mismatches.push(`${JSON.stringify(n)}: got ${String(got)}, want ${String(want)}`)
    compared++
  }
  return { compared, mismatches }
}

// ══════════════════════════════════════════════════════════════════════════
// A 组：原语等价
// ══════════════════════════════════════════════════════════════════════════

describe('Round 168 A 组：getHeadingLevel 记忆化等价', () => {
  it('A1 真实样式名多重集：33,690 次调用逐次与 oracle 相同', () => {
    expect(REAL_SEQ.length).toBe(33690)
    expect(new Set(REAL_SEQ).size).toBe(25)
    expect(REAL_DIST[0]).toEqual(['Normal', 32317])
    const { compared, mismatches } = diffNames(REAL_SEQ)
    expect(mismatches).toEqual([])
    expect(compared).toBe(33690)
  })

  it('A2 记忆化不得引入调用顺序依赖（原序 vs 确定性乱序 vs 单名重复）', () => {
    // 原序建表
    const byName = new Map<string, number | null>()
    for (const n of REAL_SEQ) if (!byName.has(n)) byName.set(n, getHeadingLevel(n))
    expect(byName.size).toBe(25)
    for (const [n, v] of byName) expect(v, n).toBe(round168OldGetHeadingLevel(n))

    // 确定性乱序（Fisher–Yates with LCG）后逐次必须仍等于原序结果
    const rnd = lcg(0x168_02)
    const shuffled = [...REAL_SEQ]
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1))
      const tmp = shuffled[i]
      shuffled[i] = shuffled[j]
      shuffled[j] = tmp
    }
    const mismatches: string[] = []
    for (const n of shuffled) if (getHeadingLevel(n) !== byName.get(n)) mismatches.push(n)
    expect(mismatches).toEqual([])

    // 同一名字连续 1,000 次（全命中路径）必须稳定
    const repeats: string[] = []
    for (let i = 0; i < 1000; i++) repeats.push('Normal')
    expect(diffNames(repeats).mismatches).toEqual([])
  })

  it('A3 穷举「前缀×分隔×数字×后缀」叉积 + 对抗性名字，全部与 oracle 相同', () => {
    expect(EXHAUSTIVE.length).toBe(9900)
    expect(diffNames(EXHAUSTIVE).mismatches).toEqual([])
    expect(diffNames(ADVERSARIAL).mismatches).toEqual([])
    // 对抗集必须真正覆盖「非空返回」与「null 返回」两侧（否则是空转）
    const nonNull = ADVERSARIAL.filter((n) => round168OldGetHeadingLevel(n) !== null).length
    const nulls = ADVERSARIAL.filter((n) => round168OldGetHeadingLevel(n) === null).length
    expect(nonNull).toBeGreaterThan(10)
    expect(nulls).toBeGreaterThan(10)
    // 穷举集里也必须有命中（含中文分支与英文分支）
    expect(EXHAUSTIVE.some((n) => round168OldGetHeadingLevel(n) === 7)).toBe(true)
  })

  it('A4 随机模糊：5,000 条任意码元串与 oracle 相同', () => {
    const rnd = lcg(0x168_4)
    const POOL = 'headingHAGI NG\t\n0123456789.-xX标題１(),\u00a0\u2028\u2029'
    const names: string[] = []
    for (let t = 0; t < 5000; t++) {
      const len = Math.floor(rnd() * 15)
      let s = ''
      for (let k = 0; k < len; k++) s += POOL.charAt(Math.floor(rnd() * POOL.length))
      names.push(s)
    }
    expect(names.length).toBe(5000)
    expect(diffNames(names).mismatches).toEqual([])
  })

  it('A5 缓存上界路径：注入 > 4,096 个不同名字触发清空后，已知名字仍必须正确', () => {
    // 先让若干已知名字进入缓存
    const known = ['Normal', 'Heading 4', '标题 3', 'heading 2', 'HEADING 9', 'Body Text']
    const before = known.map((n) => getHeadingLevel(n))
    expect(before).toEqual(known.map((n) => round168OldGetHeadingLevel(n)))

    // 注入 5,000 个不同名字 ⇒ 至少触发一次 clear()
    for (let i = 0; i < 5000; i++) getHeadingLevel(`Synthetic Style ${i}`)
    expect(diffNames(['Synthetic Style 0', 'Synthetic Style 4999']).mismatches).toEqual([])

    // 清空只丢缓存、不改语义：已知名字与清空前结果一致，且仍与 oracle 一致
    expect(known.map((n) => getHeadingLevel(n))).toEqual(before)
    expect(diffNames(known).mismatches).toEqual([])

    // 真实多重集在上界冲击后重放仍逐次正确
    expect(diffNames(REAL_SEQ).mismatches).toEqual([])
  })
})

// ══════════════════════════════════════════════════════════════════════════
// B 组：骨架负控鉴别力
// ══════════════════════════════════════════════════════════════════════════

type SkMode = 'ok' | 'noRangeCheck' | 'noZh' | 'caseSensitive' | 'keyCollapse' | 'keyTrimmed'

const skCache = new Map<string, number | null>()

function skCompute(styleName: string, mode: SkMode): number | null {
  const m = styleName.match(mode === 'caseSensitive' ? /^heading\s*(\d+)$/ : /^heading\s*(\d+)$/i)
  if (m) {
    const level = parseInt(m[1], 10)
    if (mode === 'noRangeCheck' || (level >= 1 && level <= 9)) return level
  }
  if (mode !== 'noZh') {
    const z = styleName.match(/^标题\s*(\d+)$/)
    if (z) {
      const level = parseInt(z[1], 10)
      if (mode === 'noRangeCheck' || (level >= 1 && level <= 9)) return level
    }
  }
  return null
}

/** 与生产同构的骨架：按名记忆化（mode 注入各类缺陷）。 */
function round168HeadingSkeleton(styleName: string, mode: SkMode): number | null {
  const key =
    mode === 'keyCollapse'
      ? styleName.charAt(0)
      : mode === 'keyTrimmed'
        ? styleName.trim()
        : styleName
  const cached = skCache.get(key)
  if (cached !== undefined) return cached
  const v = skCompute(styleName, mode)
  skCache.set(key, v)
  return v
}

function runSkeleton(names: string[], mode: SkMode): Array<number | null> {
  skCache.clear()
  return names.map((n) => round168HeadingSkeleton(n, mode))
}

function runOracle(names: string[]): Array<number | null> {
  return names.map((n) => round168OldGetHeadingLevel(n))
}

describe('Round 168 B 组：骨架负控鉴别力', () => {
  it('B1 正控：保留全部语义的骨架在真实 + 穷举 + 对抗 + 随机输入上与 oracle 完全一致', () => {
    expect(runSkeleton(REAL_SEQ, 'ok')).toEqual(runOracle(REAL_SEQ))
    expect(runSkeleton(EXHAUSTIVE, 'ok')).toEqual(runOracle(EXHAUSTIVE))
    expect(runSkeleton(ADVERSARIAL, 'ok')).toEqual(runOracle(ADVERSARIAL))
    const rnd = lcg(0x168_b1)
    const names: string[] = []
    for (let t = 0; t < 800; t++) names.push(EXHAUSTIVE[Math.floor(rnd() * EXHAUSTIVE.length)])
    expect(runSkeleton(names, 'ok')).toEqual(runOracle(names))
  })

  it('B2 负控「丢 1..9 界」：越界等级必须与 oracle 不同', () => {
    const probe = ['heading 0', 'heading 10', '标题 0', '标题 10', 'Heading 3', 'Normal']
    expect(runSkeleton(probe, 'ok')).toEqual(runOracle(probe))
    expect(runSkeleton(probe, 'noRangeCheck')).not.toEqual(runOracle(probe))
  })

  it('B3 负控「丢中文分支」：中文标题必须与 oracle 不同', () => {
    const probe = ['标题 1', '标题 9', 'Heading 2', 'Normal']
    expect(runSkeleton(probe, 'ok')).toEqual(runOracle(probe))
    expect(runSkeleton(probe, 'noZh')).not.toEqual(runOracle(probe))
  })

  it('B4 负控「丢 i 标志」：大小写变体必须与 oracle 不同', () => {
    const probe = ['HEADING 3', 'Heading 3', 'heading 3', 'Normal']
    expect(runSkeleton(probe, 'ok')).toEqual(runOracle(probe))
    expect(runSkeleton(probe, 'caseSensitive')).not.toEqual(runOracle(probe))
  })

  it('B5 负控「缓存键塌缩为首字符」：同首字符不同名必须与 oracle 不同', () => {
    const probe = ['Heading 2', 'Heading 1', 'Header', 'Heading 3']
    expect(runSkeleton(probe, 'ok')).toEqual(runOracle(probe))
    expect(runSkeleton(probe, 'keyCollapse')).not.toEqual(runOracle(probe))
  })

  it('B6 负控「缓存键 trim」：带尾随空白的名字必须与 oracle 不同', () => {
    const probe = ['Heading 1 ', 'Heading 1', '标题 2 ', '标题 2']
    expect(runSkeleton(probe, 'ok')).toEqual(runOracle(probe))
    expect(runSkeleton(probe, 'keyTrimmed')).not.toEqual(runOracle(probe))
  })

  it('B7 元断言：负控探针本身非空转（ok 与缺陷模式确有分歧点）', () => {
    for (const mode of ['noRangeCheck', 'noZh', 'caseSensitive', 'keyCollapse', 'keyTrimmed'] as SkMode[]) {
      const probe = [...ADVERSARIAL, ...EXHAUSTIVE.slice(0, 500)]
      const okOut = runSkeleton(probe, 'ok')
      const badOut = runSkeleton(probe, mode)
      expect(badOut, mode).not.toEqual(okOut)
    }
  })
})

// ══════════════════════════════════════════════════════════════════════════
// C 组：接线元断言（源码文本）
// ══════════════════════════════════════════════════════════════════════════

describe('Round 168 C 组：接线元断言', () => {
  const STYLE = fs.readFileSync(new URL('../src/utils/styleParser.ts', import.meta.url), 'utf8')
  const DOC = fs.readFileSync(new URL('../src/utils/docParser.ts', import.meta.url), 'utf8')

  it('C1 缓存声明、上界常量与纯函数分离齐备，且各只定义一次', () => {
    expect(STYLE).toContain('const HEADING_LEVEL_CACHE_MAX = 4096')
    expect(STYLE).toContain('const headingLevelCache = new Map<string, number | null>()')
    expect(STYLE.split('const headingLevelCache = new Map<string, number | null>()').length - 1).toBe(1)
    expect(STYLE.split('function computeHeadingLevel(').length - 1).toBe(1)
    expect(STYLE).toContain('function computeHeadingLevel(styleName: string): number | null {')
  })

  it('C2 判据为 `cached !== undefined`、上界清空后仍写入，且缓存键就是原始入参', () => {
    const start = STYLE.indexOf('export function getHeadingLevel(styleName: string): number | null {')
    expect(start).toBeGreaterThan(0)
    const end = STYLE.indexOf('\n}\n', start)
    expect(end).toBeGreaterThan(start)
    const body = STYLE.slice(start, end)
    expect(body).toContain('const cached = headingLevelCache.get(styleName)')
    expect(body).toContain('if (cached !== undefined) return cached')
    expect(body).toContain('const computed = computeHeadingLevel(styleName)')
    expect(body).toContain('if (headingLevelCache.size >= HEADING_LEVEL_CACHE_MAX) headingLevelCache.clear()')
    expect(body).toContain('headingLevelCache.set(styleName, computed)')
    // 真值判定会把 `null` 结果当成未命中（语义不变但每次都重算 ⇒ 记忆化失效）
    expect(body).not.toContain('if (cached) return cached')
    // 缓存键必须是原始入参，不得 trim / 取首字符
    expect(body).not.toContain('styleName.trim()')
    expect(body).not.toContain('styleName.charAt(0)')
  })

  it('C3 原正则与 1..9 界判定原样保留（缓存包装不得改写判定逻辑）', () => {
    expect(STYLE).toContain('styleName.match(/^heading\\s*(\\d+)$/i)')
    expect(STYLE).toContain('styleName.match(/^标题\\s*(\\d+)$/)')
    expect(STYLE.split('if (level >= 1 && level <= 9) return level').length - 1).toBe(2)
  })

  it('C4 调用点仍在：docParser 每段落一次 + detectStyleSet 探测一次', () => {
    expect(DOC).toContain('const headingLevel = getHeadingLevel(style.name)')
    expect(DOC).toContain('if (newPara.paraFormat.headingLevel === undefined) {')
    expect(STYLE).toContain('styles.some(s => getHeadingLevel(s.name) !== null)')
  })
})
