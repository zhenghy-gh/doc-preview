const DEBUG_MODE = true

class Logger {
  private enabled: boolean

  constructor(enabled: boolean = DEBUG_MODE) {
    this.enabled = enabled
  }

  log(message: string, data?: any) {
    if (this.enabled) {
      console.log(`[DOC Parser] ${message}`, data || '')
    }
  }

  error(message: string, data?: any) {
    if (this.enabled) {
      console.error(`[DOC Parser ERROR] ${message}`, data || '')
    }
  }

  warn(message: string, data?: any) {
    if (this.enabled) {
      console.warn(`[DOC Parser WARN] ${message}`, data || '')
    }
  }

  info(message: string, data?: any) {
    if (this.enabled) {
      console.info(`[DOC Parser INFO] ${message}`, data || '')
    }
  }
}

const logger = new Logger()

// 类型声明

export class DocParser {
  private buffer: ArrayBuffer
  private view: DataView
  private text: string = ''

  constructor(buffer: ArrayBuffer) {
    this.buffer = buffer
    this.view = new DataView(buffer)
    logger.info(`初始化解析器，文件大小: ${buffer.byteLength} bytes`)
  }

  private safeReadUint8(offset: number, defaultValue: number = 0): number {
    if (offset < 0 || offset >= this.buffer.byteLength) {
      logger.warn(`Uint8 越界访问: offset=${offset}, length=${this.buffer.byteLength}`)
      return defaultValue
    }
    return this.view.getUint8(offset)
  }

  private safeReadUint16(offset: number, littleEndian: boolean = true, defaultValue: number = 0): number {
    if (offset < 0 || offset + 2 > this.buffer.byteLength) {
      logger.warn(`Uint16 越界访问: offset=${offset}, length=${this.buffer.byteLength}`)
      return defaultValue
    }
    return this.view.getUint16(offset, littleEndian)
  }

  private safeReadInt32(offset: number, littleEndian: boolean = true, defaultValue: number = 0): number {
    if (offset < 0 || offset + 4 > this.buffer.byteLength) {
      logger.warn(`Int32 越界访问: offset=${offset}, length=${this.buffer.byteLength}`)
      return defaultValue
    }
    return this.view.getInt32(offset, littleEndian)
  }

  private safeReadUint32(offset: number, littleEndian: boolean = true, defaultValue: number = 0): number {
    if (offset < 0 || offset + 4 > this.buffer.byteLength) {
      logger.warn(`Uint32 越界访问: offset=${offset}, length=${this.buffer.byteLength}`)
      return defaultValue
    }
    return this.view.getUint32(offset, littleEndian)
  }

  parse(): { text: string; success: boolean; error?: string } {
    try {
      logger.info('开始解析 DOC 文件')

      if (!this.isOleFile()) {
        logger.error('文件不是有效的 OLE 复合文档格式')
        return { text: '', success: false, error: '文件不是有效的 OLE 复合文档格式' }
      }

      logger.log('OLE 文件签名验证通过')

      const header = this.parseHeader()
      logger.log('文件头解析完成', { header })

      const fatSectors = this.getFatSectors(header)
      logger.log(`FAT 表解析完成，扇区数: ${fatSectors.length}`)

      const directorySectors = this.getDirectorySectors(header, fatSectors)
      logger.log(`目录表解析完成，条目数: ${directorySectors.length}`)

      const wordDocumentStream = this.findWordDocumentStream(directorySectors)

      if (!wordDocumentStream) {
        logger.error('未找到 WordDocument 流，尝试直接扫描文件内容')
        const fallbackText = this.extractTextFromFullFile()
        if (fallbackText.length > 0) {
          logger.info('从整个文件中提取到文本')
          return { text: fallbackText, success: true }
        }
        return { text: '', success: false, error: '未找到 WordDocument 流' }
      }

      logger.log(`WordDocument 流读取完成，大小: ${wordDocumentStream.size} bytes`)

      this.text = this.extractTextWithFib(wordDocumentStream)
      logger.info(`文本提取完成，长度: ${this.text.length} 字符`)

      if (this.text.length === 0) {
        logger.warn('FIB 解析失败，尝试备选提取方法')
        this.text = this.extractTextSimple(wordDocumentStream.data)
      }

      if (this.text.length === 0) {
        return { text: '', success: false, error: '文档内容为空' }
      }

      return { text: this.text, success: true }
    } catch (error) {
      const message = error instanceof Error ? `${error.message}\n${error.stack}` : '未知错误'
      logger.error('解析过程发生异常', message)
      return { text: '', success: false, error: `解析失败: ${error instanceof Error ? error.message : '未知错误'}` }
    }
  }

  parseWithFormat(): { success: boolean; document?: any; text?: string; error?: string } {
    try {
      logger.info('开始解析带格式的 DOC 文件')

      if (!this.isOleFile()) {
        logger.error('文件不是有效的 OLE 复合文档格式')
        return { success: false, error: '文件不是有效的 OLE 复合文档格式' }
      }

      logger.log('OLE 文件签名验证通过')

      const header = this.parseHeader()
      logger.log('文件头解析完成', { header })

      const fatSectors = this.getFatSectors(header)
      logger.log(`FAT 表解析完成，扇区数: ${fatSectors.length}`)

      const directorySectors = this.getDirectorySectors(header, fatSectors)
      logger.log(`目录表解析完成，条目数: ${directorySectors.length}`)

      const wordDocumentStream = this.findWordDocumentStream(directorySectors)

      if (!wordDocumentStream) {
        logger.error('未找到 WordDocument 流，使用备选方法提取格式')
        const fallbackText = this.extractTextFromFullFile()
        
        if (fallbackText.length > 0) {
          logger.info('从整个文件中提取到文本')
          const paragraphs = this.createFormattedParagraphsFromText(fallbackText)
          
          return {
            success: true,
            document: { paragraphs },
            text: fallbackText
          }
        }
        return { success: false, error: '未找到 WordDocument 流' }
      }

      logger.log(`WordDocument 流读取完成，大小: ${wordDocumentStream.size} bytes`)

      const formattedParagraphs = this.extractFormattedText(wordDocumentStream)
      
      if (formattedParagraphs.length === 0) {
        logger.warn('格式解析失败，使用备选方法')
        const fallbackText = this.extractTextSimple(wordDocumentStream.data)
        if (fallbackText.length > 0) {
          return { success: true, text: fallbackText }
        }
        return { success: false, error: '文档内容为空' }
      }

      logger.info(`带格式解析完成，共 ${formattedParagraphs.length} 个段落`)

      const plainText = formattedParagraphs.map(p => p.text).join('\n\n')

      return {
        success: true,
        document: { paragraphs: formattedParagraphs },
        text: plainText
      }
    } catch (error) {
      const message = error instanceof Error ? `${error.message}\n${error.stack}` : '未知错误'
      logger.error('解析过程发生异常', message)
      return { success: false, error: `解析失败: ${error instanceof Error ? error.message : '未知错误'}` }
    }
  }

  private extractFormattedText(wordStream: { data: Uint8Array; size: number }): any[] {
    logger.log('开始提取带格式的文本')

    const fibData = this.parseFib(wordStream.data)

    if (fibData && fibData.fcMin > 0 && fibData.fcMac > 0) {
      logger.log('FIB提供了有效偏移，使用格式数据')
      return this.extractTextWithFormatFromFib(wordStream.data, fibData)
    }

    // FIB没有提供有效的fcMin，需要自动检测编码
    const suggestedComplex = fibData ? fibData.fComplex : false
    logger.warn(`FIB无有效偏移，自动检测编码(fComplex=${suggestedComplex})`)

    // 先用原始二进制检测编码：UTF-16LE 中段落标记为 0x0D 0x00，8-bit 中为 0x0D
    const binaryDetect = this.detectEncodingFromBinary(wordStream.data)
    if (binaryDetect !== null) {
      logger.log(`二进制检测决定编码: ${binaryDetect ? '8-bit' : 'UTF-16LE'}`)
      const raw = this.extractParagraphsWithFormat(wordStream.data, { fcMin: 0, fComplex: binaryDetect })
      return this.filterParagraphsWithGenericLogic(raw)
    }

    // 无法通过二进制判断，回退到评分
    const raw8 = this.extractParagraphsWithFormat(wordStream.data, { fcMin: 0, fComplex: true })
    const raw16 = this.extractParagraphsWithFormat(wordStream.data, { fcMin: 0, fComplex: false })

    const score8 = this.scoreRawParagraphs(raw8)
    const score16 = this.scoreRawParagraphs(raw16)

    logger.log(`编码评分 - 8-bit: ${score8}, UTF-16LE: ${score16}`)

    let useComplex: boolean
    if (suggestedComplex) {
      useComplex = score8 >= score16 * 0.4
    } else {
      useComplex = score16 < score8 * 0.4
    }

    logger.log(`选择编码: ${useComplex ? '8-bit' : 'UTF-16LE'}`)
    return this.filterParagraphsWithGenericLogic(useComplex ? raw8 : raw16)
  }

