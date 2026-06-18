const DEBUG_MODE = false

export class Logger {
  private _enabled: boolean

  constructor(enabled: boolean = DEBUG_MODE) {
    this._enabled = enabled
  }

  get enabled(): boolean {
    return this._enabled
  }

  set enabled(value: boolean) {
    this._enabled = value
  }

  log(message: string, data?: any) {
    if (this._enabled) {
      console.log(`[DOC Parser] ${message}`, data || '')
    }
  }

  error(message: string, data?: any) {
    if (this._enabled) {
      console.error(`[DOC Parser ERROR] ${message}`, data || '')
    }
  }

  warn(message: string, data?: any) {
    if (this._enabled) {
      console.warn(`[DOC Parser WARN] ${message}`, data || '')
    }
  }

  info(message: string, data?: any) {
    if (this._enabled) {
      console.info(`[DOC Parser INFO] ${message}`, data || '')
    }
  }
}

export const logger = new Logger()

export function enableDebugMode() {
  logger.enabled = true
  logger.info('Debug mode enabled')
}
