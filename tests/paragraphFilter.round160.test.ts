// Round 160 护栏：`applyStructuralFormats` Step 3 正文着色循环「短段落分支」的两处改动
//   (1) 惰性求值：把 `nextPara` / `nextIsLong` 挪进 `prevIsBody` 为真的分支内，
//       命中标题时直接 `continue`（原实现无条件先算这两个局部量再进 `if`）；
//   (2) 去掉两处恒真判断：`else if (len > 0)` 里的 `len > 0`、条件里的 `len < 100`；
//   顺带把长 / 短两个分支里的 `paragraphs[i]` 全部改用循环头部已取的局部量 `para`。
//
// 等价前提（本护栏钉死的不变量）：
//   进入 Step 3 正文循环的短段落分支时必有 `1 <= len < BODY_MIN_LEN`：
//     ① 空段在更上面被 `if (paraText.length === 0) continue` 排除；
//     ② `len >= BODY_MIN_LEN` 被同一 `if/else` 的前半支吃掉。
//   ⇒ 原 `else if (len > 0)` 的 `len > 0` 与条件里的 `len < 100` 恒真，删掉语义不变；
//   ⇒ `prevIsBody` 为假时 `nextPara` / `nextIsLong` 从未被读取，惰性化逐字节等价。
//
// 本文件用两条互相独立的断言钉死它：
//   A. 差分：生产函数输出（去空段后按序）与「改动前 Step 3 决策的逐行转写」逐段一致；
//   B. 边界与路径：`BODY_MIN_LEN` 恰为 100、首/末位邻居缺失、`\u0007` 替代路径、副标题路径。
// 负控：三处单行缺陷注入生产源码后，本护栏必须失败（见 changelog）。
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { DocParser } from '../src/utils/docParser'

const BODY_MIN_LEN = 100

/** 165 字符：> LIST_ITEM_MAX_LEN(150) ⇒ 不会进列表组、也不会被 Step 1 判为标题。 */
const LONG = '这是一段足够长的正文用于避开结构启发式判定并且长度超过列表项上限。'.repeat(5)
/** 60 字符：落在短段落分支（< 100），但孤立出现时不成列表组。 */
const SHORT = '短文段落用于测试正文着色循环的短段落分支判定逻辑是否保持一致'.repeat(2)
/** 5 字符：< LIST_ITEM_MIN_LEN(10) ⇒ 必定打断列表组，但仍是 Step 3 的「短段落」。 */
const TINY = 'abcde'
/** 5 字符且含表格标记：用来走 `nextIsLong` 的 `includes('\u0007')` 替代路径。 */
const TBL5 = '\u0007'.repeat(5)
/** 恰好卡在 BODY_MIN_LEN 两侧。 */
const EXACT99 = 'a'.repeat(99)
const EXACT100 = 'a'.repeat(100)

type P = {
  text: string
  charFormat?: Record<string, unknown>
  paraFormat?: Record<string, unknown>
  [k: string]: unknown
}

const fsOf = (p: P) => (p.charFormat as { fontSize?: number } | undefined)?.fontSize
const fliOf = (p: P) => (p.paraFormat as { firstLineIndent?: number } | undefined)?.firstLineIndent
const listOf = (p: P) => (p.paraFormat as { listType?: unknown } | undefined)?.listType

function newParser() {
  return new DocParser(new ArrayBuffer(512))
}

function runApply(texts: string[]): P[] {
  const paras: P[] = texts.map((text) => ({ text, charFormat: {}, paraFormat: {} }))
  ;(newParser() as any).applyStructuralFormats(paras)
  return paras
}

type Decision = 'long' | 'heading' | 'regular'

/** 三种决策对应的期望输出（改动前 / 改动后相同）。 */
const EXPECT: Record<Decision, { fontSize: number; firstLineIndent: number }> = {
  long: { fontSize: 10.5, firstLineIndent: 24 },
  heading: { fontSize: 18, firstLineIndent: 0 },
  regular: { fontSize: 10.5, firstLineIndent: 0 },
}

