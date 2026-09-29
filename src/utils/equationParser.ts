import { logger } from './logger'
import { DirectoryEntry, StreamData } from './oleParser'

export interface EquationInfo {
  id: number
  eqnText: string
  latex: string
  cp?: number
  hasPicture?: boolean
  format?: string
}

const EQUATION_NAME_PATTERN = /^Equation\.\d+/

function readUint16(data: Uint8Array, offset: number): number {
  if (offset + 2 > data.length) return 0
  return (data[offset + 1] << 8) | data[offset]
}

function readUint32(data: Uint8Array, offset: number): number {
  if (offset + 4 > data.length) return 0
  return (data[offset + 3] << 24) | (data[offset + 2] << 16) | (data[offset + 1] << 8) | data[offset]
}

function decodeUtf16Le(data: Uint8Array, offset: number, length: number): string {
  const chars: string[] = []
  const end = Math.min(offset + length * 2, data.length)
  for (let i = offset; i < end; i += 2) {
    const charCode = readUint16(data, i)
    if (charCode === 0) break
    chars.push(String.fromCharCode(charCode))
  }
  return chars.join('')
}

export function eqnToLatex(eqnText: string): string {
  let latex = eqnText

  latex = latex.replace(/\\frac\{([^}]+)\}\{([^}]+)\}/g, '\\frac{$1}{$2}')
  latex = latex.replace(/\\sqrt\{([^}]+)\}/g, '\\sqrt{$1}')
  latex = latex.replace(/\\sumfrom\{([^}]+)\}\{([^}]+)\}/g, '\\sum_{$1}^{$2}')
  latex = latex.replace(/\\prodfrom\{([^}]+)\}\{([^}]+)\}/g, '\\prod_{$1}^{$2}')
  latex = latex.replace(/\\intfrom\{([^}]+)\}\{([^}]+)\}/g, '\\int_{$1}^{$2}')

  latex = latex.replace(/\^([a-zA-Z0-9]+)/g, '^{$1}')
  latex = latex.replace(/_([a-zA-Z0-9]+)/g, '_{$1}')

  latex = latex.replace(/\\deg/g, '^{\\circ}')
  latex = latex.replace(/\\rad/g, '')

  latex = latex.replace(/\s+/g, ' ')
  latex = latex.trim()

  return latex
}

function parseEquationTextStream(streamData: StreamData): string {
  const data = streamData.data
  if (!data || data.length === 0) return ''

  let offset = 0
  if (data.length >= 4) {
    const length = readUint32(data, 0)
    if (length > 0 && length < data.length) {
      offset = 4
    }
  }

  if (data[offset] === 0xFF && data[offset + 1] === 0xFE) {
    return decodeUtf16Le(data, offset + 2, data.length - offset - 2)
  } else if (data[offset] === 0xFE && data[offset + 1] === 0xFF) {
    const chars: string[] = []
    for (let i = offset + 2; i + 1 < data.length; i += 2) {
      const charCode = (data[i] << 8) | data[i + 1]
      if (charCode === 0) break
      chars.push(String.fromCharCode(charCode))
    }
    return chars.join('')
  }

  let text = ''
  for (let i = offset; i < data.length; i++) {
    if (data[i] === 0) break
    text += String.fromCharCode(data[i])
  }
  return text
}

export function extractEquationsFromDirectory(
  directory: DirectoryEntry[],
  readStream: (entry: DirectoryEntry) => StreamData | null
): EquationInfo[] {
  const equations: EquationInfo[] = []
  const equationEntries = directory.filter(e => EQUATION_NAME_PATTERN.test(e.name) && e.objectType === 1)
  const streamEntries = new Map<string, DirectoryEntry>()
  for (const entry of directory) {
    if (entry.objectType === 2 && !streamEntries.has(entry.name)) {
      streamEntries.set(entry.name, entry)
    }
  }

  for (const entry of equationEntries) {
    const eqnTextName = `${entry.name}\x00EquationText`
    const eqnTextEntry = streamEntries.get(eqnTextName)

    if (!eqnTextEntry) continue

    try {
      const streamData = readStream(eqnTextEntry)
      if (!streamData || !streamData.data) continue

      const eqnText = parseEquationTextStream(streamData)
      if (!eqnText || eqnText.trim().length === 0) continue

      const latex = eqnToLatex(eqnText)
      const hasPic = streamEntries.has(`${entry.name}\x00Picture`)

      equations.push({
        id: equations.length + 1,
        eqnText: eqnText.trim(),
        latex: latex,
        hasPicture: hasPic,
      })
    } catch (e) {
      logger.warn(`解析公式 ${entry.name} 失败: ${e}`)
    }
  }

  return equations
}

export function extractEquationsFromWordDocumentStream(data: Uint8Array): EquationInfo[] {
  const equations: EquationInfo[] = []
  const eqnMagic = new Uint8Array([0xEF, 0xBF, 0xBD, 0xEF, 0xBF, 0xBD])

  for (let offset = 0; offset < data.length - 100; offset++) {
    let match = true
    for (let i = 0; i < eqnMagic.length; i++) {
      if (data[offset + i] !== eqnMagic[i]) {
        match = false
        break
      }
    }
    if (!match) continue

    // Scan UTF-16LE code units after the magic; stop at a 0x0000 terminator.
    // (Previously this scanned byte-by-byte for a single 0x00, which always
    // terminated inside the first ASCII character's zero high byte, so the
    // extracted range was never longer than ~7 bytes and no equation could
    // ever be produced.)
    let endOffset = offset + eqnMagic.length
    while (endOffset + 1 < data.length) {
      if (data[endOffset] === 0 && data[endOffset + 1] === 0) break
      endOffset += 2
    }

    if (endOffset - offset > 10 && endOffset - offset < 2000) {
      let eqnText = ''
      for (let i = offset; i < endOffset; i += 2) {
        if (i + 1 >= data.length) break
        const charCode = (data[i + 1] << 8) | data[i]
        if (charCode === 0) break
        eqnText += String.fromCharCode(charCode)
      }

      eqnText = eqnText.replace(/[^\x20-\x7E\\]/g, '')
      if (eqnText.length > 2 && eqnText.includes('\\')) {
        const latex = eqnToLatex(eqnText)
        equations.push({
          id: equations.length + 1,
          eqnText: eqnText,
          latex: latex,
        })
      }
    }
  }

  return equations
}
