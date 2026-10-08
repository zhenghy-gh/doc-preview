import { describe, it, expect } from 'vitest'
import { classifyError } from '../src/utils/errorClassifier'

/**
 * W2-1 配套：URL 加载超时文案 / TimeoutError 必须落入 network 类
 * （可重试 + 网络类建议），而不是落 unknown 误导用户。
 *
 * 关键字约束说明：刻意不收录裸词『超时』——『Worker 解析超时』依赖
 * 『解析』关键字归类为 parse（worker 空闲超时属解析阶段问题），
 * 裸词会把它翻转到 network 造成语义回退。
 */
describe('errorClassifier - 加载超时归入 network（W2-1）', () => {
  it('loadFromUrl 的中文超时文案应分类为 network 且可重试', () => {
    const result = classifyError('加载超时：服务器长时间无响应，请检查地址是否可访问或稍后重试')
    expect(result.category).toBe('network')
    expect(result.retryable).toBe(true)
    expect(result.suggestions.length).toBeGreaterThan(0)
  })

  it('TimeoutError DOMException 名应分类为 network', () => {
    const err = new DOMException('加载超时（60 秒无响应）', 'TimeoutError')
    const result = classifyError(err)
    expect(result.category).toBe('network')
    expect(result.retryable).toBe(true)
  })

  it('英文环境返回英文网络类标题', () => {
    const result = classifyError('request timed out after 60000 ms', 'en')
    expect(result.category).toBe('network')
    expect(result.title).toBe('Unable to load file')
  })

  it('裸词『超时』不触发 network —— Worker 解析超时保持 parse 归类', () => {
    // 守护既有语义：worker 段超时属于解析阶段，仍应由『解析』关键字命中 parse
    const result = classifyError('Worker 解析超时')
    expect(result.category).toBe('parse')
  })
})
