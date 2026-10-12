import { logger } from './logger'
import { DirectoryEntry, StreamData } from './oleParser'
import { nextMagicOffset, type MagicScanIndex } from './docparser/magicScanIndex'

export type WordArtEffect = 
  | 'gradient' | 'shadow' | 'emboss' | 'bevel' | 'outline'
  | 'fill' | '3d' | 'rotate' | 'flip' | 'stretch'
  | 'unknown'

export interface WordArtInfo {
  id: number
  name: string
  text?: string
  effects: WordArtEffect[]
  rotation?: number
  flipHorizontal?: boolean
  flipVertical?: boolean
  colors?: string[]
  fontName?: string
  fontSize?: number
  hasPicture?: boolean
  width?: number
  height?: number
  cp?: number
}

const WORDART_NAME_PATTERNS: Record<string, boolean> = {
  'WordArt': true,
  'WordArt.1': true,
  'WordArt.2': true,
  'WordArt.3': true,
  'WordArt.4': true,
  'WordArt.5': true,
  'WordArt.6': true,
  'WordArt.7': true,
  'WordArt.8': true,
  'WordArt.9': true,
  'WordArt.10': true,
  'Microsoft.WordArt': true,
  'Microsoft.WordArt.2': true,
}

const WORDART_NAME_REGEX = /^WordArt(?:\.\d+)?$/
const WORDART_NAME_PATTERN_KEYS = Object.keys(WORDART_NAME_PATTERNS)

/**
 * `extractWordArtFromDrawingData` 的候选起始标记 `E0 00 00 00` 的首字节。
 *
 * 0xE0 在真实语料里密度约 1/751（0.133%），所以把首字节单独前置比较能让
 * 99.87% 的偏移只付一次数组读取；其余三个字节固定为 0x00，在比较处直接写出。
 */
const WORDART_MARKER_LEAD = 0xe0

/** 起始标记之后用于确定 WordArt 结束位置的连续零字节数。 */
const WORDART_TERMINATOR_ZEROS = 8

/**
 * `data` 从 `offset` 起是否连续 `WORDART_TERMINATOR_ZEROS` 个字节都是 0x00。
 *
 * 越界读出的 `undefined` 不等于 0，因此尾部不足的窗口一律判为「不匹配」，
 * 与原实现的内层循环语义一致。
 */
function isZeroRun(data: Uint8Array, offset: number): boolean {
  for (let i = 0; i < WORDART_TERMINATOR_ZEROS; i++) {
    if (data[offset + i] !== 0) return false
  }
  return true
}

function detectWordArtEffects(name: string, data?: Uint8Array): WordArtEffect[] {
  const effects: WordArtEffect[] = []
  const lowerName = name.toLowerCase()

  if (lowerName.includes('gradient') || lowerName.includes('gradientfill')) {
    effects.push('gradient')
  }
  if (lowerName.includes('shadow') || lowerName.includes('drop')) {
    effects.push('shadow')
  }
  if (lowerName.includes('emboss')) {
    effects.push('emboss')
  }
  if (lowerName.includes('bevel')) {
    effects.push('bevel')
  }
  if (lowerName.includes('outline')) {
    effects.push('outline')
  }
  if (lowerName.includes('3d')) {
    effects.push('3d')
  }
  if (lowerName.includes('rotate')) {
    effects.push('rotate')
  }
  if (lowerName.includes('flip')) {
    effects.push('flip')
  }

  if (data && data.length > 0) {
    const dataEffectMask = detectDataEffectMask(data)
    if (dataEffectMask & 1) {
      effects.push('gradient')
    }
    if (dataEffectMask & 2) {
      effects.push('shadow')
    }
    if (dataEffectMask & 4) {
      effects.push('3d')
    }
  }

  if (effects.length === 0) {
    effects.push('fill')
  }

  return effects
}

function detectDataEffectMask(data: Uint8Array): number {
  let mask = 0
  for (let i = 0; i < data.length - 8; i++) {
    if (
      i < data.length - 16 &&
      data[i] === 0x10 && data[i + 1] === 0x00 &&
      data[i + 2] === 0x00 && data[i + 3] === 0x00 &&
      data[i + 4] === 0x00 && data[i + 5] === 0x00 &&
      data[i + 6] === 0x00 && data[i + 7] === 0x00
    ) {
      mask |= 1
    }
    if (
      data[i] === 0x4B && data[i + 1] === 0x00 &&
      data[i + 2] === 0x00 && data[i + 3] === 0x00
    ) {
      mask |= 2
    }
    if (
      data[i] === 0x4C && data[i + 1] === 0x00 &&
      data[i + 2] === 0x00 && data[i + 3] === 0x00
    ) {
      mask |= 4
    }
    if (mask === 7) break
  }
  return mask
}

function extractTextFromData(data: Uint8Array): string | undefined {
  const textBytes: number[] = []
  let inText = false
  
  for (let i = 0; i < data.length - 1; i++) {
    const b1 = data[i]
    const b2 = data[i + 1]
    
    if (b1 === 0 && b2 !== 0 && b2 >= 0x20 && b2 <= 0x7E) {
      inText = true
      textBytes.push(b2)
      i++
    } else if (b1 >= 0x20 && b1 <= 0x7E) {
      textBytes.push(b1)
    } else if (inText && b1 === 0 && b2 === 0) {
      break
    }
  }

  if (textBytes.length > 0) {
    return new TextDecoder('utf-8').decode(new Uint8Array(textBytes))
  }
  return undefined
}

