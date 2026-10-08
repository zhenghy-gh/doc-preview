import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

/**
 * i18n 字典完整性守卫（locale.ts 函数覆盖率低是因为 180+ 条目几乎从不被逐条遍历，
 * 本测试用静态扫描一次性看住全部条目）：
 *
 * 1. zh-CN 与 en 两本字典的键集合必须完全一致 —— 防止"切英文后残留中文键回退"或
 *    "en 多出无主翻译"这类用户可见回归。
 * 2. 每个键在中英两版的插值参数集合必须一致 —— 防止某语言改了参数名导致另一语言
 *    渲染出 undefined。
 *
 * 字典未导出，因此直接对源码做块级扫描：顶层条目统一是两空格缩进的 `'dotted.key':`
 * 行，嵌套 Record 子键（如 shortcuts.items 的 pageUp）不带点号且缩进更深，会被
 * 双重过滤排除。
 */

function extractTopLevelKeys(block: string): string[] {
  return [...block.matchAll(/^[ ]{2}'([^']+)':/gm)]
    .map(m => m[1])
    .filter(key => key.includes('.'))
}

/** 把字典块切成 key -> 该条目源码片段（从本键行到下一顶层键行）。 */
function segmentByKey(block: string): Map<string, string> {
  const out = new Map<string, string>()
  const matches = [...block.matchAll(/^[ ]{2}'([^']+)':/gm)].filter(m => m[1].includes('.'))
  for (let i = 0; i < matches.length; i++) {
    const start = matches[i].index! + matches[i][0].length
    const end = i + 1 < matches.length ? matches[i + 1].index! : block.length
    out.set(matches[i][1], block.slice(start, end))
  }
  return out
}

/** 条目片段中出现的全部插值参数名：字符串值的 {name} + 函数值解构签名 ({ a, b })。 */
function extractParams(segment: string): Set<string> {
  const params = new Set<string>()
  for (const m of segment.matchAll(/\{([a-zA-Z_]\w*)\}/g)) params.add(m[1])
  const sig = segment.match(/\(\s*\{\s*([^}]*?)\s*}\s*\)/)
  if (sig) {
    for (const raw of sig[1].split(',')) {
      const name = raw.trim().split(':')[0].trim()
      if (/^[a-zA-Z_]\w*$/.test(name)) params.add(name)
    }
  }
  return params
}

describe('locale dictionary integrity', () => {
  const source = readFileSync(new URL('../src/utils/locale.ts', import.meta.url), 'utf8')
  const zhMarker = source.indexOf('const zh:')
  const enMarker = source.indexOf('const en:')
  // 字典以顶格的 "}" 结束；不截断的话最后一个条目的片段会吞进
  // 文件尾部 t()/tMap() 的实现代码，把里面的 {k} 等字面量误判成参数。
  const zhEnd = source.indexOf('\n}', zhMarker)
  const enEnd = source.indexOf('\n}', enMarker)
  const zhBlock = source.slice(zhMarker, zhEnd)
  const enBlock = source.slice(enMarker, enEnd)

  it('locates both dictionaries in the source', () => {
    expect(zhMarker, 'const zh: block not found').toBeGreaterThan(-1)
    expect(enMarker, 'const en: block not found').toBeGreaterThan(-1)
    expect(enMarker).toBeGreaterThan(zhMarker)
  })

  it('en defines exactly the same keys as zh', () => {
    const zhKeys = extractTopLevelKeys(zhBlock)
    const enKeys = extractTopLevelKeys(enBlock)

    // Sanity: the dictionary really was captured (180+ dotted entries).
    expect(zhKeys.length).toBeGreaterThan(100)

    const zhSet = new Set(zhKeys)
    const enSet = new Set(enKeys)
    const missingInEn = zhKeys.filter(k => !enSet.has(k))
    const extraInEn = enKeys.filter(k => !zhSet.has(k))
    expect(missingInEn, 'keys missing in en dict').toEqual([])
    expect(extraInEn, 'keys missing in zh dict').toEqual([])
  })

  it('uses identical interpolation parameter names in both languages', () => {
    const zhSegments = segmentByKey(zhBlock)
    const enSegments = segmentByKey(enBlock)

    const mismatches: string[] = []
    for (const [key, zhSeg] of zhSegments) {
      const enSeg = enSegments.get(key)
      if (!enSeg) continue // 键位缺失已由上一个测试报告，这里不重复
      const zhParams = extractParams(zhSeg)
      const enParams = extractParams(enSeg)
      const onlyZh = [...zhParams].filter(p => !enParams.has(p))
      const onlyEn = [...enParams].filter(p => !zhParams.has(p))
      if (onlyZh.length || onlyEn.length) {
        mismatches.push(`${key}: zh={${[...zhParams].join(',')}} en={${[...enParams].join(',')}}`)
      }
    }
    expect(mismatches, 'placeholder name mismatches between zh and en').toEqual([])
  })
})
