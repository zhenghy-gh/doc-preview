export const MAX_DOC_FILE_SIZE = 50 * 1024 * 1024

export function getFileSizeLimitError(): string {
  return '文件超过最大支持大小（50 MB）'
}

export function isDocFileTooLarge(byteLength: number): boolean {
  return byteLength > MAX_DOC_FILE_SIZE
}

export async function readResponseWithLimit(
  response: Response,
  maxBytes = MAX_DOC_FILE_SIZE,
): Promise<ArrayBuffer> {
  const contentLength = Number(response.headers.get('content-length'))
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    await response.body?.cancel().catch(() => {})
    throw new RangeError(getFileSizeLimitError())
  }

  const reader = response.body?.getReader()
  if (!reader) throw new Error('无法读取响应内容')

  const chunks: Uint8Array[] = []
  let totalBytes = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      totalBytes += value.byteLength
      if (totalBytes > maxBytes) {
        await reader.cancel().catch(() => {})
        throw new RangeError(getFileSizeLimitError())
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }

  const result = new Uint8Array(totalBytes)
  let offset = 0
  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.byteLength
  }
  return result.buffer
}