  /**
   * 通过分析原始二进制中 0x0D 后是否跟 0x00 来判断编码：
   * - UTF-16LE: 段落标记为 0x0D 0x00
   * - 8-bit compressed: 段落标记为单独的 0x0D
   * 返回 true=8-bit, false=UTF-16LE, null=无法判断
   */
  private detectEncodingFromBinary(data: Uint8Array): boolean | null {
    const startOffset = Math.min(2048, Math.floor(data.length / 4))
    const endOffset = Math.min(data.length, startOffset + 100000)

    let totalCR = 0
    let crFollowedByNull = 0

    for (let i = startOffset; i < endOffset - 1; i++) {
      if (data[i] === 0x0D) {
        totalCR++
        if (data[i + 1] === 0x00) {
          crFollowedByNull++
        }
      }
    }

    if (totalCR === 0) return null

    const ratio = crFollowedByNull / totalCR
    logger.log(`编码二进制检测: 0x0D=${totalCR}, 后跟0x00=${crFollowedByNull}, 比例=${ratio.toFixed(3)}`)

    // 如果 <30% 的 0x0D 后跟 0x00，则是 8-bit
    return ratio < 0.3
  }

  private scoreRawParagraphs(paragraphs: any[]): number {
    if (!paragraphs || paragraphs.length === 0) return 0
    let score = 0
    for (const p of paragraphs) {
      const text = p.text || ''
      const len = text.length
      if (len < 4) continue

      // 英文段落：3个以上连续ASCII字母
      const englishWords = (text.match(/[A-Za-z]{3,}/g) || []).length
      if (englishWords >= 2) score += 30
      else if (englishWords >= 1) score += 10

      // 真实中文（而非二进制误解）
      const chineseCount = (text.match(/[一-鿿]/g) || []).length
      if (chineseCount >= 3) score += 25
      else if (chineseCount >= 1) score += 5

      // 段落长度加分（合理范围的文本）
      if (len >= 10 && len <= 500) score += Math.min(len / 2, 50)

      // 常见句法结构
      if (/[,.]/.test(text) || /[，。]/.test(text)) score += 10
      if (/^[A-Z]/.test(text.trim())) score += 5
    }
    return score
  }

  private parseFib(data: Uint8Array): any {
    if (data.length < 32) {
      logger.warn('数据太短，无法解析FIB')
      return null
    }

    const magic = data[0] | (data[1] << 8)

    if (magic !== 0xa5ec && magic !== 0xa5eb) {
      logger.warn(`无效的FIB magic: 0x${magic.toString(16)}`)
      return null
    }

    logger.log(`FIB magic: 0x${magic.toString(16)}`)

    try {
      const nFib = data[2] | (data[3] << 8)
      // fComplex 标志位：FibBase offset 0x0C (byte 12), bit 0
      // 1=8bit压缩存储, 0=UTF-16LE存储
      const fComplex = data[12] & 0x01

      // csw 在 32-byte FibBase 之后（offset 32）
      const csw = data[32] | (data[33] << 8)

      // FibRgW: csw 之后 (csw+1) 个 WORD
      const fibRgWEnd = 34 + (csw + 1) * 2
      if (fibRgWEnd + 4 > data.length) {
        // 无法继续解析FIB变量部分，但仍返回fComplex和默认偏移
        logger.warn('FIB FibRgW超出范围，仅使用fComplex标志')
        return { fcMin: 0, fcMac: 0, fcClx: 0, lcbClx: 0, fComplex: fComplex === 1 }
      }

      // cslw: FibRgW 之后（4 bytes）
      const cslw = data[fibRgWEnd] | (data[fibRgWEnd + 1] << 8) |
                   (data[fibRgWEnd + 2] << 16) | (data[fibRgWEnd + 3] << 24)

      // FibRgLw: cslw 之后, (cslw+1) 个 DWORD
      const fibRgLwEnd = fibRgWEnd + 4 + (cslw + 1) * 4
      if (fibRgLwEnd + 2 > data.length) {
        logger.warn('FIB FibRgLw超出范围，仅使用fComplex标志')
        return { fcMin: 0, fcMac: 0, fcClx: 0, lcbClx: 0, fComplex: fComplex === 1 }
      }

      // cbRgFcLcb: FibRgLw 之后（2 bytes WORD）
      const cbRgFcLcb = data[fibRgLwEnd] | (data[fibRgLwEnd + 1] << 8)

      // rgFcLcbBlob: cbRgFcLcb 之后
      const blobStart = fibRgLwEnd + 2
      const blobSize = cbRgFcLcb * 8  // 每组 (fc + lcb) = 8 bytes

      if (blobStart + blobSize > data.length || cbRgFcLcb < 2) {
        // blob大小不足，无法获取fcMin/fcMac，但仍返回fComplex
        logger.warn(`FIB blob太小(cbRgFcLcb=${cbRgFcLcb})，仅使用fComplex=${fComplex}`)
        return { fcMin: 0, fcMac: 0, fcClx: 0, lcbClx: 0, fComplex: fComplex === 1 }
      }

      const readDword = (offset: number): number => {
        return (data[offset] | (data[offset + 1] << 8) |
                (data[offset + 2] << 16) | (data[offset + 3] << 24)) >>> 0
      }

      // fc 和 lcb 是交错的: [fcMin, lcbMin, fcMac, lcbMac, ...]
      const fcMin = readDword(blobStart + 0 * 4) & 0x3FFFFFFF
      // const lcbMin = readDword(blobStart + 1 * 4)
      const fcMac = readDword(blobStart + 2 * 4) & 0x3FFFFFFF

      let fcClx = 0
      let lcbClx = 0
      if (cbRgFcLcb >= 16) {
        fcClx = readDword(blobStart + 14 * 4) & 0x3FFFFFFF
        lcbClx = readDword(blobStart + 15 * 4)
      }

      logger.log(`nFib=${nFib} fComplex=${fComplex} fcMin=0x${fcMin.toString(16)} fcMac=0x${fcMac.toString(16)}`)
      logger.log(`fcClx=0x${fcClx.toString(16)} lcbClx=${lcbClx}`)

      return {
        fcClx,
        lcbClx,
        fcMin,
        fcMac,
        fComplex: fComplex === 1,
        fibBase: 32
      }
    } catch (error) {
      logger.error(`FIB解析错误: ${error}`)
      return null
    }
  }

  private extractTextWithFormatFromFib(data: Uint8Array, fib: any): any[] {
    logger.log('从FIB提取带格式的文本')

    const clxStart = fib.fcClx
    const clxEnd = clxStart + fib.lcbClx

    if (clxEnd > data.length) {
      logger.warn('Clx数据超出范围，使用简单提取')
      return this.extractParagraphsWithFormat(data, { fcMin: fib.fcMin, fComplex: fib.fComplex })
    }

    const paragraphs = this.extractParagraphsWithFormat(data, { fcMin: fib.fcMin, fComplex: fib.fComplex })
    
    if (paragraphs.length === 0) {
      return []
    }

    logger.info(`提取到 ${paragraphs.length} 个段落`)
    return this.filterParagraphsWithGenericLogic(paragraphs)
  }

