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

  latex = latex.replace(/\\alpha/g, '\\alpha')
  latex = latex.replace(/\\beta/g, '\\beta')
  latex = latex.replace(/\\gamma/g, '\\gamma')
  latex = latex.replace(/\\delta/g, '\\delta')
  latex = latex.replace(/\\epsilon/g, '\\epsilon')
  latex = latex.replace(/\\zeta/g, '\\zeta')
  latex = latex.replace(/\\eta/g, '\\eta')
  latex = latex.replace(/\\theta/g, '\\theta')
  latex = latex.replace(/\\iota/g, '\\iota')
  latex = latex.replace(/\\kappa/g, '\\kappa')
  latex = latex.replace(/\\lambda/g, '\\lambda')
  latex = latex.replace(/\\mu/g, '\\mu')
  latex = latex.replace(/\\nu/g, '\\nu')
  latex = latex.replace(/\\xi/g, '\\xi')
  latex = latex.replace(/\\pi/g, '\\pi')
  latex = latex.replace(/\\rho/g, '\\rho')
  latex = latex.replace(/\\sigma/g, '\\sigma')
  latex = latex.replace(/\\tau/g, '\\tau')
  latex = latex.replace(/\\upsilon/g, '\\upsilon')
  latex = latex.replace(/\\phi/g, '\\phi')
  latex = latex.replace(/\\chi/g, '\\chi')
  latex = latex.replace(/\\psi/g, '\\psi')
  latex = latex.replace(/\\omega/g, '\\omega')

  latex = latex.replace(/\\Gamma/g, '\\Gamma')
  latex = latex.replace(/\\Delta/g, '\\Delta')
  latex = latex.replace(/\\Theta/g, '\\Theta')
  latex = latex.replace(/\\Lambda/g, '\\Lambda')
  latex = latex.replace(/\\Xi/g, '\\Xi')
  latex = latex.replace(/\\Pi/g, '\\Pi')
  latex = latex.replace(/\\Sigma/g, '\\Sigma')
  latex = latex.replace(/\\Upsilon/g, '\\Upsilon')
  latex = latex.replace(/\\Phi/g, '\\Phi')
  latex = latex.replace(/\\Psi/g, '\\Psi')
  latex = latex.replace(/\\Omega/g, '\\Omega')

  latex = latex.replace(/\\frac\{([^}]+)\}\{([^}]+)\}/g, '\\frac{$1}{$2}')
  latex = latex.replace(/\\sqrt\{([^}]+)\}/g, '\\sqrt{$1}')
  latex = latex.replace(/\\sum/g, '\\sum')
  latex = latex.replace(/\\prod/g, '\\prod')
  latex = latex.replace(/\\int/g, '\\int')
  latex = latex.replace(/\\oint/g, '\\oint')
  latex = latex.replace(/\\sumfrom\{([^}]+)\}\{([^}]+)\}/g, '\\sum_{$1}^{$2}')
  latex = latex.replace(/\\prodfrom\{([^}]+)\}\{([^}]+)\}/g, '\\prod_{$1}^{$2}')
  latex = latex.replace(/\\intfrom\{([^}]+)\}\{([^}]+)\}/g, '\\int_{$1}^{$2}')

  latex = latex.replace(/\^([a-zA-Z0-9]+)/g, '^{$1}')
  latex = latex.replace(/_([a-zA-Z0-9]+)/g, '_{$1}')

  latex = latex.replace(/\\sin/g, '\\sin')
  latex = latex.replace(/\\cos/g, '\\cos')
  latex = latex.replace(/\\tan/g, '\\tan')
  latex = latex.replace(/\\cot/g, '\\cot')
  latex = latex.replace(/\\sec/g, '\\sec')
  latex = latex.replace(/\\csc/g, '\\csc')
  latex = latex.replace(/\\log/g, '\\log')
  latex = latex.replace(/\\ln/g, '\\ln')
  latex = latex.replace(/\\exp/g, '\\exp')

  latex = latex.replace(/\\cdot/g, '\\cdot')
  latex = latex.replace(/\\times/g, '\\times')
  latex = latex.replace(/\\div/g, '\\div')
  latex = latex.replace(/\\pm/g, '\\pm')
  latex = latex.replace(/\\mp/g, '\\mp')
  latex = latex.replace(/\\neq/g, '\\neq')
  latex = latex.replace(/\\leq/g, '\\leq')
  latex = latex.replace(/\\geq/g, '\\geq')
  latex = latex.replace(/\\approx/g, '\\approx')
  latex = latex.replace(/\\equiv/g, '\\equiv')
  latex = latex.replace(/\\propto/g, '\\propto')
  latex = latex.replace(/\\infty/g, '\\infty')

  latex = latex.replace(/\\leftarrow/g, '\\leftarrow')
  latex = latex.replace(/\\rightarrow/g, '\\rightarrow')
  latex = latex.replace(/\\leftrightarrow/g, '\\leftrightarrow')
  latex = latex.replace(/\\uparrow/g, '\\uparrow')
  latex = latex.replace(/\\downarrow/g, '\\downarrow')

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

function hasPictureStream(directory: DirectoryEntry[], parentName: string): boolean {
  const pictureName = `${parentName}\x00Picture`
  return directory.some(e => e.name === pictureName && e.objectType === 2)
}

export function extractEquationsFromDirectory(
  directory: DirectoryEntry[],
  readStream: (entry: DirectoryEntry) => StreamData | null
): EquationInfo[] {
  const equations: EquationInfo[] = []
  const equationEntries = directory.filter(e => EQUATION_NAME_PATTERN.test(e.name) && e.objectType === 1)

  for (const entry of equationEntries) {
    const eqnTextName = `${entry.name}\x00EquationText`
    const eqnTextEntry = directory.find(e => e.name === eqnTextName && e.objectType === 2)

    if (!eqnTextEntry) continue

    try {
      const streamData = readStream(eqnTextEntry)
      if (!streamData || !streamData.data) continue

      const eqnText = parseEquationTextStream(streamData)
      if (!eqnText || eqnText.trim().length === 0) continue

      const latex = eqnToLatex(eqnText)
      const hasPic = hasPictureStream(directory, entry.name)

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

    let endOffset = offset + eqnMagic.length
    while (endOffset < data.length && data[endOffset] !== 0) {
      endOffset++
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
