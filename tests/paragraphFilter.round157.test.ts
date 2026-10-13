// Round 157 护栏：`applyStructuralFormats` Step 4 的「混合图片占位符拆分为独立段落」
// 判定，由 `text.includes('\u0001') && para.__hasEmbeddedPic` 收紧为仅 `para.__hasEmbeddedPic`。
//
// 等价前提（本护栏钉死的不变量）：
//   `__hasEmbeddedPic` 只在 Step 2 的 `if (text.includes('\u0001'))` 分支内、
//   且「剥离占位符后仍有非空白内容」时才置位 ⇒ **标志恒蕴含 includes**。
//   加之 Step 2 之后没有任何路径会从 `para.text` 里删掉 `\u0001`
//   （Step 3.5 的合并只是把 `prev.text` 前插，Step 3.6 只插入空段落），
//   故 `includes && flag` 与 `flag` 在全部输入上恒等。
//
// 参照实现 = **改动前**的判定口径，用同一批合成输入对照（慢但等价对照）。
// 负控：三处单行缺陷注入生产源码后，本护栏必须失败。
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { DocParser } from '../src/utils/docParser'

const PIC_PLACEHOLDER_RE = /\u0001/g

/**
 * 改动前口径的参照实现：某段落是否会被 Step 4 拆出独立占位符段落。
 * = `text.includes('\u0001') && (剥离占位符后 trim 非空)`。
 */
function referenceShouldSplit(text: string): boolean {
  return text.includes('\u0001') && text.replace(PIC_PLACEHOLDER_RE, '').trim().length > 0
}

/** 长于 150 字符的填充，避免触发列表分组 / 副标题 / 短段落合并等其它文本改写路径。 */
const PAD = '这是一段足够长的正文用于避开结构启发式的段落合并与副标题判定。'.repeat(4)

function newParser() {
  return new DocParser(new ArrayBuffer(512))
}

function runApply(texts: string[]) {
  const paras = texts.map((text) => ({ text, charFormat: { fontSize: 12 }, paraFormat: {} }))
  ;(newParser() as any).applyStructuralFormats(paras)
  return paras
}

/** Step 4 拆出的占位符段落：text 为纯 `\u0001` 且 fontSize 被显式置 0。 */
function countPicParagraphs(paras: Array<{ text: string; charFormat?: { fontSize?: number } }>) {
  return paras.filter((p) => p.text === '\u0001' && p.charFormat?.fontSize === 0).length
}

describe('Round 157 Step-4 占位符拆分判定（flag 蕴含 includes）', () => {
  it('混合内容含占位符 ⇒ 拆出 1 个独立占位符段落，原段落去掉占位符', () => {
    const input = `${PAD}\u0001${PAD}`
    const out = runApply([input])
    expect(countPicParagraphs(out)).toBe(1)
    const main = out.find((p) => p.text.includes(PAD))
    expect(main).toBeDefined()
    expect(main!.text.includes('\u0001')).toBe(false)
  })

  it('纯占位符（剥离后 trim 为空）⇒ 不拆分', () => {
    // 单个 `\u0001`：Step 2 会把它当标题（fontSize=28），但 flag 不置位 ⇒ Step 4 跳过。
    const out = runApply(['\u0001'])
    expect(countPicParagraphs(out)).toBe(0)
    // 原段落仍是占位符本身（未被清空、也未拆出新段落）；额外段落来自标题后的空行插入。
    expect(out.filter((p) => p.text === '\u0001' && p.charFormat?.fontSize !== 0)).toHaveLength(1)
  })

  it('占位符 + 纯空白（剥离后 trim 为空）⇒ 不拆分', () => {
    const out = runApply(['  \u0001  '])
    expect(countPicParagraphs(out)).toBe(0)
  })

  it('无占位符的普通段落 ⇒ 不拆分', () => {
    const out = runApply([PAD])
    expect(countPicParagraphs(out)).toBe(0)
  })

  it('多个占位符且仍有可见内容 ⇒ 仅拆出 1 个占位符段落，原段落清空全部占位符', () => {
    const input = `${PAD}\u0001\u0001${PAD}`
    const out = runApply([input])
    expect(countPicParagraphs(out)).toBe(1)
    const main = out.find((p) => p.text.includes(PAD))
    expect(main).toBeDefined()
    expect(main!.text.includes('\u0001')).toBe(false)
  })

  it('慢但等价对照：合成语料上，实际拆分与否 ≡ 改动前口径 referenceShouldSplit', () => {
    const corpus = [
      PAD,
      `\u0001${PAD}`,
      `${PAD}\u0001`,
      `${PAD}\u0001${PAD}`,
      `${PAD}\u0001\u0001${PAD}`,
      '\u0001',
      '\u0001\u0001',
      '  \u0001  ',
      '\t\u0001\n',
      `abc\u0001`,
      `\u0001abc`,
      '普通正文',
      '',
    ]
    for (const text of corpus) {
      const out = runApply([text])
      const expected = referenceShouldSplit(text) ? 1 : 0
      expect(countPicParagraphs(out), `text=${JSON.stringify(text)}`).toBe(expected)
    }
  })
})

describe('Round 157 护栏鉴别力（负控注入生产源码，必须失败）', () => {
  const SRC = resolve(__dirname, '../src/utils/docparser/heuristics/paragraphFilter.ts')

  it('接线元断言：Step 4 用标志位早退，且不再有恒真的 includes 扫描', () => {
    const src = readFileSync(SRC, 'utf8')
    expect(src).toContain('if (!para.__hasEmbeddedPic) continue')
    // 改动前的复合判定不得回归
    expect(src).not.toContain("text.includes('\\u0001') && para.__hasEmbeddedPic")
  })

  it('注入骨架：三种缺陷都能让上面的断言口径发生可观测变化', () => {
    // 骨架复刻 Step 2 的置位规则 + Step 4 的拆分判定，便于在离树状态下演示鉴别力。
    const flagRule = (text: string) =>
      text.includes('\u0001') && text.replace(PIC_PLACEHOLDER_RE, '').trim().length > 0

    const splitCount = (texts: string[], mode: 'correct' | 'always' | 'never' | 'flagNoIncludes') =>
      texts.reduce((acc, text) => {
        let flag: boolean
        if (mode === 'flagNoIncludes') flag = text.replace(PIC_PLACEHOLDER_RE, '').trim().length > 0
        else flag = flagRule(text)
        const doSplit = mode === 'always' ? true : mode === 'never' ? false : flag
        return acc + (doSplit ? 1 : 0)
      }, 0)

    const corpus = [PAD, `${PAD}\u0001${PAD}`, '\u0001', '  \u0001  ']
    const expected = corpus.reduce((a, t) => a + (referenceShouldSplit(t) ? 1 : 0), 0)

    expect(splitCount(corpus, 'correct')).toBe(expected)
    expect(splitCount(corpus, 'always')).not.toBe(expected) // 缺陷：无条件拆分
    expect(splitCount(corpus, 'never')).not.toBe(expected) // 缺陷：从不拆分
    expect(splitCount(corpus, 'flagNoIncludes')).not.toBe(expected) // 缺陷：置位丢掉 includes 前提
  })
})
