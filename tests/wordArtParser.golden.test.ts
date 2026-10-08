import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'
import { extractWordArtFromDrawingData } from '../src/utils/wordArtParser'

/**
 * `extractWordArtFromDrawingData` 的真实样本快照与复杂度护栏。
 *
 * 与同目录的 `wordArtParser.test.ts` 互补：后者用合成样本逐条覆盖标记识别、
 * 效果/颜色/文本提取；这里守住两件合成样本守不住的事：
 *
 * 1. **真实样本快照** —— 27 份 `.doc` 上的全部 27 个 WordArt（分布在 15 份
 *    样本里）逐字段比对。扫描循环从「逐字节 + 内层循环」改为「首字节不匹配时
 *    用 `indexOf` 跳跃」后，这个快照是防止跳跃漏掉候选或错位的主要常驻防线。
 *    快照由改动前的实现生成，且已由差分测试证明两版在真实语料上逐位一致。
 * 2. **复杂度护栏** —— 跳跃式扫描最怕「首字节很密」的输入（每个字节一次原生
 *    调用）。1 MB 全 0xE0 必须与其它填充一样快，才能证明跳跃只在首字节不匹配
 *    时才发生。
 */

const here = dirname(fileURLToPath(import.meta.url))
const docsDir = resolve(here, '../docs')
const goldenPath = resolve(here, 'fixtures/wordArtParser-golden.json')

describe('extractWordArtFromDrawingData — 真实样本快照', () => {
  it('docs/ 下每份样本的提取结果与快照逐字段一致', () => {
    if (!existsSync(goldenPath) || !existsSync(docsDir)) return
    const golden = JSON.parse(readFileSync(goldenPath, 'utf8')) as Record<string, unknown[]>

    let files = 0
    let wordArts = 0
    let filesWithArt = 0
    for (const [file, expected] of Object.entries(golden)) {
      const p = resolve(docsDir, file)
      if (!existsSync(p)) continue
      const actual = extractWordArtFromDrawingData(new Uint8Array(readFileSync(p)))
      expect(JSON.stringify(actual), `${file} 的提取结果`).toBe(JSON.stringify(expected))
      files++
      wordArts += actual.length
      if (actual.length) filesWithArt++
    }

    // 样本缺失时不应静默退化成「空测试」
    expect(files, '匹配到的快照样本数').toBeGreaterThan(20)
    expect(wordArts, '校验到的 WordArt 总数').toBeGreaterThan(20)
    expect(filesWithArt, '有产出的样本数').toBeGreaterThan(10)
  })
})

describe('extractWordArtFromDrawingData — 复杂度护栏', () => {
  // 1 MB 输入的线性扫描约 1–2 ms；5000 ms 的上限有约三个数量级余量，
  // 不会因并行测试的机器争用而误报，但能拦住超线性退化。
  const N = 1024 * 1024

  it('单一字节铺满 1MB 在线性时间内完成（含首字节最密的全 0xE0）', () => {
    for (const fill of [0x00, 0xe0, 0xff, 0x10, 0x4b, 0x4c, 0x20, 0x89]) {
      const buf = new Uint8Array(N).fill(fill)
      const t = performance.now()
      extractWordArtFromDrawingData(buf)
      const ms = performance.now() - t
      expect(ms, `fill=0x${fill.toString(16)} 耗时 ${ms.toFixed(0)} ms`).toBeLessThan(5000)
    }
  })

  it('每 16 字节一个真标记的 1MB 缓冲区在线性时间内完成', () => {
    const buf = new Uint8Array(N).fill(0xff)
    for (let o = 0; o + 4 <= buf.length; o += 16) {
      buf[o] = 0xe0
      buf[o + 1] = 0
      buf[o + 2] = 0
      buf[o + 3] = 0
    }
    const t = performance.now()
    extractWordArtFromDrawingData(buf)
    const ms = performance.now() - t
    expect(ms, `密集真标记耗时 ${ms.toFixed(0)} ms`).toBeLessThan(5000)
  })

  it('每 16 字节一个假 0xE0（后三字节非零）的 1MB 缓冲区在线性时间内完成', () => {
    const buf = new Uint8Array(N).fill(0xff)
    for (let o = 0; o + 4 <= buf.length; o += 16) buf[o] = 0xe0
    const t = performance.now()
    extractWordArtFromDrawingData(buf)
    const ms = performance.now() - t
    expect(ms, `密集假首字节耗时 ${ms.toFixed(0)} ms`).toBeLessThan(5000)
  })

  it('无任何候选的 1MB 缓冲区在线性时间内完成（跳跃路径全程生效）', () => {
    const buf = new Uint8Array(N)
    for (let i = 0; i < buf.length; i++) buf[i] = 0x41 + (i % 26)
    const t = performance.now()
    const r = extractWordArtFromDrawingData(buf)
    const ms = performance.now() - t
    expect(r).toEqual([])
    expect(ms, `无候选耗时 ${ms.toFixed(0)} ms`).toBeLessThan(5000)
  })
})
