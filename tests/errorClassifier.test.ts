import { describe, it, expect } from 'vitest'
import { classifyError, ERROR_CATEGORY_ICON } from '../src/utils/errorClassifier'

describe('errorClassifier', () => {
  describe('classifyError - 网络错误分类', () => {
    it('Failed to fetch 错误应分类为 network', () => {
      const result = classifyError('Failed to fetch')
      expect(result.category).toBe('network')
      expect(result.retryable).toBe(true)
      expect(result.suggestions.length).toBeGreaterThan(0)
    })

    it('CORS 错误应分类为 network', () => {
      const result = classifyError('CORS policy blocked the request')
      expect(result.category).toBe('network')
    })

    it('HTTP 404 错误应分类为 network', () => {
      const result = classifyError('HTTP 404: Not Found')
      expect(result.category).toBe('network')
    })

    it('HTTP 500 错误应分类为 network', () => {
      const result = classifyError('HTTP 500: Internal Server Error')
      expect(result.category).toBe('network')
    })

    it('Error 对象应被正确处理', () => {
      const err = new Error('Failed to fetch resource')
      const result = classifyError(err)
      expect(result.category).toBe('network')
      expect(result.raw).toBe('Failed to fetch resource')
    })

    it('英文环境下应返回英文提示', () => {
      const result = classifyError('Failed to fetch', 'en')
      expect(result.title).toBe('Unable to load file')
      expect(result.suggestions[0]).toContain('URL')
    })
  })

  describe('classifyError - 格式不支持', () => {
    it('.docx 提及应分类为 format', () => {
      const result = classifyError('File appears to be .docx (zip-based)')
      expect(result.category).toBe('format')
      expect(result.retryable).toBe(false)
    })

    it('英文环境下应返回英文 format 提示', () => {
      const result = classifyError('File appears to be .docx', 'en')
      expect(result.title).toBe('Unsupported file format')
      expect(result.detail).toContain('OLE2/CFB')
      expect(result.suggestions[0]).toContain('docx')
      expect(result.retryable).toBe(false)
    })

    it('OLE 签名无效应分类为 format', () => {
      const result = classifyError('Not a valid OLE2 file')
      expect(result.category).toBe('format')
    })

    it('不支持的格式应分类为 format', () => {
      const result = classifyError('Unsupported format')
      expect(result.category).toBe('format')
    })
  })

  describe('classifyError - 文件损坏', () => {
    it('未找到 WordDocument 流应分类为 corrupted', () => {
      const result = classifyError('未找到 WordDocument 流')
      expect(result.category).toBe('corrupted')
      expect(result.retryable).toBe(true)
    })

    it('内容为空应分类为 corrupted', () => {
      const result = classifyError('文档内容为空')
      expect(result.category).toBe('corrupted')
    })

    it('corrupt 关键字应分类为 corrupted', () => {
      const result = classifyError('File is corrupt')
      expect(result.category).toBe('corrupted')
    })

    it('英文环境下应返回英文 corrupted 提示', () => {
      const result = classifyError('WordDocument stream not found', 'en')
      expect(result.title).toBe('File may be corrupted')
      expect(result.detail).toContain('file structure')
      expect(result.suggestions[0]).toContain('re-downloading')
      expect(result.retryable).toBe(true)
    })
  })

  describe('classifyError - 文件大小限制', () => {
    it('50 MiB input limit is actionable and not retryable', () => {
      const result = classifyError('文件超过最大支持大小（50 MiB）')
      expect(result.category).toBe('size')
      expect(result.title).toBe('文件超过大小限制')
      expect(result.detail).toContain('50 MiB')
      expect(result.retryable).toBe(false)
      expect(result.suggestions[0]).toContain('小于 50 MiB')
    })

    it('English locale explains a fixed maximum size without retry advice', () => {
      const result = classifyError('Exceeds maximum supported size', 'en')
      expect(result.category).toBe('size')
      expect(result.title).toBe('File exceeds size limit')
      expect(result.detail).toContain('50 MiB')
      expect(result.retryable).toBe(false)
    })
  })

  describe('classifyError - 渲染错误', () => {
    it('classifies the English render boundary and retains the cause', () => {
      const result = classifyError('❌ Error rendering document\n\nCanvas failed', 'en')
      expect(result.category).toBe('render')
      expect(result.title).toBe('Document could not be displayed')
      expect(result.detail).toContain('preview could not render')
      expect(result.suggestions[0]).toContain('reload')
      expect(result.raw).toContain('Canvas failed')
      expect(result.retryable).toBe(true)
    })

    it('classifies the Chinese render boundary', () => {
      const result = classifyError('❌ 渲染文档时发生错误\n\n画布失败', 'zh-CN')
      expect(result.category).toBe('render')
      expect(result.title).toBe('文档无法显示')
      expect(result.detail).toContain('预览内容无法渲染')
      expect(result.raw).toContain('画布失败')
    })
  })

  describe('classifyError - 内存不足', () => {
    it('out of memory 应分类为 memory', () => {
      const result = classifyError('Out of memory')
      expect(result.category).toBe('memory')
      expect(result.retryable).toBe(false)
    })

    it('maximum call stack 应分类为 memory', () => {
      const result = classifyError('Maximum call stack size exceeded')
      expect(result.category).toBe('memory')
    })

    it('英文环境下应返回英文 memory 提示', () => {
      const result = classifyError('Out of memory', 'en')
      expect(result.title).toBe('File too large')
      expect(result.detail).toContain('memory')
      expect(result.suggestions[0]).toContain('smaller file')
      expect(result.retryable).toBe(false)
    })
  })

  describe('classifyError - 解析错误', () => {
    it('parse 关键字应分类为 parse', () => {
      const result = classifyError('Failed to parse FIB header')
      expect(result.category).toBe('parse')
      expect(result.retryable).toBe(true)
    })

    it('SPRM 关键字应分类为 parse', () => {
      const result = classifyError('Invalid SPRM code')
      expect(result.category).toBe('parse')
    })

    it('解析失败 关键字应分类为 parse', () => {
      const result = classifyError('解析失败: 未知错误')
      expect(result.category).toBe('parse')
    })

    it('英文环境下应返回英文 parse 提示', () => {
      const result = classifyError('Failed to parse FIB', 'en')
      expect(result.title).toBe('Failed to parse document')
      expect(result.detail).toContain('parsing')
      expect(result.suggestions[0]).toContain('sub-format')
      expect(result.retryable).toBe(true)
    })
  })

  describe('classifyError - 未知错误', () => {
    it('无匹配关键字应分类为 unknown', () => {
      const result = classifyError('一些奇怪的错误消息')
      expect(result.category).toBe('unknown')
      expect(result.retryable).toBe(true)
    })

    it('空字符串应分类为 unknown', () => {
      const result = classifyError('')
      expect(result.category).toBe('unknown')
    })

    it('null/undefined 应分类为 unknown', () => {
      const result = classifyError(null)
      expect(result.category).toBe('unknown')
    })

    it('英文环境下应返回英文 unknown 提示', () => {
      const result = classifyError('some odd message', 'en')
      expect(result.title).toBe('Unknown error')
      expect(result.detail).toBe('some odd message')
      expect(result.suggestions[0]).toContain('reloading')
      expect(result.retryable).toBe(true)
    })

    it('空错误在英文环境下应有默认描述', () => {
      const result = classifyError('', 'en')
      expect(result.detail).toContain('unexpected error')
    })
  })

  describe('ERROR_CATEGORY_ICON', () => {
    it('应包含所有类别的图标', () => {
      expect(ERROR_CATEGORY_ICON.network).toBeTruthy()
      expect(ERROR_CATEGORY_ICON.format).toBeTruthy()
      expect(ERROR_CATEGORY_ICON.parse).toBeTruthy()
      expect(ERROR_CATEGORY_ICON.corrupted).toBeTruthy()
      expect(ERROR_CATEGORY_ICON.render).toBeTruthy()
      expect(ERROR_CATEGORY_ICON.size).toBeTruthy()
      expect(ERROR_CATEGORY_ICON.memory).toBeTruthy()
      expect(ERROR_CATEGORY_ICON.unknown).toBeTruthy()
    })
  })
})
