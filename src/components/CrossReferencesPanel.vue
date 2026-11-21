<script setup lang="ts">
import { t } from '../utils/locale'
import type { CrossReferenceRange } from '../utils/docFormat'
import CollapsiblePanel from './CollapsiblePanel.vue'

const props = defineProps<{
  modelValue: boolean
  title: string
  references: CrossReferenceRange[]
}>()
const emit = defineEmits<{ 'update:modelValue': [value: boolean] }>()
</script>

<template>
  <CollapsiblePanel
    v-if="props.references.length > 0"
    :model-value="props.modelValue"
    :title="props.title"
    summary="REF / NOTEREF"
    panel-class="cross-refs-panel"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <div class="cross-refs-content">
      <div v-for="(cr, idx) in props.references" :key="idx" class="cross-ref-item">
        <div class="cross-ref-header">
          <span class="cross-ref-type">{{ t('crossRefs.type.' + cr.type) || cr.type }}</span>
          <span v-if="cr.result" class="cross-ref-result">{{ t('crossRefs.show', { v: cr.result }) }}</span>
        </div>
        <div class="cross-ref-target">{{ t('crossRefs.target') }}: <code>{{ cr.targetBookmarkName }}</code></div>
        <div class="cross-ref-instruction">{{ t('crossRefs.instruction', { inst: cr.instruction }) }}</div>
        <div v-if="cr.switches.length > 0" class="cross-ref-switches">
          {{ t('crossRefs.switches') }}:
          <span
            v-for="sw in cr.switches"
            :key="sw"
            class="cross-ref-switch"
            :title="t('crossRefs.switch.' + sw.replace('\\\\', ''))"
          >{{ sw }}{{ t('crossRefs.switch.' + sw.replace('\\\\', '')) ? ` (${t('crossRefs.switch.' + sw.replace('\\\\', ''))})` : '' }}</span>
        </div>
        <div class="cross-ref-cp">CP: {{ cr.cpStart }} – {{ cr.cpEnd }}</div>
      </div>
    </div>
  </CollapsiblePanel>
</template>

<style scoped>
.cross-refs-panel {
  max-width: 800px;
  margin: 0 auto 32px auto;
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  overflow: hidden;
}
.cross-refs-content { padding: 12px 16px; display: grid; gap: 10px; }
.cross-ref-item { padding: 8px 12px; background: var(--bg-primary); border-left: 3px solid #8e44ad; border-radius: 4px; font-size: 0.85rem; }
.cross-ref-header { display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap; margin-bottom: 4px; }
.cross-ref-type { color: var(--text-primary); font-weight: 600; }
.cross-ref-result { color: #8e44ad; font-weight: 600; }
.cross-ref-target { color: var(--text-muted); font-size: 0.8rem; margin-top: 2px; }
.cross-ref-target code { background: var(--bg-tertiary); padding: 1px 6px; border-radius: 3px; font-family: 'SF Mono', Consolas, Monaco, monospace; color: #8e44ad; }
.cross-ref-instruction { color: var(--text-muted); font-size: 0.8rem; word-break: break-all; margin-top: 2px; }
.cross-ref-switches { color: var(--text-muted); font-size: 0.78rem; margin-top: 4px; display: flex; flex-wrap: wrap; gap: 6px; align-items: baseline; }
.cross-ref-switch { display: inline-block; padding: 1px 6px; background: var(--bg-tertiary); border-radius: 3px; font-family: 'SF Mono', Consolas, Monaco, monospace; color: #8e44ad; font-size: 0.74rem; }
.cross-ref-cp { color: var(--text-muted); font-size: 0.75rem; font-variant-numeric: tabular-nums; margin-top: 2px; }
</style>
