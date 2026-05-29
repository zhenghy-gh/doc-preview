<script setup lang="ts">
import { ref, watch, onMounted } from 'vue'
import { parseDocFileWithFormat, parseDocFileFromBuffer } from '../utils/docParser'

const props = defineProps<{
  source: File | string | null
}>()

const fileName = ref('')
const htmlContent = ref('')
const loading = ref(true)
const error = ref('')

const loadFromFile = async (file: File) => {
  fileName.value = file.name
  loading.value = true
  error.value = ''

  try {
    const result = await parseDocFileWithFormat(file)

    if (!result.success) {
      error.value = result.error || '解析失败'
      loading.value = false
      return
    }

    renderResult(result, file.name)
  } catch (err) {
    console.error('Error parsing DOC file:', err)
    error.value = `❌ 解析失败\n\n${err instanceof Error ? err.message : '未知错误'}`
  } finally {
    loading.value = false
  }
}

const loadFromUrl = async (url: string) => {
  fileName.value = url.split('/').pop() || url
  loading.value = true
  error.value = ''

  try {
    const response = await fetch(url)
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`)
    }

    const buffer = await response.arrayBuffer()
    const result = parseDocFileFromBuffer(buffer, fileName.value)

    if (!result.success) {
      error.value = result.error || '解析失败'
      loading.value = false
      return
    }

    renderResult(result, fileName.value)
  } catch (err) {
    console.error('Error loading DOC from URL:', err)
    const msg = err instanceof Error ? err.message : '未知错误'
    if (msg.includes('HTTP') || msg.includes('Failed to fetch')) {
      error.value = `❌ 无法从地址加载文件\n\n${msg}\n\n可能原因：\n• 地址不可达或已失效\n• 跨域限制（CORS）\n• 服务器返回了错误状态码`
    } else {
      error.value = `❌ 加载失败\n\n${msg}`
    }
  } finally {
    loading.value = false
  }
}

const renderResult = (result: any, _name: string) => {
  if (result.document && result.document.paragraphs) {
    htmlContent.value = formatFormattedTextToHtml(result.document.paragraphs)
  } else if (result.text) {
    htmlContent.value = formatTextWithInferredFormat(result.text)
  } else {
    error.value = '⚠️ 文档内容为空或无法提取文本\n\n可能原因：\n• 文件格式不受支持\n• 文件已损坏\n• 文档内容为空'
  }
}

const formatFormattedTextToHtml = (paragraphs: any[]): string => {
  if (!paragraphs || paragraphs.length === 0) {
    return '<p>文档内容为空</p>'
  }

  let html = ''

  for (let i = 0; i < paragraphs.length; i++) {
    const para = paragraphs[i]
    const text = para.text
    if (!text || !text.trim()) continue

    const charFormat = para.charFormat || {}
    const paraFormat = para.paraFormat || {}

    // 从文档格式信息读取对齐方式
    let textAlign = 'justify'
    if (paraFormat.alignment) {
      textAlign = paraFormat.alignment
    } else if (charFormat.alignment) {
      textAlign = charFormat.alignment
    }

    const isCentered = textAlign === 'center'
    const isRightAligned = textAlign === 'right'
    
    // 使用文档中的加粗信息
    // const isBold = charFormat.bold || false
    
    // 重新启用字符样式处理
    const hasCharStyles = charFormat.styles && charFormat.styles.length > 0
    
    if (hasCharStyles) {
      html += formatTextWithCharacterStyles(text, charFormat.styles, {
        isCentered,
        charFormat: { ...charFormat },
        paraFormat: { ...paraFormat }
      })
    } else {
      html += formatTextWithDefaultStyles(text, charFormat, paraFormat, {
        isCentered,
        isRightAligned
      })
    }
  }

  return html
}

// const shouldUseCharStyles = (_styles: any[], _text: string): boolean => {
//   if (!styles || styles.length === 0) return false
//   
//   const hasUnderline = styles.some(s => s.style && s.style.underline)
//   const hasDifferentFonts = new Set(styles.map(s => s.style && s.style.fontName)).size > 1
//   
//   return hasUnderline || hasDifferentFonts
// }

const formatTextWithCharacterStyles = (
  text: string, 
  charStyles: Array<{start: number; end: number; style: any}>,
  options: any
): string => {
  const { isCentered, charFormat, paraFormat } = options
  const isRightAligned = paraFormat && paraFormat.alignment === 'right'

  let fontSize = '1.0rem'  // 默认正文
  if (charFormat.fontSize) {
    const sizeMap: { [key: number]: string } = {
      36: '2.25rem',
      22: '1.375rem',
      32: '2.0rem',
      16: '1.0rem',
      14: '0.875rem',
      12: '0.75rem',
    }
    fontSize = sizeMap[charFormat.fontSize] || `${charFormat.fontSize / 16}rem`
  }

  let textAlign = 'justify'
  if (isCentered) {
    textAlign = 'center'
  } else if (isRightAligned) {
    textAlign = 'right'
  }
  let fontWeight = charFormat.bold ? 'bold' : 'normal'

  // 验证字符样式是否覆盖了整个文本
  let totalLength = 0
  for (const style of charStyles) {
    totalLength += (style.end - style.start)
  }
  
  // 如果字符样式没有完全覆盖文本，使用默认样式
  if (totalLength < text.length * 0.8) {
    return formatTextWithDefaultStyles(text, charFormat, {}, options)
  }

  let htmlContent = ''
  let lastEnd = 0

  for (const style of charStyles) {
    // 处理两个样式之间的间隙
    if (style.start > lastEnd) {
      const gapSegment = text.substring(lastEnd, style.start)
      if (gapSegment) {
        htmlContent += escapeHtml(gapSegment)
      }
    }
    
    const segment = text.substring(style.start, style.end)
    if (!segment) continue

    const segmentStyles: string[] = []

    if (style.style.fontName) {
      segmentStyles.push(`font-family: '${style.style.fontName}', serif`)
    } else {
      segmentStyles.push(`font-family: '宋体', serif`)
    }

    segmentStyles.push(`font-size: ${fontSize}`)
    segmentStyles.push(`font-weight: ${fontWeight}`)

    if (style.style.underline) {
      segmentStyles.push('text-decoration: underline')
    }

    const segmentStyleString = segmentStyles.join('; ')
    htmlContent += `<span style="${segmentStyleString}">${escapeHtml(segment)}</span>`
    
    lastEnd = style.end
  }
  
  // 处理文本末尾的剩余部分
  if (lastEnd < text.length) {
    const remainingSegment = text.substring(lastEnd)
    if (remainingSegment) {
      htmlContent += escapeHtml(remainingSegment)
    }
  }

  const tag = 'p'  // 统一使用p标签，样式在style属性中控制
  const containerStyle = `font-size: ${fontSize}; text-align: ${textAlign}`

  return `<${tag} style="${containerStyle}">${htmlContent}</${tag}>`
}

const formatTextWithDefaultStyles = (
  text: string,
  charFormat: any,
  _paraFormat: any,
  options: any
): string => {
  const { isCentered, isRightAligned } = options

  let styles: string[] = []

  if (charFormat.fontName) {
    styles.push(`font-family: '${charFormat.fontName}', 'SimSun', serif`)
  } else {
    styles.push('font-family: "宋体", "SimSun", serif')
  }

  if (charFormat.fontSize) {
    const sizeMap: { [key: number]: string } = {
      36: '2.25rem',
      22: '1.375rem',
      32: '2.0rem',
      16: '1.0rem',
      14: '0.875rem',
      12: '0.75rem',
    }
    const fontSize = sizeMap[charFormat.fontSize] || `${charFormat.fontSize / 16}rem`
    styles.push(`font-size: ${fontSize}`)
  } else {
    styles.push('font-size: 1.0rem')
  }

  if (charFormat.bold) {
    styles.push('font-weight: bold')
  }

  if (charFormat.italic) {
    styles.push('font-style: italic')
  }

  if (charFormat.underline) {
    styles.push('text-decoration: underline')
  }

  if (charFormat.color) {
    styles.push(`color: ${charFormat.color}`)
  }

  let textAlign = 'justify'
  if (isCentered) {
    textAlign = 'center'
  } else if (isRightAligned) {
    textAlign = 'right'
  }
  styles.push(`text-align: ${textAlign}`)

  const styleString = styles.join('; ')

  return `<p style="${styleString}">${escapeHtml(text)}</p>`
}

const formatTextWithInferredFormat = (text: string): string => {
  const paragraphs = text.split(/\n+/).filter(p => p.trim())

  if (paragraphs.length === 0) {
    return `<p style="font-family: '宋体', serif; font-size: 1.0rem;">${escapeHtml(text)}</p>`
  }

  let html = ''

  for (const para of paragraphs) {
    const trimmed = para.trim()
    if (!trimmed) continue

    const isShortTitle = trimmed.length < 20 && (trimmed.match(/[\u4e00-\u9fff]/g) || []).length / trimmed.length > 0.5

    if (isShortTitle) {
      html += `<h1 style="font-family: '宋体', serif; font-size: 1.375rem; font-weight: bold; text-align: center;">${escapeHtml(trimmed)}</h1>`
    } else {
      html += `<p style="font-family: '宋体', 'SimSun', serif; font-size: 1.0rem; text-align: justify;">${escapeHtml(trimmed)}</p>`
    }
  }

  return html
}

const escapeHtml = (text: string): string => {
  const div = document.createElement('div')
  div.textContent = text
  return div.innerHTML
}

watch(() => props.source, (newSource) => {
  if (newSource) {
    if (typeof newSource === 'string') {
      loadFromUrl(newSource)
    } else {
      loadFromFile(newSource)
    }
  }
})

onMounted(() => {
  if (props.source) {
    if (typeof props.source === 'string') {
      loadFromUrl(props.source)
    } else {
      loadFromFile(props.source)
    }
  }
})
</script>

<template>
  <div class="doc-preview">
    <div v-if="loading" class="loading-container">
      <div class="loading-spinner"></div>
      <p>正在解析文档...</p>
    </div>

    <div v-else-if="error" class="error-container">
      <div class="error-icon">❌</div>
      <p>{{ error }}</p>
    </div>

    <div v-else class="preview-content">
      <div 
        class="document-content" 
        v-html="htmlContent"
      ></div>
    </div>
  </div>
</template>

<style scoped>
.doc-preview {
  background: white;
  border-radius: 0 0 16px 16px;
  box-shadow: 0 10px 40px rgba(0, 0, 0, 0.1);
  min-height: 500px;
}

.loading-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 100px 20px;
}

.loading-spinner {
  width: 50px;
  height: 50px;
  border: 4px solid #f3f3f3;
  border-top: 4px solid #667eea;
  border-radius: 50%;
  animation: spin 1s linear infinite;
  margin-bottom: 20px;
}

@keyframes spin {
  0% { transform: rotate(0deg); }
  100% { transform: rotate(360deg); }
}

.loading-container p {
  color: #666;
  font-size: 1.1rem;
}

.error-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 100px 20px;
}

.error-icon {
  font-size: 4rem;
  margin-bottom: 20px;
}

.error-container p {
  color: #e74c3c;
  font-size: 1.1rem;
  text-align: center;
}

.doc-info {
  font-size: 0.85rem;
  color: #999;
  margin-bottom: 16px;
  padding-bottom: 12px;
  border-bottom: 1px solid #eee;
}

.preview-content {
  padding: 40px;
  max-height: 70vh;
  overflow-y: auto;
}

.document-content {
  line-height: 1.8;
  color: #333;
}

.document-content h1 {
  font-size: 2.2rem;
  font-weight: bold;
  margin-bottom: 20px;
  padding-bottom: 10px;
  border-bottom: 2px solid #667eea;
  color: #333;
  font-family: '华文中宋', 'SimHei', serif;
  text-align: center;
}

.document-content h2 {
  font-size: 3.2rem;
  font-weight: bold;
  margin-top: 30px;
  margin-bottom: 15px;
  color: #444;
  font-family: '华文中宋', 'SimHei', serif;
  text-align: center;
}

.document-content h3 {
  font-size: 1.3rem;
  margin-top: 25px;
  margin-bottom: 12px;
  color: #555;
}

.document-content p {
  margin-bottom: 15px;
  text-align: justify;
}

.document-content ul,
.document-content ol {
  margin-bottom: 15px;
  padding-left: 30px;
}

.document-content li {
  margin-bottom: 8px;
}

.document-content strong {
  font-weight: 600;
  color: #333;
}

.document-content em {
  font-style: italic;
}

.document-content table {
  width: 100%;
  border-collapse: collapse;
  margin-bottom: 20px;
}

.document-content th,
.document-content td {
  border: 1px solid #ddd;
  padding: 10px;
  text-align: left;
}

.document-content th {
  background-color: #f5f5f5;
  font-weight: 600;
}

.document-content hr {
  border: none;
  border-top: 1px solid #ddd;
  margin: 30px 0;
}

.document-content blockquote {
  border-left: 4px solid #667eea;
  padding-left: 15px;
  margin: 20px 0;
  color: #666;
  font-style: italic;
}

@media (max-width: 768px) {
  .preview-content {
    padding: 20px;
  }
}
</style>
