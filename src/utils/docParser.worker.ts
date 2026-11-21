import { DocParser } from './docParser'
import type { ProgressCallback, ParseProgressStage } from './docParser'
import type { ParseResult } from './docFormat'

export interface WorkerParseRequest {
  buffer: ArrayBuffer
  maxScanBytes?: number
}

/** 结果消息负载与主线程 ParseResult 同形（TD-1a 收敛，消息协议形状不变）。 */
export interface WorkerParseResultMessage extends ParseResult {
  type: 'result'
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
      // ERR-CODE 随结果消息透传，主线程 classifyError 得以按结构化 code 直映射；
      // 旧 worker / 旧 result 消息无此字段时为 undefined，回退关键字分类。
      errorCode: result.errorCode,
    } as WorkerParseResultMessage)
  } catch (error) {
    postMessage({
      type: 'result',
      success: false,
      error: error instanceof Error ? error.message : 'Worker 解析异常',
    } as WorkerParseResultMessage)
  }
})
