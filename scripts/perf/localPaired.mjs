#!/usr/bin/env node
/**
 * 本地性能配对基准（供优化循环 Round 179+ 复用）。
 *
 * 从 git HEAD 导出基线源码到临时目录，与当前工作区源码分别用 esbuild 打包，
 * 然后在同一进程里交错运行 N 对「27 份真实语料 × parseWithFormat」，
 * 输出 medianRatio / meanRatio / 胜率。候选 bundle 路径可用 --cand 指定
 * （默认用当前工作区源码打包）。
 *
 * 用法：
 *   node scripts/perf/localPaired.mjs [pairs]
 *   PAIRS=300 node scripts/perf/localPaired.mjs
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, openSync, readFileSync, readdirSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const pairs = Number(process.env.PAIRS || process.argv[2] || 200)
const temp = mkdtempSync(join(tmpdir(), 'dp-paired-'))
const baseSrc = join(temp, 'base')
mkdirSync(baseSrc)

try {
  execFileSync('git', ['archive', 'HEAD'], { cwd: root, stdio: ['ignore', openSync(join(temp, 'base.tar'), 'w'), 'inherit'] })
  execFileSync('tar', ['-x', '-f', join(temp, 'base.tar'), '-C', baseSrc], { stdio: 'inherit' })
  symlinkSync(join(root, 'node_modules'), join(baseSrc, 'node_modules'), 'dir')

  async function bundle(srcRoot, out) {
    await build({
      entryPoints: [join(srcRoot, 'src/utils/docParser.ts')],
      bundle: true,
      platform: 'node',
      format: 'esm',
      outfile: out,
      logLevel: 'silent',
    })
  }
  const baseBundle = join(temp, 'base.mjs')
  const candBundle = join(temp, 'cand.mjs')
  await bundle(baseSrc, baseBundle)
  await bundle(root, candBundle)

  const { DocParser: Base } = await import(baseBundle)
  const { DocParser: Cand } = await import(candBundle)
  const docsDir = join(root, 'docs')
  const files = readdirSync(docsDir).filter(f => f.endsWith('.doc')).sort().map(f => {
    const b = readFileSync(join(docsDir, f))
    return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)
  })

  function run(Parser) {
    const t = process.hrtime.bigint()
    let ck = 0
    for (const ab of files) {
      const r = new Parser(ab).parseWithFormat()
      if (r.success) ck += r.document.paragraphs.length
    }
    return { ms: Number(process.hrtime.bigint() - t) / 1e6, ck }
  }
  for (let i = 0; i < 5; i++) { run(Base); run(Cand) }

  const ratios = []
  let wins = 0
  for (let i = 0; i < pairs; i++) {
    const order = i % 2 === 0 ? [Base, Cand] : [Cand, Base]
    const a = run(order[0])
    const b = run(order[1])
    if (a.ck !== b.ck) throw new Error(`checksum mismatch: ${a.ck} vs ${b.ck}`)
    const baseMs = order[0] === Base ? a.ms : b.ms
    const candMs = order[0] === Cand ? a.ms : b.ms
    ratios.push(candMs / baseMs)
    if (candMs < baseMs) wins++
  }
  ratios.sort((x, y) => x - y)
  console.log(JSON.stringify({
    pairs,
    medianRatio: Number(ratios[ratios.length >> 1].toFixed(6)),
    meanRatio: Number((ratios.reduce((s, r) => s + r, 0) / pairs).toFixed(6)),
    wins,
    winRate: Number((100 * wins / pairs).toFixed(2)),
  }))
} finally {
  rmSync(temp, { recursive: true, force: true })
}
