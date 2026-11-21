<script setup lang="ts">
import { computed } from 'vue'

/**
 * 通用折叠面板组件
 * 用于统一渲染各类型文档信息面板（属性、修订、书签、分节等）
 */
const props = defineProps<{
  /** 是否展开 */
  modelValue: boolean
  /** 面板标题（含计数等） */
  title: string
  /** 标题右侧摘要文字 */
  summary?: string
  /** 面板根节点的 class（用于样式区分） */
  panelClass?: string
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
}>()

const isOpen = computed(() => props.modelValue)

// A monotonic ID avoids hydration mismatches caused by Math.random() in SSR.
let nextPanelId = 0
const panelInstanceId = `collapsible-panel-${++nextPanelId}`
const titleId = `${panelInstanceId}-title`
const contentId = `${panelInstanceId}-content`

function toggle() {
  emit('update:modelValue', !props.modelValue)
}
</script>

<template>
  <div :class="['collapsible-panel', panelClass]">
    <button
      type="button"
      class="stories-toggle"
      @click="toggle"
      :id="titleId"
      :aria-expanded="isOpen"
      :aria-controls="contentId"
    >
      <span class="stories-toggle-icon" aria-hidden="true">{{ isOpen ? '▾' : '▸' }}</span>
      <span>{{ title }}</span>
      <span v-if="summary" class="stories-toggle-summary">{{ summary }}</span>
    </button>
    <div
      v-if="isOpen"
      :id="contentId"
      class="stories-content"
      role="region"
      :aria-labelledby="titleId"
    >
      <slot />
    </div>
  </div>
</template>

<style scoped>
/* CollapsiblePanel 自身的骨架样式：从 DocPreview.vue 迁入，保证所有面板一致。 */
.stories-toggle {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 10px 16px;
  border: none;
  background: transparent;
  color: var(--text-secondary);
  font-size: 0.88rem;
  cursor: pointer;
  text-align: left;
  transition: background 0.15s;
}
.stories-toggle:hover {
  background: var(--bg-tertiary);
}
.stories-toggle-icon {
  display: inline-block;
  width: 12px;
  color: var(--text-muted);
  font-size: 0.75rem;
}
.stories-toggle-summary {
  margin-left: auto;
  color: var(--text-muted);
  font-size: 0.78rem;
}
.stories-content {
  padding: 4px 16px 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

@media (max-width: 640px) {
  .stories-toggle {
    padding: 10px;
    font-size: 0.82rem;
  }
}
</style>
