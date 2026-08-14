import { describe, it, expect } from 'vitest'
import { extractEquationsFromDirectory, extractEquationsFromWordDocumentStream, eqnToLatex } from '../src/utils/equationParser'

describe('eqnToLatex', () => {
  it('should convert basic Greek letters', () => {
    expect(eqnToLatex('\\alpha')).toBe('\\alpha')
    expect(eqnToLatex('\\beta')).toBe('\\beta')
    expect(eqnToLatex('\\gamma')).toBe('\\gamma')
    expect(eqnToLatex('\\Gamma')).toBe('\\Gamma')
    expect(eqnToLatex('\\Delta')).toBe('\\Delta')
  })

  it('should convert fractions', () => {
    expect(eqnToLatex('\\frac{a}{b}')).toBe('\\frac{a}{b}')
    expect(eqnToLatex('\\frac{x+y}{2}')).toBe('\\frac{x+y}{2}')
  })

  it('should convert square roots', () => {
    expect(eqnToLatex('\\sqrt{x}')).toBe('\\sqrt{x}')
    expect(eqnToLatex('\\sqrt{a^2+b^2}')).toBe('\\sqrt{a^{2}+b^{2}}')
  })

  it('should convert superscripts and subscripts', () => {
    expect(eqnToLatex('x^2')).toBe('x^{2}')
    expect(eqnToLatex('x_1')).toBe('x_{1}')
    expect(eqnToLatex('a^n_m')).toBe('a^{n}_{m}')
  })

  it('should convert operators', () => {
    expect(eqnToLatex('\\cdot')).toBe('\\cdot')
    expect(eqnToLatex('\\times')).toBe('\\times')
    expect(eqnToLatex('\\div')).toBe('\\div')
    expect(eqnToLatex('\\pm')).toBe('\\pm')
    expect(eqnToLatex('\\neq')).toBe('\\neq')
    expect(eqnToLatex('\\leq')).toBe('\\leq')
    expect(eqnToLatex('\\geq')).toBe('\\geq')
  })

  it('should convert trigonometric functions', () => {
    expect(eqnToLatex('\\sin(x)')).toBe('\\sin(x)')
    expect(eqnToLatex('\\cos(x)')).toBe('\\cos(x)')
    expect(eqnToLatex('\\tan(x)')).toBe('\\tan(x)')
    expect(eqnToLatex('\\log(x)')).toBe('\\log(x)')
    expect(eqnToLatex('\\ln(x)')).toBe('\\ln(x)')
  })

  it('should convert additional operators and relations', () => {
    expect(eqnToLatex('\\prod')).toBe('\\prod')
    expect(eqnToLatex('\\oint')).toBe('\\oint')
    expect(eqnToLatex('\\prodfrom{i=1}{n}')).toBe('\\prod_{i=1}^{n}')
    expect(eqnToLatex('\\cot(x)')).toBe('\\cot(x)')
    expect(eqnToLatex('\\sec(x)')).toBe('\\sec(x)')
    expect(eqnToLatex('\\csc(x)')).toBe('\\csc(x)')
    expect(eqnToLatex('\\exp(x)')).toBe('\\exp(x)')
    expect(eqnToLatex('\\mp')).toBe('\\mp')
    expect(eqnToLatex('\\approx')).toBe('\\approx')
    expect(eqnToLatex('\\equiv')).toBe('\\equiv')
    expect(eqnToLatex('\\propto')).toBe('\\propto')
    expect(eqnToLatex('\\infty')).toBe('\\infty')
  })

  it('should convert arrows and special operators', () => {
    expect(eqnToLatex('\\leftarrow')).toBe('\\leftarrow')
    expect(eqnToLatex('\\rightarrow')).toBe('\\rightarrow')
    expect(eqnToLatex('\\leftrightarrow')).toBe('\\leftrightarrow')
    expect(eqnToLatex('\\uparrow')).toBe('\\uparrow')
    expect(eqnToLatex('\\downarrow')).toBe('\\downarrow')
    expect(eqnToLatex('\\deg')).toBe('^{\\circ}')
    expect(eqnToLatex('\\rad')).toBe('')
  })

  it('should collapse whitespace', () => {
    expect(eqnToLatex('a   +   b')).toBe('a + b')
  })
})

