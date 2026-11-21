<script setup lang="ts">
import { t } from '../utils/locale'
import type { SectionInfo } from '../utils/docFormat'
import CollapsiblePanel from './CollapsiblePanel.vue'

const props = defineProps<{
  modelValue: boolean
  title: string
  sections: SectionInfo[]
  formatSizePt: (pt: number | undefined) => string
}>()
const emit = defineEmits<{ 'update:modelValue': [value: boolean] }>()
</script>

<template>
  <CollapsiblePanel
    v-if="props.sections.length > 0"
    :model-value="props.modelValue"
    :title="props.title"
    :summary="t('sections.summary')"
    panel-class="sections-panel"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <div class="sections-content">
      <div v-for="(sec, idx) in props.sections" :key="idx" class="section-item">
        <div class="section-header">
          <span class="section-index">{{ t('sections.index', { n: sec.index }) }}</span>
          <span v-if="sec.breakType" class="section-break">{{ t('sections.break.' + sec.breakType) || sec.breakType }}</span>
          <span v-if="sec.orientation" class="section-orientation">
            {{ sec.orientation === 'landscape' ? t('sections.orientation.landscape') : t('sections.orientation.portrait') }}
          </span>
        </div>
        <div class="section-grid">
          <div v-if="sec.pageWidthPt && sec.pageHeightPt" class="section-field">
            <span class="section-field-label">{{ t('sections.pageSize') }}</span>
            <span class="section-field-value">{{ props.formatSizePt(sec.pageWidthPt) }} × {{ props.formatSizePt(sec.pageHeightPt) }}</span>
          </div>
          <div v-if="sec.marginLeftPt" class="section-field">
            <span class="section-field-label">{{ t('sections.marginLeft') }}</span>
            <span class="section-field-value">{{ props.formatSizePt(sec.marginLeftPt) }}</span>
          </div>
          <div v-if="sec.marginRightPt" class="section-field">
            <span class="section-field-label">{{ t('sections.marginRight') }}</span>
            <span class="section-field-value">{{ props.formatSizePt(sec.marginRightPt) }}</span>
          </div>
          <div v-if="sec.marginTopPt" class="section-field">
            <span class="section-field-label">{{ t('sections.marginTop') }}</span>
            <span class="section-field-value">{{ props.formatSizePt(sec.marginTopPt) }}</span>
          </div>
          <div v-if="sec.marginBottomPt" class="section-field">
            <span class="section-field-label">{{ t('sections.marginBottom') }}</span>
            <span class="section-field-value">{{ props.formatSizePt(sec.marginBottomPt) }}</span>
          </div>
          <div v-if="sec.gutterPt" class="section-field">
            <span class="section-field-label">{{ t('sections.gutter') }}</span>
            <span class="section-field-value">{{ props.formatSizePt(sec.gutterPt) }}</span>
          </div>
          <div v-if="sec.columnCount && sec.columnCount > 1" class="section-field">
            <span class="section-field-label">{{ t('sections.columns') }}</span>
            <span class="section-field-value">
              {{ sec.columnCount }} {{ t('sections.columns') }}
              <span v-if="sec.columnSpacingPt">{{ t('sections.columns.gap', { pt: props.formatSizePt(sec.columnSpacingPt) }) }}</span>
            </span>
          </div>
          <div v-if="sec.pageStart !== undefined" class="section-field">
            <span class="section-field-label">{{ t('sections.startPageNum') }}</span>
            <span class="section-field-value">{{ sec.pageStart }}</span>
          </div>
        </div>
      </div>
    </div>
  </CollapsiblePanel>
</template>

<style scoped>
.sections-panel {
  max-width: 800px;
  margin: 0 auto 32px auto;
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  overflow: hidden;
}
.sections-content { padding: 12px 16px; display: grid; gap: 12px; }
.section-item { padding: 10px 12px; background: var(--bg-primary); border-left: 3px solid #9b59b6; border-radius: 4px; }
.section-header { display: flex; align-items: baseline; gap: 10px; margin-bottom: 8px; flex-wrap: wrap; }
.section-index { font-weight: 600; color: var(--text-primary); font-size: 0.9rem; }
.section-break, .section-orientation { display: inline-block; padding: 2px 8px; border-radius: 10px; font-size: 0.75rem; background: rgba(155, 89, 182, 0.12); color: #9b59b6; }
.section-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 6px 16px; }
.section-field { display: flex; flex-direction: column; gap: 2px; }
.section-field-label { color: var(--text-muted); font-size: 0.72rem; }
.section-field-value { color: var(--text-primary); font-size: 0.82rem; font-variant-numeric: tabular-nums; }
</style>
