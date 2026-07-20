import { describe, it } from 'vitest'
import { readFileSync } from 'fs'
import { parseDocFileFromBuffer } from './src/utils/docParser'

describe('file preview test', () => {
  it('parse file-sample_100kB.doc', () => {
    const buf = readFileSync('./file-sample_100kB.doc')
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
    const result = parseDocFileFromBuffer(ab)
    console.log('success:', result.success)
    if (result.error) {
      console.log('error:', result.error)
    }
    if (result.document) {
      console.log('paragraphs count:', result.document.paragraphs?.length)
      console.log('first 3 paragraphs:')
      for (let i = 0; i < Math.min(3, result.document.paragraphs?.length || 0); i++) {
        const p = result.document.paragraphs[i]
        console.log(`  [${i}] text="${p.text}" format=`, JSON.stringify(p.charFormat || p.format))
      }
      console.log('hyperlinks:', result.document.hyperlinks?.length)
      console.log('images:', result.document.images?.length)
      console.log('pictures:', result.document.pictures?.length)
      console.log('tables:', result.document.tables?.length)
    }
    if (result.text) {
      console.log('text length:', result.text.length)
      console.log('text preview:', result.text.substring(0, 500))
    }
  })
})
