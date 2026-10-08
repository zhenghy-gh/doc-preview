import { logger } from './logger'
import { DirectoryEntry, StreamData } from './oleParser'
import { readUint16, readUint32 } from './binaryReader'

export interface EquationInfo {
  id: number
  eqnText: string
  latex: string
  cp?: number
  hasPicture?: boolean
  format?: string
}

const EQUATION_NAME_PATTERN = /^Equation\.\d+/

/**
 * `extractEquationsFromWordDocumentStream` 在 WordDocument 流里找的前导签名。
 *
 * 值是 UTF-8 的 U+FFFD（替换字符）重复两次——看着像是从一段乱码里提取出来的。
 * 在 27 份真实样本的 5.77 MB WordDocument 流里它出现 **0 次**（实测），所以这
 * 是一把「几乎不命中」的筛子。本轮不碰它（改掉它是行为变更），只让扫描它变便宜。
 */
const EQN_MAGIC = [0xef, 0xbf, 0xbd, 0xef, 0xbf, 0xbd] as const

/**
 * `EQN_MAGIC[0]`，跳跃锚点。
 *
 * 实测密度 0.0846%（4 878 / 5 767 130 字节），平均每 1 182 字节才出现一次。
 * 这个密度是「条件式 `indexOf` 跳跃划算」的前提，必须实测而不是假设——
 * 对照：`0x00` 在同一语料里占 31.4%（每 3.2 字节一次），以它为锚点必然退化。
 */
const EQN_MAGIC_LEAD = EQN_MAGIC[0]

/** 魔数长度，供 `endOffset` 初始化复用（原先是 `eqnMagic.length`）。 */
const EQN_MAGIC_LEN = EQN_MAGIC.length

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
  const equationEntries: DirectoryEntry[] = []
  const streamEntries = new Map<string, DirectoryEntry>()
  for (const entry of directory) {
    if (entry.objectType === 2) {
      if (!streamEntries.has(entry.name)) streamEntries.set(entry.name, entry)
    } else if (entry.objectType === 1 && EQUATION_NAME_PATTERN.test(entry.name)) {
      equationEntries.push(entry)
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
  const limit = data.length - 100
  let offset = 0

  while (offset < limit) {
    // 条件式跳跃：只有首字节不匹配时才调用 `indexOf`。
    //
    // `data[offset] !== EQN_MAGIC_LEAD` 时下面的魔数比较必然失败（它是
    // 逐字节 `&&` 链的第一项），所以「跳到下一个 0xEF」不会漏掉任何候选：
    // 被接受的偏移集合与逐字节版本完全一致。等价性由此可证。
    //
    // 「条件式」是刻意的：若首字节**匹配**却仍去 `indexOf`，在 0xEF 铺满的
    // 输入上每次只前进 1 字节、却多付一次原生调用，反而比逐字节慢。
    // 实测（真实语料 6.79x / 1 MB 全 0xEF 1.33x）——两端都拿到。
    if (data[offset] !== EQN_MAGIC_LEAD) {
      offset = data.indexOf(EQN_MAGIC_LEAD, offset + 1)
      if (offset < 0 || offset >= limit) break
      continue
    }
    if (
      data[offset + 1] !== EQN_MAGIC[1] ||
      data[offset + 2] !== EQN_MAGIC[2] ||
      data[offset + 3] !== EQN_MAGIC[3] ||
      data[offset + 4] !== EQN_MAGIC[4] ||
      data[offset + 5] !== EQN_MAGIC[5]
    ) {
      offset++
      continue
    }

    // Scan UTF-16LE code units after the magic; stop at a 0x0000 terminator.
    // (Previously this scanned byte-by-byte for a single 0x00, which always
    // terminated inside the first ASCII character's zero high byte, so the
    // extracted range was never longer than ~7 bytes and no equation could
    // ever be produced.)
    let endOffset = offset + EQN_MAGIC_LEN
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

    // 原 `for` 的 `offset++`；跳跃路径在自己的分支里 `continue`，不走这里。
    offset++
  }

  return equations
}
