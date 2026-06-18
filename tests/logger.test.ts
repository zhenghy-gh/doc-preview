import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { Logger, logger, enableDebugMode } from '../src/utils/logger'

describe('Logger', () => {
  it('should be disabled by default', () => {
    const log = new Logger(false)
    expect(log.enabled).toBe(false)
  })

  it('should be enabled when constructed with true', () => {
    const log = new Logger(true)
    expect(log.enabled).toBe(true)
  })

  it('should toggle enabled state', () => {
    const log = new Logger(false)
    log.enabled = true
    expect(log.enabled).toBe(true)
    log.enabled = false
    expect(log.enabled).toBe(false)
  })

  describe('logging methods', () => {
    let consoleLogSpy: ReturnType<typeof vi.spyOn>
    let consoleWarnSpy: ReturnType<typeof vi.spyOn>
    let consoleErrorSpy: ReturnType<typeof vi.spyOn>
    let consoleInfoSpy: ReturnType<typeof vi.spyOn>

    beforeEach(() => {
      consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
      consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      consoleInfoSpy = vi.spyOn(console, 'info').mockImplementation(() => {})
    })

    afterEach(() => {
      consoleLogSpy.mockRestore()
      consoleWarnSpy.mockRestore()
      consoleErrorSpy.mockRestore()
      consoleInfoSpy.mockRestore()
    })

    it('should not call console methods when disabled', () => {
      const log = new Logger(false)
      log.log('test'); log.warn('test'); log.error('test'); log.info('test')
      expect(consoleLogSpy).not.toHaveBeenCalled()
      expect(consoleWarnSpy).not.toHaveBeenCalled()
      expect(consoleErrorSpy).not.toHaveBeenCalled()
      expect(consoleInfoSpy).not.toHaveBeenCalled()
    })

    it('should call console.log when enabled', () => {
      const log = new Logger(true)
      log.log('hello', { data: 1 })
      expect(consoleLogSpy).toHaveBeenCalledWith('[DOC Parser] hello', { data: 1 })
    })

    it('should call console.warn when enabled', () => {
      const log = new Logger(true)
      log.warn('warning', { data: 1 })
      expect(consoleWarnSpy).toHaveBeenCalledWith('[DOC Parser WARN] warning', { data: 1 })
    })

    it('should call console.error when enabled', () => {
      const log = new Logger(true)
      log.error('error', { data: 1 })
      expect(consoleErrorSpy).toHaveBeenCalledWith('[DOC Parser ERROR] error', { data: 1 })
    })

    it('should call console.info when enabled', () => {
      const log = new Logger(true)
      log.info('info', { data: 1 })
      expect(consoleInfoSpy).toHaveBeenCalledWith('[DOC Parser INFO] info', { data: 1 })
    })

    it('should pass empty string when data is undefined', () => {
      const log = new Logger(true)
      log.log('hello')
      expect(consoleLogSpy).toHaveBeenCalledWith('[DOC Parser] hello', '')
    })
  })

  describe('enableDebugMode', () => {
    afterEach(() => {
      logger.enabled = false
    })

    it('should enable the global logger', () => {
      expect(logger.enabled).toBe(false)
      enableDebugMode()
      expect(logger.enabled).toBe(true)
    })
  })
})
