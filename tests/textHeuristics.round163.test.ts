// Round 163 护栏：同段落跨消费者共享 `text.trim()` 与「整段含 CJK」探测。
//
// 被护栏保护的改动：`detectAlignment` / `detectListInfo` / `guessCharFormatCore`
// 三个消费者原本各自对**同一段文本**跑一次 `text.trim()`（共 3 次）与各跑一次
// `HAS_CJK_RE.test(text)`（共 2 次）。改动引入一个「按值键控的单条目记忆」
// （`refreshSharedProfile` + `sharedTrim` / `sharedHasCJK`）：只要连续调用传入的
// `text` 取值相同就复用上次算出的 `trimmed` / `hasCJK`，取值一变立即重算。
//
// 逐字节等价前提：`String.prototype.trim` 与 `HAS_CJK_RE.test` 都是**文本取值的
// 纯函数**，故「命中记忆」与「重新计算」的结果必然逐位相同。本护栏的核心风险是
// **陈旧记忆**（取值变了却仍返回上次的结果）—— A 组用「记忆命中路径」与「强制
// 重算路径」逐段对照来钉死它；C 组用去掉重算判据的骨架证明该对照**有鉴别力**。
// B 组钉死接线（共享函数确实被三个消费者使用、直接形式已消失）。
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  detectAlignment,
  detectListInfo,
  detectParagraphFormat,
  guessCharFormat,
  guessCharFormatWithoutStyles,
} from '../src/utils/docparser/heuristics/textHeuristics'
import { DocParser } from '../src/utils/docParser'

const HAS_CJK = /[\u4e00-\u9fff]/

// ── 强制「记忆未命中」：用一段与任何真实文本都不同的串刷新档案 ──────────────
let flushCounter = 0
const FLUSH_PREFIX = '\u0000\u0001FLUSH\u0001\u0000'
function flush(): void {
  // 每次都用唯一串，保证紧随其后的真实文本必然触发重算
  detectListInfo(FLUSH_PREFIX + ++flushCounter)
}

type Triple = {
  align: ReturnType<typeof detectAlignment>
  list: ReturnType<typeof detectListInfo>
  para: ReturnType<typeof detectParagraphFormat>
  charNoStyles: ReturnType<typeof guessCharFormatWithoutStyles>
  charWithStyles: ReturnType<typeof guessCharFormat>
}

/** 走「记忆命中」路径：同一段文本连续喂给三个消费者，随后再取一次结果。 */
function tripleMemo(s: string, i: number, n: number): Triple {
  detectAlignment(s, i, n)
  detectListInfo(s)
  guessCharFormatWithoutStyles(s, i)
  guessCharFormat(s, i)
  return {
    align: detectAlignment(s, i, n),
    list: detectListInfo(s),
    para: detectParagraphFormat(s, i, n),
    charNoStyles: guessCharFormatWithoutStyles(s, i),
    charWithStyles: guessCharFormat(s, i),
  }
}

/** 走「强制重算」路径：每次调用前都用唯一串刷新档案，使记忆必然未命中。 */
function tripleRecompute(s: string, i: number, n: number): Triple {
  flush()
  const align = detectAlignment(s, i, n)
  flush()
  const list = detectListInfo(s)
  flush()
  const para = detectParagraphFormat(s, i, n)
  flush()
  const charNoStyles = guessCharFormatWithoutStyles(s, i)
  flush()
  const charWithStyles = guessCharFormat(s, i)
  return { align, list, para, charNoStyles, charWithStyles }
}

// ── 合成语料：覆盖 trim 边界 / CJK / 冒号 / 标点 / 标题 / 空白 / 空串 ─────────
const SYNTHETIC: string[] = [
  '',
  ' ',
  '\t\t',
  '\u3000\u3000\u3000',
  'a',
  'ab',
  'abc',
  '  hello world  ',
  'This Is A Title',
  'THIS IS ALL CAPS TITLE',
  '2024年',
  '2024 年',
  '1月',
  '12 月',
  '中文标题',
  '中文段落，包含句号。',
  '中文：冒号',
  '中文:半角冒号',
  'mixed 中文 and English',
  'x'.repeat(200),
  '中'.repeat(200),
  '  \t 中文 前导空白  ',
  'Hello: world',
  'e.g. an abbreviation',
  '一、列表项',
  '1. 阿拉伯列表',
  '（一）括号中文',
  '• 项目符号',
  '\u0001',
  '\u0001图片占位符',
]

