<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import DocPreview from './components/DocPreview.vue'
import { currentLocale, setLocale, t } from './utils/locale'
import { isDocFileTooLarge } from './utils/docLimits'
import { getFileNameFromUrl } from './utils/urlFileName'

const selectedFile = ref<File | null>(null)
const urlInput = ref('')
const previewSource = ref<File | string | null>(null)
type AppError = { key: string; params?: Record<string, unknown> } | null
const errorState = ref<AppError>(null)
const errorMessage = computed(() => errorState.value ? t(errorState.value.key, errorState.value.params) : '')
const isUrlError = computed(() => errorState.value?.key === 'app.upload.url.required')
const isFileError = computed(() => ['app.upload.error.format', 'app.upload.error.docx', 'app.upload.error.sizeLimit'].includes(errorState.value?.key || ''))
const errorId = computed(() => isUrlError.value ? 'url-error' : isFileError.value ? 'file-error' : undefined)
const isDragOver = ref(false)
const previewFileName = computed(() => {
  if (typeof previewSource.value === 'string') return getFileNameFromUrl(previewSource.value)
  return selectedFile.value?.name || t('app.title')
})

watch(currentLocale, (locale) => {
  document.title = t('app.title')
  document.documentElement.lang = locale
}, { immediate: true })

const isValidFile = (file: File): boolean => {
  const ext = file.name.toLowerCase()
  return ext.endsWith('.doc') || ext.endsWith('.dot')
}

const getFileExt = (file: File): string => {
  return file.name.split('.').pop()?.toLowerCase() || ''
}

const formatError = (file: File): AppError => {
  const ext = getFileExt(file)
  if (ext === 'docx') return { key: 'app.upload.error.docx' }
  return { key: 'app.upload.error.format', params: { ext } }
}

const isValidFileSize = (file: File): boolean => {
  return !isDocFileTooLarge(file.size)
}

