// @vitest-environment happy-dom
/**
 * 错误码透传回归（任务 A）。
 *
 * ParseResult.errorCode 是 errorClassifier 中 PARSE_ERROR_CATEGORY 直映射的
 * 唯一入口。历史上此链路有三处断点，使直映射在运行时成为死路径：
 *   ① docParser.worker.ts 的结果消息不带 errorCode（worker 路径丢失）；
 *   ② DocPreview.vue 的 ParserOutput/error ref 不保存 errorCode，ErrorDisplay
 *      也只接收 :error（UI 链路丢失）；
 *   ③ ErrorDisplay 未把 errorCode 传给 classifyError。
 *
 * 负控设计：用到「raw 文案按关键字会落到别的类别」的样例，只有 errorCode
 * 真正透传并参与分类时，才得到结构化标题。撤回任一环节相应断言即失败。
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import ErrorDisplay from '../src/components/ErrorDisplay.vue'
import { setLocale } from '../src/utils/locale'

//  hoist mock fn：vi.mock 工厂在文件顶部提升执行，需提前声明。
const parseWithFormatMock = vi.hoisted(() => vi.fn())

vi.mock('../src/utils/docParser', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/utils/docParser')>()
  return {
    ...actual,
    parseDocFileWithFormat: parseWithFormatMock,
  }
})

import DocPreview from '../src/components/DocPreview.vue'

afterEach(() => {
  setLocale('zh-CN')
  vi.unstubAllGlobals()
  parseWithFormatMock.mockReset()
})

describe('ErrorDisplay - errorCode 结构化分类（核心负控）', () => {
  it('errorCode=OLE_FORMAT 覆盖 raw 的网络关键字，显示结构化格式标题且不可重试', () => {
    // raw「Failed to fetch」无 code 时按关键字归 network（无法加载文件 + 重试按钮）。
    const w = mount(ErrorDisplay, {
      props: { error: 'Failed to fetch', errorCode: 'OLE_FORMAT' },
    })
    expect(w.find('.error-title').text()).toBe('不支持的文件格式')
    expect(w.find('.error-retry-btn').exists()).toBe(false)
    w.unmount()
  })

  it('errorCode=NO_WORDDOCUMENT_STREAM 让自由文案归 corrupted 且可重试', () => {
    // raw「some odd text」无 code 时落 unknown（未知错误）。
    const w = mount(ErrorDisplay, {
      props: { error: 'some odd text', errorCode: 'NO_WORDDOCUMENT_STREAM' },
    })
    expect(w.find('.error-title').text()).toBe('文件可能已损坏或为空')
    expect(w.find('.error-retry-btn').exists()).toBe(true)
    w.unmount()
  })

  it('无 errorCode 时保持关键字回退（协议兼容）', () => {
    const w = mount(ErrorDisplay, { props: { error: 'Failed to fetch' } })
    expect(w.find('.error-title').text()).toBe('无法加载文件')
    expect(w.find('.error-retry-btn').exists()).toBe(true)
    w.unmount()
  })
})

describe('docParser.worker - 结果消息携带 errorCode（worker 路径负控）', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('解析失败的结果消息含结构化 errorCode', async () => {
    let handler: ((e: MessageEvent) => void) | null = null
    const posted: Array<Record<string, unknown>> = []
    vi.stubGlobal('addEventListener', (type: string, fn: (e: MessageEvent) => void) => {
      if (type === 'message') handler = fn
    })
    vi.stubGlobal('postMessage', (msg: Record<string, unknown>) => posted.push(msg))

    await import('../src/utils/docParser.worker')

    // 破坏 OLE 魔数 → parseWithFormat 失败出口附带 OLE_FORMAT。
    const buf = new ArrayBuffer(512)
    new Uint8Array(buf)[0] = 0x00
    handler!({ data: { buffer: buf } } as MessageEvent)

    const result = posted.find((m) => m.type === 'result')
    expect(result, 'worker 应 post 一条 result 消息').toBeTruthy()
    expect(result!.success).toBe(false)
    expect(result!.errorCode, 'result 消息必须携带 errorCode').toBe('OLE_FORMAT')
  })
})

describe('DocPreview - 解析失败的 errorCode 端到端透传到 ErrorDisplay', () => {
  it('parseDocFileWithFormat 失败带 code → ErrorDisplay 显示结构化标题（整链负控）', async () => {
    // raw 为网络关键字，只有 errorCode 真正透传才会显示格式标题。
    parseWithFormatMock.mockResolvedValue({
      success: false,
      error: 'Failed to fetch',
      errorCode: 'OLE_FORMAT',
    })
    const file = new File([new ArrayBuffer(16)], 'bad.doc', { type: 'application/msword' })
    const wrapper = mount(DocPreview, { props: { source: file } })
    await flushPromises()
    await vi.waitFor(
      () => expect(wrapper.find('.error-title').exists()).toBe(true),
      { timeout: 5000 },
    )
    expect(wrapper.find('.error-title').text()).toBe('不支持的文件格式')
    expect(wrapper.find('.error-retry-btn').exists()).toBe(false)
    wrapper.unmount()
  })
})
