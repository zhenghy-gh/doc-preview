<script setup lang="ts">
import { t } from '../utils/locale'
import CollapsiblePanel from './CollapsiblePanel.vue'

interface StorySection {
  key: string
  label: string
  text: string
  images?: Array<{ dataUrl: string; widthPx?: number; heightPx?: number; format?: string }>
}

const props = defineProps<{
  modelValue: boolean
  title: string
  sections: StorySection[]
  formatStoryText: (text: string) => string
}>()
const emit = defineEmits<{ 'update:modelValue': [value: boolean] }>()
</script>

<template>
  <CollapsiblePanel
    v-if="props.sections.length > 0"
    :model-value="props.modelValue"
    :title="props.title"
    :summary="props.sections.map((s) => s.label).join(' · ')"
    panel-class="stories-panel"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <div
      v-for="section in props.sections"
      :key="section.key"
      class="story-section"
      :class="'story-' + section.key"
    >
      <div class="story-section-title">{{ section.label }}</div>
      <div class="story-section-text" v-html="props.formatStoryText(section.text)"></div>
      <div v-if="section.images && section.images.length > 0" class="story-section-images">
        <div v-for="(img, idx) in section.images" :key="idx" class="story-image-item">
          <img
            :src="img.dataUrl"
            :alt="t('images.alt', { n: idx + 1 })"
            :style="{ maxWidth: '100%', height: 'auto', maxHeight: '200px' }"
            loading="lazy"
            decoding="async"
            class="story-image"
          />
          <span class="story-image-caption">{{ img.format?.toUpperCase() || t('story.image.caption', { fmt: '' }) }}</span>
        </div>
      </div>
    </div>
  </CollapsiblePanel>
</template>

<style scoped>
.stories-panel {
  max-width: 800px;
  margin: 0 auto 32px auto;
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  overflow: hidden;
}
.story-section { padding: 10px 12px; background: var(--bg-primary); border-left: 3px solid var(--accent); border-radius: 4px; }
.story-section-title { font-size: 0.8rem; font-weight: 600; color: var(--accent); margin-bottom: 6px; }
.story-section-text { font-size: 0.85rem; line-height: 1.6; color: var(--text-secondary); max-height: 240px; overflow-y: auto; }
.story-section-text :deep(p) { margin: 0 0 6px 0; }
.story-section-text :deep(p:last-child) { margin-bottom: 0; }
.story-section-images { margin-top: 10px; display: flex; flex-wrap: wrap; gap: 12px; }
.story-image-item { display: flex; flex-direction: column; align-items: center; gap: 4px; }
.story-image { border-radius: 4px; border: 1px solid var(--border-color); box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1); }
.story-image-caption { font-size: 0.75rem; color: var(--text-tertiary); }
</style>
