<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from '../composables/useI18n'

/** 预览工具栏：缩放、搜索、打印/导出、复制、大纲、隐藏文字、主题、快捷键、分页。 */
const props = defineProps<{
  zoomLabel: string
  canZoomOut: boolean
  canZoomIn: boolean
  searchOpen: boolean
  outlineAvailable: boolean
  outlineOpen: boolean
  hiddenTextShown: boolean
  darkMode: boolean
  shortcutsOpen: boolean
  wordCount: number
  paragraphCount: number
  charCount: number
  currentPage: number
  totalPages: number
}>()

const emit = defineEmits<{
  'zoom-out': []
  'zoom-reset': []
  'zoom-in': []
  'toggle-search': []
  print: []
  'download-txt': []
  'download-html': []
  'download-md': []
  'copy-text': []
  'toggle-outline': []
  'toggle-hidden': []
  'toggle-dark': []
  'toggle-shortcuts': []
  'prev-page': []
  'next-page': []
}>()

const { t } = useI18n()
const searchToggleRef = ref<HTMLButtonElement | null>(null)
defineExpose({ focusSearchToggle: () => searchToggleRef.value?.focus() })
</script>

<template>
  <div class="toolbar" role="toolbar" :aria-label="t('toolbar.label')">
    <div class="toolbar-left">
      <button type="button" class="toolbar-btn" @click="emit('zoom-out')" :disabled="!props.canZoomOut" :title="t('toolbar.zoom.out')" :aria-label="t('toolbar.zoom.out')">−</button>
      <button type="button" class="toolbar-btn zoom-label" @click="emit('zoom-reset')" :title="t('toolbar.zoom.reset')" :aria-label="t('toolbar.zoom.reset.aria')">{{ props.zoomLabel }}</button>
      <button type="button" class="toolbar-btn" @click="emit('zoom-in')" :disabled="!props.canZoomIn" :title="t('toolbar.zoom.in')" :aria-label="t('toolbar.zoom.in')">+</button>

      <span class="toolbar-sep" aria-hidden="true"></span>

      <button ref="searchToggleRef" type="button" class="toolbar-btn" @click="emit('toggle-search')" :class="{ active: props.searchOpen }" :title="t('toolbar.search')" :aria-label="t('toolbar.search')" :aria-expanded="props.searchOpen" aria-controls="doc-search-bar">🔍</button>

      <span class="toolbar-sep" aria-hidden="true"></span>

      <button type="button" class="toolbar-btn" @click="emit('print')" :title="t('toolbar.print')" :aria-label="t('toolbar.print')">🖨️</button>
      <button type="button" class="toolbar-btn" @click="emit('download-txt')" :title="t('toolbar.download.txt')" :aria-label="t('toolbar.download.txt')">📥</button>
      <button type="button" class="toolbar-btn" @click="emit('download-html')" :title="t('toolbar.download.html')" :aria-label="t('toolbar.download.html')">🌐</button>
      <button type="button" class="toolbar-btn" @click="emit('download-md')" :title="t('toolbar.download.md')" :aria-label="t('toolbar.download.md')">📝</button>
      <button type="button" class="toolbar-btn" data-action="copy-text" @click="emit('copy-text')" :title="t('toolbar.copy')" :aria-label="t('toolbar.copy')">📋</button>

      <span class="toolbar-sep" aria-hidden="true"></span>

      <button
        type="button"
        class="toolbar-btn"
        :class="{ active: props.outlineOpen }"
        :disabled="!props.outlineAvailable"
        @click="emit('toggle-outline')"
        :title="t('toolbar.outline')"
        :aria-label="t('toolbar.outline')"
        :aria-expanded="props.outlineOpen"
        aria-controls="doc-outline-sidebar"
      >📑</button>

      <button
        type="button"
        class="toolbar-btn"
        :class="{ active: props.hiddenTextShown }"
        @click="emit('toggle-hidden')"
        :title="props.hiddenTextShown ? t('toolbar.hidden.show') : t('toolbar.hidden.hide')"
        :aria-label="t('toolbar.hidden.toggle')"
        :aria-pressed="props.hiddenTextShown"
      >👁️</button>
    </div>

    <div class="toolbar-right">
      <span class="doc-stats" v-if="props.wordCount > 0">
        {{ props.wordCount }} {{ t('stats.words') }} · {{ props.paragraphCount }} {{ t('stats.paragraphs') }} · {{ props.charCount }} {{ t('stats.chars') }}
      </span>

      <span class="toolbar-sep" aria-hidden="true"></span>

      <button
        type="button"
        class="toolbar-btn"
        :class="{ active: props.darkMode }"
        @click="emit('toggle-dark')"
        :title="props.darkMode ? t('app.theme.light') : t('app.theme.dark')"
        :aria-label="t('toolbar.theme')"
        :aria-pressed="props.darkMode"
      >{{ props.darkMode ? '☀️' : '🌙' }}</button>

      <button
        type="button"
        class="toolbar-btn"
        :class="{ active: props.shortcutsOpen }"
        @click="emit('toggle-shortcuts')"
        :title="t('toolbar.shortcuts') + ' (?)'"
        :aria-label="t('toolbar.shortcuts')"
        :aria-expanded="props.shortcutsOpen"
        aria-controls="doc-shortcuts-panel"
      >⌨️</button>

      <span class="toolbar-sep" aria-hidden="true"></span>

      <div class="pagination-controls" role="group" :aria-label="t('pagination.label')">
        <button type="button" class="pagination-btn" @click="emit('prev-page')" :disabled="props.currentPage <= 1" :title="t('pagination.prev')" :aria-label="t('pagination.prev')">◀</button>
        <span class="pagination-info" role="status" aria-live="polite" :aria-label="t('pagination.page', { current: props.currentPage, total: props.totalPages })">
          {{ props.currentPage }} / {{ props.totalPages }}
        </span>
        <button type="button" class="pagination-btn" @click="emit('next-page')" :disabled="props.currentPage >= props.totalPages" :title="t('pagination.next')" :aria-label="t('pagination.next')">▶</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 16px;
  background: var(--toolbar-bg);
  border-bottom: 1px solid var(--toolbar-border);
  gap: 8px;
  flex-wrap: wrap;
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
}
.toolbar-left { display: flex; align-items: center; gap: 4px; }
.toolbar-right { display: flex; align-items: center; }
.toolbar-btn {
  display: inline-flex; align-items: center; justify-content: center;
  min-width: 32px; height: 32px; padding: 0 8px;
  border: 1px solid transparent; border-radius: 6px;
  background: transparent; color: var(--text-secondary);
  font-size: 0.85rem; cursor: pointer; transition: all 0.15s ease; user-select: none;
}
.toolbar-btn:hover:not(:disabled) { background: var(--bg-tertiary); border-color: var(--border-color); }
.toolbar-btn:disabled { opacity: 0.35; cursor: default; }
.toolbar-btn.active { background: var(--accent-light); color: var(--accent); border-color: var(--accent); }
.zoom-label { font-variant-numeric: tabular-nums; min-width: 44px; font-weight: 600; cursor: pointer !important; }
.toolbar-sep { width: 1px; height: 20px; background: var(--border-color); margin: 0 4px; }
.doc-stats { font-size: 0.78rem; color: var(--text-muted); white-space: nowrap; }
.pagination-controls { display: flex; align-items: center; gap: 8px; }
.pagination-btn {
  width: 28px; height: 28px; display: flex; align-items: center; justify-content: center;
  border: 1px solid var(--border-color); border-radius: 6px;
  background: var(--bg-secondary); color: var(--text-primary);
  font-size: 0.85rem; cursor: pointer; transition: background-color 0.15s, border-color 0.15s;
}
.pagination-btn:hover:not(:disabled) { border-color: var(--accent); color: var(--accent); }
.pagination-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.pagination-info { font-size: 0.85rem; color: var(--text-muted); min-width: 60px; text-align: center; }
</style>
