<script setup lang="ts">
import type { BookmarkRange } from '../utils/docFormat'
import CollapsiblePanel from './CollapsiblePanel.vue'

/** 书签面板：命名范围（PlcfBkf / PlcfBkl / SttbfBkmk）。 */
const props = defineProps<{
  modelValue: boolean
  title: string
  summary: string
  bookmarks: BookmarkRange[]
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
}>()
</script>

<template>
  <CollapsiblePanel
    :model-value="props.modelValue"
    :title="props.title"
    :summary="props.summary"
    panel-class="bookmarks-panel"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <div class="bookmarks-content">
      <div
        v-for="(bm, idx) in props.bookmarks"
        :key="idx"
        class="bookmark-item"
      >
        <span class="bookmark-name">{{ bm.name }}</span>
        <span class="bookmark-range">CP: {{ bm.cpStart }} – {{ bm.cpEnd }}</span>
      </div>
    </div>
  </CollapsiblePanel>
</template>

<style scoped>
.bookmarks-panel {
  max-width: 800px;
  margin: 0 auto 32px auto;
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  overflow: hidden;
}

.bookmarks-content {
  padding: 12px 16px;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 8px;
}

.bookmark-item {
  display: flex;
  align-items: baseline;
  gap: 8px;
  flex-wrap: wrap;
  padding: 6px 10px;
  background: var(--bg-primary);
  border-left: 3px solid #3498db;
  border-radius: 4px;
  font-size: 0.85rem;
}

.bookmark-name {
  color: var(--text-primary);
  font-weight: 500;
  word-break: break-all;
}

.bookmark-range {
  margin-left: auto;
  color: var(--text-muted);
  font-size: 0.78rem;
  font-variant-numeric: tabular-nums;
}
</style>
