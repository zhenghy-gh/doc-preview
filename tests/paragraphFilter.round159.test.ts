// Round 159 护栏：`applyStructuralFormats` 的两处改动
//   (1) 删除恒为空转的 Step 3.5「12pt 短正文段并入后一段」循环；
//   (2) Step 3 正文着色循环：`subtitleSet` 空集短路 + 段落对象 / 文本局部量提升。
//
// 等价前提（本护栏钉死的不变量）：
//   被删循环的唯一触发条件是「prev 非空、非列表、字号恰为 12pt」。
//   而紧邻其上的 Step 3 正文循环会把**每个**段落改写成 10.5pt 或 18pt，除非命中四个 continue：
//     ① `paraFormat.listType`（保留原字号，但被删循环自己用 `!listType` 排除）；
//     ② `charFormat.fontSize === 28`（标题，28 ≠ 12）；
//     ③ 副标题行（副标题着色已写成 18pt，18 ≠ 12）；
//     ④ `text.length === 0`（空段，被删循环自己用 `text.length > 0` 排除）。
//   ⇒ Step 3 之后不存在「非空 + 非列表 + 12pt」的段落 ⇒ 被删循环在**全部**输入上恒为空转。
//
// 本文件用两条互相独立的断言钉死它：
//   A. 「改动前 Step 3.5 的逐行转写」作用在**函数输出**上必须为空操作（并配正控证明转写有鉴别力）；
//   B. 函数输出的不变量：不存在「非空 + 非列表 + fontSize===12」的段落。
// 负控：三处单行缺陷注入生产源码后，本护栏必须失败（见 changelog）。
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { DocParser } from '../src/utils/docParser'

const BODY_MIN_LEN = 100

/** 长于 150 字符的填充，避免触发列表分组等其它文本改写路径。 */
const PAD = '这是一段足够长的正文用于避开结构启发式的段落合并与副标题判定。'.repeat(4)

/** Step 3.5 触发形状里的「短段」：长度 < 20。 */
const SHORT_A = 'In non'
const SHORT_B = 'also short'

/**
 * 超过列表项上界（150）的长正文，用来稳定产出多个 10.5pt 正文段：
 * 长度 > 150 ⇒ 不会被 Step 2 判为列表项、也 > 50 ⇒ 不会被 Step 1 判为标题。
 */
const LONG = '这是一段足够长的正文用于避开结构启发式的段落合并与副标题判定并且长度超过列表项上限。'.repeat(5)

type P = {
  text: string
  charFormat?: Record<string, unknown>
  paraFormat?: Record<string, unknown>
  [k: string]: unknown
}

function newParser() {
  return new DocParser(new ArrayBuffer(512))
}

function runApply(texts: string[], cf: Record<string, unknown> = { fontSize: 12 }): P[] {
  const paras: P[] = texts.map((text) => ({ text, charFormat: { ...cf }, paraFormat: {} }))
  ;(newParser() as any).applyStructuralFormats(paras)
  return paras
}

/**
 * **改动前** Step 3.5 的逐行转写（就地修改给定数组），返回合并次数。
 * 与生产源码中被删除的循环逐语句对应。
 */
function referenceStep35Merge(paras: P[]): number {
  let merges = 0
  for (let i = paras.length - 1; i >= 1; i--) {
    const para = paras[i]
    const prev = paras[i - 1]
    if (
      prev.text.length > 0 &&
      prev.text.length < 20 &&
      (prev.charFormat as { fontSize?: number } | undefined)?.fontSize === 12 &&
      !(prev.paraFormat as { listType?: unknown } | undefined)?.listType &&
      para.text.length >= BODY_MIN_LEN
    ) {
      para.text = prev.text + para.text
      if (!para.charFormat) para.charFormat = prev.charFormat
      paras.splice(i - 1, 1)
      merges++
    }
  }
  return merges
}

/** 语料：全部以「短段(12pt, <20 字符) 紧邻 长段(>=100 字符)」的触发形状为主。 */
const CORPUS: Array<{ name: string; texts: string[] }> = [
  { name: '短段紧邻长段', texts: [PAD, SHORT_A, PAD] },
  { name: '两组触发形状', texts: [PAD, SHORT_A, PAD, SHORT_B, PAD] },
  { name: '短段在首位', texts: [SHORT_A, PAD, PAD] },
  { name: '标题 + 触发形状', texts: ['Title', SHORT_A, PAD, PAD] },
  { name: '副标题 + 触发形状（subtitleLines 非空）', texts: ['Title', 'Introduction to the system.', SHORT_A, PAD, PAD] },
  { name: '空段夹在中间', texts: [PAD, '', SHORT_A, PAD] },
  { name: '超长正文（非列表路径）', texts: [LONG, LONG, LONG] },
  { name: '短段 + 超长正文', texts: [LONG, SHORT_A, LONG] },
  { name: '纯长段（对照）', texts: [PAD, PAD, PAD] },
]

