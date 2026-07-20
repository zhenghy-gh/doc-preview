import { DocParser } from './docParser'
import type { ProgressCallback } from './docParser'
import type { WorkerParseResponse } from './docParser.worker'

export interface WorkerParseResult {
  success: boolean
  document?: any
  text?: string
  error?: string
}

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
    // Attempt Web Worker path
    try {
      const worker = new Worker(
        new URL('./docParser.worker.ts', import.meta.url),
        { type: 'module' },
      )

      const timeout = setTimeout(() => {
        worker.terminate()
        // Fallback on timeout
        fallbackParse(buffer, maxScanBytes, resolve, onProgress)
      }, 30_000)

      worker.onmessage = (e: MessageEvent<WorkerParseResponse>) => {
        const msg = e.data
        // 分流：进度消息 vs 结果消息
        if (msg.type === 'progress') {
          onProgress?.(msg.stage, msg.percent)
          return
        }
        // msg.type === 'result'
        clearTimeout(timeout)
        worker.terminate()
        resolve({
          success: msg.success,
          document: msg.document,
          text: msg.text,
          error: msg.error,
        })
      }

      worker.onerror = () => {
        clearTimeout(timeout)
        worker.terminate()
        fallbackParse(buffer, maxScanBytes, resolve, onProgress)
      }

      // Transfer buffer for zero-copy
      worker.postMessage({ buffer, maxScanBytes }, [buffer])
    } catch {
      // Workers unsupported (e.g. some older browsers) → main thread
      fallbackParse(buffer, maxScanBytes, resolve, onProgress)
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
