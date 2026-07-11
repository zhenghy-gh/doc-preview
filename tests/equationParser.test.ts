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

  it('should convert sums and integrals', () => {
    expect(eqnToLatex('\\sum')).toBe('\\sum')
    expect(eqnToLatex('\\int')).toBe('\\int')
    expect(eqnToLatex('\\sumfrom{i=1}{n}')).toBe('\\sum_{i=1}^{n}')
    expect(eqnToLatex('\\intfrom{0}{\\infty}')).toBe('\\int_{0}^{\\infty}')
  })

  it('should handle complex expressions', () => {
    const eqn = '\\frac{-b \\pm \\sqrt{b^2-4ac}}{2a}'
    const latex = eqnToLatex(eqn)
    expect(latex).toContain('\\frac')
    expect(latex).toContain('\\pm')
    expect(latex).toContain('\\sqrt')
  })

  it('should trim whitespace', () => {
    expect(eqnToLatex('  \\alpha + \\beta  ')).toBe('\\alpha + \\beta')
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
})

describe('extractEquationsFromDirectory', () => {
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
})
