<script setup lang="ts">
import { computed } from 'vue'
import CollapsiblePanel from './CollapsiblePanel.vue'
import { t } from '../utils/locale'

interface DocStatsData {
  wordCount: number
  charCount: number
  paragraphCount: number
  pageCount: number
  imageCount: number
  tableCount: number
}

const props = defineProps<{
  /** 是否展开 */
  modelValue: boolean
  /** 统计数据 */
  stats: DocStatsData
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
}>()

const items = computed(() => [
  { value: props.stats.wordCount.toLocaleString(), label: t('stats.words') },
  { value: props.stats.charCount.toLocaleString(), label: t('stats.chars') },
  { value: props.stats.paragraphCount.toLocaleString(), label: t('stats.paragraphs') },
  { value: props.stats.pageCount, label: t('stats.pages') },
  { value: props.stats.imageCount, label: t('stats.images') },
  { value: props.stats.tableCount, label: t('stats.tables') },
])
</script>

<template>
  <CollapsiblePanel
    v-if="stats.paragraphCount > 0"
    :model-value="modelValue"
    @update:model-value="emit('update:modelValue', $event)"
    :title="t('stats.title')"
    :summary="t('stats.summary', { words: stats.wordCount, paras: stats.paragraphCount, pages: stats.pageCount })"
    panel-class="stats-panel"
  >
    <div class="stats-grid">
      <div v-for="(item, idx) in items" :key="idx" class="stat-item">
        <span class="stat-value">{{ item.value }}</span>
        <span class="stat-label">{{ item.label }}</span>
      </div>
    </div>
  </CollapsiblePanel>
</template>