/**
 * **改动前** Step 3 正文着色循环的逐行转写（只算决策，不改数据）。
 *
 * 语料被刻意构造成「不形成列表组、不产生 28pt 标题、`subtitleLines` 为空」，
 * 因此 Step 3 之前不会有任何段落被写入 `listType`、`text` 也不会被改写，
 * 故可直接用原始输入数组做 prev/next 查询（原实现里的 `!prevPara.paraFormat?.listType`
 * 在本语料上恒为真，A1 末尾另有断言钉死「输出里没有任何 listType」）。
 */
function referenceDecision(texts: string[], i: number): Decision {
  const len = texts[i].length
  if (len >= BODY_MIN_LEN) return 'long'
  // 原实现：`else if (len > 0)` —— 空段已在上游被 continue 掉
  if (len > 0) {
    const prevText = i > 0 ? texts[i - 1] : null
    const nextText = i < texts.length - 1 ? texts[i + 1] : null
    const prevIsBody = prevText !== null && prevText.length >= BODY_MIN_LEN
    const nextIsLong =
      nextText !== null && (nextText.length >= BODY_MIN_LEN || nextText.includes('\u0007'))
    if (prevIsBody && nextIsLong && len < 100) return 'heading'
    return 'regular'
  }
  return 'regular'
}

const CORPUS: Array<{ name: string; texts: string[] }> = [
  { name: '长-短-长（触发标题）', texts: [LONG, SHORT, LONG] },
  { name: '长-短（末位 nextPara 缺失）', texts: [LONG, SHORT] },
  { name: '短-长-长（首位 prevPara 缺失）', texts: [SHORT, LONG, LONG] },
  { name: '三长-短-两长（触发标题）', texts: [LONG, LONG, LONG, SHORT, LONG, LONG] },
  { name: '三长-短-TINY-长（next 短且无 \\u0007 ⇒ 非标题）', texts: [LONG, LONG, LONG, SHORT, TINY, LONG] },
  { name: '三长-短-表标记-长（next 短但含 \\u0007 ⇒ 标题）', texts: [LONG, LONG, LONG, SHORT, TBL5, LONG] },
  { name: '长-99 字符（短分支边界）', texts: [LONG, EXACT99] },
  { name: '长-100 字符（长分支边界）', texts: [LONG, EXACT100] },
  { name: '纯长段对照', texts: [LONG, LONG, LONG] },
  { name: '长-短-长-短-长（两组触发）', texts: [LONG, SHORT, LONG, SHORT, LONG] },
]

describe('Round 160 差分：生产输出 ≡ 改动前 Step 3 决策转写', () => {
  it('A1. 去空段后逐段文本 / fontSize / firstLineIndent 全部一致', () => {
    for (const { name, texts } of CORPUS) {
      const out = runApply(texts)
      // 语料约束：Step 3.6 只插入空段、Step 4 无操作 ⇒ 去空段后应保持原序原数
      const kept = out.filter((p) => p.text.length > 0)
      expect(kept.length, `case「${name}」去空段后段落数应不变`).toBe(texts.length)
      kept.forEach((p, i) => {
        const decision = referenceDecision(texts, i)
        expect(p.text, `case「${name}」#${i} 文本应原样保留`).toBe(texts[i])
        expect(fsOf(p), `case「${name}」#${i} (${decision}) fontSize`).toBe(EXPECT[decision].fontSize)
        expect(
          fliOf(p),
          `case「${name}」#${i} (${decision}) firstLineIndent`,
        ).toBe(EXPECT[decision].firstLineIndent)
      })
      // 语料约束的非空转检查：不得有任何段落被 Step 2 判成列表项
      expect(
        out.filter((p) => listOf(p)).length,
        `case「${name}」不应形成列表组`,
      ).toBe(0)
    }
  })

  it('A2. 正控：决策转写自身有鉴别力（同语料上同时给出 heading 与 regular）', () => {
    expect(referenceDecision([LONG, SHORT, LONG], 1)).toBe('heading')
    expect(referenceDecision([LONG, LONG, LONG, SHORT, TINY, LONG], 3)).toBe('regular')
    expect(referenceDecision([SHORT, LONG, LONG], 0)).toBe('regular')
    expect(referenceDecision([LONG, LONG, LONG, SHORT, TBL5, LONG], 3)).toBe('heading')
  })

  it('A3. 非空转：语料同时覆盖 heading / regular / long 三种决策', () => {
    const counts: Record<Decision, number> = { long: 0, heading: 0, regular: 0 }
    for (const { texts } of CORPUS) {
      for (let i = 0; i < texts.length; i++) counts[referenceDecision(texts, i)]++
    }
    expect(counts.heading, 'heading 触发次数').toBeGreaterThanOrEqual(3)
    expect(counts.regular, 'regular 触发次数').toBeGreaterThanOrEqual(3)
    expect(counts.long, 'long 触发次数').toBeGreaterThanOrEqual(5)
  })
})

