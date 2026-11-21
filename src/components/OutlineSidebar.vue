<script setup lang="ts">
import { useI18n } from '../composables/useI18n'

const { t } = useI18n()

/** 大纲条目：text 显示文本、level 层级（1..3）、index 对应正文段落序号。 */
interface OutlineItem {
  text: string
  level: number
  index: number
}

/**
 * OutlineSidebar —— 文档大纲导航侧栏（纯展示 + 事件转发）。
 *
 * scrollToOutline 仍由 DocPreview 实现（需临时关闭虚拟滚动并对目标段加
 * outline-highlight），本组件只把点击/键盘激活转发为 `navigate(item)`。
 * 保留 #doc-outline-sidebar / role / ARIA / tabindex 契约。
 */
const props = defineProps<{
  items: OutlineItem[]
}>()

const emit = defineEmits<{
  navigate: [item: OutlineItem]
}>()
</script>

<template>
  <div
    id="doc-outline-sidebar"
    class="outline-sidebar"
    role="navigation"
    :aria-label="t('outline.header')"
  >
    <div class="outline-header">{{ t('outline.header') }}</div>
    <div class="outline-list">
      <div
        v-for="item in props.items"
        :key="item.index"
        class="outline-item"
        :class="'outline-level-' + item.level"
        role="button"
        tabindex="0"
        :aria-label="item.text"
        @click="emit('navigate', item)"
        @keydown.enter.prevent="emit('navigate', item)"
        @keydown.space.prevent="emit('navigate', item)"
      >{{ item.text }}</div>
    </div>
  </div>
</template>

<style scoped>
.outline-sidebar {
  float: left;
  width: 220px;
  margin: 24px 0 24px 16px;
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  font-size: 0.82rem;
  max-height: 400px;
  overflow-y: auto;
  position: sticky;
  top: 16px;
}

.outline-header {
  padding: 10px 14px;
  font-weight: 600;
  color: var(--text-primary);
  border-bottom: 1px solid var(--border-color);
  font-size: 0.85rem;
}

.outline-list {
  padding: 6px 0;
}

.outline-item {
  padding: 5px 14px 5px calc(14px + 12px * (var(--level, 1) - 1));
  cursor: pointer;
  color: var(--text-secondary);
  line-height: 1.4;
  transition: background 0.1s, color 0.1s;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.outline-item:hover {
  background: var(--bg-tertiary);
  color: var(--accent);
}

.outline-item:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: -2px;
  background: var(--bg-tertiary);
  color: var(--accent);
}

.outline-level-1 {
  --level: 1;
  font-weight: 600;
}

.outline-level-2 {
  --level: 2;
}

.outline-level-3 {
  --level: 3;
  font-size: 0.8rem;
}

@media (max-width: 900px) {
  .outline-sidebar {
    float: none;
    width: auto;
    margin: 16px;
    max-height: 280px;
    position: static;
  }
}

@media (max-width: 640px) {
  .outline-sidebar {
    margin: 10px;
    max-height: 240px;
    border-radius: 6px;
    font-size: 0.78rem;
  }
}

@media (max-width: 480px) {
  .outline-header {
    padding: 8px 10px;
    font-size: 0.8rem;
  }

  .outline-item {
    padding: 6px 10px 6px calc(10px + 12px * (var(--level, 1) - 1));
    font-size: 0.78rem;
  }
}
</style>
