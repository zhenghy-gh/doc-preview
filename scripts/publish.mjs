#!/usr/bin/env node
/**
 * 双包发布脚本
 *
 * 同一份代码以两个包名发布：
 *   - @zhenghy/doc-preview (scoped, 需要 --access public)
 *   - doc-preview (unscoped)
 *
 * 用法:
 *   node scripts/publish.mjs                    # 发布两个包
 *   node scripts/publish.mjs --only=scoped      # 只发 @zhenghy/doc-preview
 *   node scripts/publish.mjs --only=unscoped    # 只发 doc-preview
 *   node scripts/publish.mjs --no-build         # 跳过 build:lib
 *   node scripts/publish.mjs --dry-run          # 演练（不真正发布）
 *
 * 安全机制:
 *   - 通过备份文件 .package.json.bak 保证 package.json 可恢复
 *   - 启动时检测残留备份，避免误操作
 *   - 已发布的版本会自动跳过
 */

import { execSync } from 'node:child_process'
import {
  readFileSync,
  writeFileSync,
  copyFileSync,
  existsSync,
  unlinkSync
} from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')
const pkgPath = resolve(root, 'package.json')
const backupPath = resolve(root, '.package.json.bak')

const SCOPED_NAME = '@zhenghy/doc-preview'
const UNSCOPED_NAME = 'doc-preview'

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

function backupPkg() {
  copyFileSync(pkgPath, backupPath)
}

function restorePkg() {
  if (existsSync(backupPath)) {
    copyFileSync(backupPath, pkgPath)
    unlinkSync(backupPath)
  }
}

function isVersionPublished(name, version) {
  return runQuiet(`npm view ${name}@${version}`)
}

function publishAs(name, version, { dryRun }) {
  log(`准备发布 ${name}@${version}`)

  if (isVersionPublished(name, version)) {
    log(`⚠️  ${name}@${version} 已存在，跳过`)
    return
  }

  const pkg = readPkg()
  const originalName = pkg.name

  // 需要 name 字段不同时，备份并修改
  const needSwap = pkg.name !== name
  if (needSwap) {
    backupPkg()
    pkg.name = name
    writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n')
  }

  try {
    const isScoped = name.startsWith('@')
    const flags = [isScoped ? '--access public' : '', dryRun ? '--dry-run' : '']
      .filter(Boolean)
      .join(' ')
    run(`npm publish ${flags}`.trim())
    log(`✅ ${name}@${version} ${dryRun ? '(演练)' : '发布成功'}`)
  } finally {
    if (needSwap) {
      restorePkg()
      log(`已恢复 package.json (name=${originalName})`)
    }
  }
}

// —— 参数解析 ——
const args = process.argv.slice(2)
const onlyArg = args.find((a) => a.startsWith('--only='))
const only = onlyArg ? onlyArg.split('=')[1] : null
const noBuild = args.includes('--no-build')
const dryRun = args.includes('--dry-run')

// —— 安全校验 ——
if (existsSync(backupPath)) {
  console.error(`[publish] 检测到残留备份文件: ${backupPath}`)
  console.error(`[publish] 可能是上次发布未正常结束。请检查 package.json 后删除备份再重试。`)
  process.exit(1)
}

if (only && !['scoped', 'unscoped'].includes(only)) {
  console.error(`[publish] --only 只支持 "scoped" 或 "unscoped"`)
  process.exit(1)
}

const pkg = readPkg()
const currentVersion = pkg.version
log(`当前版本: ${currentVersion}`)
log(`原始包名: ${pkg.name}`)
if (dryRun) log('⚠️  演练模式（--dry-run），不会真正发布')

// —— 构建 ——
if (!noBuild) {
  log('构建 dist...')
  run('npm run build:lib')
} else {
  log('跳过构建（--no-build）')
}

// —— 发布 ——
const targets = []
if (!only || only === 'scoped') targets.push(SCOPED_NAME)
if (!only || only === 'unscoped') targets.push(UNSCOPED_NAME)

for (const name of targets) {
  try {
    publishAs(name, currentVersion, { dryRun })
  } catch (err) {
    log(`❌ ${name} 发布失败: ${err.message}`)
    // 确保恢复 package.json
    restorePkg()
    process.exit(1)
  }
}

log('全部完成')
