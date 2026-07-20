<script setup lang="ts">
import { ref, watch } from 'vue'
import DocPreview from './components/DocPreview.vue'
import { currentLocale, setLocale, t } from './utils/locale'

const MAX_FILE_SIZE = 50 * 1024 * 1024 // 50MB limit

const selectedFile = ref<File | null>(null)
const urlInput = ref('')
const previewSource = ref<File | string | null>(null)
const errorMessage = ref('')
const isDragOver = ref(false)

const isValidFile = (file: File): boolean => {
  const ext = file.name.toLowerCase()
  return ext.endsWith('.doc') || ext.endsWith('.dot')
}

const getFileExt = (file: File): string => {
  return file.name.split('.').pop()?.toLowerCase() || ''
}

const formatErrorMessage = (file: File): string => {
  const ext = getFileExt(file)
  if (ext === 'docx') {
    return '.docx 格式暂不支持。\n此工具为旧版 .doc (OLE2) 格式设计，\n.docx 文件需使用 Microsoft Word 或其他兼容工具打开。'
  }
  return `不支持的文件格式 ".${ext}"，请选择 .doc 或 .dot 文件`
}

const isValidFileSize = (file: File): boolean => {
  return file.size <= MAX_FILE_SIZE
}

const formatFileSize = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

const handleFileChange = (event: Event) => {
  const target = event.target as HTMLInputElement
  const files = target.files
  if (!files || files.length === 0) return

  const file = files[0]
  errorMessage.value = ''

  if (!isValidFile(file)) {
    errorMessage.value = formatErrorMessage(file)
    return
  }

  if (!isValidFileSize(file)) {
    errorMessage.value = `文件过大 (${formatFileSize(file.size)})，最大支持 ${formatFileSize(MAX_FILE_SIZE)}`
    return
  }

  selectedFile.value = file
  previewSource.value = file
}

const handleDrop = (event: DragEvent) => {
  event.preventDefault()
  isDragOver.value = false

  const file = event.dataTransfer?.files?.[0]
  if (!file) return

  errorMessage.value = ''

  if (!isValidFile(file)) {
    errorMessage.value = formatErrorMessage(file)
    return
  }

  if (!isValidFileSize(file)) {
    errorMessage.value = `文件过大 (${formatFileSize(file.size)})，最大支持 ${formatFileSize(MAX_FILE_SIZE)}`
    return
  }

  selectedFile.value = file
  previewSource.value = file
}

const handleDragOver = (event: DragEvent) => {
  event.preventDefault()
  isDragOver.value = true
}

const handleDragLeave = () => {
  isDragOver.value = false
}

const loadFromUrl = () => {
  const url = urlInput.value.trim()
  if (!url) return
  errorMessage.value = ''
  previewSource.value = url
  selectedFile.value = null
}

const resetFile = () => {
  selectedFile.value = null
  previewSource.value = null
  urlInput.value = ''
  errorMessage.value = ''
}

// --- Reader mode ---
const readerMode = ref(false)

function toggleReaderMode() {
  readerMode.value = !readerMode.value
}

// --- Dark mode ---
const darkMode = ref(localStorage.getItem('dark-mode') === 'true')

function toggleDarkMode() {
  darkMode.value = !darkMode.value
  localStorage.setItem('dark-mode', String(darkMode.value))
}

// --- Web Font ---
const useWebFont = ref(localStorage.getItem('use-webfont') === 'true')

function toggleWebFont() {
  useWebFont.value = !useWebFont.value
  localStorage.setItem('use-webfont', String(useWebFont.value))
}

// Sync dark class on mount and changes
if (darkMode.value) {
  document.documentElement.classList.add('dark')
}

watch(darkMode, (val) => {
  document.documentElement.classList.toggle('dark', val)
})
</script>

