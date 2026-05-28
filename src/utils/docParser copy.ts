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
    const fat: number[] = []
    const sectorSize = this.getSectorSize(header)
    const entriesPerSector = sectorSize / 4

    logger.log(`开始读取 FAT 表，共 ${header.difat.length} 个 FAT 扇区`)

    for (let d = 0; d < header.difat.length; d++) {
      const fatSector = header.difat[d]
      const offset = this.sectorToOffset(fatSector, header)

      if (offset + sectorSize > this.buffer.byteLength) {
        logger.warn(`FAT 扇区 ${fatSector} 越界`)
        continue
      }

      for (let i = 0; i < entriesPerSector; i++) {
        const entryOffset = offset + i * 4
        if (entryOffset + 4 > this.buffer.byteLength) break

        const entry = this.safeReadInt32(entryOffset)

        if (entry === -1) break
        if (entry >= 0) {
          fat.push(entry)
        }
      }
    }

    logger.log(`FAT 表读取完成，共 ${fat.length} 个扇区`)
    return fat
  }

  private getDirectorySectors(header: any, fat: number[]): any[] {
    const directory: any[] = []
    const sectorSize = this.getSectorSize(header)
    const entriesPerSector = sectorSize / 128

    logger.log(`开始读取目录表，firstDirectorySector: ${header.firstDirectorySector}`)

    let currentSector = header.firstDirectorySector
    let sectorIndex = 0

    while (currentSector < fat.length && currentSector !== -2 && sectorIndex < 1000) {
      sectorIndex++
      const offset = this.sectorToOffset(fat[currentSector], header)

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
      const maxNameEnd = Math.min(offset + 64, offset + nameLength - 2)

      for (let i = offset; i < maxNameEnd; i += 2) {
        const char = this.safeReadUint16(i)
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

    const wordDocEntry = directory.find(entry =>
      entry.name === 'WordDocument' && entry.objectType === 2
    )

    if (wordDocEntry) {
      logger.info('找到 WordDocument 流')
      return this.readStream(wordDocEntry)
    }

    logger.warn('未找到标准 WordDocument 流，搜索其他流')

    const entries = directory.filter(e =>
      e.name.includes('Word') && e.objectType === 2
    )

    if (entries.length > 0) {
      logger.info(`找到 ${entries.length} 个包含 Word 的流，尝试第一个`)
      return this.readStream(entries[0])
    }

    const allStreams = directory.filter(e => e.objectType === 2 && e.size > 0)
    if (allStreams.length > 0) {
      logger.warn(`未找到 Word 相关流，尝试最大的流: ${allStreams[0].name}`)
      return this.readStream(allStreams[0])
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

    while (currentSector < fat.length && currentSector !== -2 && bytesRead < entry.size && iterations < maxIterations) {
      iterations++

      if (currentSector < 0) {
        logger.warn(`扇区索引无效: ${currentSector}`)
        break
      }

      const offset = this.sectorToOffset(fat[currentSector], header)

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
    logger.log('开始使用 FIB 解析文本内容')

    const data = wordStream.data

    if (data.length < 32) {
      logger.warn('数据太短，无法解析 FIB')
      return ''
    }

    const magic = data[0] | (data[1] << 8)
    logger.log(`Magic: 0x${magic.toString(16)}`)

    if (magic !== 0xa5ec && magic !== 0xa5eb) {
      logger.warn('Magic 不匹配')
      return ''
    }

    const csw = data[2] | (data[3] << 8)
    const fibBaseOffset = 4 + csw * 2

    logger.log(`CSW: ${csw}, FibBaseOffset: ${fibBaseOffset}`)

    if (fibBaseOffset + 100 > data.length) {
      logger.warn('FIB 偏移越界')
      return ''
    }

    const fibMagic = data[fibBaseOffset] | (data[fibBaseOffset + 1] << 8)
    logger.log(`FIB Magic: 0x${fibMagic.toString(16)}`)

    if (fibMagic !== 0x000d && fibMagic !== 0x000c) {
      logger.warn('FIB Magic 不匹配')
      return ''
    }

    let fib = {
      magic: fibMagic,
      csw,
      fibRgFcLcb97Offset: 0,
      fcClx: 0,
      lcbClx: 0,
      fcMin: 0,
      fcMax: 0
    }

    let cslw = data[fibBaseOffset + 4] | (data[fibBaseOffset + 5] << 8)
    let cb = data[fibBaseOffset + 2] | (data[fibBaseOffset + 3] << 8)
    
    fib.fibRgFcLcb97Offset = fibBaseOffset + 32 + cslw * 2

    logger.log(`FibRgFcLcb97 offset: ${fib.fibRgFcLcb97Offset}, CSW: ${cslw}, CB: ${cb}`)

    if (fib.fibRgFcLcb97Offset + 220 > data.length) {
      logger.warn('FibRgFcLcb97 offset 越界，尝试备选方法')
      return this.extractTextSimple(data)
    }

    fib.fcClx = data[fib.fibRgFcLcb97Offset + 28] | 
                 (data[fib.fibRgFcLcb97Offset + 29] << 8) | 
                 (data[fib.fibRgFcLcb97Offset + 30] << 16) | 
                 (data[fib.fibRgFcLcb97Offset + 31] << 24)

    fib.lcbClx = data[fib.fibRgFcLcb97Offset + 32] | 
                  (data[fib.fibRgFcLcb97Offset + 33] << 8) | 
                  (data[fib.fibRgFcLcb97Offset + 34] << 16) | 
                  (data[fib.fibRgFcLcb97Offset + 35] << 24)

    logger.log(`FcClx: ${fib.fcClx}, LcbClx: ${fib.lcbClx}`)

    if (fib.lcbClx > 0 && fib.fcClx + fib.lcbClx <= data.length) {
      const clxData = data.subarray(fib.fcClx, fib.fcClx + fib.lcbClx)
      const textFromClx = this.parseClx(clxData, data)
      
      if (textFromClx.length > 0) {
        logger.log(`从 Clx 结构中提取到 ${textFromClx.length} 字符`)
        return textFromClx
      }
    }

    logger.log('Clx 解析失败，尝试备选方法')
    return this.extractTextSimple(data)
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

  private extractTextSimple(data: Uint8Array): string {
    logger.log('使用简单文本提取方法')

    const paragraphs: string[] = []
    let currentParagraph = ''

    const maxBytes = Math.min(data.length, 500000)

    for (let i = 0; i < maxBytes - 1; i++) {
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

      if (byte1 >= 0x00 && byte1 <= 0xFF && byte2 >= 0x00 && byte2 <= 0xFF) {
        const charCode = (byte2 << 8) | byte1

        if (charCode >= 0x4E00 && charCode <= 0x9FFF) {
          currentParagraph += String.fromCharCode(charCode)
          i++
          continue
        }

        if ([0x3001, 0x3002, 0xFF0C, 0xFF0E, 0x300A, 0x300B,
             0x2018, 0x2019, 0x201C, 0x201D, 0xFF08, 0xFF09,
             0xFF1F, 0xFF01].includes(charCode)) {
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
        
        if (cleanP.includes('清川') || cleanP.includes('讯问')) {
          foundStart = true
          filteredStart.push(cleanP)
          continue
        }
        
        if (cleanP.includes('监') && cleanP.includes('委')) {
          foundStart = true
          filteredStart.push(cleanP)
          continue
        }
        
        if (cleanP.includes('笔') && cleanP.includes('录')) {
          foundStart = true
          filteredStart.push(cleanP)
          continue
        }
        
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
        filteredStart.push(this.cleanParagraph(p))
      }
    }

    if (!foundStart) {
      filteredStart.push(...paragraphs.slice(0, 3).map(p => this.cleanParagraph(p)))
    }

    const junkCharsPattern = /[一伀倀藠俹醫蠀耀頀琀餀栀儀騀甀攀爀愀氀攀漀漀渀]/g
    
    const filtered = filteredStart.filter(p => {
      if (p.length < 2) return false
      
      const junkMatches = p.match(junkCharsPattern) || []
      const chineseMatches = p.match(/[\u4e00-\u9fff]/g) || []
      
      if (junkMatches.length > 2 && junkMatches.length >= chineseMatches.length) {
        return false
      }
      
      const validChinese = ['清', '川', '市', '监', '察', '委', '员', '会', '讯', '问', '笔', '录', 
                           '时', '间', '分', '地', '点', '人', '性', '别', '年', '龄', '岁',
                           '工', '作', '单', '位', '职', '务', '总', '经', '理', '政', '治',
                           '面', '貌', '群', '众', '联', '系', '方', '式', '住', '址']
      
      const hasValidChinese = validChinese.some(char => p.includes(char))
      if (junkMatches.length > 0 && !hasValidChinese) {
        return false
      }
      
      const upperP = p.toUpperCase()
      const skipPatterns = ['ROOT', 'SUMMARY', 'DOCUMENT', 'WORD', 'WPS', 'MICROSOFT',
                            'PROPERTY', 'STORAGE', 'STREAM', 'TABLE', 'FORMAT',
                            'XMLDATA', 'BASE64', 'TEMPLATE', 'REGISTRY']

      for (const pattern of skipPatterns) {
        if (upperP.includes(pattern)) return false
      }

      if (chineseMatches.length > 0) return true

      if (/[a-zA-Z]{3,}/.test(p) && !/^[A-Z0-9_]+$/.test(p)) return true

      return chineseMatches.length >= 1
    })

    const result = filtered.join('\n\n').trim()

    logger.log(`最终文本长度: ${result.length} 字符`)

    return result
  }

  private cleanParagraph(p: string): string {
    let cleaned = p.trim()
    
    const firstChineseIndex = cleaned.search(/[\u4e00-\u9fff]/)
    
    if (firstChineseIndex > 0) {
      const beforeChinese = cleaned.substring(0, firstChineseIndex)
      const hasOnlyAsciiAndSymbols = /^[A-Z0-9!"#$%&'()*+,\-./:;<=>?@\s_]+$/.test(beforeChinese)
      
      if (hasOnlyAsciiAndSymbols && firstChineseIndex > 2) {
        cleaned = cleaned.substring(firstChineseIndex)
      }
    }
    
    const junkChars = /^[一伀倀藠俹醫蠀耀頀琀餀栀儀騀甀攀爀愀氀攀漀漀渀]+/
    cleaned = cleaned.replace(junkChars, '')
    
    return cleaned.trim()
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

export function enableDebugMode() {
  logger.info('调试模式已启用')
}
