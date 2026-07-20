import { describe, it, expect } from 'vitest'
import { DocParser, type ParseProgressStage } from '../src/utils/docParser'

describe('DocParser.parseWithFormat - 进度回调', () => {
  it('调用 parseWithFormat 时应通过 onProgress 回调报告进度（空 buffer 也会触发 verifying）', () => {
    // 使用空 buffer，解析会失败但进度回调仍应被触发
    const buffer = new ArrayBuffer(512)
    const parser = new DocParser(buffer)
    const stages: Array<{ stage: ParseProgressStage; percent: number }> = []

    const result = parser.parseWithFormat((stage, percent) => {
      stages.push({ stage, percent })
    })

    // 至少应该有 verifying 阶段被触发
    expect(stages.length).toBeGreaterThan(0)
    expect(stages[0].stage).toBe('verifying')
    // 百分比应在 0-100 之间
    for (const { percent } of stages) {
      expect(percent).toBeGreaterThanOrEqual(0)
      expect(percent).toBeLessThanOrEqual(100)
    }
    // 结果对象存在
    expect(result).toBeDefined()
    expect(typeof result.success).toBe('boolean')
  })

  it('不传 onProgress 时应正常工作', () => {
    const buffer = new ArrayBuffer(512)
    const parser = new DocParser(buffer)
    const result = parser.parseWithFormat()
    expect(result).toBeDefined()
    expect(typeof result.success).toBe('boolean')
  })

  it('进度百分比应单调递增（非严格）', () => {
    const buffer = new ArrayBuffer(512)
    const parser = new DocParser(buffer)
    const percents: number[] = []

    parser.parseWithFormat((_stage, percent) => {
      percents.push(percent)
    })

    // 验证百分比是递增的（允许相等，不允许倒退）
    for (let i = 1; i < percents.length; i++) {
      expect(percents[i]).toBeGreaterThanOrEqual(percents[i - 1])
    }
  })
})
