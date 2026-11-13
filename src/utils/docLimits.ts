export const MAX_DOC_FILE_SIZE = 50 * 1024 * 1024

const MAX_EAGER_RESPONSE_BUFFER_BYTES = 1024 * 1024
const DEFAULT_RESPONSE_BUFFER_BYTES = 64 * 1024

type ResizableArrayBuffer = ArrayBuffer & { resize(byteLength: number): void }
type ResizableArrayBufferConstructor = new (
  byteLength: number,
  options: { maxByteLength: number },
) => ResizableArrayBuffer

function createResizableBuffer(initialLength: number, maxByteLength: number): ResizableArrayBuffer | null {
  const prototype = ArrayBuffer.prototype as ArrayBuffer & { resize?: unknown }
  if (typeof prototype.resize !== 'function' || !Number.isSafeInteger(maxByteLength) || maxByteLength < initialLength) {
    return null
  }

  try {
    const Constructor = ArrayBuffer as unknown as ResizableArrayBufferConstructor
    return new Constructor(initialLength, { maxByteLength })
  } catch {
    return null
  }
}

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

  const hasSmallLengthHint = Number.isFinite(contentLength) &&
    contentLength >= 0 && contentLength <= MAX_EAGER_RESPONSE_BUFFER_BYTES
  const initialCapacity = hasSmallLengthHint
    ? Math.min(maxBytes, contentLength)
    : Math.min(maxBytes, DEFAULT_RESPONSE_BUFFER_BYTES)
  // Resize one buffer when supported; older browsers use the chunk fallback below.
  const resizableBuffer = createResizableBuffer(initialCapacity, maxBytes)
  let buffer = resizableBuffer
    ? new Uint8Array(resizableBuffer)
    : hasSmallLengthHint
      ? new Uint8Array(initialCapacity)
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
      } else if (buffer && resizableBuffer) {
        const nextCapacity = Math.min(
          maxBytes,
          Math.max(nextTotal, buffer.byteLength * 2, DEFAULT_RESPONSE_BUFFER_BYTES),
        )
        resizableBuffer.resize(nextCapacity)
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

  if (buffer && resizableBuffer) {
    resizableBuffer.resize(totalBytes)
    return resizableBuffer
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
