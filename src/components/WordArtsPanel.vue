<script setup lang="ts">
import { t } from '../utils/locale'
import type { WordArtInfo } from '../utils/docFormat'
import CollapsiblePanel from './CollapsiblePanel.vue'

const props = defineProps<{
  modelValue: boolean
  title: string
  wordArts: WordArtInfo[]
}>()
const emit = defineEmits<{ 'update:modelValue': [value: boolean] }>()

function effectLabel(effect: string): string {
  return t('wordart.effect.' + effect) || t('wordart.effect.unknown')
}
</script>

<template>
  <CollapsiblePanel
    v-if="props.wordArts.length > 0"
    :model-value="props.modelValue"
    :title="props.title"
    :summary="t('wordart.summary')"
    panel-class="wordart-panel"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <div class="wordart-content">
      <div v-for="(wa, idx) in props.wordArts" :key="idx" class="wordart-item">
        <div class="wordart-header">
          <span class="wordart-id">{{ t('wordart.id', { id: wa.id }) }}</span>
          <span v-for="(effect, eIdx) in wa.effects" :key="eIdx" class="wordart-effect">{{ effectLabel(effect) }}</span>
        </div>
        <div v-if="wa.text" class="wordart-text">
          <span class="wordart-label">{{ t('wordart.text') }}</span>
          <span class="wordart-value">{{ wa.text }}</span>
        </div>
        <div class="wordart-name">
          <span class="wordart-label">{{ t('wordart.name') }}</span>
          <span class="wordart-value">{{ wa.name }}</span>
        </div>
        <div v-if="wa.colors && wa.colors.length > 0" class="wordart-colors">
          <span class="wordart-label">{{ t('wordart.colors') }}</span>
          <div class="wordart-color-list">
            <span
              v-for="(color, cIdx) in wa.colors"
              :key="cIdx"
              class="wordart-color"
              :style="{ backgroundColor: color }"
              :title="color"
            ></span>
          </div>
        </div>
      </div>
    </div>
  </CollapsiblePanel>
</template>

<style scoped>
.wordart-panel {
  max-width: 800px;
  margin: 0 auto 32px auto;
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  overflow: hidden;
}
.wordart-content { padding: 12px 16px; display: grid; gap: 10px; }
.wordart-item { padding: 8px 12px; background: var(--bg-primary); border-left: 3px solid #e74c3c; border-radius: 4px; font-size: 0.85rem; }
.wordart-header { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; margin-bottom: 4px; }
.wordart-id { color: var(--text-primary); font-weight: 600; }
.wordart-effect { background: #e74c3c; color: white; padding: 1px 6px; border-radius: 3px; font-size: 0.75rem; font-weight: 600; }
.wordart-label { color: var(--text-muted); font-size: 0.78rem; }
.wordart-value { display: block; background: var(--bg-tertiary); padding: 4px 8px; border-radius: 3px; font-size: 0.78rem; word-break: break-all; margin-top: 2px; color: var(--text-primary); }
.wordart-color-list { display: flex; gap: 6px; margin-top: 4px; }
.wordart-color { width: 20px; height: 20px; border-radius: 4px; border: 1px solid var(--border-color); cursor: pointer; }
</style>
