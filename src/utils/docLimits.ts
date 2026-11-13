export const MAX_DOC_FILE_SIZE = 50 * 1024 * 1024

const MAX_EAGER_RESPONSE_BUFFER_BYTES = 1024 * 1024

export function getFileSizeLimitError(): string {
  return '文件超过最大支持大小（50 MiB）'
}

export function isDocFileTooLarge(byteLength: number): boolean {
  return byteLength > MAX_DOC_FILE_SIZE
}

export async function readResponseWithLimit(
  response: Response,
  maxBytes = MAX_DOC_FILE_SIZE,
): Promise<ArrayBuffer> {
  const contentLengthHeader = response.headers.get('content-length')
  const contentLength = contentLengthHeader === null ? Number.NaN : Number(contentLengthHeader)
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    await response.body?.cancel().catch(() => {})
    throw new RangeError(getFileSizeLimitError())
  }

  const reader = response.body?.getReader()
  if (!reader) throw new Error('无法读取响应内容')

  // Chunk larger or unknown bodies to avoid allocating slack and copying it away at the end.
  const hasSmallLengthHint = Number.isFinite(contentLength) &&
    contentLength >= 0 && contentLength <= MAX_EAGER_RESPONSE_BUFFER_BYTES
  let buffer = hasSmallLengthHint
    ? new Uint8Array(Math.min(maxBytes, contentLength))
    : null
  const chunks: Uint8Array[] = []
  let totalBytes = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      const nextTotal = totalBytes + value.byteLength
      if (nextTotal > maxBytes) {
        await reader.cancel().catch(() => {})
        throw new RangeError(getFileSizeLimitError())
      }
      if (buffer && nextTotal <= buffer.byteLength) {
        buffer.set(value, totalBytes)
      } else {
        if (buffer) chunks.push(buffer.subarray(0, totalBytes))
        buffer = null
        chunks.push(value)
      }
      totalBytes = nextTotal
    }
  } finally {
    reader.releaseLock()
  }

  if (buffer) {
    return totalBytes === buffer.byteLength ? buffer.buffer : buffer.slice(0, totalBytes).buffer
  }

  const result = new Uint8Array(totalBytes)
  let offset = 0
  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.byteLength
  }
  return result.buffer
}
