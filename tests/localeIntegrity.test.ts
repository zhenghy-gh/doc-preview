import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * i18n 字典完整性守卫（locale.ts 函数覆盖率低是因为 180+ 条目几乎从不被逐条遍历，
 * 本测试用静态扫描一次性看住全部条目）：
 *
 * 1. zh-CN 与 en 两本字典的键集合必须完全一致 —— 防止"切英文后残留中文键回退"或
 *    "en 多出无主翻译"这类用户可见回归。
 * 2. 每个键在中英两版的插值参数集合必须一致 —— 防止某语言改了参数名导致另一语言
 *    渲染出 undefined。
 * 3. 组件模板/脚本里实际使用的每一个 t() 静态键、动态前缀命名空间、tMap() 嵌套键，
 *    在中英两本字典里都必须存在 —— 防止新增组件时只补了一语言字典、或忘了补字典
 *    导致切语言后回退显示原始 key。
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

/** 提取嵌套 Record（如 shortcuts.items）的 prefix -> Set<subKey>。 */
function extractNestedKeys(block: string): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>()
  for (const m of block.matchAll(/^[ ]{2}'([^']+)':\s*\{([\s\S]*?)^[ ]{2}\}/gm)) {
    out.set(m[1], new Set([...m[2].matchAll(/^[ ]{4}'([^']+)'\s*:/gm)].map(s => s[1])))
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

/** 去掉注释后再扫描，避免注释里的示例 key（如 `// t('foo.xxx')`）被误判为真实使用。 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
}

/** 组件源码里 t()/tMap() 的使用情况。 */
interface UsedKeys {
  static: Set<string>
  prefixes: Set<string>
  tmap: Array<{ prefix: string; sub: string }>
}

function collectUsedKeys(sources: string[]): UsedKeys {
  const used: UsedKeys = { static: new Set(), prefixes: new Set(), tmap: [] }
  for (const raw of sources) {
    const src = stripComments(raw)
    for (const m of src.matchAll(/\bt\(\s*'([^']+)'/g)) {
      const key = m[1]
      if (key.endsWith('.')) used.prefixes.add(key)
      else used.static.add(key)
    }
    for (const m of src.matchAll(/\btMap\(\s*'([^']+)'\s*,\s*'([^']+)'/g)) {
      used.tmap.push({ prefix: m[1], sub: m[2] })
    }
  }
  return used
}

/** 递归收集组件与 App.vue 的 .vue 源文件。 */
function collectVueFiles(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) out.push(...collectVueFiles(p))
    else if (name.endsWith('.vue')) out.push(p)
  }
  return out
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
  const zhKeys = new Set(extractTopLevelKeys(zhBlock))
  const enKeys = new Set(extractTopLevelKeys(enBlock))

  // 覆盖全部组件（含 App.vue）——不只是旧组件。路径相对测试文件。
  const componentDir = new URL('../src/components/', import.meta.url)
  const componentSources = [
    ...collectVueFiles(componentDir.pathname).map(p => readFileSync(p, 'utf8')),
    readFileSync(new URL('../src/App.vue', import.meta.url), 'utf8'),
  ]

  it('locates both dictionaries in the source', () => {
    expect(zhMarker, 'const zh: block not found').toBeGreaterThan(-1)
    expect(enMarker, 'const en: block not found').toBeGreaterThan(-1)
    expect(enMarker).toBeGreaterThan(zhMarker)
  })

  it('en defines exactly the same keys as zh', () => {
    // Sanity: the dictionary really was captured (180+ dotted entries).
    expect(zhKeys.size).toBeGreaterThan(100)

    const missingInEn = [...zhKeys].filter(k => !enKeys.has(k))
    const extraInEn = [...enKeys].filter(k => !zhKeys.has(k))
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

  it('every static t() key used by components exists in both dictionaries', () => {
    expect(componentSources.length).toBeGreaterThanOrEqual(20)
    const used = collectUsedKeys(componentSources).static
    // 确保扫描确实抓到了键（扫描器退化成空集会令本测试永真）。
    expect(used.size).toBeGreaterThan(100)
    const missingInZh = [...used].filter(k => !zhKeys.has(k))
    const missingInEn = [...used].filter(k => !enKeys.has(k))
    expect(missingInZh, 'component t() keys missing in zh dict').toEqual([])
    expect(missingInEn, 'component t() keys missing in en dict').toEqual([])
  })

  it('every dynamic t() prefix used by components is a valid namespace in both dictionaries', () => {
    const used = collectUsedKeys(componentSources).prefixes
    expect(used.size, 'dynamic prefixes were expected (e.g. shapes.type.)').toBeGreaterThan(0)
    const invalidInZh = [...used].filter(p => ![...zhKeys].some(k => k.startsWith(p)))
    const invalidInEn = [...used].filter(p => ![...enKeys].some(k => k.startsWith(p)))
    expect(invalidInZh, 't(prefix.) namespaces missing in zh dict').toEqual([])
    expect(invalidInEn, 't(prefix.) namespaces missing in en dict').toEqual([])
  })

  it('every tMap() prefix/sub-key used by components resolves in both dictionaries', () => {
    const zhNested = extractNestedKeys(zhBlock)
    const enNested = extractNestedKeys(enBlock)
    const used = collectUsedKeys(componentSources).tmap
    expect(used.length, 'tMap() usages were expected (shortcuts.items)').toBeGreaterThan(0)
    const missing: string[] = []
    for (const { prefix, sub } of used) {
      if (!zhNested.get(prefix)?.has(sub)) missing.push(`zh: ${prefix}.${sub}`)
      if (!enNested.get(prefix)?.has(sub)) missing.push(`en: ${prefix}.${sub}`)
    }
    expect(missing, 'tMap() nested keys missing from dictionaries').toEqual([])
  })
})