const handleFileChange = (event: Event) => {
  const target = event.target as HTMLInputElement
  const files = target.files
  if (!files || files.length === 0) return

  const file = files[0]
  target.value = ''
  errorState.value = null

  if (!isValidFile(file)) {
    errorState.value = formatError(file)
    return
  }

  if (!isValidFileSize(file)) {
    errorState.value = { key: 'app.upload.error.sizeLimit' }
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

  errorState.value = null

  if (!isValidFile(file)) {
    errorState.value = formatError(file)
    return
  }

  if (!isValidFileSize(file)) {
    errorState.value = { key: 'app.upload.error.sizeLimit' }
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
  if (!url) {
    errorState.value = { key: 'app.upload.url.required' }
    return
  }
  errorState.value = null
  previewSource.value = url
  selectedFile.value = null
}

const resetFile = () => {
  selectedFile.value = null
  previewSource.value = null
  urlInput.value = ''
  errorState.value = null
}

// --- Reader mode ---
const readerMode = ref(false)

function toggleReaderMode() {
  readerMode.value = !readerMode.value
}

// --- Color scheme ---
type ThemePreference = 'light' | 'dark' | null

function parseThemePreference(value: string | null): ThemePreference {
  if (value === 'dark' || value === 'true') return 'dark'
  if (value === 'light' || value === 'false') return 'light'
  return null
}

function readThemePreference(): ThemePreference {
  try {
    return parseThemePreference(localStorage.getItem('dark-mode'))
  } catch {
    return null
  }
}

function getSystemDarkMode(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-color-scheme: dark)').matches
    : false
}

const themePreference = ref<ThemePreference>(readThemePreference())
const darkMode = ref(themePreference.value === null ? getSystemDarkMode() : themePreference.value === 'dark')

function applyTheme(preference: ThemePreference, systemDark = getSystemDarkMode()) {
  themePreference.value = preference
  darkMode.value = preference === null ? systemDark : preference === 'dark'
  document.documentElement.classList.toggle('dark', darkMode.value)
  document.documentElement.classList.toggle('light', preference === 'light')
  const colorScheme = document.querySelector<HTMLMetaElement>('meta[name="color-scheme"]')
  if (colorScheme) colorScheme.content = preference ?? 'light dark'
}

function chooseTheme(targetDark: boolean) {
  const systemDark = getSystemDarkMode()
  const preference: ThemePreference = targetDark === systemDark ? null : targetDark ? 'dark' : 'light'
  try {
    if (preference === null) localStorage.removeItem('dark-mode')
    else localStorage.setItem('dark-mode', preference)
  } catch {
    // The current page still follows the requested theme without persistence.
  }
  applyTheme(preference, systemDark)
}

function toggleDarkMode() {
  chooseTheme(!darkMode.value)
}

function handleSystemThemeChange(event: MediaQueryListEvent) {
  if (themePreference.value === null) applyTheme(null, event.matches)
}

function handleThemeStorage(event: StorageEvent) {
  if (event.key !== null && event.key !== 'dark-mode') return
  applyTheme(parseThemePreference(event.key === null ? null : event.newValue))
}

const systemThemeQuery = typeof window !== 'undefined' && typeof window.matchMedia === 'function'
  ? window.matchMedia('(prefers-color-scheme: dark)')
  : null

applyTheme(themePreference.value)

onMounted(() => {
  systemThemeQuery?.addEventListener('change', handleSystemThemeChange)
  window.addEventListener('storage', handleThemeStorage)
})

onUnmounted(() => {
  systemThemeQuery?.removeEventListener('change', handleSystemThemeChange)
  window.removeEventListener('storage', handleThemeStorage)
})

// --- Web Font ---
function readWebFontPreference(): boolean {
  try {
    return localStorage.getItem('use-webfont') === 'true'
  } catch {
    return false
  }
}

const useWebFont = ref(readWebFontPreference())

function toggleWebFont() {
  useWebFont.value = !useWebFont.value
  try {
    localStorage.setItem('use-webfont', String(useWebFont.value))
  } catch {
    // The current document still honors the toggle without persistence.
  }
}

</script>

<template>
  <div class="app-container" :class="{ 'reader-mode': readerMode }">
    <header class="header">
      <div class="header-top">
        <h1>{{ t('app.title') }}</h1>
        <button
          type="button"
          class="theme-btn"
          @click="toggleDarkMode"
          :title="darkMode ? t('app.theme.light') : t('app.theme.dark')"
          :aria-label="t('app.theme.toggle')"
          :aria-pressed="darkMode"
        >
          {{ darkMode ? '☀️' : '🌙' }}
        </button>
        <button
          type="button"
          class="theme-btn lang-switch"
          @click="setLocale(currentLocale === 'zh-CN' ? 'en' : 'zh-CN')"
          :title="t('app.lang.switch')"
          :aria-label="currentLocale === 'zh-CN' ? t('app.lang.switchToEnglish') : t('app.lang.switchToChinese')"
        >
          {{ currentLocale === 'zh-CN' ? 'EN' : '中文' }}
        </button>
      </div>
      <p>{{ t('app.desc') }}</p>
    </header>

    <main class="main-content">
      <div class="sr-only" role="status" aria-live="polite" aria-atomic="true">{{ errorMessage }}</div>
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

          <div v-if="errorMessage" :id="errorId" class="error-banner">
            {{ errorMessage }}
          </div>

          <label class="upload-btn">
            <input
              type="file"
              accept=".doc,.dot"
              @change="handleFileChange"
              class="file-input"
              :aria-invalid="isFileError ? 'true' : undefined"
              :aria-describedby="isFileError ? 'file-error' : undefined"
            />
            <span>{{ t('app.upload.btn') }}</span>
          </label>

          <div class="url-section">
            <div class="divider"><span>{{ t('app.upload.or') }}</span></div>
            <label class="url-label" for="source-url">{{ t('app.upload.url.label') }}</label>
            <div class="url-input-row">
              <input
                id="source-url"
                type="url"
                inputmode="url"
                autocomplete="url"
                spellcheck="false"
                enterkeyhint="go"
                v-model="urlInput"
                :placeholder="t('app.upload.url.placeholder')"
                class="url-input"
                :aria-invalid="isUrlError ? 'true' : undefined"
                :aria-describedby="isUrlError ? 'url-error' : undefined"
                @keyup.enter="loadFromUrl"
              />
              <button type="button" class="url-btn" @click="loadFromUrl">{{ t('app.upload.url.btn') }}</button>
            </div>
          </div>
        </div>
      </template>

      <template v-else>
        <div class="preview-header">
          <span class="file-name">{{ previewFileName }}</span>
          <div class="header-actions">
            <button
              class="header-btn"
              @click="toggleWebFont"
              :class="{ active: useWebFont }"
              :title="useWebFont ? t('app.font.on') : t('app.font.off')"
              :aria-label="t('app.font.toggle')"
              :aria-pressed="useWebFont"
            >
              🔤
            </button>
            <button
              class="header-btn"
              @click="toggleReaderMode"
              :title="readerMode ? t('app.reader.on') : t('app.reader.off')"
              :aria-label="t('app.reader.toggle')"
              :aria-pressed="readerMode"
            >
              {{ readerMode ? '⊟' : '⊞' }}
            </button>
            <button class="back-btn" @click="resetFile">
              {{ t('app.back') }}
            </button>
          </div>
        </div>
        <DocPreview
          :source="previewSource"
          :use-web-font="useWebFont"
          :dark-mode="darkMode"
          @theme-change="chooseTheme"
        />
      </template>
    </main>
  </div>
</template>

<style scoped>
.sr-only {
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

.app-container {
  width: 100%;
  min-height: 100vh;
  background: linear-gradient(135deg, var(--accent-action) 0%, #6f4b99 100%);
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
  width: 44px;
  height: 44px;
  font-size: 1.2rem;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
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
  background: var(--bg-secondary, #fff);
  border-radius: 16px;
  padding: 60px 40px;
  text-align: center;
  box-shadow: var(--shadow);
  border: 3px dashed var(--border-color);
  transition: all 0.3s ease;
}

.upload-area:hover {
  border-color: var(--accent);
  box-shadow: var(--shadow);
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
  color: var(--text-secondary);
  background: var(--bg-tertiary);
  padding: 8px 16px;
  border-radius: 20px;
}

.upload-btn {
  display: inline-block;
  padding: 14px 40px;
  background: linear-gradient(135deg, var(--accent-action) 0%, #6f4b99 100%);
  color: white;
  border-radius: 30px;
  font-size: 1.1rem;
  cursor: pointer;
  transition: transform 0.2s ease, box-shadow 0.2s ease;
  box-shadow: 0 4px 15px rgba(77, 95, 199, 0.4);
}

.upload-btn:hover {
  transform: translateY(-2px);
  box-shadow: 0 6px 20px rgba(77, 95, 199, 0.5);
}

.upload-btn:focus-within {
  outline: 3px solid #fff;
  outline-offset: 3px;
}

.file-input {
  position: absolute;
  clip: rect(0, 0, 0, 0);
  clip-path: inset(50%);
  overflow: hidden;
  width: 1px;
  height: 1px;
  margin: -1px;
  padding: 0;
  border: 0;
  white-space: nowrap;
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

.url-label {
  display: block;
  margin-bottom: 8px;
  color: var(--text-secondary);
  font-size: 0.95rem;
}

.url-input-row {
  display: flex;
  gap: 8px;
}

.url-input {
  flex: 1;
  padding: 12px 16px;
  color: var(--text-primary);
  background: var(--bg-secondary);
  border: 2px solid var(--border-color);
  border-radius: 8px;
  font-size: 0.95rem;
  outline: none;
  transition: border-color 0.2s;
}

.url-input:focus {
  border-color: var(--accent);
}

.url-btn {
  padding: 12px 24px;
  background: var(--accent-action);
  color: white;
  border: none;
  border-radius: 8px;
  font-size: 0.95rem;
  cursor: pointer;
  transition: background 0.2s;
  white-space: nowrap;
}

.url-btn:hover {
  background: var(--accent-action-hover);
}

.preview-header {
  color: var(--text-primary);
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
  color: var(--text-primary);
  background: var(--bg-tertiary);
  border: none;
  border-radius: 8px;
  font-size: 0.95rem;
  cursor: pointer;
  transition: all 0.2s ease;
}

.back-btn:hover {
  background: var(--bg-secondary);
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.header-btn {
  padding: 8px 14px;
  color: var(--text-primary);
  background: var(--bg-tertiary);
  border: none;
  border-radius: 8px;
  font-size: 1.1rem;
  cursor: pointer;
  transition: all 0.2s ease;
  line-height: 1;
}

.header-btn:hover {
  background: var(--bg-secondary);
}

.header-btn.active {
  background: var(--accent-action);
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
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-block-size: 44px;
    padding: 12px 32px;
    font-size: 1rem;
  }

  .url-input-row {
    flex-direction: column;
    gap: 8px;
  }

  .url-btn {
    width: 100%;
    min-block-size: 44px;
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
