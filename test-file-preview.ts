import { readFileSync, writeFileSync } from 'fs'
import { parseDocFileFromBuffer } from './src/utils/docParser'

const buf = readFileSync('./file-sample_100kB.doc')
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
const result = parseDocFileFromBuffer(ab)
console.log('success:', result.success)
if (result.error) {
  console.log('error:', result.error)
  process.exit(1)
}

const doc = result.document
if (!doc) {
  console.log('no document')
  process.exit(1)
}

// Check font issue in detail
const fontCounts: Record<string, number> = {}
const badParagraphs: any[] = []
for (let i = 0; i < (doc.paragraphs?.length || 0); i++) {
  const p = doc.paragraphs[i]
  if (p.charFormat?.styles) {
    for (const s of p.charFormat.styles) {
      const fn = s.style?.fontName || '(no fontName)'
      fontCounts[fn] = (fontCounts[fn] || 0) + 1
      if (fn === '仿宋' || fn === '宋体') {
        badParagraphs.push({ index: i, text: p.text, start: s.start, end: s.end, char: p.text?.substring(s.start, s.end) })
      }
    }
  }
}
console.log('\nFont usage counts:', fontCounts)
console.log('\nBad paragraphs (first 10):')
for (const bp of badParagraphs.slice(0, 10)) {
  console.log(`  [${bp.index}] "${bp.text?.substring(0, 60)}" -> bad chars: "${bp.char}"`)
}

console.log('\nParagraph 0 charFormat:', JSON.stringify(doc.paragraphs?.[0]?.charFormat))
console.log('Paragraph 0 charFormatFromReal:', doc.paragraphs?.[0]?.charFormatFromReal)
console.log('Paragraph 1 charFormatFromReal:', doc.paragraphs?.[1]?.charFormatFromReal)
