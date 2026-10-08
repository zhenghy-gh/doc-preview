// Synthetic OLE2/.doc generator — DEF-003 附带项迁仓版本化。
// 出处：perf-dev 性能基线 R1 的 /tmp/docbench/gen-samples.mjs（2026-08-25），
// 适配自 tests/docParser.test.ts 的 buildNoClxOle 构造器并扩展 multi-FAT 支持。
// 使用本仓库 oleParser 的扇区约定：解析器扇区 N 位于物理偏移 (N+1)*512
// （头部占用物理扇区 0）。头部字段(oleParser.parseHeader)：44=fatSectorsCount、
// 48=firstDirectorySector、76+=DIFAT[109]；FAT 扇区 k 覆盖解析器扇区 k*128..k*128+127。
// CLX 刻意无效（指向全零 0Table），迫使解析走 FibBase fcMin/fcMac 回退路径
// （DEF-003/DEF-004：该路径持有验证过的文本右界，不受 maxScanBytes 截断）。
//
// 用法：
//   作为模块：import { buildBigDoc } from './gen-samples.mjs'
//   作为 CLI：node scripts/perf/gen-samples.mjs [--out <dir>] [--chars N] [--latin1]
//
// CLI 示例：node scripts/perf/gen-samples.mjs --out /tmp/docbench --chars 3000000

const SECTOR = 512
const END = 0xFFFFFFFE, FREE = 0xFFFFFFFF

export function buildBigDoc({ textChars = 3_000_000, utf16 = true } = {}) {
  const words = ['性能', '基线', '测量', '文档', '解析', '渲染', '优化', '样本',
    'The', 'quick', 'brown', 'fox', 'jumps', 'over', 'lazy', 'dog']
  let x = 0x12345678
  const rnd = () => ((x = (x * 1664525 + 1013904223) >>> 0), x)
  let text = ''
  let para = ''
  // Alternate short(<10 or >150 avoided-in-range)/long(>150 chars) paragraphs so
  // DocPreview's structural heuristics never classify 2+ consecutive paragraphs
  // (len 10..150) as a list group — keeps pagination representative.
  let idx = 0
  const targetLen = () => (idx++ % 2 === 0 ? 180 + (rnd() % 120) : 6 + (rnd() % 3))
  const len8 = () => Buffer.byteLength(text, utf16 ? 'utf16le' : 'latin1') + Buffer.byteLength(para, utf16 ? 'utf16le' : 'latin1')
  while (true) {
    const w = words[rnd() % words.length]
    para += w
    if (para.length >= targetLen()) { text += para + '\r\r'; para = '' }
    if (len8() + 400 > textChars * (utf16 ? 2 : 1)) break
  }
  text += para
  const textBytes = utf16 ? text.length * 2 : Buffer.byteLength(text, 'latin1')

  // parser-sector layout: [0..numFat-1]=FAT | dir | 0Table | WD(S sectors)
  const TEXT_OFF = 2048
  const wdBytes = TEXT_OFF + textBytes + 64
  const S = Math.ceil(wdBytes / SECTOR)
  const totalSec = 1 /*dir*/ + 1 /*table*/ + S
  const numFat = Math.ceil(totalSec / 128)
  const dirP = numFat, tblP = numFat + 1, wdP0 = numFat + 2
  const fileSize = SECTOR * (totalSec + 1)

  const buf = Buffer.alloc(fileSize)
  const w16 = (off, v) => { buf[off] = v & 0xff; buf[off + 1] = (v >> 8) & 0xff }
  const w32 = (off, v) => buf.writeUInt32LE(v >>> 0, off)
  const off = (parserSec) => (parserSec + 1) * SECTOR

  // header
  buf.set([0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1], 0)
  w16(26, 3); w16(30, 9); w16(32, 6)
  w32(48, dirP)                       // firstDirectorySector
  w32(56, 4096)                       // miniStreamCutoffSize
  w32(60, END); w32(64, 0)            // firstMiniFat / count
  w32(68, END); w32(72, 0)            // firstDifat / count (header DIFAT only)
  for (let i = 0; i < 109; i++) w32(76 + i * 4, i < numFat ? i : FREE)

  // FAT sectors: entry index = parser sector number
  const fatEntries = new Uint32Array(numFat * 128).fill(FREE)
  for (let i = 0; i < numFat; i++) fatEntries[i] = 0xFFFFFFFD // FATSECT marker
  fatEntries[dirP] = END
  fatEntries[tblP] = END
  for (let i = 0; i < S - 1; i++) fatEntries[wdP0 + i] = wdP0 + i + 1
  fatEntries[wdP0 + S - 1] = END
  for (let i = 0; i < fatEntries.length; i++) w32(off(i >> 7) + (i & 127) * 4, fatEntries[i])

  // directory
  const db = off(dirP)
  const writeDir = (idx, name, type, start, size) => {
    const o = db + idx * 128
    for (let i = 0; i < name.length; i++) w16(o + i * 2, name.charCodeAt(i))
    w16(o + 64, name.length * 2)
    buf[o + 66] = type
    buf[o + 67] = 1
    w32(o + 116, start)
    w32(o + 120, size)
  }
  writeDir(0, 'Root Entry', 5, END, 0)
  writeDir(1, 'WordDocument', 2, wdP0, wdBytes)
  writeDir(2, '0Table', 2, tblP, 512)
  writeDir(3, 'MSGraph.Chart.8', 1, END, 0)

  // WordDocument stream: FIB + text
  const wd = off(wdP0)
  w16(wd + 0, 0xA5EC)
  w16(wd + 2, 0x0101)
  w16(wd + 10, 0)
  w16(wd + 32, 0)
  w16(wd + 34, 22)
  w32(wd + 24, TEXT_OFF)                                  // fcMin
  w32(wd + 28, TEXT_OFF + textBytes)                      // fcMac
  w32(wd + 36 + 12, text.length)                          // ccpText
  w16(wd + 124, 34)
  w32(wd + 126 + 33 * 8, 500)                             // fcClx -> zeros (invalid Pcdt)
  w32(wd + 126 + 33 * 8 + 4, 10)                          // lcbClx
  if (utf16) {
    for (let i = 0; i < text.length; i++) w16(wd + TEXT_OFF + i * 2, text.charCodeAt(i))
  } else {
    for (let i = 0; i < text.length; i++) buf[wd + TEXT_OFF + i] = text.charCodeAt(i) & 0x7f
  }
  return { buffer: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), textLength: text.length, fileBytes: buf.length }
}

// ---- 最小 CLI：生成样本落盘，便于本地复现性能基线（默认不覆盖已有文件） ----
async function main() {
  const { pathToFileURL } = await import('node:url')
  if (process.argv[1] && pathToFileURL(process.argv[1]).href !== import.meta.url) return
  const fs = await import('node:fs')
  const path = await import('node:path')
  const arg = (name, def) => {
    const i = process.argv.indexOf(`--${name}`)
    return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : def
  }
  const outDir = arg('out', '/tmp/docbench')
  const chars = Number(arg('chars', 3_000_000))
  const utf16 = !process.argv.includes('--latin1')
  fs.mkdirSync(outDir, { recursive: true })
  const { buffer, textLength, fileBytes } = buildBigDoc({ textChars: chars, utf16 })
  const name = `synthetic-${Math.round(chars / 1000)}k-${utf16 ? 'u16' : 'l1'}.doc`
  const dest = path.join(outDir, name)
  fs.writeFileSync(dest, Buffer.from(buffer))
  console.log(`[gen-samples] ${dest} 文件=${(fileBytes / 1024 / 1024).toFixed(2)}MB 文本字符=${textLength}`)
}

main()
