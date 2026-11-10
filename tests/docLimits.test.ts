import { describe, expect, it } from 'vitest'
import { MAX_DOC_FILE_SIZE, readResponseWithLimit } from '../src/utils/docLimits'

function makeResponse(body: ReadableStream<Uint8Array>, headers = new Headers()): Response {
  return { headers, body } as Response
}

describe('MAX_DOC_FILE_SIZE', () => {
  it('matches the upload and parser limit of 50 MiB', () => {
    expect(MAX_DOC_FILE_SIZE).toBe(50 * 1024 * 1024)
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

  it('returns bytes when the stream stays within the limit', async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2]))
        controller.enqueue(new Uint8Array([3]))
        controller.close()
      },
    })

    const buffer = await readResponseWithLimit(makeResponse(body), 3)
    expect(Array.from(new Uint8Array(buffer))).toEqual([1, 2, 3])
  })
})