  private filterParagraphsWithGenericLogic(paragraphs: any[]): any[] {
    let filtered = paragraphs.filter(p => {
      if (p.text.length < 2) return false
      
      const hasSignificantContent = this.hasSignificantContent(p.text)
      if (!hasSignificantContent) {
        return false
      }
      
      const upperP = p.text.toUpperCase()
      const skipPatterns = ['ROOT', 'SUMMARY', 'DOCUMENT', 'WORD', 'WPS', 'MICROSOFT',
                           'PROPERTY', 'STORAGE', 'STREAM', 'TABLE', 'FORMAT',
                           'XMLDATA', 'BASE64', 'TEMPLATE', 'REGISTRY']

      for (const pattern of skipPatterns) {
        if (upperP.includes(pattern)) return false
      }

      return true
    })

    logger.info(`过滤后剩余 ${filtered.length} 个段落`)

    // 清理前3个段落中的乱码前缀（更彻底的清理）
    for (let i = 0; i < Math.min(3, filtered.length); i++) {
      filtered[i] = this.stripBinaryPrefix(filtered[i])
    }
    
    // 再次过滤，移除被清理后变得空的段落
    filtered = filtered.filter(p => p.text.length >= 2)
    
    // 额外检查：移除明显只有乱码的段落
    filtered = filtered.filter(p => {
      const weirdChars = (p.text.match(/[^\u4e00-\u9fff\u3400-\u4dbf\w\s,.!?，。！？；：""''（）【】、]/g) || []).length
      const totalChars = p.text.length
      return weirdChars / totalChars < 0.5
    })

    // 清理 Word 字段代码
    filtered = filtered.map(p => this.cleanWordFieldCodes(p))
    
    // 再次过滤，移除字段清理后变得空的段落
    filtered = filtered.filter(p => p.text.length >= 2)

    logger.info(`清理后剩余 ${filtered.length} 个段落`)

    return filtered
  }

  private cleanWordFieldCodes(para: any): any {
    let text = para.text
    
    // 特殊处理："第 PAGE 4 页 共 NUMPAGES 5 页" 这种模式
    const pagePattern = /第\s*PAGE\s*(\d+)\s*页\s*共\s*NUMPAGES\s*(\d+)\s*页/gi
    let cleaned = text.replace(pagePattern, '第 $1 页 共 $2 页')
    
    // 如果没匹配到，再处理单个字段，使用单词边界避免误匹配
    if (cleaned === text) {
      const fieldPatterns = [
        /\bPAGE\b/gi,
        /\bNUMPAGES\b/gi,
        /\bDATE\b/gi,
        /\bTIME\b/gi,
        /\bSECTION\b/gi,
        /\bSECTIONPAGES\b/gi,
        /\bFILENAME\b/gi,
        /\bAUTHOR\b/gi,
        /\bTITLE\b/gi,
        /\bSUBJECT\b/gi,
        /\bKEYWORDS\b/gi,
        /\bCOMMENTS\b/gi,
        /\bCREATEDATE\b/gi,
        /\bSAVEDATE\b/gi,
        /\bPRINTDATE\b/gi,
        /\bEDITTIME\b/gi,
        /\bNUMWORDS\b/gi,
        /\bNUMCHARS\b/gi,
        /\bDOCPROPERTY\b/gi,
        /\bMERGEFIELD\b/gi,
        /\bREF\b/gi,
        /\bHYPERLINK\b/gi,
        /\bINCLUDEPICTURE\b/gi,
        /\bINCLUDETEXT\b/gi,
        /\bSEQ\b/gi,
        /\bTOC\b/gi,
        /\bTOC\s+o\s+"1-9"\b/gi,
        /\bTOC\s+o\s+"1-3"\b/gi,
      ]
      
      cleaned = text
      for (const pattern of fieldPatterns) {
        cleaned = cleaned.replace(pattern, '')
      }
    }
    
    // 清理重复的空格和标点
    cleaned = cleaned
      .replace(/\s{2,}/g, ' ')
      .replace(/，\s*，/g, '，')
      .replace(/。\s*。/g, '。')
      .replace(/：\s*：/g, '：')
      .trim()
    
    if (cleaned !== text) {
      logger.log(`清理字段代码: "${text}" → "${cleaned}"`)
      
      // 如果有 charFormat.styles，简化处理：因为文本被压缩了，暂时清空字符样式
      const newCharFormat = { ...para.charFormat }
      if (newCharFormat.styles && newCharFormat.styles.length > 0) {
        delete newCharFormat.styles
      }
      
      return { ...para, text: cleaned, charFormat: newCharFormat }
    }
    
    return para
  }

  private stripBinaryPrefix(para: any): any {
    const text = para.text
    if (!text || text.length < 10) return para

    logger.log(`清理乱码前缀，原文前100字符: "${text.substring(0, Math.min(100, text.length))}..."`)

    let realStart = 0
    let foundRealStart = false

    // 查找第一个连续3个有效字符的位置
    for (let i = 0; i < Math.min(text.length - 3, 100); i++) {
      let validCount = 0
      for (let j = i; j < Math.min(i + 3, text.length); j++) {
        const charCode = text.charCodeAt(j)
        if (this.isValidChar(charCode)) {
          validCount++
        }
      }
      
      if (validCount >= 2) {
        realStart = i
        foundRealStart = true
        break
      }
    }

    if (foundRealStart && realStart > 0) {
      const cleaned = text.substring(realStart)
      logger.log(`清理乱码前缀，从位置 ${realStart} 开始`)

      // 同步调整 charFormat.styles
      const newCharFormat = { ...para.charFormat }
      if (newCharFormat.styles && newCharFormat.styles.length > 0) {
        // 调整每个样式的 start/end
        newCharFormat.styles = newCharFormat.styles
          .map((style: any) => ({
            start: Math.max(0, style.start - realStart),
            end: Math.max(0, style.end - realStart),
            style: style.style
          }))
          .filter((style: any) => style.end > style.start && style.start < cleaned.length)
        
        logger.log(`调整了 ${para.charFormat.styles.length} 个字符样式`)
      }

      return { ...para, text: cleaned, charFormat: newCharFormat }
    }

    // 检测段落整体是否乱码比例过高
    const totalWeird = (text.match(/[^\u4e00-\u9fff\u3400-\u4dbf\w\s,.!?，。！？；：""''（）【】、]/g) || []).length
    if (totalWeird > text.length * 0.4) {
      logger.log(`段落乱码比例过高(${totalWeird}/${text.length})，标记为空`)
      return { ...para, text: '' }
    }

    return para
  }

  private isValidChar(charCode: number): boolean {
    // 有效字符包括：中文、基本ASCII(32-126)、常用标点
    return (
      (charCode >= 0x4E00 && charCode <= 0x9FFF) ||
      (charCode >= 0x3400 && charCode <= 0x4DBF) ||
      (charCode >= 32 && charCode <= 126) ||
      [0x3001, 0x3002, 0xFF0C, 0xFF0E, 0x300A, 0x300B, 0xFF1A,
       0x2018, 0x2019, 0x201C, 0x201D, 0xFF08, 0xFF09,
       0xFF1F, 0xFF01, 0x3000, 0x2014, 0xFF0B].includes(charCode)
    )
  }

