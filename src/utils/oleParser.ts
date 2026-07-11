import { logger } from './logger'

export interface OleHeader {
  minorVersion: number
  majorVersion: number
  byteOrder: number
  sectorSizePower: number
  miniSectorSizePower: number
  directorySectorsCount: number
  fatSectorsCount: number
  firstDirectorySector: number
  miniStreamCutoffSize: number
  firstMiniFatSector: number
  miniFatSectorsCount: number
  difatSectorsCount: number
  firstDifatSector: number
  difat: number[]
  [key: string]: any
}

export interface DirectoryEntry {
  name: string
  objectType: number
  startSector: number
  size: number
  nameLength: number
}

export interface StreamData {
  data: Uint8Array
  size: number
}

export type FileFormat = 'ole' | 'docx' | 'xml' | 'unknown'

const OLE_SIGNATURE = '\xD0\xCF\x11\xE0\xA1\xB1\x1A\xE1'
const ZIP_SIGNATURE = '\x50\x4B\x03\x04'
const XML_HEADER = '<?xml'

const FREESECT = -2
const ENDOFCHAIN = -1

export class OleParser {
  private buffer: ArrayBuffer
  private view: DataView
  private _header: OleHeader | null = null
  private _fat: number[] | null = null
  private _miniFat: number[] | null = null

  constructor(buffer: ArrayBuffer) {
    this.buffer = buffer
    this.view = new DataView(buffer)
  }

  /** Reset cached header/FAT — useful if you've mutated the buffer (rare). */
  resetCache() {
    this._header = null
    this._fat = null
    this._miniFat = null
  }

  // ---- Safe readers ----

  safeReadUint8(offset: number, defaultValue: number = 0): number {
    if (offset < 0 || offset >= this.buffer.byteLength) {
      logger.warn(`Uint8 越界访问: offset=${offset}, length=${this.buffer.byteLength}`)
      return defaultValue
    }
    return this.view.getUint8(offset)
  }

  safeReadUint16(offset: number, littleEndian: boolean = true, defaultValue: number = 0): number {
    if (offset < 0 || offset + 2 > this.buffer.byteLength) {
      logger.warn(`Uint16 越界访问: offset=${offset}, length=${this.buffer.byteLength}`)
      return defaultValue
    }
    return this.view.getUint16(offset, littleEndian)
  }

  safeReadInt32(offset: number, littleEndian: boolean = true, defaultValue: number = 0): number {
    if (offset < 0 || offset + 4 > this.buffer.byteLength) {
      logger.warn(`Int32 越界访问: offset=${offset}, length=${this.buffer.byteLength}`)
      return defaultValue
    }
    return this.view.getInt32(offset, littleEndian)
  }

  safeReadUint32(offset: number, littleEndian: boolean = true, defaultValue: number = 0): number {
    if (offset < 0 || offset + 4 > this.buffer.byteLength) {
      logger.warn(`Uint32 越界访问: offset=${offset}, length=${this.buffer.byteLength}`)
      return defaultValue
    }
    return this.view.getUint32(offset, littleEndian)
  }

  // ---- Format detection ----

  detectFormat(): FileFormat {
    if (this.view.byteLength < 4) return 'unknown'

    const sig4 = this._getString(0, 4)
    if (sig4 === ZIP_SIGNATURE) return 'docx'
    if (sig4.startsWith('PK')) return 'docx'

    if (this.view.byteLength >= 8) {
      const sig8 = this._getString(0, 8)
      if (sig8 === OLE_SIGNATURE) return 'ole'
    }

    const firstBytes = this._getString(0, Math.min(20, this.view.byteLength))
    if (firstBytes.startsWith(XML_HEADER)) return 'xml'

    return 'unknown'
  }

  getFormatErrorString(): string {
    const format = this.detectFormat()
    switch (format) {
      case 'docx':
        return '不支持 .docx 格式。\n\n此工具仅支持旧版 OLE2 格式的 .doc 文件。\n.docx 文件需使用其他支持 Open XML 格式的工具打开。'
      case 'xml':
        return '文件包含 XML 格式头，可能不是有效的 .doc 文件。\n\n请确认文件是 Word 97-2003 (.doc) 格式。'
      case 'unknown':
        return '无法识别的文件格式。\n\n请确认文件是有效的 Word 97-2003 (.doc) 文件。'
      default:
        return '文件不是有效的 OLE 复合文档格式。\n\n请确认文件是 Word 97-2003 (.doc) 格式。'
    }
  }

