<script setup lang="ts">
import type { IndexEntry, TocEntry } from '../utils/fieldParser'
import CollapsiblePanel from './CollapsiblePanel.vue'

/** 目录（TOC）与索引（INDEX）面板，共享目录列表样式。 */
const props = defineProps<{
  tocOpen: boolean
  indexOpen: boolean
  tocTitle: string
  indexTitle: string
  toc: TocEntry[]
  index: IndexEntry[]
}>()

const emit = defineEmits<{
  'update:tocOpen': [value: boolean]
  'update:indexOpen': [value: boolean]
}>()
</script>

<template>
  <CollapsiblePanel
    v-if="props.toc.length > 0"
    :model-value="props.tocOpen"
    :title="props.tocTitle"
    panel-class="toc-panel"
    @update:model-value="emit('update:tocOpen', $event)"
  >
    <div class="toc-content">
      <ul class="toc-list">
        <li
          v-for="(entry, index) in props.toc"
          :key="index"
          class="toc-item"
          :class="`toc-level-${entry.level}`"
        >
          <span class="toc-text">{{ entry.text }}</span>
          <span v-if="entry.pageNumber" class="toc-page">{{ entry.pageNumber }}</span>
        </li>
      </ul>
    </div>
  </CollapsiblePanel>

  <CollapsiblePanel
    v-if="props.index.length > 0"
    :model-value="props.indexOpen"
    :title="props.indexTitle"
    panel-class="toc-panel"
    @update:model-value="emit('update:indexOpen', $event)"
  >
    <div class="toc-content">
      <ul class="toc-list">
        <li
          v-for="(entry, i) in props.index"
          :key="i"
          class="toc-item"
          :class="{ 'toc-level-2': entry.subTerm }"
        >
          <span class="toc-text">{{ entry.mainTerm }}</span>
          <span v-if="entry.subTerm" class="toc-subterm">· {{ entry.subTerm }}</span>
          <span v-if="entry.pageNumber" class="toc-page">{{ entry.pageNumber }}</span>
        </li>
      </ul>
    </div>
  </CollapsiblePanel>
</template>

<style scoped>
.toc-panel {
  max-width: 800px;
  margin: 0 auto 32px auto;
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  overflow: hidden;
}

.toc-content {
  padding: 16px;
}

.toc-list {
  list-style: none;
  padding: 0;
  margin: 0;
}

.toc-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 6px 0;
  border-bottom: 1px solid var(--border-color);
}

.toc-item:last-child {
  border-bottom: none;
}

.toc-level-1 {
  font-weight: bold;
  font-size: 1rem;
  padding-left: 0;
}

.toc-level-2 {
  font-size: 0.95rem;
  padding-left: 16px;
}

.toc-level-3 {
  font-size: 0.9rem;
  padding-left: 32px;
}

.toc-level-4,
.toc-level-5,
.toc-level-6,
.toc-level-7,
.toc-level-8,
.toc-level-9 {
  font-size: 0.85rem;
  padding-left: calc(16px * var(--level, 4));
}

.toc-text {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.toc-page {
  color: var(--text-muted);
  font-size: 0.85rem;
  margin-left: 12px;
}
</style>
