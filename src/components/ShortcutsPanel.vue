<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, shallowRef, watch } from 'vue'
import { t, tMap } from '../utils/locale'

interface ShortcutItem {
  keys: string
  label: string
}

const platform = typeof navigator === 'undefined'
  ? ''
  : (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform || navigator.platform
const isApplePlatform = /mac|iphone|ipad|ipod/i.test(platform)

function formatShortcutKeys(keys: string): string {
  if (!isApplePlatform) return keys
  return keys
    .replace(/Ctrl\+Shift\+/g, '⇧⌘')
    .replace(/Shift\+/g, '⇧')
    .replace(/Ctrl\+/g, '⌘')
}

const props = defineProps<{
  /** 是否显示 */
  modelValue: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
}>()
const dialogRef = ref<HTMLDialogElement | null>(null)
const dialogInvoker = shallowRef<HTMLElement | null>(null)
let dialogOpenObserver: MutationObserver | null = null
let closeEmitted = false

function emitDialogClosed() {
  if (!props.modelValue || closeEmitted) return
  closeEmitted = true
  emit('update:modelValue', false)
}

function showDialog(invoker?: HTMLElement | null) {
  const dialog = dialogRef.value
  if (!dialog) return
  if (!dialogOpenObserver && typeof MutationObserver !== 'undefined') {
    dialogOpenObserver = new MutationObserver(() => {
      if (!dialog.open) emitDialogClosed()
    })
    dialogOpenObserver.observe(dialog, { attributes: true, attributeFilter: ['open'] })
  }
  if (!dialog.open) {
    closeEmitted = false
    dialogInvoker.value = invoker ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null)
    dialog.showModal()
  }
}

function closeDialog() {
  dialogRef.value?.close()
}

function restoreInvokerFocusIfNeeded() {
  const dialog = dialogRef.value
  const invoker = dialogInvoker.value
  if (!dialog || !invoker?.isConnected) return

  window.setTimeout(() => {
    requestAnimationFrame(() => {
      const activeElement = document.activeElement
      const focusWasDropped = activeElement === document.body || activeElement === dialog.closest('.doc-preview')
      if (!dialog.open && focusWasDropped) invoker.focus()
    })
  }, 0)
}

function handleDialogClose() {
  emitDialogClosed()
}

function handleDialogClick(event: MouseEvent) {
  if ('closedBy' in HTMLDialogElement.prototype) return
  const dialog = dialogRef.value
  if (!dialog || event.target !== dialog) return
  const rect = dialog.getBoundingClientRect()
  const clickedInside = event.clientX >= rect.left && event.clientX <= rect.right
    && event.clientY >= rect.top && event.clientY <= rect.bottom
  if (!clickedInside) {
    dialog.close()
  }
}

watch(() => props.modelValue, async (isOpen) => {
  await nextTick()
  const dialog = dialogRef.value
  if (!dialog) return
  if (isOpen && !dialog.open) showDialog()
  else if (!isOpen) {
    if (dialog.open) dialog.close()
    restoreInvokerFocusIfNeeded()
  }
})

onMounted(() => {
  if (props.modelValue) showDialog()
})

onUnmounted(() => {
  dialogOpenObserver?.disconnect()
})

defineExpose({ showDialog, closeDialog })

const shortcutList = computed<ShortcutItem[]>(() => [
  { keys: formatShortcutKeys('Ctrl+F'), label: tMap('shortcuts.items', 'toggleSearch') },
  { keys: formatShortcutKeys('F3 / Ctrl+G'), label: tMap('shortcuts.items', 'nextMatch') },
  { keys: formatShortcutKeys('Shift+F3 / Ctrl+Shift+G'), label: tMap('shortcuts.items', 'prevMatch') },
  { keys: 'Escape', label: tMap('shortcuts.items', 'closeSearch') },
  { keys: formatShortcutKeys('Ctrl+P'), label: tMap('shortcuts.items', 'print') },
  { keys: formatShortcutKeys('Ctrl+= / Ctrl++'), label: tMap('shortcuts.items', 'zoomIn') },
  { keys: formatShortcutKeys('Ctrl+-'), label: tMap('shortcuts.items', 'zoomOut') },
  { keys: formatShortcutKeys('Ctrl+0'), label: tMap('shortcuts.items', 'zoomReset') },
  { keys: 'PageUp', label: tMap('shortcuts.items', 'prevPage') },
  { keys: 'PageDown', label: tMap('shortcuts.items', 'nextPage') },
  { keys: 'Home', label: tMap('shortcuts.items', 'firstPage') },
  { keys: 'End', label: tMap('shortcuts.items', 'lastPage') },
  { keys: formatShortcutKeys('? / Ctrl+/'), label: tMap('shortcuts.items', 'toggleShortcuts') },
])
</script>

<template>
  <dialog
    ref="dialogRef"
    class="shortcuts-panel"
    closedby="any"
    aria-labelledby="shortcuts-title"
    @close="handleDialogClose"
    @click="handleDialogClick"
  >
    <div class="shortcuts-header">
      <h2 id="shortcuts-title" class="shortcuts-title">{{ t('shortcuts.title') }}</h2>
      <button class="shortcuts-close" type="button" @click="closeDialog" :aria-label="t('shortcuts.close')" autofocus>✕</button>
    </div>
    <div class="shortcuts-body">
      <div
        v-for="(item, idx) in shortcutList"
        :key="idx"
        class="shortcut-row"
      >
        <kbd class="shortcut-keys" v-for="key in item.keys.split(' / ')" :key="key">{{ key }}</kbd>
        <span class="shortcut-label">{{ item.label }}</span>
      </div>
    </div>
  </dialog>
</template>

<style scoped>
.shortcuts-panel {
  background: var(--bg-primary, #fff);
  color: var(--text-primary, #333);
  border: 0;
  border-radius: 12px;
  margin: auto;
  padding: 0;
  width: min(480px, calc(100vw - 32px));
  max-height: min(70vh, 500px);
  overflow: hidden;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.25);
}

.shortcuts-panel[open] {
  display: flex;
  flex-direction: column;
}

.shortcuts-panel:modal {
  overscroll-behavior: contain;
}

.shortcuts-panel::backdrop {
  background: rgba(0, 0, 0, 0.4);
  overflow: hidden;
  overscroll-behavior: contain;
}

.shortcuts-title {
  margin: 0;
  font: inherit;
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
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 44px;
  min-height: 44px;
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
