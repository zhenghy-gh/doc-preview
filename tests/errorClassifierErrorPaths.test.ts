// @vitest-environment happy-dom
/**
 * 错误路径分类回归（Phase 3 / 任务 B）。
 *
 * 覆盖 .docx / 损坏 OLE / 超大文件 / 网络失败 / 超时五条路径，
 * 校验中英双语文案与 retryable 标记；并钉死 ErrorDisplay 的按钮契约。
 *
 * 负控：撤回 errorClassifier 的中文格式关键字修复后，
 * 「无法识别的文件格式」「不是有效的 OLE 复合文档格式」两项会失败。
 */
import { describe, it, expect, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { classifyError, ERROR_CATEGORY_ICON, type ErrorCategory } from '../src/utils/errorClassifier'
import { setLocale } from '../src/utils/locale'
import ErrorDisplay from '../src/components/ErrorDisplay.vue'

afterEach(() => setLocale('zh-CN'))

type Case = {
  name: string
  raw: string | Error
  category: ErrorCategory
  retryable: boolean
  zhTitle: string
  enTitle: string
}

const CASES: Case[] = [
  {
    name: '.docx / zip-based',
    raw: 'File appears to be .docx (zip-based)',
    category: 'format',
    retryable: false,
    zhTitle: '不支持的文件格式',
    enTitle: 'Unsupported file format',
  },
  {
    name: '中文 .docx 提示（getFormatErrorString 真实文案）',
    raw: '不支持 .docx 格式。\n\n此工具仅支持旧版 OLE2 格式的 .doc 文件。',
    category: 'format',
    retryable: false,
    zhTitle: '不支持的文件格式',
    enTitle: 'Unsupported file format',
  },
  {
    name: '中文无法识别格式（负控）',
    raw: '无法识别的文件格式。\n\n请确认文件是有效的 Word 97-2003 (.doc) 文件。',
    category: 'format',
    retryable: false,
    zhTitle: '不支持的文件格式',
    enTitle: 'Unsupported file format',
  },
  {
    name: '中文损坏 OLE 签名（负控）',
    raw: '文件不是有效的 OLE 复合文档格式。\n\n请确认文件是 Word 97-2003 (.doc) 格式。',
    category: 'format',
    retryable: false,
    zhTitle: '不支持的文件格式',
    enTitle: 'Unsupported file format',
  },
  {
    name: 'XML 头伪装 .doc',
    raw: '文件包含 XML 格式头，可能不是有效的 .doc 文件。',
    category: 'format',
    retryable: false,
    zhTitle: '不支持的文件格式',
    enTitle: 'Unsupported file format',
  },
  {
    name: '损坏 OLE：缺失 WordDocument 流',
    raw: '未找到 WordDocument 流',
    category: 'corrupted',
    retryable: true,
    zhTitle: '文件可能已损坏',
    enTitle: 'File may be corrupted',
  },
  {
    name: '损坏 OLE：FAT 链错误',
    raw: 'Invalid sector in FAT chain',
    category: 'corrupted',
    retryable: true,
    zhTitle: '文件可能已损坏',
    enTitle: 'File may be corrupted',
  },
  {
    name: '超大文件 / 内存不足',
    raw: new Error('OutOfMemoryError: allocation failed'),
    category: 'memory',
    retryable: false,
    zhTitle: '文件过大',
    enTitle: 'File too large',
  },
  {
    name: '网络失败：fetch',
    raw: new Error('Failed to fetch'),
    category: 'network',
    retryable: true,
    zhTitle: '无法加载文件',
    enTitle: 'Unable to load file',
  },
  {
    name: '网络失败：CORS',
    raw: 'CORS policy blocked',
    category: 'network',
    retryable: true,
    zhTitle: '无法加载文件',
    enTitle: 'Unable to load file',
  },
  {
    name: '加载超时：中文文案',
    raw: '加载超时：服务器长时间无响应，请检查地址是否可访问或稍后重试',
    category: 'network',
    retryable: true,
    zhTitle: '无法加载文件',
    enTitle: 'Unable to load file',
  },
  {
    name: '加载超时：TimeoutError',
    raw: new DOMException('加载超时（60 秒无响应）', 'TimeoutError'),
    category: 'network',
    retryable: true,
    zhTitle: '无法加载文件',
    enTitle: 'Unable to load file',
  },
  {
    name: 'Worker 解析超时仍归 parse（裸词『超时』守护）',
    raw: 'Worker 解析超时',
    category: 'parse',
    retryable: true,
    zhTitle: '解析文档失败',
    enTitle: 'Failed to parse document',
  },
]

describe('errorClassifier - 五条错误路径的中英双语与 retryable', () => {
  for (const c of CASES) {
    it(`${c.name} -> ${c.category} (retryable=${c.retryable})`, () => {
      const zh = classifyError(c.raw, 'zh-CN')
      const en = classifyError(c.raw, 'en')
      expect(zh.category, `zh category for ${c.name}`).toBe(c.category)
      expect(en.category, `en category for ${c.name}`).toBe(c.category)
      expect(zh.retryable, `zh retryable for ${c.name}`).toBe(c.retryable)
      expect(en.retryable, `en retryable for ${c.name}`).toBe(c.retryable)
      expect(zh.title, `zh title for ${c.name}`).toBe(c.zhTitle)
      expect(en.title, `en title for ${c.name}`).toBe(c.enTitle)
      expect(zh.suggestions.length).toBeGreaterThan(0)
      expect(en.suggestions.length).toBeGreaterThan(0)
      expect(ERROR_CATEGORY_ICON[c.category]).toBeTruthy()
    })
  }

  it('errorCode 优先于关键字（即使文案含 404 也不误判网络）', () => {
    const r = classifyError('offset 404 in OLE header', 'en', 'OLE_FORMAT')
    expect(r.category).toBe('format')
    expect(r.retryable).toBe(false)
  })

  it('NO_WORDDOCUMENT_STREAM 错误码映射到 corrupted 且可重试', () => {
    const r = classifyError('some raw text', 'en', 'NO_WORDDOCUMENT_STREAM')
    expect(r.category).toBe('corrupted')
    expect(r.retryable).toBe(true)
  })
})

describe('ErrorDisplay - retry 按钮与双语渲染', () => {
  it('format 类（不可重试）不渲染重试按钮', () => {
    const w = mount(ErrorDisplay, { props: { error: 'File appears to be .docx' } })
    expect(w.find('.error-title').text()).toBe('不支持的文件格式')
    expect(w.find('.error-retry-btn').exists()).toBe(false)
    expect(w.findAll('.error-suggestions li').length).toBeGreaterThan(0)
    w.unmount()
  })

  it('network 类（可重试）渲染按钮并 emit retry', async () => {
    const w = mount(ErrorDisplay, { props: { error: 'Failed to fetch' } })
    expect(w.find('.error-retry-btn').exists()).toBe(true)
    await w.find('.error-retry-btn').trigger('click')
    expect(w.emitted('retry')).toHaveLength(1)
    w.unmount()
  })

  it('英文环境渲染英文标题与建议', () => {
    setLocale('en')
    const w = mount(ErrorDisplay, { props: { error: '加载超时：服务器无响应' } })
    expect(w.find('.error-title').text()).toBe('Unable to load file')
    expect(w.find('.error-retry-btn').exists()).toBe(true)
    w.unmount()
  })

  it('中文损坏 OLE 文案不得落到 unknown（负控组件层）', () => {
    const w = mount(ErrorDisplay, { props: { error: '无法识别的文件格式。' } })
    expect(w.find('.error-title').text()).toBe('不支持的文件格式')
    expect(w.find('.error-retry-btn').exists()).toBe(false)
    w.unmount()
  })
})
