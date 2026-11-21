import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'

/**
 * scripts/i18nScan.mjs 的可复跑性守卫：CI 里除 vitest 内部扫描（只覆盖 .vue/App.vue）
 * 之外，再真正执行 CLI 一次，把 rendering/composable 等 .ts 使用点也纳入门禁。
 * CLI 的失败路径（缺失键 → exit 1）由负控人工验证，见 changelog。
 */
const script = resolve(process.cwd(), 'scripts/i18nScan.mjs')

describe('i18n scan CLI', () => {
  it('exits 0 and reports all keys/namespaces resolved on the current tree', () => {
    const out = execFileSync(process.execPath, [script], { encoding: 'utf8' })
    expect(out).toMatch(/i18n OK/)
    expect(out).toMatch(/scanned \d+ source files \(\.ts\/\.vue\) under src\//)
    expect(out).toMatch(/static keys, \d+ dynamic prefixes, \d+ tMap\(\) calls/)
  })
})
