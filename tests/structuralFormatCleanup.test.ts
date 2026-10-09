// Round 107 护栏：`applyStructuralFormats` 的字段码预清洗与图片占位符长度计算
// 由「无条件 replace」改成「先做字面量存在性判断再 replace」后，结果必须逐字一致。
//
// 参照实现是**改动前**的逐行转写（三次无守卫 replace + 无条件剥离 \u0001 后取长度）。
// 关键陷阱：`OTHER_FIELD_CODE_RE` 作用在**已剥离 HYPERLINK 之后的串**上，
// 而 HYPERLINK 剥离既可能让该串不再含字段关键字、也可能把被拆开的两段拼接起来，
// 所以守卫必须落在「该次 replace 的输入串」上 —— 本用例专门覆盖这一类交互。
//
// 说明：`\u0001` 在 applyStructuralFormats 的后续步骤里会被搬移到独立段落
// （既有行为，与本轮改动无关），因此字段码用例与占位符用例分开断言。
//
// 关于守卫位置：HYPERLINK 剥离只会**删除**字符，不可能凭空造出紧邻字段关键字的空白，
// 因此「清洗后的串命中字段码正则」蕴含「原串命中」，守卫无论落在原串还是清洗后的串
// 都等价；本文件选择落在清洗后的串（即该次 replace 的真正输入）以便直接对应。
// 真正会出问题的是守卫**漏掉关键字**（例如只判断 EMBED 而漏掉 LIBREOFFICE/INCLUDETEXT）。
import { describe, it, expect } from 'vitest'
import { DocParser } from '../src/utils/docParser'

// —— 改动前实现的逐行转写 ——
const HYPERLINK_QUOTED_RE = /\bHYPERLINK\s+"[^"]*"[\s\u0001]*/g
const HYPERLINK_BARE_RE = /\bHYPERLINK\s+\S+[\s\u0001]*/g
const OTHER_FIELD_CODE_RE = /\b(?:EMBED|LIBREOFFICE|INCLUDEPICTURE|INCLUDETEXT)\s+\S+/g
const PIC_PLACEHOLDER_RE = /\u0001/g

function referenceCleanText(text: string): string {
  let cleanedText = text
  cleanedText = cleanedText.replace(HYPERLINK_QUOTED_RE, '')
  cleanedText = cleanedText.replace(HYPERLINK_BARE_RE, '')
  cleanedText = cleanedText.replace(OTHER_FIELD_CODE_RE, '')
  return cleanedText
}

/** 剥离图片占位符后的可见长度（改动前口径）。 */
function referenceVisibleLength(text: string): number {
  return text.replace(PIC_PLACEHOLDER_RE, '').length
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

describe('applyStructuralFormats 字段码清洗守卫等价性', () => {
  it('覆盖 HYPERLINK 剥离影响后续字段码判定的交互', () => {
    const cases = [
      PAD,
      `HYPERLINK "http://example.com/a"${PAD}`,
      `HYPERLINK http://example.com/b${PAD}`,
      `EMBED Excel.Sheet.8${PAD}`,
      `LIBREOFFICE ${PAD}`,
      `INCLUDEPICTURE "http://x/y.png"${PAD}`,
      // 剥离 HYPERLINK 后 \S+ 的落点改变：守卫若落在原串上会漏掉这次替换
      `INCLUDETEXT HYPERLINK "http://x/y"${PAD}`,
      // 剥离后把被拆开的两段拼接起来，产生原本不存在的 HYPERLINK 字面量
      `HYPERHYPERLINK "http://x/y"LINK http://z${PAD}`,
      // 只含被拆开的片段（剥离后不会拼出 HYPERLINK）
      `HYPER LINK http://z${PAD}`,
      // 字段关键字本身被 HYPERLINK 串拆开：剥离后拼出 EMBED 才命中字段码正则。
      // 若守卫落在**原串**上会返回 false 从而跳过替换 → 与改动前不一致。
      `EMB${'HYPERLINK "http://x"'}ED Excel${PAD}`,
      // 同理，关键字被拆开且剥离后拼出 INCLUDETEXT
      `INCLUDE${'HYPERLINK "http://x"'}TEXT ${PAD}`,
      // 无任何字段码
      `普通正文没有任何字段码${PAD}`,
    ]
    const got = runApply(cases).map((p) => p.text)
    expect(got).toEqual(cases.map(referenceCleanText))
  })

  it('含字段码的段落确实被改写（护栏非空转）', () => {
    const cases = [`HYPERLINK "http://example.com/a"${PAD}`, `EMBED Excel.Sheet.8${PAD}`]
    const got = runApply(cases).map((p) => p.text)
    expect(got).not.toEqual(cases)
    expect(got.every((t, i) => t !== cases[i])).toBe(true)
    expect(got.every((t) => !t.includes('HYPERLINK') && !t.includes('EMBED'))).toBe(true)
  })

  it('占位符长度口径：可见长度恰在上界 150 时仍判为列表项', () => {
    // 每段 = \u0001 + 150 字符 → 剥离后可见长度恰好 150（LIST_ITEM_MAX_LEN 上界）。
    // 若守卫写错（不剥离占位符）长度会变成 151 → 不再判为列表项，分组消失。
    const item = `\u0001${'正'.repeat(150)}`
    const texts = [PAD, item, item, item, item]
    for (const t of texts.slice(1)) {
      expect(referenceVisibleLength(t)).toBe(150)
    }
    const paras = runApply(texts)
    const listed = paras.filter((p) => p.paraFormat?.listType === 'unordered')
    expect(listed.length).toBeGreaterThan(0)
  })

  it('占位符长度口径：可见长度恰好 9 时不应判为列表项', () => {
    // 剥离后可见长度 9 < LIST_ITEM_MIN_LEN(10)；若守卫写错（不剥离）会变成 10 → 误判。
    const item = `\u0001${'正'.repeat(9)}`
    expect(referenceVisibleLength(item)).toBe(9)
    const paras = runApply([PAD, item, item, item, item])
    const listed = paras.filter((p) => p.paraFormat?.listType === 'unordered')
    expect(listed).toHaveLength(0)
  })
})
