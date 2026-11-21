/**
 * useExport —— 打印 / TXT / HTML / Markdown 导出 / 富文本复制。
 *
 * 从 DocPreview.vue 原样搬迁，只把组件状态改为显式注入的 ref，保持
 * 下载文件名、print CSS、剪贴板三级降级与 ✓ 反馈定位契约不变。
 */
import type { Ref } from 'vue'
import { escapeHtml } from '../utils/textRender'
import { htmlToMarkdown } from '../utils/markdownExport'
import { buildPrintWindowHtml } from '../utils/rendering/printLayout'
import type { Translator } from '../utils/docFormat'

export interface UseExportOptions {
  fileName: Ref<string>
  plainText: Ref<string>
  htmlContent: Ref<string>
  previewRef: Ref<HTMLElement | null>
  toolbarRef: Ref<{ $el?: Element | null } | null>
  t: Translator
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export function useExport(options: UseExportOptions) {
  const { fileName, plainText, htmlContent, previewRef, toolbarRef, t } = options

  function exportBaseName(): string {
    return fileName.value.replace(/\.(doc|dot)$/i, '') || 'document'
  }

  function printDocument(): void {
    if (!htmlContent.value) return
    const printWindow = window.open('', '_blank')
    if (!printWindow) {
      globalThis.alert(t('print.popupBlocked'))
      return
    }
    const printContent = buildPrintWindowHtml({
      title: escapeHtml(fileName.value || 'DOC Preview'),
      labels: { prefix: t('print.p1'), middle: t('print.p2'), suffix: t('print.p3') },
      bodyHtml: htmlContent.value,
    })
    printWindow.addEventListener('load', () => {
      setTimeout(() => {
        printWindow.print()
        printWindow.close()
      }, 500)
    }, { once: true })
    printWindow.document.write(printContent)
    printWindow.document.close()
  }

  function downloadText(): void {
    if (!plainText.value) return
    downloadBlob(new Blob([plainText.value], { type: 'text/plain;charset=utf-8' }), `${exportBaseName()}.txt`)
  }

  function downloadHtml(): void {
    if (!htmlContent.value) return
    const htmlTemplate = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(fileName.value || 'DOC Preview')}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 40px 20px; line-height: 1.8; color: #333; background: #f5f5f5; }
    .document-content { background: white; padding: 60px; box-shadow: 0 1px 4px rgba(0,0,0,0.12); }
    h1, h2, h3, h4, h5, h6 { margin-top: 24px; margin-bottom: 12px; font-weight: 600; }
    p { margin-bottom: 16px; }
    ul, ol { margin-left: 24px; margin-bottom: 16px; }
    table { border-collapse: collapse; width: 100%; margin-bottom: 16px; }
    td, th { border: 1px solid #ddd; padding: 8px 12px; }
    tr:nth-child(even) { background-color: #f9f9f9; }
    a { color: #667eea; text-decoration: underline; }
    .search-highlight { background-color: #ffeb3b; }
    .search-highlight-current { background-color: #f44336; color: white; }
    @media print { body { background: white; padding: 0; max-width: none; } .document-content { box-shadow: none; padding: 0; } }
  </style>
</head>
<body>
  <div class="document-content">
    ${htmlContent.value}
  </div>
</body>
</html>`
    downloadBlob(new Blob([htmlTemplate], { type: 'text/html;charset=utf-8' }), `${exportBaseName()}.html`)
  }

  function downloadMarkdown(): void {
    if (!htmlContent.value) return
    downloadBlob(
      new Blob([htmlToMarkdown(htmlContent.value)], { type: 'text/markdown;charset=utf-8' }),
      `${exportBaseName()}.md`,
    )
  }

  async function copyText(): Promise<void> {
    if (!plainText.value) return

    const tryRichCopy = async () => {
      if (!htmlContent.value) return false
      if (typeof ClipboardItem === 'undefined' || typeof navigator.clipboard?.write !== 'function') return false
      try {
        const blob = new Blob([htmlContent.value], { type: 'text/html' })
        await navigator.clipboard.write([new ClipboardItem({ 'text/html': blob })])
        return true
      } catch {
        return false
      }
    }

    const tryExecCommandCopy = () => {
      const container = previewRef.value?.querySelector('.document-content')
      if (!container) return false
      try {
        const range = document.createRange()
        range.selectNodeContents(container)
        const selection = window.getSelection()
        selection?.removeAllRanges()
        selection?.addRange(range)
        const successful = document.execCommand('copy')
        selection?.removeAllRanges()
        return successful
      } catch {
        return false
      }
    }

    const tryPlainCopy = async () => {
      try {
        await navigator.clipboard.writeText(plainText.value)
        return true
      } catch {
        const ta = document.createElement('textarea')
        ta.value = plainText.value
        ta.style.position = 'fixed'
        ta.style.opacity = '0'
        document.body.appendChild(ta)
        ta.select()
        const successful = document.execCommand('copy')
        document.body.removeChild(ta)
        return successful
      }
    }

    const showCopySuccess = () => {
      const btn = toolbarRef.value?.$el?.querySelector('.toolbar-btn[data-action="copy-text"]') as HTMLElement | null
      if (btn) {
        const originalText = btn.innerHTML
        btn.innerHTML = '✓'
        setTimeout(() => { btn.innerHTML = originalText }, 2000)
      }
    }

    if (await tryRichCopy()) return showCopySuccess()
    if (tryExecCommandCopy()) return showCopySuccess()
    if (await tryPlainCopy()) return showCopySuccess()
  }

  return { printDocument, downloadText, downloadHtml, downloadMarkdown, copyText }
}
