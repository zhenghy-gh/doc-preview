/**
 * 错误分类与友好提示工具
 * 将底层错误信息分类为用户可理解的提示，附带解决建议
 */

export type ErrorCategory =
  | 'network'
  | 'format'
  | 'parse'
  | 'corrupted'
  | 'memory'
  | 'unknown'

export interface ClassifiedError {
  category: ErrorCategory
  /** 友好标题（不含技术细节） */
  title: string
  /** 详细描述 */
  detail: string
  /** 解决建议列表 */
  suggestions: string[]
  /** 是否可重试 */
  retryable: boolean
  /** 原始错误信息（用于调试） */
  raw?: string
}

/** 判断字符串中是否包含任意关键字 */
function containsAny(text: string, keywords: string[]): boolean {
  return keywords.some((k) => text.includes(k))
}

/**
 * 对原始错误信息进行分类
 * @param rawError 原始错误信息（字符串或 Error 对象）
 * @param locale 语言（'zh-CN' | 'en'），默认中文
 */
export function classifyError(
  rawError: string | Error | unknown,
  locale: 'zh-CN' | 'en' = 'zh-CN',
): ClassifiedError {
  const rawText =
    rawError instanceof Error
      ? rawError.message
      : typeof rawError === 'string'
        ? rawError
        : String(rawError || '')

  const lower = rawText.toLowerCase()
  const isEN = locale === 'en'

  // 1. 网络错误
  if (
    containsAny(lower, ['failed to fetch', 'networkerror', 'network error']) ||
    containsAny(lower, ['load failed', 'cors', 'cross-origin']) ||
    containsAny(lower, ['http 4', 'http 5', '403', '404', '500', '502', '503'])
  ) {
    return {
      category: 'network',
      title: isEN ? 'Unable to load file' : '无法加载文件',
      detail: isEN
        ? `A network or HTTP error occurred: ${rawText}`
        : `网络或 HTTP 错误：${rawText}`,
      suggestions: isEN
        ? [
            'Check if the URL is reachable',
            'The server may require CORS headers (Access-Control-Allow-Origin)',
            'Try downloading the file and opening it locally',
            'HTTP 4xx/5xx indicates a server-side issue',
          ]
        : [
            '检查地址是否可访问',
            '服务器可能未配置 CORS 跨域头（Access-Control-Allow-Origin）',
            '尝试下载文件后本地打开',
            'HTTP 4xx/5xx 表示服务器端问题',
          ],
      retryable: true,
      raw: rawText,
    }
  }

  // 2. 格式不支持（.docx、.rtf、未知格式）
  if (
    containsAny(lower, ['.docx', 'docx', 'zip-based', 'ooxml']) ||
    containsAny(lower, ['not a valid ole', 'invalid ole', 'ole signature']) ||
    containsAny(lower, ['unsupported format', 'unknown format'])
  ) {
    return {
      category: 'format',
      title: isEN ? 'Unsupported file format' : '不支持的文件格式',
      detail: isEN
        ? 'This tool only supports legacy .doc files (OLE2/CFB format).'
        : '本工具仅支持传统 .doc 文件（OLE2/CFB 复合文档格式）。',
      suggestions: isEN
        ? [
            '.docx files are not supported — please use a .doc file',
            '.rtf / .txt / .odt files are not supported',
            'On macOS, use Word or Pages to save as .doc',
          ]
        : [
            '不支持 .docx 文件 —— 请使用 .doc 格式',
            '不支持 .rtf / .txt / .odt 等格式',
            '在 macOS 上可用 Word 或 Pages 另存为 .doc',
          ],
      retryable: false,
      raw: rawText,
    }
  }

  // 3. 文件损坏
  if (
    containsAny(lower, ['worddocument', 'stream not found', '未找到']) ||
    containsAny(lower, ['empty', 'is empty', '内容为空', '文档内容为空']) ||
    containsAny(lower, ['corrupt', 'damaged', 'invalid sector', 'fat chain'])
  ) {
    return {
      category: 'corrupted',
      title: isEN ? 'File may be corrupted' : '文件可能已损坏',
      detail: isEN
        ? `The file structure could not be parsed: ${rawText}`
        : `无法解析文件结构：${rawText}`,
      suggestions: isEN
        ? [
            'Try re-downloading or re-saving the file',
            'Open in Microsoft Word and "Save As" .doc again',
            'The file may use an uncommon sub-format',
          ]
        : [
            '尝试重新下载或重新保存文件',
            '在 Microsoft Word 中打开后"另存为" .doc',
            '文件可能使用了不常见的子格式',
          ],
      retryable: true,
      raw: rawText,
    }
  }

  // 4. 内存不足
  if (
    containsAny(lower, ['out of memory', 'maximum call stack', 'rangeerror']) ||
    containsAny(lower, ['allocation failed'])
  ) {
    return {
      category: 'memory',
      title: isEN ? 'File too large' : '文件过大',
      detail: isEN
        ? 'The browser ran out of memory while parsing this file.'
        : '浏览器在解析此文件时内存不足。',
      suggestions: isEN
        ? [
            'Try a smaller file',
            'Close other browser tabs to free memory',
            'Use a desktop app for very large documents',
          ]
        : [
            '尝试使用较小的文件',
            '关闭其他浏览器标签页释放内存',
            '超大文档请使用桌面应用处理',
          ],
      retryable: false,
      raw: rawText,
    }
  }

  // 5. 解析错误（通用）
  if (containsAny(lower, ['parse', '解析', 'fib', 'clx', 'sprm'])) {
    return {
      category: 'parse',
      title: isEN ? 'Failed to parse document' : '解析文档失败',
      detail: isEN
        ? `An error occurred during parsing: ${rawText}`
        : `解析过程中发生错误：${rawText}`,
      suggestions: isEN
        ? [
            'The file may use an uncommon .doc sub-format',
            'Try opening in Word and re-saving',
            'Check if the file can be opened in LibreOffice',
          ]
        : [
            '文件可能使用了不常见的 .doc 子格式',
            '尝试在 Word 中打开后重新保存',
            '检查文件是否能在 LibreOffice 中打开',
          ],
      retryable: true,
      raw: rawText,
    }
  }

  // 6. 未知错误
  return {
    category: 'unknown',
    title: isEN ? 'Unknown error' : '未知错误',
    detail: rawText || (isEN ? 'An unexpected error occurred' : '发生了未预期的错误'),
    suggestions: isEN
      ? [
          'Try reloading the page',
          'Try a different file',
          'Check browser console for details',
        ]
      : ['尝试刷新页面', '尝试使用其他文件', '查看浏览器控制台获取详细信息'],
    retryable: true,
    raw: rawText,
  }
}

/** 错误类别图标 */
export const ERROR_CATEGORY_ICON: Record<ErrorCategory, string> = {
  network: '🌐',
  format: '📄',
  parse: '⚙️',
  corrupted: '🔧',
  memory: '💾',
  unknown: '❌',
}
