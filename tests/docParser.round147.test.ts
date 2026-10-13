/**
 * Round 147 护栏：真实 CHPX 格式可用时跳过启发式 `charFormat.styles` 计算。
 *
 * 背景（`createParagraphsWithRealFormats`）：旧顺序是「先 `guessCharFormat`
 * （内含 `detectCharacterStyles`）→ … → 合并真实格式时把 styles 键整个丢掉」。
 * 真实 27 份语料实测 34,945 个段落里 32,690 个有真实格式（97%），那部分
 * `detectCharacterStyles` 的产出（自耗 4.02% + 正则 1.10%）是纯浪费。
 * 本轮把 merged 的真实格式判定前移到 `newPara` 创建之前：
 *   - 有真实格式 ⇒ `guessCharFormatWithoutStyles`（不建 styles 键），
 *     最终合并只需一次展开（旧版是展开 + rest 两个对象）；
 *   - 无真实格式 ⇒ 原样走完整 `guessCharFormat`（styles 照常产出）。
 *
 * 等价性论据（本文件逐一钉住）：
 *   1. 纯函数层：`guessCharFormatWithoutStyles(t)` 与 `guessCharFormat(t)`
 *      除 styles 键外逐键、逐值、逐键序相同（穷举 65,536 码元 + 真实语料段落）。
 *   2. 决策层：对任意 merged（含空、含「merged 自带 styles 键」的对抗输入），
 *      旧路径（full+rest）与新路径（noStyles+一次展开+in 兜底）产出 JSON 逐字节相同。
 *   3. 语料层：27 份真实文档每个 `charFormatFromReal` 段落都没有 styles 键
 *      （97% 走新路径），无真实格式的段落 styles 照旧且等于
 *      `detectCharacterStyles(段落文本)`（新路径未被误触发）。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import {
  guessCharFormat,
  guessCharFormatWithoutStyles,
  detectCharacterStyles,
} from '../src/utils/docparser/heuristics/textHeuristics'
import { DocParser } from '../src/utils/docParser'

// ─────────────────────────── 参照实现（改动前逐行转写） ───────────────────────────

/** 旧实现的末尾合并：展开 + rest 排除 styles（两个对象）。 */
function oldPathRealCharFormat(
  heuristic: Record<string, unknown>,
  merged: Record<string, unknown>,
): Record<string, unknown> {
  const { styles: _dropped, ...rest } = { ...heuristic, ...merged }
  return rest
}

/** 本轮实现的末尾合并：一次展开 + `in` 兜底（merged 带 styles 键时仍整键丢弃）。 */
function newPathRealCharFormat(
  noStyles: Record<string, unknown>,
  merged: Record<string, unknown>,
): Record<string, unknown> {
  const realCharFormat = { ...noStyles, ...merged }
  if ('styles' in realCharFormat) {
    const { styles: _dropped, ...rest } = realCharFormat
    return rest
  }
  return realCharFormat
}

/** 从完整 charFormat 去掉 styles 键（保持其余键序）——即新路径本应拿到的输入。 */
function stripStyles(full: Record<string, unknown>): Record<string, unknown> {
  const { styles: _dropped, ...rest } = full
  return rest
}

const docsDir = new URL('../docs/', import.meta.url)

function loadCorpusTexts(): string[] {
  const files = readdirSync(docsDir).filter((f) => f.endsWith('.doc') || f.endsWith('.dot')).sort()
  const texts: string[] = []
  for (const f of files) {
    const buf = readFileSync(new URL(f, docsDir))
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
    const result = new DocParser(ab).parseWithFormat()
    if (!result.success || !result.document) continue
    for (const p of result.document.paragraphs) texts.push(p.text)
  }
  return texts
}

// merged 的真实取值宇宙（CHPX/样式格式的键空间）。含一个对抗输入：merged 自带
// styles 键——旧路径用 rest 丢、新路径用 in 兜底丢，两者必须仍然一致。
const MERGED_VARIANTS: Array<Record<string, unknown>> = [
  {},
  { fontName: 'Arial' },
  { fontSize: 14, fontName: '宋体' },
  { bold: true },
  { underline: true, fontName: '仿宋' },
  { italic: true, color: 'FF0000', highlight: 'yellow', spacing: 2, smallCaps: true, caps: true },
  { charBorder: true, charShadow: true, vanish: false },
  { fontSize: 10.5, fontName: 'X', bold: false, italic: false, underline: false, color: '000000' },
  { styles: [{ start: 0, end: 3, style: { underline: true } }] },
]

