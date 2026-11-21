<script setup lang="ts">
import { t } from '../utils/locale'
import type { EquationInfo } from '../utils/docFormat'
import CollapsiblePanel from './CollapsiblePanel.vue'

const props = defineProps<{
  modelValue: boolean
  title: string
  equations: EquationInfo[]
}>()
const emit = defineEmits<{ 'update:modelValue': [value: boolean] }>()
</script>

<template>
  <CollapsiblePanel
    v-if="props.equations.length > 0"
    :model-value="props.modelValue"
    :title="props.title"
    :summary="t('equations.summary')"
    panel-class="equations-panel"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <div class="equations-content">
      <div v-for="(eq, idx) in props.equations" :key="idx" class="equation-item">
        <div class="equation-header">
          <span class="equation-id">{{ t('equations.id', { id: eq.id }) }}</span>
          <span v-if="eq.hasPicture" class="equation-has-picture">{{ t('equations.hasPicture') }}</span>
        </div>
        <div v-if="eq.latex" class="equation-latex">
          <span class="equation-label">{{ t('equations.latex') }}</span>
          <span class="equation-code">{{ eq.latex }}</span>
        </div>
        <div v-if="eq.eqnText" class="equation-eqntext">
          <span class="equation-label">{{ t('equations.original') }}</span>
          <span class="equation-code">{{ eq.eqnText }}</span>
        </div>
      </div>
    </div>
  </CollapsiblePanel>
</template>

<style scoped>
.equations-panel {
  max-width: 800px;
  margin: 0 auto 32px auto;
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  overflow: hidden;
}
.equations-content { padding: 12px 16px; display: grid; gap: 10px; }
.equation-item { padding: 8px 12px; background: var(--bg-primary); border-left: 3px solid #9b59b6; border-radius: 4px; font-size: 0.85rem; }
.equation-header { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; margin-bottom: 4px; }
.equation-id { color: var(--text-primary); font-weight: 600; }
.equation-has-picture { background: #27ae60; color: white; padding: 1px 6px; border-radius: 3px; font-size: 0.75rem; font-weight: 600; }
.equation-label { color: var(--text-muted); font-size: 0.78rem; }
.equation-code { display: block; background: var(--bg-tertiary); padding: 6px 10px; border-radius: 4px; font-family: 'SF Mono', Consolas, Monaco, monospace; font-size: 0.8rem; word-break: break-all; margin-top: 4px; color: var(--text-primary); }
.equation-latex .equation-code { color: #9b59b6; }
.equation-eqntext .equation-code { color: var(--text-muted); font-size: 0.75rem; }
</style>
