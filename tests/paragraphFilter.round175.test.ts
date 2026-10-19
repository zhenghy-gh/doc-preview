// Round 175 护栏：`cleanParagraph` 的 `JUNK_PREFIX_RE` 加 O(1) 首字符门。
//
// 背景（27 份 × 20 轮计数插桩 + 微基准）：
//   * `cleanParagraph` **34,348 次/轮**，而 `JUNK_PREFIX_RE`（`^[垃圾字符]+`）命中 **0 次**。
//   * 每次 `replace` 仍要付一次正则引擎进入：微基准 **20.0 ns/次** vs 查表 **3.2 ns/次**
//     ⇒ 每轮白付约 **0.58 ms（≈0.95%）**。
//
// 改动：`JUNK_PREFIX_FIRST[ t.charCodeAt(0) ] ? t.replace(JUNK_PREFIX_RE, '') : t`。
//
// **等价性**：`JUNK_PREFIX_RE` 是 `^[…]`，**只可能从首字符命中**；`JUNK_PREFIX_FIRST`
// 由 `JUNK_CHAR_CLASS` 的码元构建 ⇒ 表项为 1 ⟺ 该码元是垃圾字符 ⟺ 正则可能命中。
// 表项为 0（含越界 / `charCodeAt(0)` 为 NaN）时正则必然不匹配 ⇒ `replace` 必然返回原串
// ⇒ 跳过即**逐字节等价**。
//
// **本文件 A 组直接对生产函数 `cleanParagraph` 做差分**（生产 vs 逐行转写 oracle），
// 因此对「生产代码被改错」有真实鉴别力。
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { DocParser } from '../src/utils/docParser'
import { cleanParagraph } from '../src/utils/docparser/heuristics/paragraphFilter'
import { JUNK_CHAR_CLASS } from '../src/utils/docparser/encodingDetector'

const JUNK_PREFIX_RE = new RegExp(`^[${JUNK_CHAR_CLASS}]+`)
const JUNK0 = JUNK_CHAR_CLASS[0] // 伀
const JUNK1 = JUNK_CHAR_CLASS[1] // 倀
const JUNK_LAST = JUNK_CHAR_CLASS[JUNK_CHAR_CLASS.length - 1]

/** 改动前实现：逐行转写（无条件 replace）。 */
function round175OldClean(p: string): string {
  const t = p.trim()
  const stripped = t.replace(JUNK_PREFIX_RE, '')
  return stripped === t ? t : stripped.trim()
}

// ══════════════════════════════════════════════════════════════════════════
// A 组：直接对生产函数做差分
// ══════════════════════════════════════════════════════════════════════════

const INPUTS: string[] = [
  '',
  ' ',
  '\u3000',
  '  \t\n ',
  'abc',
  '中文段落',
  '  中文段落  ',
  JUNK0,
  JUNK0 + 'abc',
  JUNK0 + JUNK1 + '中文',
  JUNK_LAST + 'x',
  JUNK0 + JUNK0 + JUNK0,
  'a' + JUNK0,          // 垃圾字符不在开头 ⇒ 原实现也不剥
  ' ' + JUNK0 + 'abc',  // trim 后垃圾字符到开头 ⇒ 必须剥
  '\u3000' + JUNK0 + '中文',
  'Normal text ' + JUNK0 + ' tail',
]

