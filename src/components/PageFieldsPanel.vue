<script setup lang="ts">
import { t } from '../utils/locale'
import type { PageFieldRange } from '../utils/docFormat'
import CollapsiblePanel from './CollapsiblePanel.vue'

const props = defineProps<{
  modelValue: boolean
  title: string
  fields: PageFieldRange[]
}>()
const emit = defineEmits<{ 'update:modelValue': [value: boolean] }>()
</script>

<template>
  <CollapsiblePanel
    v-if="props.fields.length > 0"
    :model-value="props.modelValue"
    :title="props.title"
    summary="PAGE / NUMPAGES"
    panel-class="page-fields-panel"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <div class="page-fields-content">
      <div v-for="(pf, idx) in props.fields" :key="idx" class="page-field-item">
        <div class="page-field-header">
          <span class="page-field-type">{{ t('pageFields.type.' + pf.type) || pf.type }}</span>
          <span v-if="pf.result" class="page-field-result">{{ t('pageFields.value', { v: pf.result }) }}</span>
        </div>
        <div class="page-field-instruction">{{ t('pageFields.instruction', { inst: pf.instruction }) }}</div>
        <div class="page-field-cp">CP: {{ pf.cpStart }} – {{ pf.cpEnd }}</div>
      </div>
    </div>
  </CollapsiblePanel>
</template>

<style scoped>
.page-fields-panel {
  max-width: 800px;
  margin: 0 auto 32px auto;
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  overflow: hidden;
}
.page-fields-content { padding: 12px 16px; display: grid; gap: 10px; }
.page-field-item { padding: 8px 12px; background: var(--bg-primary); border-left: 3px solid #16a085; border-radius: 4px; font-size: 0.85rem; }
.page-field-header { display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap; margin-bottom: 4px; }
.page-field-type { color: var(--text-primary); font-weight: 600; }
.page-field-result { color: #16a085; font-weight: 600; font-variant-numeric: tabular-nums; }
.page-field-instruction { color: var(--text-muted); font-size: 0.8rem; word-break: break-all; }
.page-field-cp { color: var(--text-muted); font-size: 0.75rem; font-variant-numeric: tabular-nums; margin-top: 2px; }
</style>
