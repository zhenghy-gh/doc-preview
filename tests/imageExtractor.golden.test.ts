import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'
import { extractImagesFromStream } from '../src/utils/imageExtractor'

/**
 * imageExtractor 的真实数据与复杂度护栏。
 *
 * 与同目录的 `imageExtractor.test.ts` 互补：后者用合成样本逐条覆盖
 * 各格式的边界判定；这里守住两件合成样本守不住的事：
 *
 * 1. **真实样本 golden 快照** —— 对 docs/ 下的 27 份 .doc 逐张比对提取到的
 *    图片（格式 / 长度 / 内容哈希）。合成样本无法覆盖真实 Data 流里的
 *    噪声分布与图片排布。
 * 2. **复杂度护栏** —— 曾经出现过一个 O(n²) 的候选位置跳跃实现：首字节
 *    在缓冲区里完全缺席时，每轮都从当前位置重新搜索到缓冲区末尾。它在
 *    小样本上结果完全正确、只在大输入上变成性能悬崖，因此差分测试查不出，
 *    必须靠大输入 + 时间上限兜住。
 */

const here = dirname(fileURLToPath(import.meta.url))
const docsDir = resolve(here, '../docs')
const goldenPath = resolve(here, 'fixtures/imageExtractor-golden.json')

function fnv1a(bytes: Uint8Array): string {
  let h = 0x811c9dc5
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i]
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}

describe('extractImagesFromStream — 真实样本 golden 快照', () => {
  it('docs/ 下每份样本的提取结果与快照逐张一致', () => {
    if (!existsSync(goldenPath) || !existsSync(docsDir)) return
    const golden = JSON.parse(readFileSync(goldenPath, 'utf8')) as Record<
      string,
      Array<{ format: string; len: number; hash: string }>
    >

    let files = 0
    let images = 0
    for (const [file, expected] of Object.entries(golden)) {
      const p = resolve(docsDir, file)
      if (!existsSync(p)) continue
      const actual = extractImagesFromStream(new Uint8Array(readFileSync(p)))
      expect(actual.length, `${file} 的图片数量`).toBe(expected.length)
      for (let i = 0; i < expected.length; i++) {
        expect(actual[i].format, `${file}[${i}] 格式`).toBe(expected[i].format)
        expect(actual[i].data.length, `${file}[${i}] 长度`).toBe(expected[i].len)
        expect(fnv1a(actual[i].data), `${file}[${i}] 内容哈希`).toBe(expected[i].hash)
      }
      files++
      images += actual.length
    }
    // 快照本身覆盖 15 份含图样本 / 126 张图；样本缺失时不应静默变成"空测试"
    expect(files, '匹配到的 golden 样本数').toBeGreaterThan(10)
    expect(images, '校验到的图片总数').toBeGreaterThan(100)
  })
})

describe('extractImagesFromStream — 复杂度护栏', () => {
  // 1 MB 输入。O(n) 扫描约 5–10 ms；一旦退化为 O(n²) 则需要数分钟，
  // 因此 5000 ms 的上限有约三个数量级的余量，不会因机器争用而误报。
  const N = 1024 * 1024

  it('单一字节填满的 1MB 缓冲区在线性时间内完成', () => {
    for (const fill of [0xff, 0x89, 0x47, 0x42, 0x00]) {
      const buf = new Uint8Array(N).fill(fill)
      const t = performance.now()
      const found = extractImagesFromStream(buf)
      const ms = performance.now() - t
      expect(found, `fill=0x${fill.toString(16)} 不应提取到图片`).toEqual([])
      expect(ms, `fill=0x${fill.toString(16)} 耗时 ${ms.toFixed(0)} ms`).toBeLessThan(5000)
    }
  })

  it('四个首字节交错铺满 1MB 时仍在线性时间内完成', () => {
    const buf = new Uint8Array(N)
    for (let i = 0; i < N; i++) buf[i] = [0x89, 0xff, 0x47, 0x42][i % 4]
    const t = performance.now()
    expect(extractImagesFromStream(buf)).toEqual([])
    const ms = performance.now() - t
    expect(ms, `交错首字节耗时 ${ms.toFixed(0)} ms`).toBeLessThan(5000)
  })

  it('全零 1MB 缓冲区（无任何候选）在线性时间内完成', () => {
    const t = performance.now()
    expect(extractImagesFromStream(new Uint8Array(N))).toEqual([])
    const ms = performance.now() - t
    expect(ms, `全零耗时 ${ms.toFixed(0)} ms`).toBeLessThan(5000)
  })
})