// ── 真实语料：27 份 doc/dot 的段落文本 ────────────────────────────────────
const realTexts: string[] = []
{
  const docsDir = resolve(process.cwd(), 'docs')
  const files = readdirSync(docsDir).filter((f) => f.endsWith('.doc') || f.endsWith('.dot')).sort()
  for (const name of files) {
    const buf = readFileSync(resolve(docsDir, name))
    const parser = new DocParser(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength))
    const parsed = parser.parseWithFormat()
    for (const p of parsed.document?.paragraphs ?? []) realTexts.push(p.text)
  }
}

describe('Round 163 共享档案 —— 等价性（记忆命中 ≡ 强制重算）', () => {
  it('A1 合成语料：逐条对照记忆命中与强制重算的三消费者输出', () => {
    for (let i = 0; i < SYNTHETIC.length; i++) {
      const s = SYNTHETIC[i]
      const memo = tripleMemo(s, i, SYNTHETIC.length)
      const recomputed = tripleRecompute(s, i, SYNTHETIC.length)
      expect(memo, `synthetic[${i}]=${JSON.stringify(s)}`).toEqual(recomputed)
    }
  })

  it('A2 交错文本：A/B/A/B 交替喂入，每次结果都等于该文本的独立计算结果', () => {
    const a = '中文段落，含 CJK。'
    const b = 'plain ascii paragraph with colon: yes'
    const refA = tripleRecompute(a, 0, 2)
    const refB = tripleRecompute(b, 1, 2)
    for (let round = 0; round < 8; round++) {
      // 直接连续调用（记忆会在两种取值间来回失效/命中）
      expect({ ...tripleMemo(a, 0, 2) }, `round ${round} a`).toEqual(refA)
      expect({ ...tripleMemo(b, 1, 2) }, `round ${round} b`).toEqual(refB)
    }
  })

  it('A3 同取值不同对象：值相等但不同 String 实例必须得到相同结果', () => {
    const s1 = 'ab' + 'c' + '中文'
    const s2 = ['abc', '中文'].join('')
    expect(s1).toBe(s2) // 值相等
    expect(s1 === s2).toBe(true) // 字符串按值比较
    expect({ ...tripleMemo(s1, 0, 1) }).toEqual({ ...tripleRecompute(s2, 0, 1) })
  })

  it('A4 真实语料：27 份文档全部段落逐段对照记忆命中与强制重算', () => {
    expect(realTexts.length).toBeGreaterThan(500)
    for (let i = 0; i < realTexts.length; i++) {
      const s = realTexts[i]
      const memo = tripleMemo(s, i, realTexts.length)
      const recomputed = tripleRecompute(s, i, realTexts.length)
      if (JSON.stringify(memo) !== JSON.stringify(recomputed)) {
        throw new Error(`段落 ${i} 记忆命中与重算不一致: ${JSON.stringify(s).slice(0, 80)}`)
      }
    }
  })

  // ── 绝对锚点：独立于「记忆命中 ≡ 强制重算」这一内部一致性 ──────────────────
  // A1–A4 只比较两条路径（都走生产代码），对「记忆永久冻结」这类**两条路径同时
  // 变错**的缺陷无鉴别力（N1/N2 即如此）。故补两条**绝对**锚点：直接断言由
  // `trimmed` / `hasCJK` 唯一决定的可观察输出，连续喂入不同文本以暴露冻结记忆。
  it('A5 绝对锚点：连续不同文本的列表识别各自正确（记忆不得冻结 trimmed）', () => {
    const cases: Array<[string, ReturnType<typeof detectListInfo>]> = [
      ['1. first item', { listType: 'ordered', listStyle: 'decimal', listLevel: 0 }],
      ['• bullet item', { listType: 'unordered', listStyle: 'disc', listLevel: 0 }],
      ['plain text without marker', null],
      ['  （一）括号中文', { listType: 'ordered', listStyle: 'cjk-ideographic', listLevel: 1 }],
      ['a. latin marker', { listType: 'ordered', listStyle: 'lower-alpha', listLevel: 0 }],
      ['①②带圈数字', null],
    ]
    for (const [s, expected] of cases) {
      expect(detectListInfo(s), JSON.stringify(s)).toEqual(expected)
    }
  })

  it('A6 绝对锚点：连续不同文本的字体分支各自正确（记忆不得冻结 hasCJK）', () => {
    const cases: Array<[string, string, number]> = [
      ['中文 abcdefgh', '宋体', 16],
      ['plain english paragraph', 'Times New Roman', 12],
      ['中文中文中文中文中文中文中文', '仿宋_GB2312', 22],
      ['another ascii line here', 'Times New Roman', 12],
    ]
    for (const [s, fontName, fontSize] of cases) {
      const f = guessCharFormatWithoutStyles(s, 0)
      expect(f.fontName, `fontName for ${JSON.stringify(s)}`).toBe(fontName)
      expect(f.fontSize, `fontSize for ${JSON.stringify(s)}`).toBe(fontSize)
    }
  })
})

