#!/usr/bin/env node
/**
 * 双包发布脚本
 *
 * 同一份代码（同一份 dist-lib）以两个包名发布：
 *   - @zhenghy/doc-preview (scoped，需 --access public)
 *   - doc-preview         (unscoped)
 *
 * 用法:
 *   npm run release                      # 构建一次 + 发布两个包
 *   npm run release -- --only=scoped      # 只发 @zhenghy/doc-preview
 *   npm run release -- --only=unscoped    # 只发 doc-preview
 *   npm run release -- --no-build         # 跳过 build:lib（直接用现有 dist-lib）
 *   npm run release -- --dry-run          # 演练（打包但不真正上传）
 *   npm run release -- --tag=next         # 指定 dist-tag（默认 latest）
 *
 * 说明:
 *   - lib 构建产物（dist-lib）与包名无关（vite.config.ts 中 lib.name/fileName
 *     为固定值），因此两个包名共享同一份构建结果。
 *   - 脚本只构建一次，发布时使用 --ignore-scripts 跳过 prepublishOnly，
 *     避免每个包名重复构建。
 *   - 发布 unscoped 包名时会临时改写 package.json 的 name 字段，
 *     结束后（含中断/异常）自动恢复原文件。
 *   - 已发布的 同名@版本 会自动跳过。
 */

import { execSync } from 'node:child_process'
import {
  readFileSync,
  writeFileSync,
  copyFileSync,
  existsSync,
  unlinkSync,
} from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')
const pkgPath = resolve(root, 'package.json')
const backupPath = resolve(root, '.package.json.bak')

const TARGETS = [
  { key: 'scoped', name: '@zhenghy/doc-preview' },
  { key: 'unscoped', name: 'doc-preview' },
]

// 本机 ~/.npmrc 可能把 registry 指向只读镜像（如 registry.npmmirror.com），
// 那会导致发布失败。这里强制显式指定官方 registry，可用环境变量覆盖。
const REGISTRY = process.env.NPM_PUBLISH_REGISTRY || 'https://registry.npmjs.org'

let restoring = false

function log(msg) {
  console.log(`\n[publish] ${msg}`)
}

function run(cmd) {
  log(`$ ${cmd}`)
  execSync(cmd, { stdio: 'inherit', cwd: root })
}

function runQuiet(cmd) {
  try {
    execSync(cmd, { stdio: 'pipe', cwd: root })
    return true
  } catch {
    return false
  }
}

function readPkg() {
  return JSON.parse(readFileSync(pkgPath, 'utf8'))
}

/** 从备份恢复 package.json（幂等，可安全重复调用）。 */
function restorePkg() {
  if (restoring) return
  restoring = true
  if (existsSync(backupPath)) {
    try {
      copyFileSync(backupPath, pkgPath)
      unlinkSync(backupPath)
      log('已恢复 package.json')
    } catch (err) {
      console.error(`[publish] ⚠️  恢复 package.json 失败: ${err.message}`)
    }
  }
}

/** 临时把 package.json 的 name 改成目标包名；返回是否发生了改写。 */
function swapName(name) {
  const pkg = readPkg()
  if (pkg.name === name) return false
  copyFileSync(pkgPath, backupPath)
  pkg.name = name
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n')
  log(`已临时改写 package.json (name → ${name})`)
  return true
}

function isVersionPublished(name, version) {
  return runQuiet(`npm view ${name}@${version} version --registry=${REGISTRY}`)
}

function publishAs(name, version, { dryRun, tag }) {
  log(`准备发布 ${name}@${version}`)

  if (isVersionPublished(name, version)) {
    log(`⚠️  ${name}@${version} 已存在，跳过`)
    return
  }

  const swapped = swapName(name)
  try {
    const flags = []
    if (name.startsWith('@')) flags.push('--access public')
    if (tag) flags.push(`--tag ${tag}`)
    if (dryRun) flags.push('--dry-run')
    // 已在上方统一构建过，跳过 prepublishOnly，避免两个包名重复构建
    flags.push('--ignore-scripts')
    flags.push(`--registry=${REGISTRY}`)
    run(`npm publish ${flags.join(' ')}`)
    log(`✅ ${name}@${version} ${dryRun ? '（演练）' : '发布成功'}`)
  } finally {
    if (swapped) restorePkg()
  }
}

// —— 中断保护：任何退出路径都恢复 package.json ——
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(sig, () => {
    restorePkg()
    process.exit(1)
  })
}
process.on('exit', restorePkg)

// —— 参数解析 ——
const args = process.argv.slice(2)
const onlyArg = args.find((a) => a.startsWith('--only='))
const only = onlyArg ? onlyArg.split('=')[1] : null
const tagArg = args.find((a) => a.startsWith('--tag='))
const tag = tagArg ? tagArg.split('=')[1] : null
const noBuild = args.includes('--no-build')
const dryRun = args.includes('--dry-run')

// —— 安全校验 ——
if (existsSync(backupPath)) {
  console.error(`[publish] 检测到残留备份文件: ${backupPath}`)
  console.error('[publish] 可能是上次发布未正常结束。请检查 package.json 后删除备份再重试。')
  process.exit(1)
}

if (only && !TARGETS.some((t) => t.key === only)) {
  console.error('[publish] --only 只支持 "scoped" 或 "unscoped"')
  process.exit(1)
}

const pkg = readPkg()
const currentVersion = pkg.version
log(`当前版本: ${currentVersion}`)
log(`原始包名: ${pkg.name}`)
log(`registry: ${REGISTRY}`)
log(`发布目标: ${TARGETS.filter((t) => !only || t.key === only).map((t) => t.name).join(', ')}`)
if (tag) log(`dist-tag: ${tag}`)
if (dryRun) log('⚠️  演练模式（--dry-run），不会真正上传')

// —— 构建（只构建一次）——
if (!noBuild) {
  log('构建 dist-lib...')
  run('npm run build:lib')
} else {
  log('跳过构建（--no-build）')
}

// —— 发布 ——
const targets = TARGETS.filter((t) => !only || t.key === only)
for (const { name } of targets) {
  try {
    publishAs(name, currentVersion, { dryRun, tag })
  } catch (err) {
    restorePkg()
    log(`❌ ${name} 发布失败: ${err.message}`)
    process.exit(1)
  }
}

log(`全部完成（${targets.length} 个包）`)
