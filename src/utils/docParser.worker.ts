import { DocParser } from './docParser'
import type { ProgressCallback, ParseProgressStage } from './docParser'

export interface WorkerParseRequest {
  buffer: ArrayBuffer
  maxScanBytes?: number
}

export interface WorkerParseResultMessage {
  type: 'result'
  success: boolean
  document?: any
  text?: string
  error?: string
}

export interface WorkerParseProgressMessage {
  type: 'progress'
  stage: ParseProgressStage
  percent: number
}

export type WorkerParseResponse = WorkerParseResultMessage | WorkerParseProgressMessage

addEventListener('message', (e: MessageEvent<WorkerParseRequest>) => {
  const { buffer, maxScanBytes } = e.data
  try {
    const parser = new DocParser(buffer, maxScanBytes)
    const onProgress: ProgressCallback = (stage, percent) => {
      postMessage({ type: 'progress', stage, percent } as WorkerParseProgressMessage)
    }
    const result = parser.parseWithFormat(onProgress)
    postMessage({
      type: 'result',
      success: result.success,
      document: result.document,
      text: result.text,
      error: result.error,
    } as WorkerParseResultMessage)
  } catch (error) {
    postMessage({
      type: 'result',
      success: false,
      error: error instanceof Error ? error.message : 'Worker 解析异常',
    } as WorkerParseResultMessage)
  }
})
