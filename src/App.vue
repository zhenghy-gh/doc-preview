<script setup lang="ts">
import { ref } from 'vue'
import DocPreview from './components/DocPreview.vue'
import { useDarkMode } from './composables/useDarkMode'
// I18N-SWEEP-T1②：文案消费统一收敛 useI18n()（COMPOSABLES-E 契约）。
// setLocale 含 safeStorage 持久化 + locale.ts 单例顶层启动恢复，接线即得全链路。
import { useI18n } from './composables/useI18n'
import { safeStorage } from './utils/safeStorage'

const { locale: currentLocale, setLocale, t } = useI18n()

const MAX_FILE_SIZE = 50 * 1024 * 1024 // 50MB limit

const selectedFile = ref<File | null>(null)
const urlInput = ref('')
const previewSource = ref<File | string | null>(null)
const fileError = ref('')
const urlError = ref('')
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
    return t('app.upload.error.docx')
  }
  return t('app.upload.error.format', { ext })
}

const isValidFileSize = (file: File): boolean => {
  return file.size <= MAX_FILE_SIZE
}

const formatFileSize = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

const processFile = (file: File) => {
  fileError.value = ''
  urlError.value = ''

  if (!isValidFile(file)) {
    fileError.value = formatErrorMessage(file)
    return false
  }

  if (!isValidFileSize(file)) {
    fileError.value = t('app.upload.error.size', { size: formatFileSize(file.size), max: formatFileSize(MAX_FILE_SIZE) })
    return false
  }

  selectedFile.value = file
  previewSource.value = file
  return true
}

const handleFileChange = (event: Event) => {
  const target = event.target as HTMLInputElement
  const file = target.files?.[0]
  if (file) processFile(file)
  // 允许再次选择同一个文件，避免 change 事件因 value 未变化而不触发。
  target.value = ''
}

const handleDrop = (event: DragEvent) => {
  event.preventDefault()
  isDragOver.value = false

  const file = event.dataTransfer?.files?.[0]
  if (file) processFile(file)
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
  urlError.value = ''
  fileError.value = ''
  if (!url) {
    urlError.value = t('app.upload.url.empty')
    return
  }
  let parsedUrl: URL
  try {
    parsedUrl = new URL(url)
  } catch {
    urlError.value = t('app.upload.url.invalid')
    return
  }
  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    urlError.value = t('app.upload.url.invalid')
    return
  }
  previewSource.value = parsedUrl.toString()
  selectedFile.value = null
}

const resetFile = () => {
  selectedFile.value = null
  previewSource.value = null
  urlInput.value = ''
  fileError.value = ''
  urlError.value = ''
}

// --- Reader mode ---
const readerMode = ref(false)

function toggleReaderMode() {
  readerMode.value = !readerMode.value
}

// --- Dark mode ---
// W1-C: 暗黑模式单一数据源 —— 状态/class 挂载/localStorage 持久化收敛到
// composables/useDarkMode.ts（与 DocPreview.vue 共享同一 ref），本组件只消费。
const { darkMode, toggleDarkMode } = useDarkMode()

// --- Web Font ---
const WEB_FONT_STORAGE_KEY = 'use-webfont'
const useWebFont = ref(safeStorage.getItem(WEB_FONT_STORAGE_KEY) === 'true')

function toggleWebFont() {
  useWebFont.value = !useWebFont.value
  safeStorage.setItem(WEB_FONT_STORAGE_KEY, String(useWebFont.value))
}
</script>

