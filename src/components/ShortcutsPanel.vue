<script setup lang="ts">
import { computed } from 'vue'
import { t } from '../utils/locale'

interface ShortcutItem {
  keys: string
  label: string
}

defineProps<{
  /** 是否显示 */
  modelValue: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
}>()

const shortcutList = computed<ShortcutItem[]>(() => [
  { keys: 'Ctrl+F', label: t('shortcuts.items.toggleSearch') },
  { keys: 'F3 / Ctrl+G', label: t('shortcuts.items.nextMatch') },
  { keys: 'Shift+F3 / Ctrl+Shift+G', label: t('shortcuts.items.prevMatch') },
  { keys: 'Escape', label: t('shortcuts.items.closeSearch') },
  { keys: 'Ctrl+P', label: t('shortcuts.items.print') },
  { keys: 'Ctrl+= / Ctrl++', label: t('shortcuts.items.zoomIn') },
  { keys: 'Ctrl+-', label: t('shortcuts.items.zoomOut') },
  { keys: 'Ctrl+0', label: t('shortcuts.items.zoomReset') },
  { keys: 'PageUp', label: t('shortcuts.items.prevPage') },
  { keys: 'PageDown', label: t('shortcuts.items.nextPage') },
  { keys: 'Home', label: t('shortcuts.items.firstPage') },
  { keys: 'End', label: t('shortcuts.items.lastPage') },
  { keys: '? / Ctrl+/', label: t('shortcuts.items.toggleShortcuts') },
])
</script>

<template>
  <div v-if="modelValue" class="shortcuts-overlay" @click.self="emit('update:modelValue', false)">
    <div class="shortcuts-panel" role="dialog" :aria-label="t('shortcuts.help')">
      <div class="shortcuts-header">
        <span>{{ t('shortcuts.title') }}</span>
        <button class="shortcuts-close" @click="emit('update:modelValue', false)" :aria-label="t('shortcuts.close')">✕</button>
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
    </div>
  </div>
</template>
