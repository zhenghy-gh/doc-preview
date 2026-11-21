// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest'
import { useDocLoading } from '../../src/composables/useDocLoading'

describe('useDocLoading', () => {
  it('maps parse stages to localized progress text', () => {
    const l = useDocLoading((k: string) => k)
    expect(l.getProgressStepText('verifying')).toBe('loading.progress.reading')
    expect(l.getProgressStepText('parsing_fib')).toBe('loading.progress.parsing')
    expect(l.getProgressStepText('finalizing')).toBe('loading.progress.rendering')
  })

  it('starts/stops a single seconds timer without stacking', () => {
    vi.useFakeTimers()
    try {
      const l = useDocLoading((k: string) => k)
      l.startLoadingTimer()
      l.startLoadingTimer() // first one must be cleared
      vi.advanceTimersByTime(2000)
      expect(l.loadingTime.value).toBe(2)
      l.stopLoadingTimer()
      vi.advanceTimersByTime(3000)
      expect(l.loadingTime.value).toBe(2)
      expect(l.loadingTimer.value).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('resets progress state', () => {
    const l = useDocLoading((k: string) => k)
    l.progressPercent.value = 55
    l.progressStep.value = 'parsing'
    l.resetProgress()
    expect(l.progressPercent.value).toBe(-1)
    expect(l.progressStep.value).toBe('')
  })
})
