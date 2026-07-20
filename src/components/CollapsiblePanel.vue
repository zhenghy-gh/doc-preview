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
