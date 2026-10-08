import { describe, it, expect, vi, afterEach } from 'vitest'
import { parseWithWorker } from '../src/utils/parseWithWorker'

/**
 * 大文件（>16MB，fallbackBuffer=null）路径的 Worker 失败分支：
 * parseWithWorker 对大文件不做主线程回退副本（避免 100MB+ 文档双份内存），
 * 因此超时 / onerror 只能上报失败而不是回退解析。此前这些分支 0 覆盖。
 */

class ScriptedWorker {
  static last: ScriptedWorker | null = null
  onmessage: ((e: { data: unknown }) => void) | null = null
  onerror: (() => void) | null = null
  terminate = vi.fn()
  postMessage = vi.fn()
  constructor() {
    ScriptedWorker.last = this
  }
}

function bigBuffer(): ArrayBuffer {
  // 17MB > 16MB 阈值：让 parseWithWorker 走 fallbackBuffer = null 分支
  return new ArrayBuffer(17 * 1024 * 1024)
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
  ScriptedWorker.last = null
})

describe('parseWithWorker large-file failure paths', () => {
  it('reports failure (no fallback) when a large-file worker times out', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('Worker', ScriptedWorker as unknown as typeof Worker)

    const done = parseWithWorker(bigBuffer())
    const worker = ScriptedWorker.last!
    expect(worker).not.toBeNull()

    const assertion = done.then(result => {
      expect(result.success).toBe(false)
      expect(result.error).toBe('Worker 解析超时')
    })

    await vi.advanceTimersByTimeAsync(30_000)
    await assertion
    expect(worker.terminate).toHaveBeenCalled()
  })

  it('reports failure (no fallback) when a large-file worker raises onerror', async () => {
    vi.stubGlobal('Worker', ScriptedWorker as unknown as typeof Worker)

    const buffer = bigBuffer()
    const done = parseWithWorker(buffer)
    const worker = ScriptedWorker.last!

    // 缓冲区以零拷贝方式移交给 Worker
    expect(worker.postMessage).toHaveBeenCalledTimes(1)
    expect(worker.postMessage.mock.calls[0][1]).toEqual([buffer])

    worker.onerror!()
    const result = await done
    expect(result.success).toBe(false)
    expect(result.error).toBe('Worker 解析异常')
    expect(worker.terminate).toHaveBeenCalled()
  })
})
