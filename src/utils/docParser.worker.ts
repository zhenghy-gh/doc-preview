import { DocParser } from './docParser'

export interface WorkerParseRequest {
  buffer: ArrayBuffer
  maxScanBytes?: number
}

export interface WorkerParseResponse {
  success: boolean
  document?: any
  text?: string
  error?: string
}

addEventListener('message', (e: MessageEvent<WorkerParseRequest>) => {
  const { buffer, maxScanBytes } = e.data
  try {
    const parser = new DocParser(buffer, maxScanBytes)
    const result = parser.parseWithFormat()
    postMessage({ success: result.success, document: result.document, text: result.text, error: result.error } as WorkerParseResponse)
  } catch (error) {
    postMessage({ success: false, error: error instanceof Error ? error.message : 'Worker 解析异常' } as WorkerParseResponse)
  }
})
