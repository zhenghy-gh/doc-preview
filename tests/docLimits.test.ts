import { describe, expect, it, vi } from 'vitest'
import { isDocFileTooLarge, MAX_DOC_FILE_SIZE, readResponseWithLimit } from '../src/utils/docLimits'

function makeResponse(body: ReadableStream<Uint8Array>, headers = new Headers()): Response {
  return { headers, body } as Response
}

describe('MAX_DOC_FILE_SIZE', () => {
  it('matches the upload and parser limit of 50 MiB', () => {
    expect(MAX_DOC_FILE_SIZE).toBe(50 * 1024 * 1024)
  })

  it('accepts the exact limit and rejects the next byte', () => {
    expect(isDocFileTooLarge(MAX_DOC_FILE_SIZE - 1)).toBe(false)
    expect(isDocFileTooLarge(MAX_DOC_FILE_SIZE)).toBe(false)
    expect(isDocFileTooLarge(MAX_DOC_FILE_SIZE + 1)).toBe(true)
  })
})

describe('readResponseWithLimit', () => {
  it('rejects an oversized Content-Length and cancels the body', async () => {
    let cancelled = false
    const body = new ReadableStream<Uint8Array>({
      cancel() {
        cancelled = true
      },
    })
    const response = makeResponse(body, new Headers({ 'content-length': '11' }))

    await expect(readResponseWithLimit(response, 10)).rejects.toThrow(RangeError)
    expect(cancelled).toBe(true)
  })

  it('cancels an unknown-length response when streamed bytes exceed the cap', async () => {
    let cancelled = false
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2, 3, 4]))
        controller.enqueue(new Uint8Array([5, 6, 7, 8]))
      },
      cancel() {
        cancelled = true
      },
    })

    await expect(readResponseWithLimit(makeResponse(body), 6)).rejects.toThrow(RangeError)
    expect(cancelled).toBe(true)
  })

  it('enforces the cap even when Content-Length understates the stream', async () => {
    let cancelled = false
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2, 3, 4]))
        controller.enqueue(new Uint8Array([5, 6, 7, 8]))
      },
      cancel() {
        cancelled = true
      },
    })
    const response = makeResponse(body, new Headers({ 'content-length': '1' }))

    await expect(readResponseWithLimit(response, 6)).rejects.toThrow(RangeError)
    expect(cancelled).toBe(true)
  })

  it('returns bytes for a valid response without Content-Length', async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([4, 5]))
        controller.close()
      },
    })

    const buffer = await readResponseWithLimit(makeResponse(body), 10)
    expect(Array.from(new Uint8Array(buffer))).toEqual([4, 5])
  })

  it('returns only received bytes when Content-Length overstates a valid body', async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([4, 5]))
        controller.close()
      },
    })
    const response = makeResponse(body, new Headers({ 'content-length': '9' }))

    const buffer = await readResponseWithLimit(response, 10)
    expect(Array.from(new Uint8Array(buffer))).toEqual([4, 5])
  })

  it('returns bytes using a matching Content-Length hint', async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2]))
        controller.enqueue(new Uint8Array([3]))
        controller.close()
      },
    })

    const response = makeResponse(body, new Headers({ 'content-length': '3' }))
    const buffer = await readResponseWithLimit(response, 3)
    expect(Array.from(new Uint8Array(buffer))).toEqual([1, 2, 3])
  })

  it.skipIf(typeof (ArrayBuffer.prototype as ArrayBuffer & { resize?: unknown }).resize !== 'function')(
    'grows a resizable response buffer in place',
    async () => {
      const prototype = ArrayBuffer.prototype as ArrayBuffer & { resize: (byteLength: number) => void }
      const resize = vi.spyOn(prototype, 'resize')
      try {
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new Uint8Array([1, 2, 3]))
            controller.enqueue(new Uint8Array([4, 5, 6, 7, 8]))
            controller.close()
          },
        })
        const response = makeResponse(body, new Headers({ 'content-length': '3' }))

        const buffer = await readResponseWithLimit(response, 10)
        expect(Array.from(new Uint8Array(buffer))).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
        expect(resize).toHaveBeenCalled()
      } finally {
        resize.mockRestore()
      }
    },
  )

  it('uses the chunk fallback when resizable buffers are unavailable', async () => {
    const resizeDescriptor = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'resize')
    Object.defineProperty(ArrayBuffer.prototype, 'resize', {
      configurable: true,
      value: undefined,
    })
    try {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array([1, 2]))
          controller.enqueue(new Uint8Array([3, 4]))
          controller.enqueue(new Uint8Array([5]))
          controller.close()
        },
      })
      const response = makeResponse(body, new Headers({ 'content-length': '3' }))

      const buffer = await readResponseWithLimit(response, 10)
      expect(Array.from(new Uint8Array(buffer))).toEqual([1, 2, 3, 4, 5])
    } finally {
      if (resizeDescriptor) Object.defineProperty(ArrayBuffer.prototype, 'resize', resizeDescriptor)
      else Reflect.deleteProperty(ArrayBuffer.prototype, 'resize')
    }
  })

  it.skipIf(typeof (ArrayBuffer.prototype as ArrayBuffer & { resize?: unknown }).resize !== 'function')(
    'cancels the response if resizable buffer growth fails',
    async () => {
      const prototype = ArrayBuffer.prototype as ArrayBuffer & { resize: (byteLength: number) => void }
      const resize = vi.spyOn(prototype, 'resize').mockImplementation(() => {
        throw new Error('synthetic allocation failure')
      })
      let cancelled = false
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array([1, 2, 3]))
          controller.enqueue(new Uint8Array([4, 5]))
        },
        cancel() {
          cancelled = true
        },
      })
      const response = makeResponse(body, new Headers({ 'content-length': '3' }))
      const responseBody = response.body

      try {
        await expect(readResponseWithLimit(response, 10)).rejects.toThrow('synthetic allocation failure')
        expect(cancelled).toBe(true)
        const reacquiredReader = responseBody?.getReader()
        expect(reacquiredReader).toBeDefined()
        reacquiredReader?.releaseLock()
      } finally {
        resize.mockRestore()
      }
    },
  )

  it('preserves buffered bytes when Content-Length understates a valid body', async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2, 3]))
        controller.enqueue(new Uint8Array([4, 5, 6]))
        controller.enqueue(new Uint8Array([7, 8]))
        controller.close()
      },
    })
    const response = makeResponse(body, new Headers({ 'content-length': '4' }))

    const buffer = await readResponseWithLimit(response, 10)
    expect(Array.from(new Uint8Array(buffer))).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
  })
})