describe('Round 147：真实格式路径跳过 styles 计算', () => {
  describe('纯函数等价：guessCharFormatWithoutStyles vs guessCharFormat', () => {
    it('穷举全部 65,536 个码元：除 styles 键外逐键逐值逐键序相同', () => {
      for (let code = 0; code < 0x10000; code++) {
        if (code >= 0xd800 && code <= 0xdfff) continue // 孤立代理项：单字符串会被规范成替换符，两函数同样处理即可
        const t = String.fromCharCode(code)
        const full = guessCharFormat(t) as unknown as Record<string, unknown>
        const noS = guessCharFormatWithoutStyles(t) as unknown as Record<string, unknown>
        // styles 键必须存在于完整版、不存在于无 styles 版
        expect(Array.isArray(full.styles)).toBe(true)
        expect('styles' in noS).toBe(false)
        // 其余键集合与键序完全相同
        const expectedKeys = Object.keys(full).filter((k) => k !== 'styles')
        expect(Object.keys(noS)).toEqual(expectedKeys)
        for (const k of expectedKeys) expect(noS[k]).toBe(full[k])
        // 键序敏感比对（JSON.stringify）
        const copy = { ...full }
        delete copy.styles
        expect(JSON.stringify(noS)).toBe(JSON.stringify(copy))
      }
    })

    it('多字符/边界串与真实语料段落同样只差 styles 键', () => {
      const crafted = [
        '', ' ', 'a', 'Z', '0', '9', ':', '：', '\n', '\t',
        'Chapter 1: Introduction', '2024年10月1日', '第一节：概述',
        'A'.repeat(100), '中'.repeat(50), 'a'.repeat(39), 'a'.repeat(40), 'a'.repeat(41),
        '标题一', 'IV.', '(1)', '1.2.3 ', '2) ', '十二、',
        '\u0001 3 "OBJECT"', '::::', '::: 123 :::', '123:456', '中文abc123混合',
      ]
      const corpus = loadCorpusTexts()
      const all = crafted.concat(corpus.slice(0, 4000))
      for (const t of all) {
        const full = guessCharFormat(t) as unknown as Record<string, unknown>
        const noS = guessCharFormatWithoutStyles(t) as unknown as Record<string, unknown>
        expect('styles' in noS).toBe(false)
        const expectedKeys = Object.keys(full).filter((k) => k !== 'styles')
        expect(Object.keys(noS)).toEqual(expectedKeys)
        for (const k of expectedKeys) expect(noS[k]).toBe(full[k])
      }
    })
  })

  describe('决策层差分：旧 rest 路径 vs 新一次展开路径', () => {
    it('真实语料全部段落文本 × 9 种 merged（含对抗）产出逐字节相同', () => {
      const texts = loadCorpusTexts()
      for (const t of texts) {
        const full = guessCharFormat(t) as unknown as Record<string, unknown>
        const noS = stripStyles(full)
        for (const merged of MERGED_VARIANTS) {
          const oldOut = oldPathRealCharFormat(full, merged)
          const newOut = newPathRealCharFormat(noS, merged)
          expect(JSON.stringify(newOut)).toBe(JSON.stringify(oldOut))
        }
      }
    })

    it('穷举合成 charFormat/merged 键组合（含 styles 键的对抗位置）', () => {
      const charFormats: Array<Record<string, unknown>> = [
        {},
        { styles: [] },
        { styles: [], fontName: '宋体', fontSize: 16 },
        { fontName: 'Times New Roman' },
        { styles: [], bold: true, fontSize: 28 },
        { styles: [{ start: 0, end: 2, style: { underline: true } }], fontName: 'F', underline: true },
      ]
      const mergeds: Array<Record<string, unknown>> = MERGED_VARIANTS.concat([
        { styles: [] },
        { styles: [], fontName: 'A' },
      ])
      for (const cf of charFormats) {
        for (const merged of mergeds) {
          expect(JSON.stringify(newPathRealCharFormat(stripStyles(cf), merged)))
            .toBe(JSON.stringify(oldPathRealCharFormat(cf, merged)))
        }
      }
    })

    it('merged 为空时新路径等价于「不动 charFormat」', () => {
      const texts = ['hello world', '中文标题', '2024年', '', 'a']
      for (const t of texts) {
        const full = guessCharFormat(t) as unknown as Record<string, unknown>
        const noS = guessCharFormatWithoutStyles(t) as unknown as Record<string, unknown>
        // merged 为空：两条路径都保持原对象不动
        expect(JSON.stringify(newPathRealCharFormat(noS, {}))).toBe(JSON.stringify(noS))
        expect(JSON.stringify(oldPathRealCharFormat(full, {}))).toBe(JSON.stringify(stripStyles(full)))
      }
    })
  })

  describe('真实语料不变量（27 份 DOC/DOT）', () => {
    it('真实格式段落无 styles 键；无真实格式段落 styles 仍等于 detectCharacterStyles', () => {
      const files = readdirSync(docsDir).filter((f) => f.endsWith('.doc') || f.endsWith('.dot')).sort()
      let total = 0
      let realCount = 0
      let nonRealCount = 0
      let nonRealWithStyles = 0
      let nonRealExactMatch = 0
      for (const f of files) {
        const buf = readFileSync(new URL(f, docsDir))
        const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
        const result = new DocParser(ab).parseWithFormat()
        expect(result.success).toBe(true)
        for (const p of result.document.paragraphs) {
          total++
          const cf = p.charFormat as Record<string, unknown> | undefined
          if (p.charFormatFromReal) {
            realCount++
            expect('styles' in (cf ?? {})).toBe(false)
          } else {
            nonRealCount++
            if (cf && Array.isArray(cf.styles)) {
              nonRealWithStyles++
              // 绝大多数无真实格式段落的 styles 必须逐段等于 detectCharacterStyles
              // （下游 encodingDetector 极少数位移段落除外，故只统计精确匹配数）。
              if (JSON.stringify(cf.styles) === JSON.stringify(detectCharacterStyles(p.text))) {
                nonRealExactMatch++
              }
            }
          }
        }
      }
      // 覆盖性：97% 走新路径、且有大量无真实格式段落仍走旧完整路径
      expect(total).toBeGreaterThan(30000)
      expect(realCount).toBeGreaterThan(30000)
      expect(realCount).toBeGreaterThan(nonRealCount * 10)
      expect(nonRealCount).toBeGreaterThan(1000)
      expect(nonRealWithStyles).toBeGreaterThan(500)
      expect(nonRealExactMatch).toBeGreaterThan(500)
    })
  })

  describe('鉴别力：负控必须被检出', () => {
    const texts = loadCorpusTexts()

    it('负控 1（无条件跳过 styles，无真实格式也丢）必须被检出', () => {
      // 合并决策层抓不到这个负控（merged 为空时旧 rest 路径也丢 styles——负控在此层
      // 与旧实现等价，不能拿它当负控）。语义差异在**无真实格式路径**：旧实现对这类
      // 段落保留完整 charFormat（含 styles 键），负控（总用无 styles 版）丢键。
      // 语料中存在大量无真实格式段落 ⇒ 该键的存在性差异可被上方语料不变量抓到。
      let oldHasKey = 0
      let mutantHasKey = 0
      for (const t of texts) {
        const oldOut = guessCharFormat(t) as unknown as Record<string, unknown>
        const mutantOut = guessCharFormatWithoutStyles(t) as unknown as Record<string, unknown>
        if ('styles' in oldOut) oldHasKey++
        if ('styles' in mutantOut) mutantHasKey++
      }
      expect(oldHasKey).toBeGreaterThan(texts.length * 0.9)
      expect(mutantHasKey).toBe(0)
      // 生产输出侧同样可观察：无真实格式段落带 styles 数组（下方语料不变量逐文档断言）。
      const files = readdirSync(docsDir).filter((f) => f.endsWith('.doc') || f.endsWith('.dot')).sort()
      let observed = 0
      for (const f of files) {
        const buf = readFileSync(new URL(f, docsDir))
        const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
        const result = new DocParser(ab).parseWithFormat()
        for (const p of result.document.paragraphs) {
          if (!p.charFormatFromReal && p.charFormat && Array.isArray((p.charFormat as Record<string, unknown>).styles)) observed++
        }
      }
      expect(observed).toBeGreaterThan(500)
    })

    it('负控 2（合并优先级反转 {...merged, ...charFormat}）必须被检出', () => {
      const full = guessCharFormat('hello world') as unknown as Record<string, unknown>
      const noS = stripStyles(full)
      const merged = { fontName: 'Arial' } // charFormat 里也有 fontName，反转后值不同
      expect(JSON.stringify({ ...merged, ...noS })).not.toBe(JSON.stringify(newPathRealCharFormat(noS, merged)))
    })

    it('负控 3（保留 styles 键，不丢）必须被检出', () => {
      const full = guessCharFormat('hello world') as unknown as Record<string, unknown>
      const noS = stripStyles(full)
      const merged = { bold: true }
      const kept = { ...noS, ...merged, styles: [{ start: 0, end: 1, style: {} }] }
      expect(JSON.stringify(kept)).not.toBe(JSON.stringify(newPathRealCharFormat(noS, merged)))
      // 旧 rest 路径同样丢弃
      expect(JSON.stringify(oldPathRealCharFormat(full, merged))).toBe(JSON.stringify(newPathRealCharFormat(noS, merged)))
    })

    it('负控 4（去掉 in 兜底且 merged 自带 styles）必须被检出；兜底在则一致', () => {
      const noS = { fontName: '宋体' }
      const merged = { styles: [{ start: 0, end: 1, style: { underline: false } }], bold: true }
      const noFallback = { ...noS, ...merged } // 负控：无 in 兜底
      expect(JSON.stringify(noFallback)).not.toBe(JSON.stringify(newPathRealCharFormat(noS, merged)))
      // 兜底路径与旧 rest 路径一致（styles 被整键丢弃）
      expect(JSON.stringify(newPathRealCharFormat(noS, merged)))
        .toBe(JSON.stringify(oldPathRealCharFormat({ ...noS, styles: [] }, merged)))
    })

    it('元断言：生产源码确实接线了新函数与 in 兜底', () => {
      const parserSrc = readFileSync(new URL('../src/utils/docParser.ts', import.meta.url), 'utf8')
      const heurSrc = readFileSync(
        new URL('../src/utils/docparser/heuristics/textHeuristics.ts', import.meta.url),
        'utf8',
      )
      expect(parserSrc).toContain('guessCharFormatWithoutStyles')
      expect(parserSrc).toContain("'styles' in realCharFormat")
      expect(heurSrc).toContain('export function guessCharFormatWithoutStyles')
      expect(heurSrc).toContain('guessCharFormatCore')
    })
  })
})