<template>
  <div class="app-container" :class="{ 'reader-mode': readerMode }">
    <header class="header">
      <div class="header-top">
        <h1>{{ t('app.title') }}</h1>
        <button class="theme-btn" @click="toggleDarkMode" :title="darkMode ? t('app.theme.light') : t('app.theme.dark')">
          {{ darkMode ? '☀️' : '🌙' }}
        </button>
        <button class="theme-btn lang-switch" @click="setLocale(currentLocale === 'zh-CN' ? 'en' : 'zh-CN')" :title="t('app.lang.switch')">
          {{ currentLocale === 'zh-CN' ? 'EN' : '中文' }}
        </button>
      </div>
      <p>{{ t('app.desc') }}</p>
    </header>

    <main class="main-content">
      <template v-if="!previewSource">
        <div
          class="upload-area"
          :class="{ 'drag-over': isDragOver }"
          @drop="handleDrop"
          @dragover="handleDragOver"
          @dragleave="handleDragLeave"
        >
          <div class="upload-icon">{{ isDragOver ? '📂' : '📄' }}</div>
          <h2>{{ isDragOver ? t('app.upload.area.title.drag') : t('app.upload.area.title') }}</h2>
          <p>{{ t('app.upload.area.hint') }}</p>

          <div v-if="errorMessage" class="error-banner">
            {{ errorMessage }}
          </div>

          <label class="upload-btn">
            <input
              type="file"
              accept=".doc,.dot"
              @change="handleFileChange"
              class="file-input"
            />
            <span>{{ t('app.upload.btn') }}</span>
          </label>

          <div class="url-section">
            <div class="divider"><span>{{ t('app.upload.or') }}</span></div>
            <div class="url-input-row">
              <input
                type="text"
                v-model="urlInput"
                :placeholder="t('app.upload.url.placeholder')"
                class="url-input"
                @keyup.enter="loadFromUrl"
              />
              <button class="url-btn" @click="loadFromUrl">{{ t('app.upload.url.btn') }}</button>
            </div>
          </div>
        </div>
      </template>

      <template v-else>
        <div class="preview-header">
          <span class="file-name">{{ typeof previewSource === 'string' ? previewSource.split('/').pop() : selectedFile?.name || t('app.title') }}</span>
          <div class="header-actions">
            <button
              class="header-btn"
              @click="toggleWebFont"
              :class="{ active: useWebFont }"
              :title="useWebFont ? t('app.font.on') : t('app.font.off')"
            >
              🔤
            </button>
            <button class="header-btn" @click="toggleReaderMode" :title="readerMode ? t('app.reader.on') : t('app.reader.off')">
              {{ readerMode ? '⊟' : '⊞' }}
            </button>
            <button class="back-btn" @click="resetFile">
              {{ t('app.back') }}
            </button>
          </div>
        </div>
        <DocPreview :source="previewSource" :use-web-font="useWebFont" />
      </template>
    </main>
  </div>
</template>

<style scoped>
.app-container {
  width: 100%;
  min-height: 100vh;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
}

.header {
  text-align: center;
  padding: 40px 20px;
  color: white;
}

.header-top {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  margin-bottom: 10px;
}

.header-top h1 {
  margin-bottom: 0;
}

.theme-btn {
  background: rgba(255, 255, 255, 0.15);
  border: 1px solid rgba(255, 255, 255, 0.3);
  border-radius: 50%;
  width: 40px;
  height: 40px;
  font-size: 1.2rem;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: background 0.2s;
}

.theme-btn:hover {
  background: rgba(255, 255, 255, 0.3);
}

.header h1 {
  font-size: 2.5rem;
  text-shadow: 2px 2px 4px rgba(0, 0, 0, 0.2);
}

.header p {
  font-size: 1.1rem;
  opacity: 0.9;
}

.main-content {
  max-width: 900px;
  margin: 0 auto;
  padding: 0 20px 40px;
}

.upload-area {
  background: white;
  border-radius: 16px;
  padding: 60px 40px;
  text-align: center;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.15);
  border: 3px dashed #ddd;
  transition: all 0.3s ease;
}

.upload-area:hover {
  border-color: #667eea;
  box-shadow: 0 25px 70px rgba(0, 0, 0, 0.2);
}

.upload-area.drag-over {
  border-color: #667eea;
  background: #f0f4ff;
  box-shadow: 0 25px 70px rgba(102, 126, 234, 0.3);
  transform: scale(1.02);
}

.error-banner {
  background: #fff0f0;
  color: #d63031;
  border: 1px solid #ffcccc;
  border-radius: 8px;
  padding: 10px 16px;
  margin: 16px auto;
  max-width: 480px;
  font-size: 0.9rem;
  line-height: 1.5;
}

.upload-icon {
  font-size: 6rem;
  margin-bottom: 20px;
}

