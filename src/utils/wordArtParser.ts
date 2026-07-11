import { logger } from './logger'
import { DirectoryEntry, StreamData } from './oleParser'

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
    if (hasGradientPattern(data)) {
      effects.push('gradient')
    }
    if (hasShadowPattern(data)) {
      effects.push('shadow')
    }
    if (has3dPattern(data)) {
      effects.push('3d')
    }
  }

  if (effects.length === 0) {
    effects.push('fill')
  }

  return effects
}

function hasGradientPattern(data: Uint8Array): boolean {
  for (let i = 0; i < data.length - 16; i++) {
    if (data[i] === 0x10 && data[i + 1] === 0x00 && 
        data[i + 2] === 0x00 && data[i + 3] === 0x00 &&
        data[i + 4] === 0x00 && data[i + 5] === 0x00 &&
        data[i + 6] === 0x00 && data[i + 7] === 0x00) {
      return true
    }
  }
  return false
}

function hasShadowPattern(data: Uint8Array): boolean {
  for (let i = 0; i < data.length - 8; i++) {
    if (data[i] === 0x4B && data[i + 1] === 0x00 &&
        data[i + 2] === 0x00 && data[i + 3] === 0x00) {
      return true
    }
  }
  return false
}

function has3dPattern(data: Uint8Array): boolean {
  for (let i = 0; i < data.length - 8; i++) {
    if (data[i] === 0x4C && data[i + 1] === 0x00 &&
        data[i + 2] === 0x00 && data[i + 3] === 0x00) {
      return true
    }
  }
  return false
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
      if (!colors.includes(color)) {
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

  const wordArtEntries = directory.filter(e => {
    if (e.objectType !== 1) return false
    const name = e.name.trim()
    if (WORDART_NAME_REGEX.test(name)) return true
    for (const pattern of Object.keys(WORDART_NAME_PATTERNS)) {
      if (name.includes(pattern)) return true
    }
    return false
  })

  for (const entry of wordArtEntries) {
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

export function extractWordArtFromDrawingData(data: Uint8Array): WordArtInfo[] {
  const wordArts: WordArtInfo[] = []

  const magicPattern = new Uint8Array([0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00])
  const wordArtMarker = new Uint8Array([0xE0, 0x00, 0x00, 0x00])

  for (let offset = 0; offset < data.length - 100; offset++) {
    let match = true
    for (let i = 0; i < wordArtMarker.length; i++) {
      if (data[offset + i] !== wordArtMarker[i]) {
        match = false
        break
      }
    }
    
    if (!match) continue

    const startOffset = offset
    let endOffset = offset + 100
    while (endOffset < data.length && endOffset - offset < 5000) {
      let magicMatch = true
      for (let i = 0; i < magicPattern.length; i++) {
        if (data[endOffset + i] !== magicPattern[i]) {
          magicMatch = false
          break
        }
      }
      if (magicMatch) {
        break
      }
      endOffset++
    }

    const artData = data.slice(startOffset, endOffset)
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

      offset = endOffset + 8
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