describe('Round 160 边界与路径', () => {
  it('B1. BODY_MIN_LEN 恰为 100（99 走短分支 fli=0，100 走长分支 fli=24）', () => {
    const out99 = runApply([LONG, EXACT99]).filter((p) => p.text.length > 0)
    expect(fsOf(out99[1])).toBe(10.5)
    expect(fliOf(out99[1])).toBe(0)

    const out100 = runApply([LONG, EXACT100]).filter((p) => p.text.length > 0)
    expect(fsOf(out100[1])).toBe(10.5)
    expect(fliOf(out100[1])).toBe(24)
  })

  it('B2. 邻居缺失：首位（prevPara=null）与末位（nextPara=null）都不得判为标题', () => {
    const first = runApply([SHORT, LONG, LONG]).filter((p) => p.text.length > 0)
    expect(fsOf(first[0])).toBe(10.5)
    expect(fliOf(first[0])).toBe(0)

    const last = runApply([LONG, SHORT]).filter((p) => p.text.length > 0)
    expect(fsOf(last[1])).toBe(10.5)
    expect(fliOf(last[1])).toBe(0)
  })

  it('B3. next 段落 <100 字符但含 \\u0007 时仍判为标题（替代路径）', () => {
    const withMark = runApply([LONG, LONG, LONG, SHORT, TBL5, LONG]).filter((p) => p.text.length > 0)
    expect(fsOf(withMark[3])).toBe(18)
    expect(fliOf(withMark[3])).toBe(0)

    // 对照：next 短且不含 \u0007 ⇒ 非标题
    const noMark = runApply([LONG, LONG, LONG, SHORT, TINY, LONG]).filter((p) => p.text.length > 0)
    expect(fsOf(noMark[3])).toBe(10.5)
    expect(fliOf(noMark[3])).toBe(0)
  })

  it('B4. 副标题路径（subtitleLines 非空）下循环仍正确：标题 28pt / 副标题 18pt / 正文 10.5pt', () => {
    const out = runApply(['Title', 'Introduction to the system.', SHORT, LONG, LONG])
    const sizes = out.map(fsOf).filter((v) => v !== undefined) as number[]
    expect(sizes).toContain(28)
    expect(sizes).toContain(18)
    expect(sizes).toContain(10.5)
    // 每个非空段落都落到了字号（即 Step 3 循环体覆盖到每一段）
    for (const p of out.filter((q) => q.text.length > 0)) {
      expect(fsOf(p), `段落「${p.text.slice(0, 12)}」应有字号`).toBeDefined()
    }
  })
})

describe('Round 160 接线元断言（生产源码口径）', () => {
  const src = readFileSync(
    resolve(__dirname, '../src/utils/docparser/heuristics/paragraphFilter.ts'),
    'utf8',
  )

  it('C1. 旧的急切求值与恒真判断不再出现在代码里', () => {
    expect(src).not.toContain('const prevIsBody = ')
    expect(src).not.toContain('prevIsBody && nextIsLong')
    expect(src).not.toContain('nextIsLong && len < 100')
    expect(src).not.toContain('} else if (len > 0) {')
  })

  it('C2. 新的嵌套守卫与标题分支的 continue 确已落地', () => {
    expect(src).toContain(
      'if (prevPara && prevPara.text.length >= BODY_MIN_LEN && !prevPara.paraFormat?.listType) {',
    )
    expect(src).toContain(
      "if (nextPara && (nextPara.text.length >= BODY_MIN_LEN || nextPara.text.includes('\\u0007'))) {",
    )
    expect(src).toContain('para.paraFormat.firstLineIndent = 0\n            continue')
    // 长 / 标题 / 正文三个分支都改用循环头部已取的局部量 `para`
    expect((src.match(/para\.charFormat = para\.charFormat \|\| \{\}/g) || []).length).toBeGreaterThanOrEqual(3)
  })
})
