import { describe, it, expect, vi, afterEach } from 'vitest'
import { parseWithWorker } from '../src/utils/parseWithWorker'

/**
 * W1-B / C2 心跳空闲超时行为验证。
 *
 * 背景：parseWithWorker 原为固定 30s 总时长超时，超大文档单个解析阶段静默
 * 运行超过 30s 会被误杀。现改为两段式：
 *   - 启动期（未收到任何消息）30s 快速失败 —— 由既有的
 *     parseWithWorker.test.ts / parseWithWorker.largeFile.test.ts 覆盖；
 *   - 收到 progress 消息后进入空闲心跳制，每条消息重置 60s 空闲计时器
 *     （WORKER_IDLE_TIMEOUT_MS）—— 由本文件覆盖。
 *
 * 用 17MB buffer（>16MB 阈值）走 fallbackBuffer=null 分支：
 * 超时必然以失败结算而非主线程回退，断言确定性强且无需构造真实 OLE 样本。
 */

class ManualWorker {
  static last: ManualWorker | null = null
  onmessage: ((e: { data: any }) => void) | null = null
  onerror: (() => void) | null = null
  terminated = false
  postMessage = vi.fn()
  terminate() {
    this.terminated = true
  }
  constructor() {
    ManualWorker.last = this
  }
  emit(msg: unknown) {
    this.onmessage?.({ data: msg })
  }
}

function bigBuffer(): ArrayBuffer {
  return new ArrayBuffer(17 * 1024 * 1024)
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
  ManualWorker.last = null
})

describe('parseWithWorker heartbeat idle timeout', () => {
  it('keeps a heartbeating worker alive past the legacy fixed 30s and times out after 60s idle', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('Worker', ManualWorker as unknown as typeof Worker)

    const done = parseWithWorker(bigBuffer())
    let settledCount = 0
    void done.then(() => {
      settledCount++
    })

    // t=29s：仍在启动窗口（30s）内，存活
    await vi.advanceTimersByTimeAsync(29_000)
    expect(settledCount).toBe(0)

    // 唯一一次心跳：重置空闲计时器 → 下次判定在 29s + 60s = 89s
    ManualWorker.last!.emit({ type: 'progress', stage: 'building_paragraphs', percent: 40 })

    // t=59s：旧的"固定 30s 总时长"早已越过，心跳制下必须仍然存活
    // （若实现退化为固定 30s 或空闲 30s，此处已超时结算，断言即失败）
    await vi.advanceTimersByTimeAsync(30_000)
    expect(settledCount).toBe(0)

    // t=88.999s：60s 空闲期满前的最后一毫秒
    await vi.advanceTimersByTimeAsync(29_999)
    expect(settledCount).toBe(0)

    // t=89.000s：空闲恰好满 60s → 判定挂死、终止、按大文件路径上报失败
    await vi.advanceTimersByTimeAsync(1)
    const result = await done
    expect(settledCount).toBe(1) // 仅结算一次
    expect(result.success).toBe(false)
    expect(result.error).toBe('Worker 解析超时')
    expect(ManualWorker.last!.terminated).toBe(true)
  })

  it('resolves on the result message, cancels the idle timer, and never double-settles', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('Worker', ManualWorker as unknown as typeof Worker)

    const done = parseWithWorker(bigBuffer())
    let settledCount = 0
    void done.then(() => {
      settledCount++
    })

    // 立即上报一条进度（进入心跳制），随后送达结果消息
    ManualWorker.last!.emit({ type: 'progress', stage: 'verifying', percent: 1 })
    ManualWorker.last!.emit({
      type: 'result',
      success: true,
      document: { paragraphs: [] },
      text: '',
      error: undefined,
    })
    const result = await done
    expect(result.success).toBe(true)

    // 结果已结算：此后任意推进假时钟不得产生二次 terminate/结算等副作用
    await vi.advanceTimersByTimeAsync(10 * 60_000)
    expect(settledCount).toBe(1)
  })
})
