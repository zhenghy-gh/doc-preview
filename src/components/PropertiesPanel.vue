<script setup lang="ts">
import { t } from '../utils/locale'
import type { DocumentFields } from '../utils/fieldParser'
import type { DocumentProperties } from '../utils/propertyParser'
import CollapsiblePanel from './CollapsiblePanel.vue'

/**
 * 文档属性面板：SummaryInformation 元数据 + PlcfFld 文档域。
 * 两个面板在 DocPreview 中共用同一个展开状态（showProperties），此处保持一致。
 */
const props = defineProps<{
  modelValue: boolean
  title: string
  summary: string
  docFieldsTitle: string
  docFieldsSummary: string
  properties: DocumentProperties | null
  docFields: DocumentFields | null
  styleSetLabel: string
  wordVersionLabel: string
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
}>()
</script>

<template>
  <CollapsiblePanel
    v-if="props.properties"
    :model-value="props.modelValue"
    :title="props.title"
    :summary="props.summary"
    panel-class="properties-panel"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <div v-if="props.properties.title" class="property-item">
      <span class="property-label">{{ t('props.field.title') }}:</span>
      <span class="property-value">{{ props.properties.title }}</span>
    </div>
    <div v-if="props.properties.subject" class="property-item">
      <span class="property-label">{{ t('props.field.subject') }}:</span>
      <span class="property-value">{{ props.properties.subject }}</span>
    </div>
    <div v-if="props.properties.author" class="property-item">
      <span class="property-label">{{ t('props.field.author') }}:</span>
      <span class="property-value">{{ props.properties.author }}</span>
    </div>
    <div v-if="props.properties.lastAuthor" class="property-item">
      <span class="property-label">{{ t('props.field.lastAuthor') }}:</span>
      <span class="property-value">{{ props.properties.lastAuthor }}</span>
    </div>
    <div v-if="props.properties.keywords" class="property-item">
      <span class="property-label">{{ t('props.field.keywords') }}:</span>
      <span class="property-value">{{ props.properties.keywords }}</span>
    </div>
    <div v-if="props.properties.comments" class="property-item">
      <span class="property-label">{{ t('props.field.comments') }}:</span>
      <span class="property-value">{{ props.properties.comments }}</span>
    </div>
    <div v-if="props.properties.pageCount" class="property-item">
      <span class="property-label">{{ t('props.pages') }}:</span>
      <span class="property-value">{{ props.properties.pageCount }}</span>
    </div>
    <div v-if="props.properties.wordCount" class="property-item">
      <span class="property-label">{{ t('props.words') }}:</span>
      <span class="property-value">{{ props.properties.wordCount }}</span>
    </div>
    <div v-if="props.properties.charCount" class="property-item">
      <span class="property-label">{{ t('props.chars') }}:</span>
      <span class="property-value">{{ props.properties.charCount }}</span>
    </div>
    <div v-if="props.properties.category" class="property-item">
      <span class="property-label">{{ t('props.category') }}:</span>
      <span class="property-value">{{ props.properties.category }}</span>
    </div>
    <div v-if="props.properties.company" class="property-item">
      <span class="property-label">{{ t('props.company') }}:</span>
      <span class="property-value">{{ props.properties.company }}</span>
    </div>
    <div v-if="props.properties.manager" class="property-item">
      <span class="property-label">{{ t('props.manager') }}:</span>
      <span class="property-value">{{ props.properties.manager }}</span>
    </div>
    <div v-if="props.properties.template" class="property-item">
      <span class="property-label">{{ t('props.template') }}:</span>
      <span class="property-value">{{ props.properties.template }}</span>
    </div>
    <div v-if="props.styleSetLabel" class="property-item">
      <span class="property-label">{{ t('props.styleSet') }}:</span>
      <span class="property-value">{{ props.styleSetLabel }}</span>
    </div>
    <div v-if="props.properties.appName" class="property-item">
      <span class="property-label">{{ t('props.appName') }}:</span>
      <span class="property-value">{{ props.properties.appName }}</span>
    </div>
    <div v-if="props.wordVersionLabel" class="property-item">
      <span class="property-label">{{ t('props.wordVersion') }}:</span>
      <span class="property-value">{{ props.wordVersionLabel }}</span>
    </div>
    <div v-if="props.properties.revisionNumber" class="property-item">
      <span class="property-label">{{ t('props.revisionNumber') }}:</span>
      <span class="property-value">{{ props.properties.revisionNumber }}</span>
    </div>
    <div v-if="props.properties.lineCount" class="property-item">
      <span class="property-label">{{ t('props.lines') }}:</span>
      <span class="property-value">{{ props.properties.lineCount }}</span>
    </div>
    <div v-if="props.properties.paragraphCount" class="property-item">
      <span class="property-label">{{ t('props.paragraphs') }}:</span>
      <span class="property-value">{{ props.properties.paragraphCount }}</span>
    </div>
    <div v-if="props.properties.charCountWithSpaces" class="property-item">
      <span class="property-label">{{ t('props.charsWithSpaces') }}:</span>
      <span class="property-value">{{ props.properties.charCountWithSpaces }}</span>
    </div>
  </CollapsiblePanel>

  <CollapsiblePanel
    v-if="props.docFields"
    :model-value="props.modelValue"
    :title="props.docFieldsTitle"
    :summary="props.docFieldsSummary"
    panel-class="properties-panel"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <div v-if="props.docFields.title" class="property-item">
      <span class="property-label">{{ t('props.field.title') }}:</span>
      <span class="property-value">{{ props.docFields.title }}</span>
    </div>
    <div v-if="props.docFields.author" class="property-item">
      <span class="property-label">{{ t('props.field.author') }}:</span>
      <span class="property-value">{{ props.docFields.author }}</span>
    </div>
    <div v-if="props.docFields.subject" class="property-item">
      <span class="property-label">{{ t('props.field.subject') }}:</span>
      <span class="property-value">{{ props.docFields.subject }}</span>
    </div>
    <div v-if="props.docFields.keywords" class="property-item">
      <span class="property-label">{{ t('props.field.keywords') }}:</span>
      <span class="property-value">{{ props.docFields.keywords }}</span>
    </div>
    <div v-if="props.docFields.comments" class="property-item">
      <span class="property-label">{{ t('props.field.comments') }}:</span>
      <span class="property-value">{{ props.docFields.comments }}</span>
    </div>
    <div v-if="props.docFields.lastSavedBy" class="property-item">
      <span class="property-label">{{ t('props.field.lastSavedBy') }}:</span>
      <span class="property-value">{{ props.docFields.lastSavedBy }}</span>
    </div>
    <div v-if="props.docFields.createDate" class="property-item">
      <span class="property-label">{{ t('props.field.created') }}:</span>
      <span class="property-value">{{ props.docFields.createDate }}</span>
    </div>
    <div v-if="props.docFields.lastSavedDate" class="property-item">
      <span class="property-label">{{ t('props.field.lastSaved') }}:</span>
      <span class="property-value">{{ props.docFields.lastSavedDate }}</span>
    </div>
    <div v-if="props.docFields.printDate" class="property-item">
      <span class="property-label">{{ t('props.field.printed') }}:</span>
      <span class="property-value">{{ props.docFields.printDate }}</span>
    </div>
    <div v-if="props.docFields.date" class="property-item">
      <span class="property-label">{{ t('props.field.date') }}:</span>
      <span class="property-value">{{ props.docFields.date }}</span>
    </div>
    <div v-if="props.docFields.time" class="property-item">
      <span class="property-label">{{ t('props.field.time') }}:</span>
      <span class="property-value">{{ props.docFields.time }}</span>
    </div>
    <div v-if="props.docFields.revisionNumber" class="property-item">
      <span class="property-label">{{ t('props.field.revision') }}:</span>
      <span class="property-value">{{ props.docFields.revisionNumber }}</span>
    </div>
  </CollapsiblePanel>
</template>

<style scoped>
.properties-panel {
  max-width: 800px;
  margin: 0 auto 32px auto;
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  overflow: hidden;
}

:deep(.stories-content) {
  padding: 16px;
  display: grid;
  gap: 12px;
}

.property-item {
  display: flex;
  align-items: baseline;
  gap: 12px;
}

.property-label {
  color: var(--text-muted);
  font-size: 0.85rem;
  min-width: 80px;
}

.property-value {
  color: var(--text-primary);
  font-size: 0.9rem;
  word-break: break-word;
}
</style>
