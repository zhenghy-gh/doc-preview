<script setup lang="ts">
import { t } from '../utils/locale'
import type { RevisionMode } from '../utils/revisionRender'
import type { RevisionType } from '../utils/docFormat'
import CollapsiblePanel from './CollapsiblePanel.vue'

interface RevisionItem {
  type: RevisionType
  label: string
  author: string
  time: string
  count: number
}

/** 修订痕迹面板：显示标记 / 接受全部 / 拒绝全部三种模式切换。 */
const props = defineProps<{
  modelValue: boolean
  title: string
  summary: string
  mode: RevisionMode
  items: RevisionItem[]
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  'change-mode': [mode: RevisionMode]
}>()
</script>

<template>
  <CollapsiblePanel
    v-if="props.items.length > 0"
    :model-value="props.modelValue"
    :title="props.title"
    :summary="props.summary"
    panel-class="revisions-panel"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <div class="revision-mode-toolbar" role="group" :aria-label="t('revisions.title')">
      <button
        type="button"
        class="revision-mode-btn"
        :class="{ active: props.mode === 'marks' }"
        :aria-pressed="props.mode === 'marks'"
        @click="emit('change-mode', 'marks')"
        :title="t('revisions.marks')"
      >{{ t('revisions.marks') }}</button>
      <button
        type="button"
        class="revision-mode-btn"
        :class="{ active: props.mode === 'accepted' }"
        :aria-pressed="props.mode === 'accepted'"
        @click="emit('change-mode', 'accepted')"
        :title="t('revisions.accept')"
      >{{ t('revisions.accept') }}</button>
      <button
        type="button"
        class="revision-mode-btn"
        :class="{ active: props.mode === 'rejected' }"
        :aria-pressed="props.mode === 'rejected'"
        @click="emit('change-mode', 'rejected')"
        :title="t('revisions.reject')"
      >{{ t('revisions.reject') }}</button>
    </div>
    <div
      v-for="(item, idx) in props.items"
      :key="idx"
      class="revision-item"
      :class="'revision-type-' + item.type"
    >
      <span class="revision-badge">{{ item.label }}</span>
      <span class="revision-author">{{ item.author }}</span>
      <span v-if="item.time" class="revision-time">{{ item.time }}</span>
      <span class="revision-count">{{ t('revisions.count', { n: item.count }) }}</span>
    </div>
  </CollapsiblePanel>
</template>

<style scoped>
.revisions-panel {
  max-width: 800px;
  margin: 0 auto 32px auto;
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  overflow: hidden;
}

:deep(.stories-content) {
  padding: 12px 16px;
  display: grid;
  gap: 8px;
}

.revision-mode-toolbar {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  padding: 8px 10px;
  background: var(--bg-primary);
  border: 1px solid var(--border-color);
  border-radius: 6px;
  margin-bottom: 4px;
}

.revision-mode-btn {
  padding: 4px 12px;
  border: 1px solid var(--border-color);
  border-radius: 4px;
  background: var(--bg-secondary);
  color: var(--text-primary);
  font-size: 0.82rem;
  cursor: pointer;
  transition: background-color 0.15s, border-color 0.15s, color 0.15s;
}

.revision-mode-btn:hover {
  border-color: var(--accent);
  color: var(--accent);
}

.revision-mode-btn.active {
  background: var(--accent);
  border-color: var(--accent);
  color: #fff;
}

.revision-item {
  display: flex;
  align-items: baseline;
  gap: 10px;
  flex-wrap: wrap;
  padding: 6px 10px;
  background: var(--bg-primary);
  border-left: 3px solid var(--border-color);
  border-radius: 4px;
  font-size: 0.85rem;
}

.revision-item.revision-type-insert {
  border-left-color: #27ae60;
}

.revision-item.revision-type-delete {
  border-left-color: #e74c3c;
}

.revision-item.revision-type-format {
  border-left-color: #f39c12;
}

.revision-badge {
  display: inline-block;
  padding: 2px 10px;
  border-radius: 12px;
  font-size: 0.8rem;
  font-weight: 500;
  white-space: nowrap;
}

.revision-type-insert .revision-badge {
  background: rgba(39, 174, 96, 0.12);
  color: #27ae60;
}

.revision-type-delete .revision-badge {
  background: rgba(231, 76, 60, 0.12);
  color: #e74c3c;
}

.revision-type-format .revision-badge {
  background: rgba(243, 156, 18, 0.12);
  color: #f39c12;
}

.revision-author {
  color: var(--text-primary);
  font-weight: 500;
}

.revision-time {
  color: var(--text-muted);
  font-size: 0.8rem;
}

.revision-count {
  margin-left: auto;
  color: var(--text-muted);
  font-size: 0.8rem;
}
</style>
