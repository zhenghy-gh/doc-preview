// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { downloadBlob } from '../src/utils/downloadBlob'

describe('downloadBlob', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    document.body.replaceChildren()
  })

  it('schedules object URL cleanup when the browser rejects the click', async () => {
    vi.useFakeTimers()
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:rejected-download')
    const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {
      throw new Error('download blocked')
    })

    expect(() => downloadBlob(new Blob(['data']), 'blocked.txt')).toThrow('download blocked')
    expect(document.querySelector('a[download="blocked.txt"]')).toBeNull()
    expect(revokeObjectURL).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1000)
    expect(revokeObjectURL).toHaveBeenCalledOnce()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:rejected-download')
  })

  it('activates a connected download link before revoking its object URL', async () => {
    vi.useFakeTimers()
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:doc-preview-test')
    const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    let clickedAnchor: HTMLAnchorElement | undefined
    let anchorWasConnectedAtClick = false
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      clickedAnchor = this
      anchorWasConnectedAtClick = this.isConnected
    })

    downloadBlob(new Blob(['document body'], { type: 'text/plain' }), 'document.txt')

    expect(createObjectURL).toHaveBeenCalledOnce()
    expect(clickedAnchor?.download).toBe('document.txt')
    expect(anchorWasConnectedAtClick).toBe(true)
    expect(clickedAnchor?.isConnected).toBe(false)
    expect(revokeObjectURL).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(999)
    expect(revokeObjectURL).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(revokeObjectURL).toHaveBeenCalledOnce()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:doc-preview-test')
  })
})
