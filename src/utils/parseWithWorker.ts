import { DocParser } from './docParser'
import type { ProgressCallback } from './docParser'
import workerAssetUrl from './docParser.worker?worker&url'
import type { WorkerParseResponse } from './docParser.worker'
import { MAX_DOC_FILE_SIZE, getFileSizeLimitError } from './docLimits'

export interface WorkerParseResult {
  success: boolean
  document?: any
  text?: string
  error?: string
}

/**
 * Parse a .doc file in a Web Worker to avoid blocking the main thread.
 *
 * Bundles the worker through Vite so app builds can cache it separately.
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
  if (buffer.byteLength > MAX_DOC_FILE_SIZE) {
    return Promise.resolve({ success: false, error: getFileSizeLimitError() })
  }
  return new Promise((resolve) => {
    let bufferTransferred = false
    let worker: Worker | undefined
    let timeout: ReturnType<typeof setTimeout> | undefined

    // Attempt Web Worker path
    try {
      const activeWorker = new Worker(workerAssetUrl, { type: 'module' })
      worker = activeWorker

      const workerTimeout = setTimeout(() => {
        activeWorker.terminate()
        if (bufferTransferred) {
          resolve({ success: false, error: 'Web Worker 解析超时（30 秒）' })
        } else {
          fallbackParse(buffer, maxScanBytes, resolve, onProgress)
        }
      }, 30_000)
      timeout = workerTimeout

      activeWorker.onmessage = (e: MessageEvent<WorkerParseResponse>) => {
        const msg = e.data
        // 分流：进度消息 vs 结果消息
        if (msg.type === 'progress') {
          onProgress?.(msg.stage, msg.percent)
          return
        }
        // msg.type === 'result'
        clearTimeout(workerTimeout)
        activeWorker.terminate()
        worker = undefined
        timeout = undefined
        resolve({
          success: msg.success,
          document: msg.document,
          text: msg.text,
          error: msg.error,
        })
      }

      activeWorker.onerror = (event) => {
        clearTimeout(workerTimeout)
        activeWorker.terminate()
        worker = undefined
        timeout = undefined
        if (bufferTransferred) {
          resolve({ success: false, error: event.message || 'Web Worker 运行失败' })
        } else {
          fallbackParse(buffer, maxScanBytes, resolve, onProgress)
        }
      }

      // Transfer buffer for zero-copy
      activeWorker.postMessage({ buffer, maxScanBytes }, [buffer])
      bufferTransferred = true
    } catch {
      if (timeout !== undefined) clearTimeout(timeout)
      worker?.terminate()
      worker = undefined
      timeout = undefined
      // Workers unsupported or message transfer failed before ownership changed.
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
