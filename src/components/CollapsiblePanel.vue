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
      :aria-expanded="isOpen"
    >
      <span class="stories-toggle-icon">{{ isOpen ? '▾' : '▸' }}</span>
      <span>{{ title }}</span>
      <span v-if="summary" class="stories-toggle-summary">{{ summary }}</span>
    </button>
    <div v-if="isOpen" class="stories-content">
      <slot />
    </div>
  </div>
</template>

<style scoped>
.stories-content {
  padding: 4px 16px 14px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.properties-panel .stories-content {
  padding: 16px;
  display: grid;
  gap: 12px;
}

.revisions-panel .stories-content {
  padding: 12px 16px;
  display: grid;
  gap: 8px;
}

.stories-toggle {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  min-height: 44px;
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

@media (max-width: 640px) {
  .stories-toggle {
    padding: 10px;
    font-size: 0.82rem;
  }
}
</style>