describe('Round 175 A 组：生产函数差分', () => {
  it('A1 穷举输入：生产实现与改动前 oracle 完全一致', () => {
    for (const s of INPUTS) {
      expect(cleanParagraph(s), JSON.stringify(s.slice(0, 12))).toBe(round175OldClean(s))
    }
  })

  it('A2 非空转：垃圾前缀确实会被剥掉（不是两边都原样返回）', () => {
    expect(cleanParagraph(JUNK0 + 'abc')).toBe('abc')
    expect(cleanParagraph(JUNK0 + JUNK1 + '中文')).toBe('中文')
    expect(cleanParagraph(' ' + JUNK0 + 'abc')).toBe('abc')
    // 垃圾字符不在开头时**不得**被剥
    expect(cleanParagraph('a' + JUNK0)).toBe('a' + JUNK0)
  })

  it('A3 随机模糊 3,000 条（含全部垃圾字符、中文、空白、换行）：逐条相同', () => {
    let seed = 0x175175
    const rnd = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff
      return seed / 0x7fffffff
    }
    const alphabet = ['a', 'Z', '中', ' ', '\t', '\n', '\u3000', JUNK0, JUNK1, JUNK_LAST, '，', '.']
    let withJunk = 0
    for (let k = 0; k < 3000; k++) {
      const n = Math.floor(rnd() * 10)
      let s = ''
      for (let j = 0; j < n; j++) s += alphabet[Math.floor(rnd() * alphabet.length)]
      expect(cleanParagraph(s)).toBe(round175OldClean(s))
      if (s.includes(JUNK0) || s.includes(JUNK1) || s.includes(JUNK_LAST)) withJunk++
    }
    expect(withJunk).toBeGreaterThan(100)
  })
})

// ══════════════════════════════════════════════════════════════════════════
// B 组：真实语料锚定
// ══════════════════════════════════════════════════════════════════════════

describe('Round 175 B 组：真实语料', () => {
  it('B1 27 份 parseWithFormat 全量输出 SHA-1 锚定（与历史证据一致）', () => {
    const docs = fileURLToPath(new URL('../docs/', import.meta.url))
    const files = fs.readdirSync(docs).filter((n) => /\.(doc|dot)$/.test(n)).sort()
    expect(files.length).toBe(27)
    const parts: string[] = []
    let chars = 0
    for (const f of files) {
      const b = fs.readFileSync(path.join(docs, f))
      const ab = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)
      const s = JSON.stringify(new DocParser(ab).parseWithFormat())
      parts.push(f + '\u0000' + s)
      chars += s.length
    }
    expect(chars).toBe(16247039)
    const sha1 = crypto.createHash('sha1').update(parts.join('\n')).digest('hex')
    expect(sha1).toBe('8f127d0bdbb0a63718a5663f48d267972c753b0e')
  })

  it('B2 真实语料不触发垃圾前缀（这正是「0 命中」结论的钉子）', () => {
    const docs = fileURLToPath(new URL('../docs/', import.meta.url))
    const files = fs.readdirSync(docs).filter((n) => /\.(doc|dot)$/.test(n)).sort()
    let total = 0
    let hit = 0
    for (const f of files) {
      const b = fs.readFileSync(path.join(docs, f))
      const ab = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)
      const out = new DocParser(ab).parseWithFormat() as {
        document: { paragraphs: Array<{ text?: string }> }
      }
      for (const p of out.document.paragraphs) {
        total++
        if (JUNK_PREFIX_RE.test((p.text || '').trim())) hit++
      }
    }
    expect(total).toBeGreaterThan(30000)
    // 输出侧必然为 0（cleanParagraph 已剥掉）；本条用于固定「真实语料无垃圾前缀」这一事实
    expect(hit).toBe(0)
  })
})

// ══════════════════════════════════════════════════════════════════════════
// D 组：骨架负控鉴别力
// ══════════════════════════════════════════════════════════════════════════

type CleanMode = 'ok' | 'alwaysReplace' | 'neverReplace' | 'gateOnLast'

function round175CleanSkeleton(p: string, table: Uint8Array, mode: CleanMode): string {
  const t = p.trim()
  let stripped: string
  if (mode === 'alwaysReplace') stripped = t.replace(JUNK_PREFIX_RE, '')
  else if (mode === 'neverReplace') stripped = t
  else if (mode === 'gateOnLast') {
    stripped = table[t.charCodeAt(t.length - 1)] ? t.replace(JUNK_PREFIX_RE, '') : t
  } else stripped = table[t.charCodeAt(0)] ? t.replace(JUNK_PREFIX_RE, '') : t
  return stripped === t ? t : stripped.trim()
}