  private extractParagraphsWithFormat(data: Uint8Array, options?: { fcMin?: number; fComplex?: boolean }): any[] {
    logger.log('提取段落及格式信息')

    const paragraphs: any[] = []
    let currentParagraph = ''
    let paragraphIndex = 0

    const maxBytes = Math.min(data.length, 500000)
    let startOffset = options?.fcMin ?? 0
    
    // 如果 startOffset 为 0 或过小，跳过 FIB 头部（通常是 200 字节左右）
    if (startOffset < 200) {
      // 查找第一个真正的段落标记
      let firstParaMarker = -1
      for (let i = 200; i < Math.min(data.length - 1, 1000); i++) {
        if (options?.fComplex === false) {
          // UTF-16LE
          if (data[i] === 0x0D && data[i + 1] === 0x00) {
            firstParaMarker = i
            break
          }
        } else {
          // 8-bit
          if (data[i] === 0x0D) {
            firstParaMarker = i
            break
          }
        }
      }
      
      if (firstParaMarker > 0) {
        startOffset = firstParaMarker + (options?.fComplex === false ? 2 : 1)
        logger.log(`FIB 头部跳过，从 offset ${startOffset} 开始提取`)
      } else {
        startOffset = 200
        logger.log(`未找到段落标记，使用默认 offset ${startOffset}`)
      }
    }
    
    const isCompressed = options?.fComplex ?? false

    if (isCompressed) {
      // 8-bit 压缩文本：每字节一个字符，0x0D为段落标记
      for (let i = startOffset; i < maxBytes; i++) {
        const byte = data[i]
        
        if (byte === 0x0D) {
          if (currentParagraph.trim().length >= 2) {
            const cleaned = this.cleanParagraph(currentParagraph.trim())
            if (cleaned.length > 0) {
              const pf = this.detectParagraphFormat(cleaned, paragraphIndex, 50)
              paragraphs.push({
                text: cleaned,
                paraFormat: pf || { alignment: 'left' },
                charFormat: this.guessCharFormat(cleaned, paragraphIndex)
              })
              paragraphIndex++
            }
          }
          currentParagraph = ''
          continue
        }
        
        if (byte === 0x0A || byte === 0x00) continue  // 跳过换行和空字节
        
        if (byte >= 0x20) {
          currentParagraph += String.fromCharCode(byte)
        }
      }
    } else {
      // UTF-16LE 文本
      for (let i = startOffset; i < maxBytes - 1; i++) {
        const byte1 = data[i]
        const byte2 = data[i + 1]

        if (byte1 === 0x0D && byte2 === 0x00) {
          if (currentParagraph.trim().length >= 2) {
            const cleaned = this.cleanParagraph(currentParagraph.trim())
            if (cleaned.length > 0) {
              const pf = this.detectParagraphFormat(cleaned, paragraphIndex, 50)
              paragraphs.push({
                text: cleaned,
                paraFormat: pf || { alignment: 'left' },
                charFormat: this.guessCharFormat(cleaned, paragraphIndex)
              })
              paragraphIndex++
            }
          }
          currentParagraph = ''
          i++
          continue
        }

        const charCode = (byte2 << 8) | byte1

        if (byte2 === 0x00 && byte1 >= 0x20 && byte1 <= 0x7E) {
          currentParagraph += String.fromCharCode(byte1)
          i++
          continue
        }

        if (charCode >= 0x4E00 && charCode <= 0x9FFF) {
          currentParagraph += String.fromCharCode(charCode)
          i++
          continue
        }

        if ([0x3001, 0x3002, 0xFF0C, 0xFF0E, 0x300A, 0x300B, 0xFF1A,
             0x2018, 0x2019, 0x201C, 0x201D, 0xFF08, 0xFF09,
             0xFF1F, 0xFF01, 0x3000, 0x2014].includes(charCode)) {
          currentParagraph += String.fromCharCode(charCode)
          i++
          continue
        }
      }
    }

    if (currentParagraph.trim().length >= 2) {
      const cleaned = this.cleanParagraph(currentParagraph.trim())
      if (cleaned.length > 0) {
        const pf = this.detectParagraphFormat(cleaned, paragraphIndex, 50)
        paragraphs.push({
          text: cleaned,
          paraFormat: pf || { alignment: 'left' },
          charFormat: this.guessCharFormat(cleaned, paragraphIndex)
        })
      }
    }

    logger.info(`提取到 ${paragraphs.length} 个段落`)

    return this.filterAndEnhanceParagraphs(paragraphs)
  }

  private guessCharFormat(text: string, _paragraphIndex?: number): any {
    const charFormat: any = {
      styles: [] as Array<{start: number; end: number; style: any}>
    }
    
    const chineseCount = (text.match(/[\u4e00-\u9fff]/g) || []).length
    const totalLength = text.length
    const chineseRatio = chineseCount / totalLength
    
    // 基础样式：含2个以上汉字的文本使用正文大小，避免*等符号干扰
    if (chineseCount >= 2) {
      charFormat.fontSize = 16
      if (chineseRatio > 0.7) {
        charFormat.fontName = '仿宋_GB2312'
      }
    } else {
      charFormat.fontSize = 12
      charFormat.fontName = 'Times New Roman'
    }

    // 通用标题检测：短文本 + 高中文比 + 无标点 => 加粗+大字号
    const hasSentencePunct = /[，。！？、；]/.test(text)
    const noFieldMarkers = !text.includes('：') && !text.includes(':') &&
      !text.includes('？') && !text.includes('?') && !hasSentencePunct
    // 排除纯姓名（2-4个纯中文、原文长度短的情况）
    const stripped = text.replace(/\s/g, '')
    const pureName = chineseCount >= 2 && chineseCount <= 4 && stripped.length === chineseCount && text.trim().length <= 4
    if (totalLength < 18 && chineseRatio > 0.5 && noFieldMarkers && chineseCount >= 2 && !pureName) {
      charFormat.bold = true
      if (stripped.length < 6) {
        charFormat.fontSize = 36  // 极短标题（不含空格）
      } else {
        charFormat.fontSize = 22  // 二号
      }
    }

    const charStyles = this.detectCharacterStyles(text)
    charFormat.styles = charStyles

    return charFormat
  }