describe('Round 159 Step-3.5 死循环删除（参照转写在输出上必须为空操作）', () => {
  it('A1. 参照合并循环作用在函数输出上：0 次合并且输出逐字段不变', () => {
    for (const { name, texts } of CORPUS) {
      const out = runApply(texts)
      const snapshot = JSON.parse(JSON.stringify(out))
      const merges = referenceStep35Merge(out)
      expect(merges, `case「${name}」参照循环不应发生合并`).toBe(0)
      expect(out, `case「${name}」参照循环不应改动输出`).toEqual(snapshot)
    }
  })

  it('A2. 正控：参照转写自身有鉴别力（手工构造 prev=12pt 短段 + para>=100 时必须合并）', () => {
    const hand: P[] = [
      { text: SHORT_A, charFormat: { fontSize: 12 }, paraFormat: {} },
      { text: PAD, charFormat: { fontSize: 12 }, paraFormat: {} },
    ]
    const merges = referenceStep35Merge(hand)
    expect(merges).toBe(1)
    expect(hand).toHaveLength(1)
    expect(hand[0].text).toBe(SHORT_A + PAD)
  })

  it('A3. 非空转：语料里确实存在「<20 字符的段落紧邻 >=100 字符的段落」的触发形状', () => {
    let triggerPairs = 0
    for (const { texts } of CORPUS) {
      for (let i = 1; i < texts.length; i++) {
        if (texts[i - 1].length > 0 && texts[i - 1].length < 20 && texts[i].length >= BODY_MIN_LEN) triggerPairs++
      }
    }
    expect(triggerPairs).toBeGreaterThanOrEqual(6)
  })
})

describe('Round 159 输出不变量：Step 3 之后不存在「非空 + 非列表 + 12pt」段落', () => {
  it('B1. 不变量在全部语料上成立', () => {
    for (const { name, texts } of CORPUS) {
      const out = runApply(texts)
      const offenders = out.filter(
        (p) =>
          p.text.length > 0 &&
          !(p.paraFormat as { listType?: unknown } | undefined)?.listType &&
          (p.charFormat as { fontSize?: number } | undefined)?.fontSize === 12,
      )
      expect(offenders, `case「${name}」不应残留 12pt 正文段`).toEqual([])
    }
  })

  it('B2. 不变量非空转：语料确实产出了多个 10.5pt 正文段（Step 3 真的跑过）', () => {
    const out = runApply([LONG, LONG, LONG])
    const sizes = out
      .map((p) => (p.charFormat as { fontSize?: number } | undefined)?.fontSize)
      .filter((v) => v !== undefined)
    expect(sizes).toContain(10.5)
    expect(sizes.filter((v) => v === 10.5).length).toBeGreaterThanOrEqual(3)
  })

  it('B3. 副标题路径（subtitleLines 非空）下不变量仍成立且副标题为 18pt', () => {
    const out = runApply(['Title', 'Introduction to the system.', SHORT_A, PAD, PAD])
    const sizes = out
      .map((p) => (p.charFormat as { fontSize?: number } | undefined)?.fontSize)
      .filter((v) => v !== undefined)
    expect(sizes).toContain(28) // 标题
    expect(sizes).toContain(18) // 副标题
    const offenders = out.filter(
      (p) =>
        p.text.length > 0 &&
        !(p.paraFormat as { listType?: unknown } | undefined)?.listType &&
        (p.charFormat as { fontSize?: number } | undefined)?.fontSize === 12,
    )
    expect(offenders).toEqual([])
  })
})

describe('Round 159 接线元断言（生产源码口径）', () => {
  const src = readFileSync(
    resolve(__dirname, '../src/utils/docparser/heuristics/paragraphFilter.ts'),
    'utf8',
  )

  it('C1. 被删的 Step 3.5 循环确已不在源码里', () => {
    expect(src).not.toContain("prev.charFormat?.fontSize === 12")
    expect(src).not.toContain('Step 3.5: Merge short body paragraphs')
  })

  it('C2. 正文着色循环的空集短路与局部量提升确已落地', () => {
    expect(src).toContain('const hasSubtitleLines = subtitleLines.length > 0')
    expect(src).toContain('if (hasSubtitleLines && _subtitleSet.has(i)) continue')
    expect(src).toContain('const para = paragraphs[i]')
    expect(src).toContain('const paraText = para.text')
    // 旧写法（逐次 paragraphs[i] 取值）不应再出现在守卫链里
    expect(src).not.toContain('if (_subtitleSet.has(i)) continue')
    expect(src).not.toContain('if (paragraphs[i].text.length === 0) continue')
  })
})
