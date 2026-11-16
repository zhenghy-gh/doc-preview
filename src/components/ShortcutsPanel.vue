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