  private detectCharacterStyles(text: string): Array<{start: number; end: number; style: any}> {
    const styles: Array<{start: number; end: number; style: any}> = []
    
    let currentStyle: any = null
    let styleStart = 0

    for (let i = 0; i < text.length; i++) {
      const char = text[i]

      const isDigit = /[0-9]/.test(char)
      const isChinese = /\u4e00-\u9fff/.test(char)
      const isUpperCase = /[A-Z]/.test(char)
      const isLowerCase = /[a-z]/.test(char)
      const isPunctuation = /[，。、；：""''【】《》（）!@#$%^&*()_+=\-\[\]{}|\\:;"'<>,.?\/`~]/.test(char)
      const isWhitespace = /\s/.test(char)

      let charStyle: any = null

      if (isWhitespace) {
        charStyle = {
          fontName: '宋体',
          underline: false
        }
      } else if (isDigit) {
        charStyle = {
          fontName: 'Times New Roman',
          underline: this.shouldHaveUnderline(text, i)
        }
      } else if (isUpperCase || isLowerCase) {
        charStyle = {
          fontName: 'Times New Roman',
          underline: false
        }
      } else if (isChinese) {
        charStyle = {
          fontName: '仿宋',
          underline: false
        }
      } else if (isPunctuation) {
        charStyle = {
          fontName: this.getChineseFont(text, i),
          underline: false
        }
      } else {
        charStyle = {
          fontName: this.getChineseFont(text, i),
          underline: false
        }
      }

      if (currentStyle && this.isSameStyle(currentStyle, charStyle)) {
        continue
      }

      if (currentStyle && !this.isSameStyle(currentStyle, charStyle)) {
        styles.push({
          start: styleStart,
          end: i,
          style: currentStyle
        })
      }

      currentStyle = charStyle
      styleStart = i
    }

    if (currentStyle) {
      styles.push({
        start: styleStart,
        end: text.length,
        style: currentStyle
      })
    }

    // 字段值下划线：给每个冒号后的值文本加下划线（避免标签段被误标）
    const colonPositions: number[] = []
    for (let i = 0; i < text.length; i++) {
      if (text[i] === '：' || text[i] === ':') colonPositions.push(i)
    }
    if (colonPositions.length > 0) {
      // 文本级标记：哪些字符位置应该加下划线
      const shouldUL = new Array(text.length).fill(false)
      for (let ci = 0; ci < colonPositions.length; ci++) {
        const start = colonPositions[ci] + 1
        const end = ci + 1 < colonPositions.length
          ? colonPositions[ci + 1] - 4  // 接近下一个冒号的内容是标签不是值
          : text.length
        for (let j = start; j < end; j++) {
          shouldUL[j] = true
        }
      }
      for (const seg of styles) {
        if (!seg.style) continue
        // 计算该段落在 shouldUL 中的比例
        let count = 0
        for (let j = seg.start; j < seg.end; j++) {
          if (shouldUL[j]) count++
        }
        if (count > (seg.end - seg.start) * 0.4) {
          seg.style.underline = true
        }
      }
    }

    return styles
  }

  private shouldHaveUnderline(text: string, index: number): boolean {
    const char = text[index]
    const isDigit = /[0-9]/.test(char)
    
    if (!isDigit) return false
    
    // 检查这个数字周围的上下文
    const contextBefore = text.substring(Math.max(0, index - 30), index)
    const contextAfter = text.substring(index, Math.min(text.length, index + 30))
    
    // 检查是否有冒号（中文或英文冒号）在数字前面不远处
    const hasColonBefore = /[：:]\s*$/.test(contextBefore)
    
    // 检查是否有日期/时间相关的中文单位
    const hasDatePattern = /[年日月时分秒]/.test(contextAfter) || /[年日月时分秒]/.test(contextBefore)
    const hasTimePattern = /[0-9]{2,4}[年月日时分秒]/.test(contextAfter) || /[0-9]{2,4}[年月日时分秒]/.test(contextBefore)
    
    if (hasColonBefore || hasDatePattern || hasTimePattern) {
      return true
    }

    return false
  }

  private isSameStyle(style1: any, style2: any): boolean {
    if (!style1 || !style2) return false
    const fontSame = style1.fontName === style2.fontName
    const underlineSame = (style1.underline || false) === (style2.underline || false)
    return fontSame && underlineSame
  }

  private getChineseFont(text: string, index: number): string {
    const beforeText = text.substring(0, index)
    const chineseCount = (beforeText.match(/[\u4e00-\u9fff]/g) || []).length
    const totalChars = beforeText.length

    if (totalChars === 0) return '宋体'
    
    const chineseRatio = chineseCount / totalChars
    
    if (chineseRatio > 0.7) {
      return '宋体'
    } else if (chineseRatio > 0.3) {
      return '仿宋'
    } else {
      return '仿宋'
    }
  }

  private filterAndEnhanceParagraphs(paragraphs: any[]): any[] {
    let foundStart = false
    const filtered: any[] = []

    for (const para of paragraphs) {
      if (!foundStart) {
        if (this.hasSignificantContent(para.text)) {
          foundStart = true
          if (!this.shouldSkipParagraph(para.text)) {
            filtered.push(para)
          }
          continue
        }
        continue
      }

      if (this.shouldSkipParagraph(para.text)) {
        continue
      }
      
      if (!this.hasSignificantContent(para.text)) {
        continue
      }
      
      filtered.push(para)
    }

    if (!foundStart && paragraphs.length > 0) {
      return paragraphs.filter(p => !this.shouldSkipParagraph(p.text)).slice(0, 5)
    }

    return filtered
  }

  private isOleFile(): boolean {
    if (this.view.byteLength < 8) {
      logger.error(`文件太小，不是有效的 OLE 文件: ${this.view.byteLength} bytes`)
      return false
    }

    const signature = this.getString(0, 8)
    const isValid = signature === '\xD0\xCF\x11\xE0\xA1\xB1\x1A\xE1'

    logger.log(`OLE 签名检查: ${isValid ? '通过' : '失败'} (${signature.charCodeAt(0).toString(16)})`)

    return isValid
  }

  private getString(offset: number, length: number): string {
    let result = ''
    const maxOffset = Math.min(offset + length, this.buffer.byteLength)

    for (let i = offset; i < maxOffset; i++) {
      try {
        const charCode = this.view.getUint8(i)
        if (charCode !== 0) {
          result += String.fromCharCode(charCode)
        }
      } catch (e) {
        logger.warn(`读取字符串时越界: offset=${i}`)
        break
      }
    }
    return result
  }

  private parseHeader() {
    logger.log('开始解析文件头')

    const minorVersion = this.safeReadUint16(24)
    const majorVersion = this.safeReadUint16(26)
    const byteOrder = this.safeReadUint16(28)
    const sectorSizePower = this.safeReadUint16(30)
    const miniSectorSizePower = this.safeReadUint16(32)

    logger.log(`版本: ${majorVersion}.${minorVersion}, 字节序: ${byteOrder}`)

    const header = {
      minorVersion,
      majorVersion,
      byteOrder,
      sectorSizePower,
      miniSectorSizePower,
      totalSectors: this.safeReadUint32(44),
      fatSectorsCount: this.safeReadUint32(44),
      firstDirectorySector: this.safeReadUint32(48),
      difatSectorsCount: this.safeReadUint32(40),
      firstDifatSector: this.safeReadUint32(36),
      difat: this.getDifat(76, 109),
    }

    logger.log(`扇区大小: ${Math.pow(2, header.sectorSizePower)} bytes`)
    logger.log(`DIFAT 表数量: ${header.difat.length}`)

    return header
  }

  private getDifat(startOffset: number, count: number): number[] {
    const difat: number[] = []

    for (let i = 0; i < count; i++) {
      const offset = startOffset + i * 4
      if (offset + 4 > this.buffer.byteLength) {
        logger.warn(`DIFAT 表读取越界: offset=${offset}`)
        break
      }

      const sector = this.safeReadInt32(offset)
      if (sector === -2 || sector < 0) {
        logger.log(`DIFAT 表结束于索引 ${i}`)
        break
      }
      difat.push(sector)
    }

    return difat
  }

  private getSectorSize(header: any): number {
    return Math.pow(2, header.sectorSizePower)
  }

  private sectorToOffset(sector: number, header: any): number {
    return (sector + 1) * this.getSectorSize(header)
  }

  private getFatSectors(header: any): number[] {
    const sectorSize = this.getSectorSize(header)
    const entriesPerSector = sectorSize / 4
    const totalSectors = Math.ceil(this.buffer.byteLength / sectorSize)

    logger.log(`开始读取 FAT 表，共 ${header.difat.length} 个 FAT 扇区, ${totalSectors} 总扇区`)

    // FAT[f] = next sector after f, or -1 (end), -2 (free), -3 (FAT sector itself)
    // 初始化为 -2 (FREESECT = 未分配)
    const fat = new Array(totalSectors).fill(-2)

    for (let d = 0; d < header.difat.length; d++) {
      const fatSector = header.difat[d]
      const offset = this.sectorToOffset(fatSector, header)

      if (offset + sectorSize > this.buffer.byteLength) {
        logger.warn(`FAT 扇区 ${fatSector} 越界`)
        continue
      }

      const baseSector = d * entriesPerSector
      for (let i = 0; i < entriesPerSector; i++) {
        const sectorNum = baseSector + i
        if (sectorNum >= totalSectors) break
        const entryOffset = offset + i * 4
        if (entryOffset + 4 > this.buffer.byteLength) break
        fat[sectorNum] = this.safeReadInt32(entryOffset)
      }
    }

    logger.log(`FAT 表读取完成，${fat.length} 个条目`)
    return fat
  }

  private getDirectorySectors(header: any, fat: number[]): any[] {
    const directory: any[] = []
    const sectorSize = this.getSectorSize(header)
    const entriesPerSector = sectorSize / 128

    logger.log(`开始读取目录表，firstDirectorySector: ${header.firstDirectorySector}`)

    let currentSector = header.firstDirectorySector
    let sectorIndex = 0

    while (currentSector >= 0 && currentSector < fat.length && fat[currentSector] !== -2 && sectorIndex < 1000) {
      sectorIndex++
      const offset = this.sectorToOffset(currentSector, header)

      if (offset + sectorSize > this.buffer.byteLength) {
        logger.warn(`目录扇区 ${currentSector} 越界`)
        break
      }

      for (let i = 0; i < entriesPerSector; i++) {
        const entryOffset = offset + i * 128
        if (entryOffset + 128 > this.buffer.byteLength) {
          logger.warn(`目录条目 ${i} 越界`)
          break
        }

        const entry = this.parseDirectoryEntry(entryOffset)

        if (entry && entry.nameLength > 0) {
          directory.push(entry)
          logger.log(`找到目录条目: ${entry.name} (类型: ${entry.objectType}, 大小: ${entry.size})`)
        }
      }

      if (fat[currentSector] === -1) break
      currentSector = fat[currentSector]
    }

    logger.log(`目录表读取完成，共 ${directory.length} 个条目`)
    return directory
  }

  private parseDirectoryEntry(offset: number): any {
    try {
      const objectType = this.safeReadUint8(offset + 66)
      const colorFlag = this.safeReadUint8(offset + 67)
      const nameLength = this.safeReadUint16(offset + 64)

      logger.log(`目录条目 @ offset ${offset}: objectType=${objectType}, colorFlag=${colorFlag}, nameLength=${nameLength}`)

      if (objectType === 0 && colorFlag === 0) {
        logger.log('目录条目为空（根条目标记）')
        return null
      }

      if (objectType < 1 || objectType > 5) {
        logger.warn(`无效的 objectType: ${objectType}，跳过此条目`)
        return null
      }

      let name = ''
      // 名称是从offset开始的UTF-16LE字符串
      const actualNameLength = nameLength // nameLength以字节为单位
      
      for (let i = 0; i < actualNameLength && offset + i + 1 < this.buffer.byteLength; i += 2) {
        const char = this.safeReadUint16(offset + i)
        if (char !== 0) {
          name += String.fromCharCode(char)
        }
      }

      name = name.trim()

      const startSector = this.safeReadInt32(offset + 116)
      const size = this.safeReadUint32(offset + 120)

      logger.log(`解析条目: name="${name}", objectType=${objectType}, startSector=${startSector}, size=${size}`)

      return {
        name,
        objectType,
        startSector,
        size,
        nameLength
      }
    } catch (error) {
      logger.warn(`解析目录条目失败: ${error}`)
      return null
    }
  }

  private findWordDocumentStream(directory: any[]): { data: Uint8Array; size: number } | null {
    logger.log('开始查找 WordDocument 流')
    logger.log('所有目录条目:')
    for (const entry of directory) {
      logger.log(`  - name="${entry.name}", type=${entry.objectType}, size=${entry.size}, startSector=${entry.startSector}`)
    }

    // 精确匹配 WordDocument
    const wordDocEntry = directory.find(entry =>
      entry.name === 'WordDocument' && entry.objectType === 2
    )

    if (wordDocEntry) {
      logger.info('找到标准 WordDocument 流')
      return this.readStream(wordDocEntry)
    }

    logger.warn('未找到标准 WordDocument 流，尝试不区分大小写匹配')
    const wordDocEntryCaseInsensitive = directory.find(entry =>
      entry.name.toLowerCase().includes('worddocument') && entry.objectType === 2
    )

    if (wordDocEntryCaseInsensitive) {
      logger.info(`找到近似匹配的流: ${wordDocEntryCaseInsensitive.name}`)
      return this.readStream(wordDocEntryCaseInsensitive)
    }

    logger.warn('搜索包含 "Word" 的流')
    const entries = directory.filter(e =>
      e.name.toLowerCase().includes('word') && e.objectType === 2
    )

    if (entries.length > 0) {
      logger.info(`找到 ${entries.length} 个包含 Word 的流，尝试第一个: ${entries[0].name}`)
      return this.readStream(entries[0])
    }

    logger.warn('搜索所有流对象')
    const allStreams = directory.filter(e => e.objectType === 2 && e.size > 0)
    if (allStreams.length > 0) {
      // 按大小排序，取最大的几个尝试
      const sortedStreams = allStreams.sort((a, b) => b.size - a.size)
      logger.warn(`尝试最大的流: ${sortedStreams[0].name}, size=${sortedStreams[0].size}`)
      return this.readStream(sortedStreams[0])
    }

    logger.error('未找到任何可用的流')
    return null
  }

  private readStream(entry: any): { data: Uint8Array; size: number } {
    logger.log(`开始读取流: ${entry.name}, 起始扇区: ${entry.startSector}, 大小: ${entry.size}`)

    const header = this.parseHeader()
    const fat = this.getFatSectors(header)
    const sectorSize = this.getSectorSize(header)
    const data: number[] = []

    let currentSector = entry.startSector
    let bytesRead = 0
    let maxIterations = 1000
    let iterations = 0

    while (currentSector >= 0 && currentSector < fat.length && fat[currentSector] !== -2 && bytesRead < entry.size && iterations < maxIterations) {
      iterations++

      const offset = this.sectorToOffset(currentSector, header)

      if (offset < 0 || offset >= this.buffer.byteLength) {
        logger.warn(`扇区偏移越界: sector=${currentSector}, offset=${offset}, length=${this.buffer.byteLength}`)
        break
      }

      const bytesToRead = Math.min(sectorSize, entry.size - bytesRead)

      for (let i = 0; i < bytesToRead; i++) {
        const byteOffset = offset + i
        if (byteOffset < this.buffer.byteLength) {
          data.push(this.safeReadUint8(byteOffset))
        } else {
          logger.warn(`字节读取越界: ${byteOffset}`)
          break
        }
      }

      bytesRead += bytesToRead
      currentSector = fat[currentSector]
    }

    logger.info(`流读取完成: ${data.length} bytes`)

    return { data: new Uint8Array(data), size: data.length }
  }

  private extractTextWithFib(wordStream: { data: Uint8Array; size: number }): string {
    logger.log('开始使用 FIB 解析文本内容和格式信息')

    const data = wordStream.data

    if (data.length < 32) {
      logger.warn('数据太短，无法解析 FIB')
      return ''
    }

    const fib = this.parseFib(data)
    if (!fib) {
      logger.warn('FIB 解析失败，使用备选方法')
      return this.extractTextSimple(data)
    }

    // 尝试 Clx 解析
    if (fib.lcbClx > 0 && fib.fcClx + fib.lcbClx <= data.length) {
      const clxData = data.subarray(fib.fcClx, fib.fcClx + fib.lcbClx)
      const textFromClx = this.parseClx(clxData, data)

      if (textFromClx.length > 0) {
        logger.log(`从 Clx 结构中提取到 ${textFromClx.length} 字符`)
        return textFromClx
      }
    }

    // fcMin=0 表示FIB没有有效偏移，需要自动检测编码
    if (fib.fcMin === 0 || fib.fcMac === 0) {
      logger.log('FIB偏移为0，自动检测编码')
      return this.extractTextWithAutoDetect(data, fib.fComplex)
    }

    logger.log('使用 fcMin/fComplex 提取文本')
    return this.extractTextSimple(data, { fcMin: fib.fcMin, fComplex: fib.fComplex })
  }

  private extractTextWithAutoDetect(data: Uint8Array, suggestedComplex: boolean): string {
    // 先用二进制检测编码
    const binaryDetect = this.detectEncodingFromBinary(data)
    if (binaryDetect !== null) {
      logger.log(`二进制检测决定编码: ${binaryDetect ? '8-bit' : 'UTF-16LE'}`)
      return this.extractTextSimple(data, { fcMin: 0, fComplex: binaryDetect })
    }

    // 无法通过二进制判断，回退到评分
    let text8 = this.extractTextSimple(data, { fcMin: 0, fComplex: true })
    let text16 = this.extractTextSimple(data, { fcMin: 0, fComplex: false })

    const score8 = this.scorePlainText(text8)
    const score16 = this.scorePlainText(text16)

    logger.log(`自动检测编码评分 - 8-bit: ${score8}, UTF-16LE: ${score16}`)

    if (suggestedComplex) {
      if (score8 >= score16 * 0.4) {
        logger.log('使用8-bit编码（FIB建议）')
        return text8
      }
      logger.log('8-bit结果质量差，改用UTF-16LE')
      return text16
    } else {
      if (score16 >= score8 * 0.4) {
        logger.log('使用UTF-16LE编码（FIB建议）')
        return text16
      }
      logger.log('UTF-16LE结果质量差，改用8-bit')
      return text8
    }
  }

  private scorePlainText(text: string): number {
    if (!text || text.length === 0) return 0
    const paragraphs = text.split(/\n{2,}/).filter(p => p.trim().length > 0)
    let score = 0
    for (const p of paragraphs) {
      const len = p.length
      if (len < 4) continue
      const englishWords = (p.match(/[A-Za-z]{3,}/g) || []).length
      if (englishWords >= 2) score += 30
      else if (englishWords >= 1) score += 10
      const chineseCount = (p.match(/[一-鿿]/g) || []).length
      if (chineseCount >= 3) score += 25
      else if (chineseCount >= 1) score += 5
      if (len >= 10 && len <= 500) score += Math.min(len / 2, 50)
      if (/[,.]/.test(p) || /[，。]/.test(p)) score += 10
    }
    return score
  }

  private parseClx(clxData: Uint8Array, wordDocData: Uint8Array): string {
    logger.log('解析 Clx 结构')

    if (clxData.length < 4) {
      logger.warn('Clx 数据太短')
      return ''
    }

    const clxt = clxData[0]
    logger.log(`Clx type: ${clxt}`)

    if (clxt !== 2) {
      logger.warn('不是 Pcdt 类型')
      return this.extractTextSimple(wordDocData)
    }

    let offset = 1
    
    const lcb = clxData[offset] | (clxData[offset + 1] << 8) | 
                (clxData[offset + 2] << 16) | (clxData[offset + 3] << 24)
    offset += 4

    logger.log(`Pcdt size: ${lcb}`)

    if (lcb <= 0 || offset + lcb > clxData.length) {
      logger.warn('Pcdt size 无效')
      return this.extractTextSimple(wordDocData)
    }

    const clxt2 = clxData[offset]
    offset += 1

    if (clxt2 !== 1) {
      logger.warn('不是 ClxPcdTable 类型')
      return this.extractTextSimple(wordDocData)
    }

    const lcb2 = clxData[offset] | (clxData[offset + 1] << 8) | 
                 (clxData[offset + 2] << 16) | (clxData[offset + 3] << 24)
    offset += 4

    logger.log(`PcdTable size: ${lcb2}`)

    const rgCcp: number[] = []
    while (offset + 4 <= clxData.length) {
      const ccp = clxData[offset] | (clxData[offset + 1] << 8) | 
                  (clxData[offset + 2] << 16) | (clxData[offset + 3] << 24)
      
      if (ccp === 0 && rgCcp.length > 0) break
      
      rgCcp.push(ccp)
      offset += 4
    }

    logger.log(`RgCcp 包含 ${rgCcp.length} 个条目`)

    let text = ''
    let lastCcp = 0

    for (const ccp of rgCcp) {
      if (ccp > lastCcp && ccp > 0) {
        const start = lastCcp
        const end = ccp
        const extracted = this.extractTextFromRange(wordDocData, start, end)
        if (extracted.length > 0) {
          text += extracted
        }
      }
      lastCcp = ccp
    }

    if (text.length === 0 && wordDocData.length > 0) {
      logger.log('直接扫描 WordDocument 数据')
      text = this.extractTextSimple(wordDocData)
    }

    return text
  }

  private extractTextFromRange(data: Uint8Array, start: number, end: number): string {
    logger.log(`提取范围 ${start}-${end}`)

    let text = ''
    const actualStart = Math.max(0, start)
    const actualEnd = Math.min(data.length, end)

    for (let i = actualStart; i < actualEnd - 1; i += 2) {
      const charCode = data[i] | (data[i + 1] << 8)

      if (charCode === 0x000d) {
        text += '\n'
      } else if (charCode === 0x000a) {
        continue
      } else if (charCode === 0x0000) {
        continue
      } else if ((charCode >= 0x0020 && charCode <= 0x007E) ||
                 (charCode >= 0x4E00 && charCode <= 0x9FFF) ||
                 (charCode >= 0x3000 && charCode <= 0x303F) ||
                 (charCode >= 0xFF00 && charCode <= 0xFFEF) ||
                 (charCode === 0x2018 || charCode === 0x2019 ||
                  charCode === 0x201C || charCode === 0x201D)) {
        text += String.fromCharCode(charCode)
      }
    }

    return text
  }

  private extractTextSimple(data: Uint8Array, options?: { fcMin?: number; fComplex?: boolean }): string {
    logger.log('使用简单文本提取方法')

    const paragraphs: string[] = []
    let currentParagraph = ''

    const maxBytes = Math.min(data.length, 500000)
    const startOffset = options?.fcMin ?? 0
    const isCompressed = options?.fComplex ?? false

    if (isCompressed) {
      // 8-bit 压缩文本
      for (let i = startOffset; i < maxBytes; i++) {
        const byte = data[i]
        
        if (byte === 0x0D) {
          if (currentParagraph.trim().length >= 2) {
            paragraphs.push(currentParagraph.trim())
          }
          currentParagraph = ''
          continue
        }
        
        if (byte === 0x0A || byte === 0x00) continue
        
        if (byte >= 0x20) {
          currentParagraph += String.fromCharCode(byte)
        }
      }
    } else {
      // UTF-16LE 文本
      for (let i = startOffset; i < maxBytes - 1; i++) {
        const byte1 = data[i]
        const byte2 = data[i + 1]

        if (byte1 === 0x0D && byte2 === 0x00) {
          if (currentParagraph.trim().length >= 2) {
            paragraphs.push(currentParagraph.trim())
          }
          currentParagraph = ''
          i++
          continue
        }

        if (byte1 === 0x0A && byte2 === 0x00) {
          i++
          continue
        }

        if (byte2 === 0x00 && byte1 >= 0x20 && byte1 <= 0x7E) {
          currentParagraph += String.fromCharCode(byte1)
          i++
          continue
        }

        const charCode = (byte2 << 8) | byte1

        if (charCode >= 0x4E00 && charCode <= 0x9FFF) {
          currentParagraph += String.fromCharCode(charCode)
          i++
          continue
        }

        if ([0x3001, 0x3002, 0xFF0C, 0xFF0E, 0x300A, 0x300B,
             0x2018, 0x2019, 0x201C, 0x201D, 0xFF08, 0xFF09,
             0xFF1F, 0xFF01, 0xFF1A, 0x3000].includes(charCode)) {
          currentParagraph += String.fromCharCode(charCode)
          i++
          continue
        }
      }
    }

    if (currentParagraph.trim().length >= 2) {
      paragraphs.push(currentParagraph.trim())
    }

    logger.info(`初步提取到 ${paragraphs.length} 个段落`)

    let foundStart = false
    const filteredStart: string[] = []
    
    const junkChars = /[一伀倀藠俹醫蠀耀頀琀餀栀儀騀甀攀爀愀氀攀漀漀渀]/g

    for (const p of paragraphs) {
      if (!foundStart) {
        const cleanP = this.cleanParagraph(p)
        
        if (cleanP.length > 5) {
          const chineseCount = (cleanP.match(/[\u4e00-\u9fff]/g) || []).length
          const junkCount = (cleanP.match(junkChars) || []).length
          
          if (chineseCount >= 3 && junkCount < chineseCount) {
            foundStart = true
            filteredStart.push(cleanP)
            continue
          }
        }
      } else {
        const cleanedP = this.cleanParagraph(p)
        if (!this.shouldSkipParagraph(cleanedP)) {
          filteredStart.push(cleanedP)
        }
      }
    }

    if (!foundStart) {
      filteredStart.push(...paragraphs.slice(0, 3).map(p => this.cleanParagraph(p)).filter(p => !this.shouldSkipParagraph(p)))
    }

    const filtered = filteredStart.filter(p => {
      if (p.length < 2) return false
      
      if (this.shouldSkipParagraph(p)) {
        return false
      }
      
      const hasSignificantContent = this.hasSignificantContent(p)
      if (!hasSignificantContent) {
        return false
      }
      
      const upperP = p.toUpperCase()
      const skipPatterns = ['ROOT', 'SUMMARY', 'DOCUMENT', 'WORD', 'WPS', 'MICROSOFT',
                            'PROPERTY', 'STORAGE', 'STREAM', 'TABLE', 'FORMAT',
                            'XMLDATA', 'BASE64', 'TEMPLATE', 'REGISTRY']

      for (const pattern of skipPatterns) {
        if (upperP.includes(pattern)) return false
      }

      return true
    })

    const result = filtered.join('\n\n').trim()

    logger.log(`最终文本长度: ${result.length} 字符`)

    return result
  }

  private cleanParagraph(p: string): string {
    let cleaned = p.trim()
    
    // 移除这个会删除前面数字的逻辑
    // const firstChineseIndex = cleaned.search(/[\u4e00-\u9fff]/)
    // 
    // if (firstChineseIndex > 0) {
    //   const beforeChinese = cleaned.substring(0, firstChineseIndex)
    //   const hasOnlyAsciiAndSymbols = /^[A-Z0-9!"#$%&'()*+,\-./:;<=>?@\s_]+$/.test(beforeChinese)
    //   
    //   if (hasOnlyAsciiAndSymbols && firstChineseIndex > 2) {
    //     cleaned = cleaned.substring(firstChineseIndex)
    //   }
    // }
    
    const junkChars = /^[一伀倀藠俹醫蠀耀頀琀餀栀儀騀甀攀爀愀氀攀漀漀渀]+/
    cleaned = cleaned.replace(junkChars, '')
    
    return cleaned.trim()
  }

  private createFormattedParagraphsFromText(text: string): any[] {
    logger.log('从纯文本创建带格式的段落')
    
    const paragraphs: any[] = []
    const textParagraphs = text.split(/\n\n/).filter(p => p.trim().length > 0)
    
    for (let i = 0; i < textParagraphs.length; i++) {
      const paraText = textParagraphs[i]
      const cleaned = this.cleanParagraph(paraText.trim())
      
      if (!this.shouldSkipParagraph(cleaned) && cleaned.length > 0) {
        const charFormat = this.guessCharFormat(cleaned, i)
        const paraFormat = this.detectParagraphFormat(cleaned, i, textParagraphs.length)
        
        paragraphs.push({
          text: cleaned,
          paraFormat: paraFormat,
          charFormat: charFormat
        })
      }
    }
    
    logger.info(`创建了 ${paragraphs.length} 个带格式的段落`)
    return paragraphs
  }

  private detectParagraphFormat(text: string, index: number, totalParagraphs: number): any {
    const format: any = {}
    
    // 检测对齐方式
    const alignment = this.detectAlignment(text, index, totalParagraphs)
    if (alignment) {
      format.alignment = alignment
    }
    
    return format
  }

  private detectAlignment(text: string, index: number, totalParagraphs: number): string | null {
    const stripped = text.replace(/\s/g, '')
    const chineseCount = (stripped.match(/[一-鿿]/g) || []).length
    const totalLen = text.length

    // 纯中文人名（2-4字）—— 右对齐（在标题检测之前，因为人名可能也匹配标题规则）
    const onlyName =
      chineseCount >= 2 && chineseCount <= 4 &&
      stripped.length === chineseCount
    if (onlyName && index > totalParagraphs * 0.5) {
      return 'right'
    }

    // 日期行（以数字开头 + 年月日）—— 右对齐
    if (/^\s*\d{4}\s*年/.test(text) || /^\s*\d{1,2}\s*月/.test(text)) {
      return 'right'
    }

    // 标题居中检测：短文本 + 高中文比 + 无句子标点
    const hasSentencePunct = /[，。！？、；]/.test(text)
    const noFieldMarkers = !text.includes('：') && !text.includes(':') &&
      !text.includes('？') && !text.includes('?') && !hasSentencePunct
    if (totalLen < 18 && chineseCount >= 2 && chineseCount / stripped.length > 0.5 && noFieldMarkers) {
      return 'center'
    }

    return null
  }

  private shouldSkipParagraph(text: string): boolean {
    // 检查是否有太多乱码字符
    if (this.hasTooManyJunkChars(text)) {
      return true
    }
    
    return false
  }

  private hasTooManyJunkChars(text: string): boolean {
    // 常见的乱码字符模式（已移除正常的中文"一"）
    const junkCharsPattern = /[伀倀藠俹醫蠀耀頀琀餀栀儀騀甀攀爀愀氀攀漀漀渀伇倈俼俿儀儜厬唀唕嘀噀圀堀嬀崀崜帀幀弰彀戀戀愀氀攀漀漀渀伀倀藠俹醫蠀耀頀琀餀栀儀騀甀攀爀愀氀攀漀漀渀]/g
    const junkMatches = text.match(junkCharsPattern) || []
    
    if (junkMatches.length > 0) {
      const totalLength = text.trim().length
      
      // 如果乱码字符超过2个，或者乱码占比超过20%
      if (junkMatches.length > 2 || (totalLength > 0 && junkMatches.length / totalLength > 0.2)) {
        return true
      }
    }
    
    return false
  }

  private hasSignificantContent(text: string): boolean {
    if (text.length < 2) return false

    const chineseChars = (text.match(/[\u4e00-\u9fff]/g) || []).length
    const allChars = text.length
    const chineseRatio = chineseChars / allChars

    if (chineseChars >= 2 && chineseRatio > 0.3) {
      return true
    }

    // 检测英文内容：2个以上含元音字母的3+字母英文单词
    const englishWords = (text.match(/[A-Za-z]{3,}/g) || []).filter(w => /[aeiouyAEIOUY]/.test(w)).length
    if (englishWords >= 2) {
      return true
    }

    const hasCommonPunctuation = /[，。、；：""''【】《》]/.test(text)
    const hasContent = /[\u4e00-\u9fff]{2,}/.test(text)
    
    if (hasCommonPunctuation && hasContent) {
      return true
    }

    const printableChars = text.replace(/[\s\p{P}]/gu, '').length
    if (printableChars >= 3 && chineseChars >= 1) {
      return true
    }

    return false
  }

  private extractTextFromFullFile(): string {
    logger.log('从整个 OLE 文件中扫描提取文本')

    const fullData = new Uint8Array(this.buffer)
    const text = this.extractTextSimple(fullData)

    return text
  }
}

export function parseDocFile(file: File, _debug: boolean = DEBUG_MODE): Promise<{ text: string; success: boolean; error?: string }> {
  return new Promise((resolve) => {
    logger.info(`开始解析文件: ${file.name}, 大小: ${file.size} bytes`)

    const reader = new FileReader()

    reader.onload = (e) => {
      const buffer = e.target?.result as ArrayBuffer

      if (!buffer) {
        logger.error('文件读取失败: buffer 为空')
        resolve({ text: '', success: false, error: '无法读取文件' })
        return
      }

      logger.info(`文件读取成功: ${buffer.byteLength} bytes`)

      try {
        const parser = new DocParser(buffer)
        const result = parser.parse()

        if (result.success) {
          logger.info(`解析成功: ${result.text.length} 字符`)
        } else {
          logger.error(`解析失败: ${result.error}`)
        }

        resolve(result)
      } catch (error) {
        const message = error instanceof Error ? error.message : '未知错误'
        logger.error(`解析器异常: ${message}`)
        resolve({ text: '', success: false, error: `解析失败: ${message}` })
      }
    }

    reader.onerror = () => {
      logger.error('FileReader 错误')
      resolve({ text: '', success: false, error: '文件读取失败' })
    }

    reader.readAsArrayBuffer(file)
  })
}

export function parseDocFileFromBuffer(
  buffer: ArrayBuffer,
  _fileName?: string
): {
  success: boolean
  document?: any
  text?: string
  error?: string
} {
  logger.info(`开始解析: ${_fileName || '未知'}, ${buffer.byteLength} bytes`)

  try {
    const parser = new DocParser(buffer)
    const result = parser.parseWithFormat()

    if (result.success) {
      logger.info('解析成功')
    } else {
      logger.error(`解析失败: ${result.error}`)
    }

    return result
  } catch (error) {
    const message = error instanceof Error ? error.message : '未知错误'
    logger.error(`解析器异常: ${message}`)
    return { success: false, error: `解析失败: ${message}` }
  }
}

export function parseDocFileWithFormat(file: File, _debug: boolean = DEBUG_MODE): Promise<{
  success: boolean
  document?: any
  text?: string
  error?: string
}> {
  return new Promise((resolve) => {
    logger.info(`开始解析带格式的文件: ${file.name}, 大小: ${file.size} bytes`)

    const reader = new FileReader()

    reader.onload = (e) => {
      const buffer = e.target?.result as ArrayBuffer

      if (!buffer) {
        logger.error('文件读取失败: buffer 为空')
        resolve({ success: false, error: '无法读取文件' })
        return
      }

      resolve(parseDocFileFromBuffer(buffer, file.name))
    }

    reader.onerror = () => {
      logger.error('FileReader 错误')
      resolve({ success: false, error: '文件读取失败' })
    }

    reader.readAsArrayBuffer(file)
  })
}

export function enableDebugMode() {
  logger.info('调试模式已启用')
}
