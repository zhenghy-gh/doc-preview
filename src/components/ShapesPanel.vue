<script setup lang="ts">
import { t } from '../utils/locale'
import type { ShapeInfo } from '../utils/docFormat'
import CollapsiblePanel from './CollapsiblePanel.vue'

const props = defineProps<{
  modelValue: boolean
  title: string
  shapes: ShapeInfo[]
}>()
const emit = defineEmits<{ 'update:modelValue': [value: boolean] }>()
</script>

<template>
  <CollapsiblePanel
    v-if="props.shapes.length > 0"
    :model-value="props.modelValue"
    :title="props.title"
    :summary="t('shapes.summary')"
    panel-class="shapes-panel"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <div class="shapes-content">
      <div v-for="(shape, idx) in props.shapes" :key="idx" class="shape-item">
        <div class="shape-header">
          <span class="shape-type">{{ t('shapes.type.' + shape.type) || shape.type }}</span>
          <span v-if="shape.floating" class="shape-floating">{{ t('shapes.floating') }}</span>
          <span v-if="shape.hasPicture" class="shape-picture">{{ t('shapes.hasPicture') }}</span>
        </div>
        <div class="shape-spid">{{ t('shapes.spid', { id: shape.spid }) }}</div>
        <div v-if="shape.x !== undefined && shape.y !== undefined" class="shape-position">
          {{ t('shapes.position', { x: shape.x, y: shape.y }) }}
        </div>
        <div v-if="shape.width !== undefined && shape.height !== undefined" class="shape-size">
          {{ t('shapes.size', { w: shape.width, h: shape.height }) }}
        </div>
        <div class="shape-anchor">
          {{ t('shapes.anchorType', { type: t('shapes.anchor.' + shape.anchorType) || shape.anchorType, cp: shape.anchorCp !== undefined ? shape.anchorCp : '' }) }}
        </div>
        <div v-if="shape.fcPic !== undefined" class="shape-fcpic">{{ t('shapes.fcPic', { fc: shape.fcPic }) }}</div>
        <div v-if="shape.name" class="shape-name">{{ t('shapes.name', { name: shape.name }) }}</div>
        <div v-if="shape.groupId !== undefined" class="shape-group">{{ t('shapes.groupId', { id: shape.groupId }) }}</div>
      </div>
    </div>
  </CollapsiblePanel>
</template>

<style scoped>
.shapes-panel {
  max-width: 800px;
  margin: 0 auto 32px auto;
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  overflow: hidden;
}
.shapes-content { padding: 12px 16px; display: grid; gap: 10px; }
.shape-item { padding: 8px 12px; background: var(--bg-primary); border-left: 3px solid #3498db; border-radius: 4px; font-size: 0.85rem; }
.shape-header { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; margin-bottom: 4px; }
.shape-type { color: var(--text-primary); font-weight: 600; }
.shape-floating { background: #f1c40f; color: #333; padding: 1px 6px; border-radius: 3px; font-size: 0.75rem; font-weight: 600; }
.shape-picture { background: #27ae60; color: white; padding: 1px 6px; border-radius: 3px; font-size: 0.75rem; font-weight: 600; }
.shape-spid, .shape-position, .shape-size, .shape-anchor, .shape-fcpic, .shape-name, .shape-group { color: var(--text-muted); font-size: 0.8rem; margin-top: 2px; }
</style>