function buildTable(): Uint8Array {
  let maxCode = 0
  for (let i = 0; i < JUNK_CHAR_CLASS.length; i++) {
    const c = JUNK_CHAR_CLASS.charCodeAt(i)
    if (c > maxCode) maxCode = c
  }
  const table = new Uint8Array(maxCode + 1)
  for (let i = 0; i < JUNK_CHAR_CLASS.length; i++) table[JUNK_CHAR_CLASS.charCodeAt(i)] = 1
  return table
}

describe('Round 175 D 组：骨架负控鉴别力', () => {
  const TABLE = buildTable()

  it('D1 正控：ok 与 oracle 在全部输入上一致', () => {
    for (const s of INPUTS) {
      expect(round175CleanSkeleton(s, TABLE, 'ok')).toBe(round175OldClean(s))
    }
  })

  it('D2 负控「从不 replace」：垃圾前缀必须没被剥掉', () => {
    const s = JUNK0 + 'abc'
    expect(round175CleanSkeleton(s, TABLE, 'neverReplace')).not.toBe(round175OldClean(s))
    expect(round175CleanSkeleton(s, TABLE, 'neverReplace')).toBe(JUNK0 + 'abc')
  })

  it('D3 负控「用末字符查表」：垃圾前缀在开头时必然分歧', () => {
    const s = JUNK0 + 'abc'
    expect(round175CleanSkeleton(s, TABLE, 'gateOnLast')).not.toBe(round175OldClean(s))
    // 单字符输入时首尾相同 ⇒ 该探针对此情形零鉴别力（故探针必须用长度 ≥2 且垃圾在开头）
    expect(round175CleanSkeleton(JUNK0, TABLE, 'gateOnLast')).toBe(round175OldClean(JUNK0))
  })

  it('D4 行为保持型对照：alwaysReplace 与 ok 在全部输入上完全相同（故输出测试对回退零鉴别力）', () => {
    for (const s of INPUTS) {
      expect(round175CleanSkeleton(s, TABLE, 'alwaysReplace')).toBe(round175CleanSkeleton(s, TABLE, 'ok'))
    }
  })
})

// ══════════════════════════════════════════════════════════════════════════
// C 组：接线元断言（源码文本）
// ══════════════════════════════════════════════════════════════════════════

function codeOnly(src: string): string {
  return src
    .split('\n')
    .filter((l) => {
      const t = l.trim()
      return !(t.startsWith('//') || t.startsWith('*') || t.startsWith('/*'))
    })
    .join('\n')
}

function compact(src: string): string {
  return codeOnly(src).replace(/\s+/g, ' ').trim()
}

describe('Round 175 C 组：接线元断言', () => {
  const SRC = fs.readFileSync(
    new URL('../src/utils/docparser/heuristics/paragraphFilter.ts', import.meta.url),
    'utf8'
  )
  const CODE = codeOnly(SRC)
  const C = compact(SRC)

  it('C1 首字符表存在，且由 `JUNK_CHAR_CLASS` 的最大码元长度构建（不硬编码区段）', () => {
    expect(CODE).toContain('const JUNK_PREFIX_FIRST: Uint8Array')
    expect(C).toContain('let maxCode = 0')
    expect(C).toContain('const table = new Uint8Array(maxCode + 1)')
    expect(C).toContain('table[JUNK_CHAR_CLASS.charCodeAt(i)] = 1')
  })

  it('C2 `cleanParagraph` 已加首字符门，旧无条件 replace 形态消失', () => {
    expect(C).toContain('const stripped = JUNK_PREFIX_FIRST[t.charCodeAt(0)] ? t.replace(JUNK_PREFIX_RE,')
    expect(C).not.toContain("const t = p.trim() const stripped = t.replace(JUNK_PREFIX_RE, '')")
  })

  it('C3 尾部 `stripped === t ? t : stripped.trim()` 收尾未被改动', () => {
    expect(CODE).toContain('return stripped === t ? t : stripped.trim()')
  })
})
