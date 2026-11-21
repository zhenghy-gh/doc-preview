#!/usr/bin/env node
/**
 * i18n 完整性扫描（纯 Node，无浏览器依赖，可复跑）。
 *
 * 把 tests/localeIntegrity.test.ts 里的静态扫描能力抽成独立 CLI，并把覆盖面从
 * 「仅 .vue 组件 + App.vue」扩大到 src/**\/*.{ts,vue}：parser/renderer/composable 里的
 * t()/tMap() 同样会被扫描（例如 charts.type. / shapes.anchor. 这些动态前缀）。
 *
 * 检查项：
 *   1. zh / en 两本字典的顶层键集合完全一致（防"切英文残留中文回退"或"en 多出无主翻译"）；
 *   2. 每个键在中英两版的插值参数集合一致（防某语言改参数名导致另一语言渲染 undefined）；
 *   3. src/**\/*.{ts,vue} 中每个静态 t('key') 在两本字典都存在；
 *   4. 每个动态 t('prefix.' + x) 前缀在两本字典至少有一个键（有效命名空间）；
 *   5. 每个 tMap('prefix', 'sub') 在两本字典的嵌套 Record 中都能解析。
 *
 * 自带防退化断言：若字典/源文件/静态键/动态前缀/tMap 任一扫描结果为空集，则直接判失败，
 * 避免扫描器因正则失配退化成"永真"。
 *
 * 用法：
 *   npm run audit:i18n                 # 或 node scripts/i18nScan.mjs
 *   node scripts/i18nScan.mjs --json out.json  # 把报告另存为 JSON（供 CI 归档）
 *
 * 退出码：0 = 全部通过；非 0 = 存在缺失键/命名空间或扫描器退化。
 * 本脚本是 vitest 守卫的补充，不替代 tests/localeIntegrity.test.ts。
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const localePath = join(root, 'src/utils/locale.ts')
const srcDir = join(root, 'src')

const args = process.argv.slice(2)
const jsonIdx = args.indexOf('--json')
const jsonPath = jsonIdx >= 0 && args[jsonIdx + 1] ? resolve(args[jsonIdx + 1]) : null

// ---- 字典块解析（与 tests/localeIntegrity.test.ts 保持同一口径）--------------------

function extractTopLevelKeys(block) {
  return [...block.matchAll(/^[ ]{2}'([^']+)':/gm)]
    .map(m => m[1])
    .filter(key => key.includes('.'))
}

/** 把字典块切成 key -> 该条目源码片段（从本键行到下一顶层键行）。 */
function segmentByKey(block) {
  const out = new Map()
  const matches = [...block.matchAll(/^[ ]{2}'([^']+)':/gm)].filter(m => m[1].includes('.'))
  for (let i = 0; i < matches.length; i++) {
    const start = matches[i].index + matches[i][0].length
    const end = i + 1 < matches.length ? matches[i + 1].index : block.length
    out.set(matches[i][1], block.slice(start, end))
  }
  return out
}

/** 提取嵌套 Record（如 shortcuts.items）的 prefix -> Set<subKey>。 */
function extractNestedKeys(block) {
  const out = new Map()
  for (const m of block.matchAll(/^[ ]{2}'([^']+)':\s*\{([\s\S]*?)^[ ]{2}\}/gm)) {
    out.set(m[1], new Set([...m[2].matchAll(/^[ ]{4}'([^']+)'\s*:/gm)].map(s => s[1])))
  }
  return out
}

/** 条目片段中出现的全部插值参数名：字符串值的 {name} + 函数值解构签名 ({ a, b })。 */
function extractParams(segment) {
  const params = new Set()
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

// ---- 使用点扫描 ------------------------------------------------------------------

/** 去掉注释后再扫描，避免注释里的示例 key（如 `// t('foo.xxx')`）被误判为真实使用。 */
function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
}

/** 源码里 t()/tMap() 的使用情况。 */
function collectUsedKeys(sources) {
  const used = { static: new Set(), prefixes: new Set(), tmap: [] }
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

/** 递归收集 src 下所有 .ts / .vue 源文件。 */
function collectSourceFiles(dir) {
  const out = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) out.push(...collectSourceFiles(p))
    else if (name.endsWith('.ts') || name.endsWith('.vue')) out.push(p)
  }
  return out
}

// ---- 主流程 ----------------------------------------------------------------------

const source = readFileSync(localePath, 'utf8')
const zhMarker = source.indexOf('const zh:')
const enMarker = source.indexOf('const en:')
// 字典以顶格 "}" 结束；不截断的话最后一个条目的片段会吞进文件尾部 t()/tMap() 实现代码。
const zhEnd = source.indexOf('\n}', zhMarker)
const enEnd = source.indexOf('\n}', enMarker)
const zhBlock = source.slice(zhMarker, zhEnd)
const enBlock = source.slice(enMarker, enEnd)
const zhKeys = new Set(extractTopLevelKeys(zhBlock))
const enKeys = new Set(extractTopLevelKeys(enBlock))

const files = collectSourceFiles(srcDir)
const sources = files.map(p => readFileSync(p, 'utf8'))
const used = collectUsedKeys(sources)

const failures = []
const notes = []

