// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest'
import {
  escapeMdText,
  convertInlineToMd,
  convertBlockToMd,
  htmlToMarkdown,
} from '../src/utils/markdownExport'
import { formatRevisionTime } from '../src/utils/revisionRender'

/** 解析 HTML 片段并返回第一个子节点，便于把元素喂给纯函数。 */
function firstNode(html: string): ChildNode {
  const div = document.createElement('div')
  div.innerHTML = html
  return div.firstChild as ChildNode
}

describe('markdownExport inline edge branches', () => {
  it('escapes every Markdown special character', () => {
    expect(escapeMdText('a*b_c`d[e]f')).toBe('a\\*b\\_c\\`d\\[e\\]f')
    expect(escapeMdText('plain')).toBe('plain')
  })

  it('returns empty string for comment nodes', () => {
    expect(convertInlineToMd(document.createComment('note'))).toBe('')
  })

  it('renders images with src, and falls back to inner text without src', () => {
    const withSrc = document.createElement('img')
    withSrc.setAttribute('src', 'data:image/png;base64,x')
    withSrc.setAttribute('alt', '图表')
    expect(convertInlineToMd(withSrc)).toBe('![图表](data:image/png;base64,x)')

    const noSrc = document.createElement('img')
    noSrc.setAttribute('alt', '缺失图片')
    // 无 src 时回退到子内容（空元素 → 空串），不产生 ![alt](null) 垃圾输出
    expect(convertInlineToMd(noSrc)).toBe('')
  })

  it('preserves sub/sup as raw HTML tags', () => {
    expect(convertInlineToMd(firstNode('<sub>2</sub>'))).toBe('<sub>2</sub>')
    expect(convertInlineToMd(firstNode('<sup>n</sup>'))).toBe('<sup>n</sup>')
  })
})

describe('markdownExport block edge branches', () => {
  it('passes meaningful text nodes through but drops whitespace-only ones', () => {
    expect(convertBlockToMd(firstNode('<div>正文</div>'))).toBe('正文')
    expect(convertBlockToMd(firstNode('<div>   </div>'))).toBe('')
  })

  it('fences pre blocks with language class and falls back to raw text', () => {
    expect(convertBlockToMd(firstNode('<pre><code class="language-ts">const a = 1\n</code></pre>')))
      .toBe('```ts\nconst a = 1\n```')
    // 无 <code> 子元素时回退到 pre 自身文本
    expect(convertBlockToMd(firstNode('<pre>plain code</pre>')))
      .toBe('```\nplain code\n```')
  })

  it('maps hr to a thematic break and drops bare br blocks', () => {
    expect(convertBlockToMd(firstNode('<hr>'))).toBe('---')
    expect(convertBlockToMd(firstNode('<br>'))).toBe('')
  })

  it('exports documents without .page-content via the root-container fallback', () => {
    // 纯文本回退路径：无分页容器时遍历根容器子节点，避免导出空文件
    const md = htmlToMarkdown('<div><h1>标题</h1><p>第一段</p></div>')
    expect(md).toContain('# 标题')
    expect(md).toContain('第一段')
  })
})

describe('formatRevisionTime guards', () => {
  it('returns empty for missing or invalid timestamps', () => {
    expect(formatRevisionTime(undefined)).toBe('')
    expect(formatRevisionTime(0)).toBe('')
    expect(formatRevisionTime(NaN)).toBe('')
  })

  it('formats a valid timestamp as zero-padded local YYYY-MM-DD HH:mm', () => {
    // 用本地时间分量构造，断言与运行时区无关
    const d = new Date(2024, 0, 5, 7, 8)
    expect(formatRevisionTime(d.getTime())).toBe('2024-01-05 07:08')
    const d2 = new Date(2024, 10, 23, 14, 59)
    expect(formatRevisionTime(d2.getTime())).toBe('2024-11-23 14:59')
  })
})
