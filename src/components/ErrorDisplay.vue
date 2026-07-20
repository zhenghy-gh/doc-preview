<script setup lang="ts">
import { computed } from 'vue'
import { classifyError, ERROR_CATEGORY_ICON } from '../utils/errorClassifier'
import { currentLocale, t } from '../utils/locale'

const props = defineProps<{
  /** 原始错误信息 */
  error: string
}>()

const emit = defineEmits<{
  retry: []
}>()

const classified = computed(() =>
  classifyError(props.error, currentLocale.value === 'en' ? 'en' : 'zh-CN'),
)

const icon = computed(() => ERROR_CATEGORY_ICON[classified.value.category])
</script>

<template>
  <div class="error-container enhanced-error">
    <div class="error-icon">{{ icon }}</div>
    <div class="error-body">
      <div class="error-title">{{ classified.title }}</div>
      <div class="error-detail">{{ classified.detail }}</div>
      <ul v-if="classified.suggestions.length > 0" class="error-suggestions">
        <li v-for="(s, idx) in classified.suggestions" :key="idx">{{ s }}</li>
      </ul>
      <div class="error-actions">
        <button
          v-if="classified.retryable"
          class="error-retry-btn"
          @click="emit('retry')"
        >
          {{ t('error.retry') }}
        </button>
      </div>
      <details class="error-raw" v-if="classified.raw && classified.raw !== classified.detail">
        <summary>{{ t('error.details') }}</summary>
        <pre>{{ classified.raw }}</pre>
      </details>
    </div>
  </div>
</template>
