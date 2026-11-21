<script setup lang="ts">
import CollapsiblePanel from './CollapsiblePanel.vue'

interface FlagItem {
  label: string
  description: string
}

/** DOP 文档标志面板（对开页 / 首页不同 / 修订模式等）。 */
const props = defineProps<{
  modelValue: boolean
  title: string
  summary: string
  items: FlagItem[]
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
}>()
</script>

<template>
  <CollapsiblePanel
    v-if="props.items.length > 0"
    :model-value="props.modelValue"
    :title="props.title"
    :summary="props.summary"
    panel-class="doc-flags-panel"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <div class="doc-flags-content">
      <div
        v-for="(item, index) in props.items"
        :key="index"
        class="flag-item"
      >
        <span class="flag-badge">{{ item.label }}</span>
        <span class="flag-description">{{ item.description }}</span>
      </div>
    </div>
  </CollapsiblePanel>
</template>

<style scoped>
.doc-flags-panel {
  max-width: 800px;
  margin: 0 auto 32px auto;
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  overflow: hidden;
}

.doc-flags-content {
  padding: 16px;
  display: grid;
  gap: 10px;
}

.flag-item {
  display: flex;
  align-items: baseline;
  gap: 12px;
  flex-wrap: wrap;
}

.flag-badge {
  display: inline-block;
  padding: 2px 10px;
  background: var(--accent-bg, rgba(59, 130, 246, 0.12));
  color: var(--accent-color, #3b82f6);
  border-radius: 12px;
  font-size: 0.82rem;
  font-weight: 500;
  white-space: nowrap;
}

.flag-description {
  color: var(--text-muted);
  font-size: 0.85rem;
}
</style>