function extractColorsFromData(data: Uint8Array): string[] {
  const colors: string[] = []
  const seenColors = new Set<string>()

  for (let i = 0; i < data.length - 3; i++) {
    if (data[i] === 0x00 && data[i + 1] === 0x00 &&
        data[i + 2] === 0x00 && data[i + 3] === 0x00) {
      continue
    }
    
    const b = data[i]
    const g = data[i + 1]
    const r = data[i + 2]
    const a = data[i + 3]
    
    if (a === 0xFF) {
      const color = `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`
      if (!seenColors.has(color)) {
        seenColors.add(color)
        colors.push(color)
      }
    }
    
    i += 3
  }
  
  return colors.slice(0, 8)
}

export function extractWordArtFromDirectory(
  directory: DirectoryEntry[],
  readStream: (entry: DirectoryEntry) => StreamData | null
): WordArtInfo[] {
  const wordArts: WordArtInfo[] = []

  for (const entry of directory) {
    if (entry.objectType !== 1) continue
    const name = entry.name.trim()
    let isWordArt = WORDART_NAME_REGEX.test(name)
    if (!isWordArt) {
      for (const pattern of WORDART_NAME_PATTERN_KEYS) {
        if (name.includes(pattern)) {
          isWordArt = true
          break
        }
      }
    }
    if (!isWordArt) continue

    try {
      const data = readStream(entry)
      const effects = detectWordArtEffects(entry.name, data?.data)
      const text = data ? extractTextFromData(data.data) : undefined
      const colors = data ? extractColorsFromData(data.data) : []

      wordArts.push({
        id: wordArts.length + 1,
        name: entry.name,
        text: text,
        effects: effects,
        colors: colors.length > 0 ? colors : undefined,
        hasPicture: false,
      })
    } catch (e) {
      logger.warn(`解析 WordArt ${entry.name} 失败: ${e}`)
    }
  }

  return wordArts
}

export function extractWordArtFromDrawingData(data: Uint8Array, magicIndex?: MagicScanIndex): WordArtInfo[] {
  const wordArts: WordArtInfo[] = []

  // 与原来的 `for (let offset = 0; offset < data.length - 100; offset++)` 覆盖
  // 完全相同的偏移集合 {0 … data.length - 101}，只是把 `offset++` 移到了各分支
  // 内部，好让「首字节不匹配」这一支可以整段跳过。
  const limit = data.length - 100
  let offset = 0

  while (offset < limit) {
    if (data[offset] !== WORDART_MARKER_LEAD) {
      // 首字节不匹配 → 直接跳到下一个 0xE0，而不是逐字节走过去。
      //
      // 只在**这里**跳跃是有意的：0xE0 在真实语料里密度 1/751，所以这次跳跃
      // 平均跳过 751 次逐字节比较；而当 0xE0 很密时（例如整段都是 0xE0），
      // 循环根本不会进入这一支，退化成纯逐字节比较，不会为每个字节付一次
      // 原生 indexOf 调用的开销。
      //
      // 对照实测（左：7.65 MB 真实语料 / 右：1 MB 全 0xE0）：
      //   纯逐字节        11.9 ms /  1.8 ms
      //   每次都跳         2.9 ms / 10.2 ms   ← 全 0xE0 时退化 5.5x
      //   本实现           2.9 ms /  1.3 ms   ← 两边都拿到
      offset = nextMagicOffset(magicIndex, data, WORDART_MARKER_LEAD, offset + 1)
      if (offset < 0 || offset >= limit) break
      continue
    }

    // 起始标记 E0 00 00 00。原实现是 `new Uint8Array([0xE0,0,0,0])` + 内层
    // 循环 + `match` 标志，每个偏移都要付一次循环骨架的开销。展开成直接比较后
    // 只剩三次比较。
    //
    // 越界安全性：`offset < data.length - 100`，因此 `offset + 3 < data.length - 97`。
    if (data[offset + 1] !== 0 || data[offset + 2] !== 0 || data[offset + 3] !== 0) {
      offset++
      continue
    }

    const startOffset = offset
    let endOffset = offset + 100
    while (endOffset < data.length && endOffset - offset < 5000) {
      if (isZeroRun(data, endOffset)) {
        break
      }
      endOffset++
    }

    const artData = data.subarray(startOffset, endOffset)
    const effects = detectWordArtEffects('', artData)
    const text = extractTextFromData(artData)
    const colors = extractColorsFromData(artData)

    if (text || effects.length > 1 || colors.length > 0) {
      wordArts.push({
        id: wordArts.length + 1,
        name: `WordArt ${wordArts.length + 1}`,
        text: text,
        effects: effects,
        colors: colors.length > 0 ? colors : undefined,
        hasPicture: false,
      })

      // 原实现是 `offset = endOffset + 8`，随后由 `for` 的 `offset++` 推进，
      // 因此下一个被考察的偏移是 `endOffset + 9`。
      offset = endOffset + 9
    } else {
      offset++
    }
  }

  return wordArts
}

export function getEffectLabel(effect: WordArtEffect): string {
  const labels: Record<WordArtEffect, string> = {
    gradient: '渐变',
    shadow: '阴影',
    emboss: '浮雕',
    bevel: '斜角',
    outline: '轮廓',
    fill: '填充',
    '3d': '3D',
    rotate: '旋转',
    flip: '翻转',
    stretch: '拉伸',
    unknown: '未知',
  }
  return labels[effect] || '未知'
}