describe('Round 163 共享档案 —— 语料非空转', () => {
  it('D1 真实语料同时含「有 CJK」与「无 CJK」段落（两条分支都被走到）', () => {
    const cjk = realTexts.filter((t) => HAS_CJK.test(t)).length
    expect(realTexts.length).toBeGreaterThan(500)
    expect(cjk, '含 CJK 段落数').toBeGreaterThan(0)
    expect(realTexts.length - cjk, '不含 CJK 段落数').toBeGreaterThan(0)
  })

  it('D2 合成语料覆盖空白/空串/长串（trim 记忆的重算分支被走到）', () => {
    const whitespacey = SYNTHETIC.filter((t) => t !== t.trim()).length
    expect(whitespacey).toBeGreaterThan(3)
    expect(SYNTHETIC.some((t) => t.length === 0)).toBe(true)
  })
})

describe('Round 163 共享档案 —— 接线元断言（源码文本）', () => {
  const SRC = readFileSync(
    resolve(process.cwd(), 'src/utils/docparser/heuristics/textHeuristics.ts'),
    'utf8',
  )
  // 只统计代码行，避免注释里的 `text.trim()` 等被误计
  const CODE = SRC.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n')

  it('B1 源码含共享档案实现（refreshSharedProfile / sharedTrim / sharedHasCJK）', () => {
    expect(SRC).toContain('function refreshSharedProfile(')
    expect(SRC).toContain('function sharedTrim(')
    expect(SRC).toContain('function sharedHasCJK(')
  })

  it('B2 三个消费者各走共享函数：const trimmed = sharedTrim(text) 恰 3 处、sharedHasCJK(text) 恰 2 处', () => {
    expect((CODE.match(/const trimmed = sharedTrim\(text\)/g) || []).length).toBe(3)
    expect((CODE.match(/sharedHasCJK\(text\)/g) || []).length).toBe(2)
  })

  it('B3 直接形式已消失：text.trim() 与 HAS_CJK_RE.test(text) 各仅存于 refreshSharedProfile 内 1 处', () => {
    expect((CODE.match(/text\.trim\(\)/g) || []).length).toBe(1)
    expect((CODE.match(/HAS_CJK_RE\.test\(text\)/g) || []).length).toBe(1)
  })

  it('B4 refreshSharedProfile 以「取值变化」为唯一重算判据', () => {
    expect(SRC).toContain('if (text !== sharedProfileText) {')
    expect(SRC).toContain('sharedProfileTrimmed = text.trim()')
    expect(SRC).toContain('sharedProfileHasCJK = HAS_CJK_RE.test(text)')
  })
})

describe('Round 163 共享档案 —— 骨架负控（比较方法有鉴别力）', () => {
  /** 与生产同构的单条目记忆骨架；recomputeOnChange=false 复刻「忘记在取值变化时重算」。 */
  function makeSkeleton(recomputeOnChange: boolean) {
    let txt: string | null = null
    let trimmed = ''
    let hasCJK = false
    return (t: string): string => {
      if (recomputeOnChange ? t !== txt : txt === null) {
        txt = t
        trimmed = t.trim()
        hasCJK = HAS_CJK.test(t)
      }
      return trimmed + '|' + hasCJK
    }
  }
  const direct = (s: string) => s.trim() + '|' + HAS_CJK.test(s)

  it('C1 正控：带「取值变化即重算」的骨架对交错文本恒与直接计算一致', () => {
    const f = makeSkeleton(true)
    for (const s of ['abc', '中文测试', '  padded  ', 'x:y', 'abc']) {
      expect(f(s)).toBe(direct(s))
    }
  })

  it('C2 负控：去掉「取值变化即重算」的骨架第二次不同文本返回陈旧值（证明对照有鉴别力）', () => {
    const f = makeSkeleton(false)
    expect(f('abc')).toBe('abc|false')
    const second = f('中文测试')
    expect(second).toBe('abc|false') // 陈旧值
    expect(second).not.toBe(direct('中文测试')) // 与正确结果不同 ⇒ 可辨
  })
})
