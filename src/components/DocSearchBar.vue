<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from '../composables/useI18n'

const { t } = useI18n()

/**
 * DocSearchBar —— 文档搜索栏（纯展示 + 事件转发）。
 *
 * 搜索状态与高亮逻辑仍由 DocPreview 持有（performSearch / nextMatch /
 * prevMatch 需要访问 .document-content DOM）。本组件只负责：
 * - 通过 v-model 友好的 `update:*` 事件回写输入与两个选项；
 * - 转发 perform-search / next-match / prev-match / close；
 * - expose focus()，供 Ctrl+F 与工具栏搜索按钮复用（原 searchInputRef 契约）。
 * 保留 #doc-search-bar / #doc-search-status / ARIA 属性与 :has(input:checked) 样式。
 */
const props = defineProps<{
  query: string
  caseSensitive: boolean
  wholeWord: boolean
  statusLabel: string
  resultCount: number
}>()

const emit = defineEmits<{
  'update:query': [value: string]
  'update:caseSensitive': [value: boolean]
  'update:wholeWord': [value: boolean]
  'perform-search': []
  'next-match': []
  'prev-match': []
  close: []
}>()

const inputRef = ref<HTMLInputElement | null>(null)

function onInput(e: Event) {
  // 先回写 query，再触发搜索——父组件 performSearch() 读取的是最新值。
  emit('update:query', (e.target as HTMLInputElement).value)
  emit('perform-search')
}

function onOptionChange(key: 'caseSensitive' | 'wholeWord', e: Event) {
  const checked = (e.target as HTMLInputElement).checked
  if (key === 'caseSensitive') emit('update:caseSensitive', checked)
  else emit('update:wholeWord', checked)
  emit('perform-search')
}

function focus() {
  inputRef.value?.focus()
}

defineExpose({ focus })
</script>

<template>
  <div
    id="doc-search-bar"
    class="search-bar"
    role="search"
    :aria-label="t('toolbar.search')"
  >
    <input
      ref="inputRef"
      :value="props.query"
      type="search"
      class="search-input"
      autocomplete="off"
      enterkeyhint="search"
      :placeholder="t('search.placeholder')"
      :aria-label="t('search.placeholder')"
      aria-describedby="doc-search-status"
      @input="onInput"
      @keyup.enter="emit('next-match')"
    />
    <label class="search-option" :title="t('search.case')">
      <input
        type="checkbox"
        :checked="props.caseSensitive"
        :aria-label="t('search.case')"
        @change="onOptionChange('caseSensitive', $event)"
      />
      <span aria-hidden="true">Aa</span>
    </label>
    <label class="search-option" :title="t('search.word')">
      <input
        type="checkbox"
        :checked="props.wholeWord"
        :aria-label="t('search.word')"
        @change="onOptionChange('wholeWord', $event)"
      />
      <span aria-hidden="true">W</span>
    </label>
    <span id="doc-search-status" class="search-status" role="status" aria-live="polite">{{ props.statusLabel }}</span>
    <button
      type="button"
      class="toolbar-btn"
      @click="emit('prev-match')"
      :disabled="props.resultCount === 0"
      :title="t('search.prevMatch')"
      :aria-label="t('search.prevMatch')"
    >▲</button>
    <button
      type="button"
      class="toolbar-btn"
      @click="emit('next-match')"
      :disabled="props.resultCount === 0"
      :title="t('search.nextMatch')"
      :aria-label="t('search.nextMatch')"
    >▼</button>
    <button
      type="button"
      class="toolbar-btn"
      @click="emit('close')"
      :title="t('search.close')"
      :aria-label="t('search.close')"
    >✕</button>
  </div>
</template>

<style scoped>
.search-bar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 16px;
  background: var(--search-bar-bg);
  border-bottom: 1px solid var(--border-color);
}

.search-input {
  flex: 1;
  max-width: 300px;
  padding: 6px 12px;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  font-size: 0.85rem;
  outline: none;
  background: var(--bg-secondary);
  color: var(--text-primary);
  transition: border-color 0.15s;
}

.search-input:focus {
  border-color: var(--accent);
}

.search-status {
  font-size: 0.8rem;
  color: var(--text-muted);
  min-width: 50px;
  text-align: center;
}

.search-option {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 2px 6px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--text-muted);
  border: 1px solid transparent;
  transition: all 0.15s ease;
  user-select: none;
}

.search-option:hover {
  background: var(--bg-secondary, #f0f0f0);
  border-color: var(--border-color, #ddd);
}

/* 视觉隐藏但保留键盘可聚焦性与无障碍树可见性：display:none 会让复选框
   退出 Tab 序列，键盘用户无法切换大小写/全词选项。 */
.search-option input {
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

.search-option:has(input:checked) {
  background: #e3f2fd;
  border-color: #2196f3;
  color: #1565c0;
}

/* 键盘聚焦（Tab）到视觉隐藏的复选框时，在可见 label 上给出焦点环。 */
.search-option:has(input:focus-visible) {
  outline: 2px solid var(--accent, #2196f3);
  outline-offset: 2px;
}

:root.dark .search-option:has(input:checked) {
  background: #1e3a5f;
  border-color: #64b5f6;
  color: #90caf9;
}

@media (max-width: 900px) {
  .search-bar {
    padding: 8px 12px;
    gap: 6px;
    flex-wrap: nowrap;
  }

  .search-bar .toolbar-btn {
    min-width: 34px;
    height: 34px;
  }
}

@media (max-width: 640px) {
  .search-bar {
    padding: 6px 8px;
    gap: 4px;
  }

  .search-bar .toolbar-btn {
    min-width: 38px;
    height: 38px;
  }
}
</style>