  isOleFile(): boolean {
    if (this.view.byteLength < 8) {
      logger.error(`文件太小，不是有效的 OLE 文件: ${this.view.byteLength} bytes`)
      return false
    }

    const format = this.detectFormat()
    if (format === 'docx') {
      logger.error('检测到 DOCX 格式（ZIP 压缩），此工具仅支持 OLE2 格式的 .doc 文件')
      return false
    }

    const signature = this._getString(0, 8)
    const isValid = signature === OLE_SIGNATURE
    logger.log(`OLE 签名检查: ${isValid ? '通过' : '失败'} (${signature.charCodeAt(0).toString(16)})`)
    return isValid
  }

  // ---- Header ----

  parseHeader(): OleHeader {
    if (this._header) return this._header

    logger.log('开始解析文件头')

    const header: OleHeader = {
      minorVersion: this.safeReadUint16(24),
      majorVersion: this.safeReadUint16(26),
      byteOrder: this.safeReadUint16(28),
      sectorSizePower: this.safeReadUint16(30),
      miniSectorSizePower: this.safeReadUint16(32),
      directorySectorsCount: this.safeReadUint32(40),
      fatSectorsCount: this.safeReadUint32(44),
      firstDirectorySector: this.safeReadUint32(48),
      miniStreamCutoffSize: this.safeReadUint32(56, true, 4096),
      firstMiniFatSector: this.safeReadUint32(60),
      miniFatSectorsCount: this.safeReadUint32(64),
      firstDifatSector: this.safeReadUint32(68),
      difatSectorsCount: this.safeReadUint32(72),
      difat: this._getDifat(76, 109),
    }

    logger.log(`版本: ${header.majorVersion}.${header.minorVersion}, 字节序: ${header.byteOrder}`)
    logger.log(`扇区大小: ${Math.pow(2, header.sectorSizePower)} bytes`)
    logger.log(`DIFAT 表数量: ${header.difat.length}`)

    this._header = header
    return header
  }

  getSectorSize(header: OleHeader): number {
    return Math.pow(2, header.sectorSizePower)
  }

  sectorToOffset(sector: number, header: OleHeader): number {
    return (sector + 1) * this.getSectorSize(header)
  }

  // ---- FAT ----

  getFatSectors(header: OleHeader): number[] {
    if (this._fat) return this._fat

    const sectorSize = this.getSectorSize(header)
    const entriesPerSector = sectorSize / 4
    const totalSectors = Math.ceil(this.buffer.byteLength / sectorSize)

    logger.log(`开始读取 FAT 表，共 ${header.difat.length} 个 FAT 扇区, ${totalSectors} 总扇区`)

    const fat = new Array(totalSectors).fill(FREESECT)

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
    this._fat = fat
    return fat
  }

  // ---- Directory ----

  getDirectorySectors(header: OleHeader, fat: number[]): DirectoryEntry[] {
    const directory: DirectoryEntry[] = []
    const sectorSize = this.getSectorSize(header)
    const entriesPerSector = sectorSize / 128

    logger.log(`开始读取目录表，firstDirectorySector: ${header.firstDirectorySector}`)

    let currentSector = header.firstDirectorySector
    let sectorIndex = 0

    while (currentSector >= 0 && currentSector < fat.length && fat[currentSector] !== FREESECT && sectorIndex < 1000) {
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

        const entry = this._parseDirectoryEntry(entryOffset)
        if (entry && entry.nameLength > 0) {
          directory.push(entry)
          logger.log(`找到目录条目: ${entry.name} (类型: ${entry.objectType}, 大小: ${entry.size})`)
        }
      }

      if (fat[currentSector] === ENDOFCHAIN) break
      currentSector = fat[currentSector]
    }