.upload-area h2 {
  font-size: 1.8rem;
  color: #333;
  margin-bottom: 10px;
}

.upload-area p {
  color: #666;
  margin-bottom: 10px;
}

.format-tips {
  margin-bottom: 30px;
}

.tip {
  font-size: 0.9rem;
  color: #888;
  background: #f8f9fa;
  padding: 8px 16px;
  border-radius: 20px;
}

.upload-btn {
  display: inline-block;
  padding: 14px 40px;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
  border-radius: 30px;
  font-size: 1.1rem;
  cursor: pointer;
  transition: transform 0.2s ease, box-shadow 0.2s ease;
  box-shadow: 0 4px 15px rgba(102, 126, 234, 0.4);
}

.upload-btn:hover {
  transform: translateY(-2px);
  box-shadow: 0 6px 20px rgba(102, 126, 234, 0.5);
}

.file-input {
  display: none;
}

.url-section {
  margin-top: 30px;
}

.divider {
  display: flex;
  align-items: center;
  margin-bottom: 16px;
  color: #999;
  font-size: 0.85rem;
}

.divider::before,
.divider::after {
  content: '';
  flex: 1;
  border-top: 1px solid #e0e0e0;
}

.divider span {
  padding: 0 16px;
}

.url-input-row {
  display: flex;
  gap: 8px;
}

.url-input {
  flex: 1;
  padding: 12px 16px;
  border: 2px solid #e0e0e0;
  border-radius: 8px;
  font-size: 0.95rem;
  outline: none;
  transition: border-color 0.2s;
}

.url-input:focus {
  border-color: #667eea;
}

.url-btn {
  padding: 12px 24px;
  background: #667eea;
  color: white;
  border: none;
  border-radius: 8px;
  font-size: 0.95rem;
  cursor: pointer;
  transition: background 0.2s;
  white-space: nowrap;
}

.url-btn:hover {
  background: #5a6fd6;
}

.preview-header {
  background: white;
  border-radius: 16px 16px 0 0;
  padding: 20px 30px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  box-shadow: 0 4px 15px rgba(0, 0, 0, 0.1);
}

.file-name {
  font-size: 1.1rem;
  font-weight: 600;
  color: #333;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 70%;
}

.back-btn {
  padding: 8px 20px;
  background: #f0f0f0;
  border: none;
  border-radius: 8px;
  font-size: 0.95rem;
  cursor: pointer;
  transition: all 0.2s ease;
}

.back-btn:hover {
  background: #e0e0e0;
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.header-btn {
  padding: 8px 14px;
  background: #f0f0f0;
  border: none;
  border-radius: 8px;
  font-size: 1.1rem;
  cursor: pointer;
  transition: all 0.2s ease;
  line-height: 1;
}

.header-btn:hover {
  background: #e0e0e0;
}

.header-btn.active {
  background: #667eea;
  color: white;
}

/* Reader mode: full-width, hide header/main padding */
.reader-mode .header,
.reader-mode .main-content {
  max-width: none;
  padding-left: 0;
  padding-right: 0;
  margin: 0;
}

.reader-mode .header {
  padding: 16px 20px;
}

.reader-mode .header h1 {
  font-size: 1.6rem;
}

.reader-mode .header p {
  display: none;
}

.reader-mode .preview-header {
  border-radius: 0;
}

.reader-mode .doc-preview {
  border-radius: 0;
  min-height: 100vh;
}

/* --- Mobile responsive --- */
@media (max-width: 640px) {
  .header {
    padding: 28px 16px;
  }

  .header h1 {
    font-size: 1.6rem;
  }

  .header p {
    font-size: 0.9rem;
  }

  .upload-area {
    padding: 40px 20px;
    border-radius: 12px;
  }

  .upload-area h2 {
    font-size: 1.3rem;
  }

  .upload-icon {
    font-size: 4rem;
  }

  .upload-btn {
    padding: 12px 32px;
    font-size: 1rem;
  }

  .url-input-row {
    flex-direction: column;
    gap: 8px;
  }

  .url-btn {
    width: 100%;
    padding: 12px;
  }

  .preview-header {
    padding: 14px 16px;
    flex-wrap: wrap;
    gap: 8px;
  }

  .file-name {
    font-size: 0.9rem;
    max-width: 60%;
  }

  .main-content {
    padding: 0 12px 24px;
  }
}
</style>