describe('extractEquationsFromWordDocumentStream', () => {
  it('should return empty array for empty buffer', () => {
    const data = new Uint8Array(0)
    const result = extractEquationsFromWordDocumentStream(data)
    expect(result).toEqual([])
  })

  it('should return empty array for small buffer', () => {
    const data = new Uint8Array(10)
    const result = extractEquationsFromWordDocumentStream(data)
    expect(result).toEqual([])
  })

  it('should return empty array for buffer without equation patterns', () => {
    const data = new Uint8Array([0x48, 0x65, 0x6C, 0x6C, 0x6F, 0x20, 0x57, 0x6F, 0x72, 0x6C, 0x64])
    const result = extractEquationsFromWordDocumentStream(data)
    expect(result).toEqual([])
  })

  it('should extract an equation from the magic-byte sequence', () => {
    // Magic: EF BF BD EF BF BD, then UTF-16LE "\\alpha+\\beta", then 0x00
    const magic = [0xEF, 0xBF, 0xBD, 0xEF, 0xBF, 0xBD]
    const text = '\\alpha+\\beta\\frac{x}{y}'
    const bytes: number[] = [...magic]
    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i)
      bytes.push(code & 0xff, code >> 8)
    }
    bytes.push(0x00)
    // The scanner requires data.length > 100 to run; pad to make it meaningful.
    while (bytes.length < 120) bytes.push(0)
    const data = new Uint8Array(bytes)
    const result = extractEquationsFromWordDocumentStream(data)
    expect(result).toHaveLength(1)
    expect(result[0].eqnText).toContain('\\alpha')
    expect(result[0].latex).toContain('\\alpha')
  })

  it('should skip sequences without backslash commands', () => {
    const magic = [0xEF, 0xBF, 0xBD, 0xEF, 0xBF, 0xBD]
    const bytes: number[] = [...magic]
    for (const ch of 'plain text here') bytes.push(ch.charCodeAt(0) & 0xff, ch.charCodeAt(0) >> 8)
    bytes.push(0x00)
    while (bytes.length < 120) bytes.push(0)
    const result = extractEquationsFromWordDocumentStream(new Uint8Array(bytes))
    expect(result).toEqual([])
  })

  it('should skip overly long sequences (>2000 bytes)', () => {
    const magic = [0xEF, 0xBF, 0xBD, 0xEF, 0xBF, 0xBD]
    const bytes: number[] = [...magic]
    for (let i = 0; i < 1200; i++) {
      bytes.push(0x61, 0x00) // 'a' in UTF-16LE
    }
    // No terminator → endOffset runs to data.length → length > 2000
    const result = extractEquationsFromWordDocumentStream(new Uint8Array(bytes))
    expect(result).toEqual([])
  })
})

