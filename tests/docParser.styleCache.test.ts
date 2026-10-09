import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { parseDocFileFromBuffer } from '../src/utils/docParser'

describe('paragraph style resolution cache', () => {
  it('preserves the complete formatted result for a document with repeated styles', () => {
    const data = readFileSync(resolve(__dirname, '../docs/doc-101.doc'))
    const buffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)
    const result = parseDocFileFromBuffer(buffer)
    expect(result.success).toBe(true)
    expect(result.document?.paragraphs.length).toBeGreaterThan(1)
    const paragraphs = result.document?.paragraphs ?? []
    const styled = paragraphs.filter((paragraph) => paragraph.paraFormat.styleName)
    expect(styled.length).toBeGreaterThan(1)
    expect(styled.every((paragraph) => typeof paragraph.paraFormat.styleName === 'string')).toBe(true)
  })
})