// 0. 防退化断言 —— 扫描器失配时立即失败，绝不给出"全绿"假象
if (zhMarker < 0 || enMarker < 0) failures.push('locate dictionaries: const zh: / const en: block not found')
if (zhKeys.size <= 100) failures.push(`sanity: zh dict has only ${zhKeys.size} dotted keys (expected >100)`)
if (files.length < 20) failures.push(`sanity: only ${files.length} source files scanned (expected >=20)`)
if (used.static.size <= 100) failures.push(`sanity: only ${used.static.size} static t() keys found (expected >100)`)
if (used.prefixes.size < 1) failures.push('sanity: no dynamic t(prefix.) namespaces found (scanner degraded?)')
if (used.tmap.length < 1) failures.push('sanity: no tMap() usages found (scanner degraded?)')

// 1. zh/en 键集合一致
const missingInEn = [...zhKeys].filter(k => !enKeys.has(k))
const extraInEn = [...enKeys].filter(k => !zhKeys.has(k))
if (missingInEn.length) failures.push(`keys in zh but missing in en (${missingInEn.length}): ${missingInEn.join(', ')}`)
if (extraInEn.length) failures.push(`keys in en but missing in zh (${extraInEn.length}): ${extraInEn.join(', ')}`)

// 2. 插值参数一致性
const zhSegments = segmentByKey(zhBlock)
const enSegments = segmentByKey(enBlock)
const paramMismatches = []
for (const [key, zhSeg] of zhSegments) {
  const enSeg = enSegments.get(key)
  if (!enSeg) continue
  const zhParams = extractParams(zhSeg)
  const enParams = extractParams(enSeg)
  const onlyZh = [...zhParams].filter(p => !enParams.has(p))
  const onlyEn = [...enParams].filter(p => !zhParams.has(p))
  if (onlyZh.length || onlyEn.length) {
    paramMismatches.push(`${key}: zh={${[...zhParams].join(',')}} en={${[...enParams].join(',')}}`)
  }
}
if (paramMismatches.length) failures.push(`interpolation param mismatches (${paramMismatches.length}): ${paramMismatches.join('; ')}`)

// 3. 静态 t() 键
const staticMissingZh = [...used.static].filter(k => !zhKeys.has(k))
const staticMissingEn = [...used.static].filter(k => !enKeys.has(k))
if (staticMissingZh.length) failures.push(`static t() keys missing in zh (${staticMissingZh.length}): ${staticMissingZh.join(', ')}`)
if (staticMissingEn.length) failures.push(`static t() keys missing in en (${staticMissingEn.length}): ${staticMissingEn.join(', ')}`)

// 4. 动态前缀命名空间
const invalidPrefixZh = [...used.prefixes].filter(p => ![...zhKeys].some(k => k.startsWith(p)))
const invalidPrefixEn = [...used.prefixes].filter(p => ![...enKeys].some(k => k.startsWith(p)))
if (invalidPrefixZh.length) failures.push(`dynamic prefixes missing in zh (${invalidPrefixZh.length}): ${invalidPrefixZh.join(', ')}`)
if (invalidPrefixEn.length) failures.push(`dynamic prefixes missing in en (${invalidPrefixEn.length}): ${invalidPrefixEn.join(', ')}`)

// 5. tMap 嵌套键
const zhNested = extractNestedKeys(zhBlock)
const enNested = extractNestedKeys(enBlock)
const tmapMissing = []
for (const { prefix, sub } of used.tmap) {
  if (!zhNested.get(prefix)?.has(sub)) tmapMissing.push(`zh: ${prefix}.${sub}`)
  if (!enNested.get(prefix)?.has(sub)) tmapMissing.push(`en: ${prefix}.${sub}`)
}
if (tmapMissing.length) failures.push(`tMap() nested keys missing (${tmapMissing.length}): ${tmapMissing.join(', ')}`)

// ---- 报告 ------------------------------------------------------------------------

notes.push(`scanned ${files.length} source files (.ts/.vue) under src/`)
notes.push(`zh=${zhKeys.size} keys, en=${enKeys.size} keys`)
notes.push(`usage: ${used.static.size} static keys, ${used.prefixes.size} dynamic prefixes, ${used.tmap.length} tMap() calls`)

const report = {
  ok: failures.length === 0,
  counts: {
    sourceFiles: files.length,
    zhKeys: zhKeys.size,
    enKeys: enKeys.size,
    staticKeys: used.static.size,
    dynamicPrefixes: used.prefixes.size,
    tmapCalls: used.tmap.length,
  },
  failures,
  notes,
}

if (jsonPath) writeFileSync(jsonPath, JSON.stringify(report, null, 2) + '\n')

console.log('i18n scan — src/**/*.{ts,vue} vs locale.ts (zh/en)')
for (const n of notes) console.log('  · ' + n)
if (failures.length === 0) {
  console.log('✅ i18n OK: all keys, namespaces and tMap() entries resolve in both dictionaries.')
} else {
  console.error(`❌ i18n FAILED (${failures.length} issue${failures.length === 1 ? '' : 's'}):`)
  for (const f of failures) console.error('  - ' + f)
  process.exitCode = 1
}
