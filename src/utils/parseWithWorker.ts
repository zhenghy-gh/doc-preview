import { DocParser } from './docParser'
import type { ProgressCallback } from './docParser'
import type { WorkerParseResponse } from './docParser.worker'
import type { ParseResult } from './docFormat'

/**
 * Worker 解析结果与主线程 ParseResult 同形（TD-1a 收敛平行声明）。
 * fallbackParse 直接透传 parser.parseWithFormat()，两者天然一致。
 */
export type WorkerParseResult = ParseResult

/**
 * Worker 启动期超时（W1-B / C2）：发出解析请求后尚未收到任何消息
 * （Worker 脚本加载 + 首个解析阶段）的最长等待。真实解析会在开始时立即上报
 * 第一条 progress（verifying 阶段），该窗口通常只有脚本加载耗时；保持较短
 * 可在 Worker 完全无响应时尽早失败/回退。
 */
const WORKER_STARTUP_TIMEOUT_MS = 30_000

/**
 * Worker 空闲心跳阈值（W1-B / C2）：收到最后一条消息后，再等这么久仍无新消息
 * 才判定挂死并终止。依据：解析管线有 10 阶段进度上报（verify/fib/clx/formats/
 * fields/shapes/paragraphs/properties/images/finalizing），阶段间消息间隔为
 * 毫秒级；但超大文档单个阶段内部可能静默运行数十秒——旧的固定 30s 总时长会把
 * 这类"活着的 Worker"误杀。取 60s：对慢阶段消息间隔留出一个数量级冗余，
 * 同时保证真正死锁的 Worker 也能被及时回收。
 */
const WORKER_IDLE_TIMEOUT_MS = 60_000

/**
 * Parse a .doc file in a Web Worker to avoid blocking the main thread.
 *
 * Uses Vite's native worker bundling (`new Worker(new URL(...), { type: 'module' })`).
 * Falls back to main-thread parsing if Workers are unavailable.
 *
 * @param buffer - The .doc file as an ArrayBuffer.
 * @param maxScanBytes - Optional scan limit (passed to DocParser).
 * @param onProgress - Optional progress callback (stage, percent 0-100).
 * @returns A promise resolving to the parse result.
 */
export function parseWithWorker(
  buffer: ArrayBuffer,
  maxScanBytes?: number,
  onProgress?: ProgressCallback,
): Promise<WorkerParseResult> {
  return new Promise((resolve) => {
    let settled = false
    const finish = (result: WorkerParseResult) => {
      if (settled) return
      settled = true
      resolve(result)
    }
    const fallback = (fallbackBuffer: ArrayBuffer) => {
      if (settled) return
      fallbackParse(fallbackBuffer, maxScanBytes, finish, onProgress)
    }

    // Keep the old fallback behaviour for small files, but avoid duplicating
    // large documents just to protect an unlikely worker failure path. A second
    // full ArrayBuffer copy is expensive for 100MB+ documents.
    // Keep a fallback copy only when it is cheap. Large files are transferred
    // to the worker and cannot be duplicated without defeating the memory goal.
    const fallbackBuffer = buffer.byteLength <= 16 * 1024 * 1024
      ? buffer.slice(0)
      : null

    // Attempt Web Worker path
    try {
      const worker = new Worker(
        new URL('./docParser.worker.ts', import.meta.url),
        { type: 'module' },
      )

      // C2 心跳空闲超时：不再用固定总时长，改为"距上一条消息的空闲时长"。
      // 启动期（尚未收到任何消息）沿用快速失败阈值；此后每收到一条 progress
      // 消息即重置 60s 空闲计时器（详见 WORKER_IDLE_TIMEOUT_MS 注释）。
      let idleTimer: ReturnType<typeof setTimeout> | null = null
      const clearIdleTimer = () => {
        if (idleTimer !== null) {
          clearTimeout(idleTimer)
          idleTimer = null
        }
      }
      const onIdleTimeout = () => {
        idleTimer = null
        if (settled) return
        worker.terminate()
        if (fallbackBuffer !== null) {
          fallback(fallbackBuffer)
        } else {
          finish({ success: false, error: 'Worker 解析超时' })
        }
      }
      const armIdleTimer = (delayMs: number) => {
        if (settled) return
        clearIdleTimer()
        idleTimer = setTimeout(onIdleTimeout, delayMs)
      }

      armIdleTimer(WORKER_STARTUP_TIMEOUT_MS)

      worker.onmessage = (e: MessageEvent<WorkerParseResponse>) => {
        const msg = e.data
        // 分流：进度消息 vs 结果消息
        if (msg.type === 'progress') {
          onProgress?.(msg.stage, msg.percent)
          armIdleTimer(WORKER_IDLE_TIMEOUT_MS) // 心跳重置
          return
        }
        // msg.type === 'result'
        clearIdleTimer()
        worker.terminate()
        finish({
          success: msg.success,
          document: msg.document,
          text: msg.text,
          error: msg.error,
          errorCode: msg.errorCode,
        })
      }

      worker.onerror = () => {
        clearIdleTimer()
        worker.terminate()
        if (fallbackBuffer !== null) {
          fallback(fallbackBuffer)
        } else {
          finish({ success: false, error: 'Worker 解析异常' })
        }
      }

      // Transfer buffer for zero-copy
      worker.postMessage({ buffer, maxScanBytes }, [buffer])
    } catch {
      // Workers unsupported (e.g. some older browsers) → main thread
      fallback(fallbackBuffer ?? buffer)
    }
  })
}

function fallbackParse(
  buffer: ArrayBuffer,
  maxScanBytes: number | undefined,
  resolve: (result: WorkerParseResult) => void,
  onProgress?: ProgressCallback,
) {
  try {
    const parser = new DocParser(buffer, maxScanBytes)
    resolve(parser.parseWithFormat(onProgress))
  } catch (error) {
    resolve({ success: false, error: error instanceof Error ? error.message : '解析异常' })
  }
}
