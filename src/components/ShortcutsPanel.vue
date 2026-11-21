<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useI18n } from '../composables/useI18n'

interface ShortcutItem {
  keys: string
  label: string
}

const props = defineProps<{
  /** 是否显示 */
  modelValue: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
}>()

// I18N-P0：shortcuts.items 在字典中是嵌套 Record（locale.ts），此前扁平键
// t('shortcuts.items.xxx') 必然 miss 回退显示原始 key。改走 useI18n().tMap
// （纯委托 utils/locale 的 tMap，激活其既有嵌套访问路径，双语即时生效）。
const { t, tMap } = useI18n()

const shortcutList = computed<ShortcutItem[]>(() => [
  { keys: 'Ctrl+F', label: tMap('shortcuts.items', 'toggleSearch') },
  { keys: 'F3 / Ctrl+G', label: tMap('shortcuts.items', 'nextMatch') },
  { keys: 'Shift+F3 / Ctrl+Shift+G', label: tMap('shortcuts.items', 'prevMatch') },
  { keys: 'Escape', label: tMap('shortcuts.items', 'closeSearch') },
  { keys: 'Ctrl+P', label: tMap('shortcuts.items', 'print') },
  { keys: 'Ctrl+= / Ctrl++', label: tMap('shortcuts.items', 'zoomIn') },
  { keys: 'Ctrl+-', label: tMap('shortcuts.items', 'zoomOut') },
  { keys: 'Ctrl+0', label: tMap('shortcuts.items', 'zoomReset') },
  { keys: 'PageUp', label: tMap('shortcuts.items', 'prevPage') },
  { keys: 'PageDown', label: tMap('shortcuts.items', 'nextPage') },
  { keys: 'Home', label: tMap('shortcuts.items', 'firstPage') },
  { keys: 'End', label: tMap('shortcuts.items', 'lastPage') },
  { keys: '? / Ctrl+/', label: tMap('shortcuts.items', 'toggleShortcuts') },
])

// ---- DOC-POLISH③ 模态焦点管理 ----
const panelRef = ref<HTMLElement | null>(null)
let previouslyFocused: HTMLElement | null = null

function restoreFocus() {
  const target = previouslyFocused
  previouslyFocused = null

  nextTick(() => {
    if (target?.isConnected && typeof target.focus === 'function') {
      target.focus()
      return
    }

    // 触发按钮可能随预览状态被卸载，回退到仍存在的快捷键入口。
    document.querySelector<HTMLElement>('[aria-controls="doc-shortcuts-panel"]')?.focus()
  })
}

watch(() => props.modelValue, (open) => {
  if (open) {
    previouslyFocused = document.activeElement as HTMLElement | null
    // 打开：焦点移入对话框（panel tabindex=-1），读屏随 aria-modal 隔离背景
    nextTick(() => panelRef.value?.focus())
  } else {
    // 关闭：焦点归还触发元素，键盘用户不丢位置
    restoreFocus()
  }
})

/** 焦点圈闭：面板内可聚焦元仅关闭钮一个，Tab 循环驻留其中（WAI-ARIA dialog 模式）。 */
function trapFocus(e: KeyboardEvent) {
  if (e.key !== 'Tab' || !panelRef.value) return
  const focusables = panelRef.value.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')
  if (focusables.length === 0) { e.preventDefault(); return }
  const first = focusables[0]
  const last = focusables[focusables.length - 1]
  const active = document.activeElement as HTMLElement | null
  if (e.shiftKey && active === first) { e.preventDefault(); last.focus() }
  else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus() }
  else if (!panelRef.value.contains(active)) { e.preventDefault(); first.focus() }
}
</script>

<template>
  <div v-if="modelValue" class="shortcuts-overlay" @click.self="emit('update:modelValue', false)" @keydown="trapFocus">
    <div
      ref="panelRef"
      id="doc-shortcuts-panel"
      class="shortcuts-panel"
      role="dialog"
      aria-modal="true"
      tabindex="-1"
      aria-labelledby="doc-shortcuts-title"
    >
      <div class="shortcuts-header">
        <span id="doc-shortcuts-title">{{ t('shortcuts.title') }}</span>
        <button type="button" class="shortcuts-close" @click="emit('update:modelValue', false)" :aria-label="t('shortcuts.close')">✕</button>
      </div>
      <div class="shortcuts-body">
        <div
          v-for="(item, idx) in shortcutList"
          :key="idx"
          class="shortcut-row"
        >
          <kbd
            v-for="key in item.keys.split(' / ')"
            :key="key"
            class="shortcut-keys"
            aria-hidden="true"
          >{{ key }}</kbd>
          <span class="shortcut-label">{{ item.label }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 从 DocPreview.vue 迁入：父组件 scoped 样式原本无法命中子组件内部节点。 */
.shortcuts-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  z-index: 10000;
  display: flex;
  align-items: center;
  justify-content: center;
}
.shortcuts-panel {
  background: var(--bg-primary, #fff);
  border-radius: 12px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.25);
  width: min(480px, calc(100vw - 32px));
  max-height: min(70vh, 500px);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.shortcuts-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  font-size: 15px;
  font-weight: 600;
  border-bottom: 1px solid var(--border-color, #e8e8e8);
}
.shortcuts-close {
  background: none;
  border: none;
  font-size: 16px;
  cursor: pointer;
  padding: 4px 8px;
  border-radius: 4px;
  color: var(--text-secondary, #666);
  line-height: 1;
}
.shortcuts-close:hover {
  background: var(--bg-secondary, #f0f0f0);
  color: var(--text-primary, #333);
}
.shortcuts-body {
  padding: 8px 0;
  overflow-y: auto;
  flex: 1;
}
.shortcut-row {
  display: flex;
  align-items: center;
  padding: 8px 20px;
  gap: 12px;
}
.shortcut-keys {
  display: inline-block;
  background: var(--bg-secondary, #f0f0f0);
  border: 1px solid var(--border-color, #d8d8d8);
  border-radius: 4px;
  padding: 2px 7px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 12px;
  color: var(--text-primary, #333);
  white-space: nowrap;
  box-shadow: 0 1px 0 rgba(0,0,0,0.08);
}
.shortcut-label {
  font-size: 14px;
  color: var(--text-primary, #333);
  margin-left: auto;
  text-align: right;
  white-space: nowrap;
}

@media (max-width: 640px) {
  .shortcuts-panel {
    width: calc(100vw - 24px);
    max-height: min(80vh, 480px);
    border-radius: 10px;
  }
  .shortcut-row {
    padding: 6px 14px;
  }
}
</style>