describe('extractEquationsFromDirectory', () => {
  function makeDirEntry(name: string, objectType: number, startSector = 0, size = 512) {
    return { name, objectType, startSector, size, nameLength: name.length * 2 }
  }

  function makeStream(bytes: number[]): { data: Uint8Array } {
    return { data: new Uint8Array(bytes) }
  }

  it('should return empty array for empty directory', () => {
    const directory = []
    const readStream = () => null
    const result = extractEquationsFromDirectory(directory, readStream)
    expect(result).toEqual([])
  })

  it('should return empty array for directory without Equation entries', () => {
    const directory = [
      { name: 'WordDocument', objectType: 2, startSector: 0, size: 1024, nameLength: 13 },
      { name: 'Data', objectType: 2, startSector: 1, size: 2048, nameLength: 4 },
    ]
    const readStream = () => null
    const result = extractEquationsFromDirectory(directory, readStream)
    expect(result).toEqual([])
  })

  it('should filter by Equation.N pattern', () => {
    const directory = [
      { name: 'Equation.1', objectType: 1, startSector: 0, size: 512, nameLength: 10 },
      { name: 'Equation.2', objectType: 1, startSector: 1, size: 512, nameLength: 10 },
      { name: 'NotAnEquation', objectType: 1, startSector: 2, size: 512, nameLength: 13 },
    ]
    const readStream = () => null
    const result = extractEquationsFromDirectory(directory, readStream)
    expect(result).toEqual([])
  })

  it('should skip equations without an EquationText stream', () => {
    const directory = [makeDirEntry('Equation.1', 1)]
    const result = extractEquationsFromDirectory(directory, () => null)
    expect(result).toEqual([])
  })

  it('should skip equations whose stream cannot be read', () => {
    const directory = [
      makeDirEntry('Equation.1', 1),
      makeDirEntry('Equation.1\x00EquationText', 2),
    ]
    const result = extractEquationsFromDirectory(directory, () => null)
    expect(result).toEqual([])
  })

  it('should skip equations with empty text', () => {
    const directory = [
      makeDirEntry('Equation.1', 1),
      makeDirEntry('Equation.1\x00EquationText', 2),
    ]
    const result = extractEquationsFromDirectory(directory, () => makeStream([0x00]))
    expect(result).toEqual([])
  })

  it('should extract an 8-bit equation stream and detect picture streams', () => {
    const directory = [
      makeDirEntry('Equation.1', 1),
      makeDirEntry('Equation.1\x00EquationText', 2),
      makeDirEntry('Equation.1\x00Picture', 2),
    ]
    const text = '\\frac{a}{b}'
    const bytes = [...text].map(ch => ch.charCodeAt(0)).concat([0])
    const result = extractEquationsFromDirectory(directory, () => makeStream(bytes))
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe(1)
    expect(result[0].eqnText).toBe('\\frac{a}{b}')
    expect(result[0].latex).toContain('\\frac')
    expect(result[0].hasPicture).toBe(true)
  })

  it('should decode UTF-16LE streams with BOM', () => {
    const directory = [
      makeDirEntry('Equation.1', 1),
      makeDirEntry('Equation.1\x00EquationText', 2),
    ]
    const bytes: number[] = [0xFF, 0xFE] // UTF-16LE BOM
    for (const ch of '\\alpha') {
      const code = ch.charCodeAt(0)
      bytes.push(code & 0xff, code >> 8)
    }
    bytes.push(0x00, 0x00)
    const result = extractEquationsFromDirectory(directory, () => makeStream(bytes))
    expect(result).toHaveLength(1)
    expect(result[0].eqnText).toBe('\\alpha')
    expect(result[0].hasPicture).toBe(false)
  })

  it('should decode UTF-16BE streams with BOM', () => {
    const directory = [
      makeDirEntry('Equation.1', 1),
      makeDirEntry('Equation.1\x00EquationText', 2),
    ]
    const bytes: number[] = [0xFE, 0xFF] // UTF-16BE BOM
    for (const ch of '\\beta') {
      const code = ch.charCodeAt(0)
      bytes.push(code >> 8, code & 0xff)
    }
    bytes.push(0x00, 0x00)
    const result = extractEquationsFromDirectory(directory, () => makeStream(bytes))
    expect(result).toHaveLength(1)
    expect(result[0].eqnText).toBe('\\beta')
  })

  it('should honor a leading length header', () => {
    const directory = [
      makeDirEntry('Equation.1', 1),
      makeDirEntry('Equation.1\x00EquationText', 2),
    ]
    const text = '\\gamma'
    // 4-byte little-endian length followed by 8-bit text
    const bytes: number[] = [text.length & 0xff, (text.length >> 8) & 0xff, 0, 0]
    for (const ch of text) bytes.push(ch.charCodeAt(0))
    bytes.push(0)
    const result = extractEquationsFromDirectory(directory, () => makeStream(bytes))
    expect(result).toHaveLength(1)
    expect(result[0].eqnText).toBe('\\gamma')
  })

  it('should keep counting ids across multiple equations', () => {
    const directory = [
      makeDirEntry('Equation.1', 1),
      makeDirEntry('Equation.1\x00EquationText', 2),
      makeDirEntry('Equation.2', 1),
      makeDirEntry('Equation.2\x00EquationText', 2),
    ]
    const stream = () => makeStream([...'\\alpha'].map(ch => ch.charCodeAt(0)).concat([0]))
    const result = extractEquationsFromDirectory(directory, stream)
    expect(result).toHaveLength(2)
    expect(result[0].id).toBe(1)
    expect(result[1].id).toBe(2)
  })
})

describe('extractEquationsFromDirectory read failure', () => {
  it('catches a throwing stream reader', () => {
    const directory: any[] = [
      { name: 'Equation.1', objectType: 1 },
      { name: 'Equation.1\x00EquationText', objectType: 2 },
    ]
    const result = extractEquationsFromDirectory(directory, () => {
      throw new Error('stream boom')
    })
    expect(result).toEqual([])
  })
})
