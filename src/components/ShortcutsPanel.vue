<script setup lang="ts">
import { computed } from 'vue'
import { t, tMap } from '../utils/locale'

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