<template>
  <div class="app-container" :class="{ 'reader-mode': readerMode }">
    <header class="header">
      <div class="header-top">
        <h1>{{ t('app.title') }}</h1>
        <button type="button" class="theme-btn" @click="toggleDarkMode" :title="darkMode ? t('app.theme.light') : t('app.theme.dark')" :aria-label="darkMode ? t('app.theme.light') : t('app.theme.dark')">
          {{ darkMode ? '☀️' : '🌙' }}
        </button>
        <button type="button" class="theme-btn lang-switch" @click="setLocale(currentLocale === 'zh-CN' ? 'en' : 'zh-CN')" :title="t('app.lang.switch')" :aria-label="t('app.lang.switch')">
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
          <div class="upload-icon" aria-hidden="true">{{ isDragOver ? '📂' : '📄' }}</div>
          <h2>{{ isDragOver ? t('app.upload.area.title.drag') : t('app.upload.area.title') }}</h2>
          <p id="upload-hint">{{ t('app.upload.area.hint') }}</p>

          <div v-if="fileError || urlError" id="upload-error" class="error-banner" role="alert" aria-live="assertive">
            {{ fileError || urlError }}
          </div>

          <label class="upload-btn" :aria-label="t('app.upload.btn')">
            <input
              type="file"
              accept=".doc,.dot"
              @change="handleFileChange"
              class="file-input"
              :aria-describedby="fileError ? 'upload-hint upload-error' : 'upload-hint'"
            />
            <span>{{ t('app.upload.btn') }}</span>
          </label>

          <div class="url-section">
            <div class="divider"><span>{{ t('app.upload.or') }}</span></div>
            <div class="url-input-row">
              <input
                type="url"
                v-model="urlInput"
                :placeholder="t('app.upload.url.placeholder')"
                class="url-input"
                autocomplete="url"
                spellcheck="false"
                :aria-label="t('app.upload.url.placeholder')"
                :aria-invalid="Boolean(urlError)"
                :aria-describedby="urlError ? 'upload-error' : undefined"
                @keyup.enter="loadFromUrl"
              />
              <button class="url-btn" type="button" @click="loadFromUrl">{{ t('app.upload.url.btn') }}</button>
            </div>
          </div>
        </div>
      </template>

      <template v-else>
        <div class="preview-header">
          <span class="file-name">{{ typeof previewSource === 'string' ? previewSource.split('/').pop() : selectedFile?.name || t('app.title') }}</span>
          <div class="header-actions">
            <button
              type="button"
              class="header-btn"
              @click="toggleWebFont"
              :class="{ active: useWebFont }"
              :title="useWebFont ? t('app.font.on') : t('app.font.off')"
              :aria-label="useWebFont ? t('app.font.on') : t('app.font.off')"
            >
              🔤
            </button>
            <button type="button" class="header-btn" @click="toggleReaderMode" :title="readerMode ? t('app.reader.on') : t('app.reader.off')" :aria-label="readerMode ? t('app.reader.on') : t('app.reader.off')">
              {{ readerMode ? '⊟' : '⊞' }}
            </button>
            <button type="button" class="back-btn" @click="resetFile">
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
  background: linear-gradient(135deg, var(--accent-gradient-from) 0%, var(--accent-gradient-to) 100%);
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
  background: var(--bg-secondary);
  border-radius: 16px;
  padding: 60px 40px;
  text-align: center;
  box-shadow: var(--shadow);
  border: 3px dashed var(--border-color);
  transition: all 0.3s ease;
}

.upload-area:hover {
  border-color: var(--accent);
  box-shadow: 0 25px 70px rgba(0, 0, 0, 0.2);
}

.upload-area.drag-over {
  border-color: var(--accent);
  background: var(--accent-light);
  box-shadow: 0 25px 70px rgba(102, 126, 234, 0.3);
  transform: scale(1.02);
}

.error-banner {
  background: var(--error-bg);
  color: var(--error-text);
  border: 1px solid var(--error-border);
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
  color: var(--text-primary);
  margin-bottom: 10px;
}

.upload-area p {
  color: var(--text-secondary);
  margin-bottom: 10px;
}

.format-tips {
  margin-bottom: 30px;
}

.tip {
  font-size: 0.9rem;
  color: var(--text-muted);
  background: var(--bg-tertiary);
  padding: 8px 16px;
  border-radius: 20px;
}

.upload-btn {
  display: inline-block;
  padding: 14px 40px;
  background: linear-gradient(135deg, var(--accent-gradient-from) 0%, var(--accent-gradient-to) 100%);
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
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

.url-section {
  margin-top: 30px;
}

.divider {
  display: flex;
  align-items: center;
  margin-bottom: 16px;
  color: var(--text-muted);
  font-size: 0.85rem;
}

.divider::before,
.divider::after {
  content: '';
  flex: 1;
  border-top: 1px solid var(--border-color);
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
  border: 2px solid var(--border-color);
  border-radius: 8px;
  font-size: 0.95rem;
  outline: none;
  transition: border-color 0.2s;
  background: var(--bg-primary);
  color: var(--text-primary);
}

.url-input:focus {
  border-color: var(--accent);
}

.url-btn {
  padding: 12px 24px;
  background: var(--accent);
  color: white;
  border: none;
  border-radius: 8px;
  font-size: 0.95rem;
  cursor: pointer;
  transition: background 0.2s;
  white-space: nowrap;
}

.url-btn:hover {
  background: var(--accent-hover);
}

.url-btn:focus-visible,
.url-input:focus-visible,
.upload-btn:focus-within,
.theme-btn:focus-visible,
.header-btn:focus-visible,
.back-btn:focus-visible {
  outline: 3px solid var(--accent-light);
  outline-offset: 2px;
}

.preview-header {
  background: var(--bg-secondary);
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
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 70%;
}

.back-btn {
  padding: 8px 20px;
  background: var(--bg-tertiary);
  border: none;
  border-radius: 8px;
  font-size: 0.95rem;
  cursor: pointer;
  transition: all 0.2s ease;
}

.back-btn:hover {
  background: var(--border-color);
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.header-btn {
  padding: 8px 14px;
  background: var(--bg-tertiary);
  border: none;
  border-radius: 8px;
  font-size: 1.1rem;
  cursor: pointer;
  transition: all 0.2s ease;
  line-height: 1;
}

.header-btn:hover {
  background: var(--border-color);
}

.header-btn.active {
  background: var(--accent);
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