    logger.log(`目录表读取完成，共 ${directory.length} 个条目`)
    return directory
  }

  // ---- WordDocument stream ----

  findWordDocumentStream(directory: DirectoryEntry[]): StreamData | null {
    logger.log('开始查找 WordDocument 流')
    for (const entry of directory) {
      logger.log(`  - name="${entry.name}", type=${entry.objectType}, size=${entry.size}, startSector=${entry.startSector}`)
    }

    const wordDocEntry = directory.find(e => e.name === 'WordDocument' && e.objectType === 2)
    if (wordDocEntry) {
      logger.info('找到标准 WordDocument 流')
      return this.readStream(wordDocEntry)
    }

    logger.warn('未找到标准 WordDocument 流，尝试不区分大小写匹配')
    const caseInsensitive = directory.find(e =>
      e.name.toLowerCase().includes('worddocument') && e.objectType === 2
    )
    if (caseInsensitive) {
      logger.info(`找到近似匹配: ${caseInsensitive.name}`)
      return this.readStream(caseInsensitive)
    }

    logger.warn('搜索包含 "Word" 的流')
    const wordEntries = directory.filter(e => e.name.toLowerCase().includes('word') && e.objectType === 2)
    if (wordEntries.length > 0) {
      logger.info(`找到 ${wordEntries.length} 个包含 Word 的流，尝试第一个: ${wordEntries[0].name}`)
      return this.readStream(wordEntries[0])
    }

    logger.warn('搜索所有流对象')
    const allStreams = directory.filter(e => e.objectType === 2 && e.size > 0)
    if (allStreams.length > 0) {
      const sorted = allStreams.sort((a, b) => b.size - a.size)
      logger.warn(`尝试最大的流: ${sorted[0].name}, size=${sorted[0].size}`)
      return this.readStream(sorted[0])
    }

    logger.error('未找到任何可用的流')
    return null
  }

  /**
   * Find a stream entry by name (case-insensitive, exact match).
   * Returns the first stream object (objectType === 2) whose name matches.
   * Useful for looking up named streams like `0Table`, `1Table`, `Data`, etc.
   */
  findStreamByName(directory: DirectoryEntry[], name: string): DirectoryEntry | null {
    if (!name) return null
    const target = name.toLowerCase()
    for (const entry of directory) {
      if (entry.objectType === 2 && entry.name.toLowerCase() === target) {
        return entry
      }
    }
    return null
  }

  /**
   * Locate the table stream (`0Table` or `1Table`) used by FIB's `fcClx` etc.
   *
   * Per MS-DOC, FIB's `fWhichTblStm` flag (bit 9 of fFlags) selects which table
   * stream holds the CLX/Pcdt and other format tables:
   *   - 0 → `0Table`
   *   - 1 → `1Table`
   *
   * Falls back to whichever table stream exists if the requested one is missing,
   * so callers can still extract text from slightly malformed files.
   */
  findTableStream(directory: DirectoryEntry[], which: 0 | 1): StreamData | null {
    const primary = which === 1 ? '1Table' : '0Table'
    const fallback = which === 1 ? '0Table' : '1Table'

    const primaryEntry = this.findStreamByName(directory, primary)
    if (primaryEntry) {
      logger.info(`使用 ${primary} 流作为表格流`)
      return this.readStream(primaryEntry)
    }

    const fallbackEntry = this.findStreamByName(directory, fallback)
    if (fallbackEntry) {
      logger.warn(`未找到 ${primary}，回退到 ${fallback} 流`)
      return this.readStream(fallbackEntry)
    }

    logger.warn(`未找到任何表格流 (0Table/1Table)`)
    return null
  }

  readStream(entry: DirectoryEntry): StreamData {
    logger.log(`开始读取流: ${entry.name}, 起始扇区: ${entry.startSector}, 大小: ${entry.size}`)

    const header = this.parseHeader()
    const fat = this.getFatSectors(header)
    const miniFat = this.getMiniFatSectors(header, fat)
    const rootEntry = this.findRootEntry(header, fat)

    if (this.shouldUseMiniStream(entry, header) && rootEntry) {
      const rootStream = this.readRegularStream(rootEntry, header, fat)
      if (rootStream.size > 0) {
        const miniStream = this.readMiniStream(entry, rootStream.data, miniFat, header)
        if (miniStream.size > 0) {
          logger.info(`迷你流读取完成: ${miniStream.data.length} bytes`)
          return miniStream
        }
      }
    }

    return this.readRegularStream(entry, header, fat)
  }

  private shouldUseMiniStream(entry: DirectoryEntry, header: OleHeader): boolean {
    return entry.objectType === 2 && entry.size > 0 && entry.size < header.miniStreamCutoffSize
  }

  private findRootEntry(header: OleHeader, fat: number[]): DirectoryEntry | null {
    const directory = this.getDirectorySectors(header, fat)
    return directory.find(entry => entry.objectType === 5) || null
  }

  private readRegularStream(entry: DirectoryEntry, header: OleHeader, fat: number[]): StreamData {
    const sectorSize = this.getSectorSize(header)
    const data: number[] = []

    let currentSector = entry.startSector
    let bytesRead = 0
    const maxIterations = 1000
    let iterations = 0

    while (currentSector >= 0 && currentSector < fat.length && fat[currentSector] !== FREESECT && bytesRead < entry.size && iterations < maxIterations) {
      iterations++
      const offset = this.sectorToOffset(currentSector, header)

      if (offset < 0 || offset >= this.buffer.byteLength) {
        logger.warn(`扇区偏移越界: sector=${currentSector}, offset=${offset}`)
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

  getMiniFatSectors(header: OleHeader, fat: number[]): number[] {
    if (this._miniFat) return this._miniFat

    const sectorSize = this.getSectorSize(header)
    const entriesPerSector = sectorSize / 4
    const totalSectors = Math.ceil(this.buffer.byteLength / sectorSize)
    const miniFat = new Array(totalSectors).fill(FREESECT)

    if (header.miniFatSectorsCount <= 0 || header.firstMiniFatSector < 0) {
      this._miniFat = miniFat
      return miniFat
    }

    let currentSector = header.firstMiniFatSector
    let sectorIndex = 0
    while (currentSector >= 0 && currentSector < fat.length && fat[currentSector] !== FREESECT && sectorIndex < 1000) {
      sectorIndex++
      const offset = this.sectorToOffset(currentSector, header)
      if (offset + sectorSize > this.buffer.byteLength) {
        logger.warn(`MiniFAT 扇区 ${currentSector} 越界`)
        break
      }

      const baseSector = (sectorIndex - 1) * entriesPerSector
      for (let i = 0; i < entriesPerSector; i++) {
        const miniSector = baseSector + i
        if (miniSector >= totalSectors) break
        const entryOffset = offset + i * 4
        if (entryOffset + 4 > this.buffer.byteLength) break
        miniFat[miniSector] = this.safeReadInt32(entryOffset)
      }

      if (fat[currentSector] === ENDOFCHAIN) break
      currentSector = fat[currentSector]
    }

    this._miniFat = miniFat
    return miniFat
  }

  private readMiniStream(entry: DirectoryEntry, rootStreamData: Uint8Array, miniFat: number[], header: OleHeader): StreamData {
    const miniSectorSize = Math.pow(2, header.miniSectorSizePower)
    const data: number[] = []

    let currentMiniSector = entry.startSector
    let bytesRead = 0
    let iterations = 0
    const maxIterations = 1000

    while (currentMiniSector >= 0 && currentMiniSector < miniFat.length && miniFat[currentMiniSector] !== FREESECT && bytesRead < entry.size && iterations < maxIterations) {
      iterations++
      const offset = currentMiniSector * miniSectorSize
      if (offset < 0 || offset >= rootStreamData.length) {
        logger.warn(`迷你扇区偏移越界: miniSector=${currentMiniSector}, offset=${offset}`)
        break
      }

      const bytesToRead = Math.min(miniSectorSize, entry.size - bytesRead, rootStreamData.length - offset)
      for (let i = 0; i < bytesToRead; i++) {
        data.push(rootStreamData[offset + i])
      }

      bytesRead += bytesToRead
      currentMiniSector = miniFat[currentMiniSector]
    }

    return { data: new Uint8Array(data), size: data.length }
  }

  // ---- Private helpers ----

  private _getString(offset: number, length: number): string {
    let result = ''
    const maxOffset = Math.min(offset + length, this.buffer.byteLength)

    for (let i = offset; i < maxOffset; i++) {
      try {
        const charCode = this.view.getUint8(i)
        if (charCode !== 0) {
          result += String.fromCharCode(charCode)
        }
      } catch {
        logger.warn(`读取字符串时越界: offset=${i}`)
        break
      }
    }
    return result
  }

  private _getDifat(startOffset: number, count: number): number[] {
    const difat: number[] = []

    for (let i = 0; i < count; i++) {
      const offset = startOffset + i * 4
      if (offset + 4 > this.buffer.byteLength) {
        logger.warn(`DIFAT 表读取越界: offset=${offset}`)
        break
      }

      const sector = this.safeReadInt32(offset)
      if (sector === FREESECT || sector < 0) {
        logger.log(`DIFAT 表结束于索引 ${i}`)
        break
      }
      difat.push(sector)
    }

    return difat
  }

  private _parseDirectoryEntry(offset: number): DirectoryEntry | null {
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
      for (let i = 0; i < nameLength && offset + i + 1 < this.buffer.byteLength; i += 2) {
        const char = this.safeReadUint16(offset + i)
        if (char !== 0) {
          name += String.fromCharCode(char)
        }
      }

      name = name.trim()

      return {
        name,
        objectType,
        startSector: this.safeReadInt32(offset + 116),
        size: this.safeReadUint32(offset + 120),
        nameLength,
      }
    } catch (error) {
      logger.warn(`解析目录条目失败: ${error}`)
      return null
    }
  }
}
