/**
 * 打印布局纯函数（从 `DocPreview.vue#printDocument` 抽出）。
 *
 * 设计约束（docs/CONTRACT-split-r1.md）：本文件不得 import vue / .vue、不得触
 * DOM / window，可在 Node 下直接用 esbuild 打包调用——`scripts/printPageAudit.mjs`
 * 即依赖这一点生成可重复的打印 HTML 对照审计。
 *
 * 注意：`title` 由调用方先用 `escapeHtml()` 转义（含 DOM 依赖，故不放在本文件），
 * 本模块只负责把它写入 `@top-center` 的 CSS content 字符串与 `<title>`。
 */

export interface PrintLayoutLabels {
  /** `t('print.p1')`，如 "第 " */
  prefix: string
  /** `t('print.p2')`，如 " 页 / 共 " */
  middle: string
  /** `t('print.p3')`，如 " 页" */
  suffix: string
}

export interface PrintPageCssOptions {
  /** 已转义的文档标题（escapeHtml 结果），写入 `@top-center` content */
  title: string
  labels: PrintLayoutLabels
}

export interface PrintWindowHtmlOptions extends PrintPageCssOptions {
  /** 预览区 HTML（逐页 `.page-content` 容器），原样写入 `.document-content` */
  bodyHtml: string
  lang?: string
}

/**
 * 构建打印样式表文本。与原 `printDocument()` 内联的 `<style>` 内容一致；
 * 返回值包含每行缩进与结尾换行，调用方直接拼进 `<style>` 标签即可。
 */
export function buildPrintPageCss({ title, labels }: PrintPageCssOptions): string {
  const { prefix, middle, suffix } = labels
  return `    @page {
      size: A4;
      margin: 25mm 20mm 25mm 20mm;
      @top-center {
        content: "${title}";
        font-size: 10pt;
        color: #666;
      }
      @bottom-center {
        content: "${prefix}" counter(page) "${middle}" counter(pages) "${suffix}";
        font-size: 10pt;
        color: #666;
      }
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      line-height: 1.8;
      color: #333;
      margin: 0;
      padding: 0;
    }
    .document-content {
      font-size: 11pt;
    }
    h1 { font-size: 18pt; font-weight: 600; margin-top: 0; margin-bottom: 12pt; }
    h2 { font-size: 16pt; font-weight: 600; margin-top: 24pt; margin-bottom: 10pt; }
    h3 { font-size: 14pt; font-weight: 600; margin-top: 20pt; margin-bottom: 8pt; }
    h4, h5, h6 { font-size: 12pt; font-weight: 600; margin-top: 16pt; margin-bottom: 6pt; }
    p { margin-bottom: 12pt; }
    ul, ol { margin-left: 20pt; margin-bottom: 12pt; }
    li { margin-bottom: 4pt; }
    table {
      border-collapse: collapse;
      width: 100%;
      margin-bottom: 12pt;
      font-size: 10pt;
    }
    td, th {
      border: 1px solid #ccc;
      padding: 6pt 8pt;
      vertical-align: top;
    }
    th {
      background-color: #f5f5f5;
      font-weight: 600;
    }
    a {
      color: #667eea;
      text-decoration: underline;
    }
    img {
      max-width: 100%;
      height: auto;
    }
    .page-break {
      page-break-before: always;
    }
    .search-highlight {
      background-color: #ffeb3b;
    }
    @media screen {
      body {
        padding: 40px;
        max-width: 800px;
        margin: 0 auto;
        background: #f5f5f5;
      }
      .document-content {
        background: white;
        padding: 60px;
        box-shadow: 0 1px 4px rgba(0,0,0,0.12);
      }
    }
`
}

/** 构建完整打印窗口 HTML（doctype + <head><style> + `.document-content` 正文）。 */
export function buildPrintWindowHtml(options: PrintWindowHtmlOptions): string {
  const { title, labels, bodyHtml, lang = 'zh-CN' } = options
  return `<!DOCTYPE html>
<html lang="${lang}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <style>
${buildPrintPageCss({ title, labels })}  </style>
</head>
<body>
  <div class="document-content">
    ${bodyHtml}
  </div>
</body>
</html>`
}
