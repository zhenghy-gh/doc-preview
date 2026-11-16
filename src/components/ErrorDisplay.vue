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
  <div class="error-container enhanced-error" role="alert" aria-atomic="true">
    <div class="error-icon" aria-hidden="true">{{ icon }}</div>
    <div class="error-body">
      <div class="error-title">{{ classified.title }}</div>
      <div class="error-detail">{{ classified.detail }}</div>
      <ul v-if="classified.suggestions.length > 0" class="error-suggestions">
        <li v-for="(s, idx) in classified.suggestions" :key="idx">{{ s }}</li>
      </ul>
      <div class="error-actions">
        <button
          v-if="classified.retryable"
          type="button"
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

<style scoped>
.error-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 100px 20px;
  background: var(--bg-secondary);
  border-radius: 0 0 16px 16px;
}

.error-icon {
  font-size: 4rem;
  margin-bottom: 20px;
}

.error-message {
  color: var(--error-text);
  font-size: 1.1rem;
  text-align: center;
  white-space: pre-line;
  max-width: 480px;
  line-height: 1.6;
}

.enhanced-error {
  flex-direction: row;
  gap: 16px;
  text-align: left;
  align-items: flex-start;
  max-width: 720px;
  margin: 0 auto;
}

.enhanced-error .error-icon {
  font-size: 2.5rem;
  margin-bottom: 0;
  flex-shrink: 0;
}

.enhanced-error .error-body {
  flex: 1;
  min-width: 0;
}

.enhanced-error .error-title {
  font-size: 1.2rem;
  font-weight: 600;
  color: var(--error-text);
  margin-bottom: 8px;
}

.enhanced-error .error-detail {
  color: var(--text-primary);
  font-size: 0.95rem;
  line-height: 1.5;
  margin-bottom: 12px;
  white-space: pre-line;
}

.enhanced-error .error-suggestions {
  margin: 0 0 12px 0;
  padding-left: 20px;
  color: var(--text-secondary);
  font-size: 0.9rem;
  line-height: 1.6;
}

.enhanced-error .error-suggestions li {
  margin-bottom: 4px;
}

.enhanced-error .error-actions {
  margin-bottom: 8px;
}

.enhanced-error .error-retry-btn {
  background: var(--accent-action, #4d5fc7);
  color: #fff;
  border: none;
  padding: 6px 16px;
  border-radius: 6px;
  font-size: 0.9rem;
  cursor: pointer;
  transition: opacity 0.2s;
}

.enhanced-error .error-retry-btn:hover {
  opacity: 0.85;
}

.enhanced-error .error-raw {
  margin-top: 8px;
  font-size: 0.85rem;
  color: var(--text-secondary);
}

.enhanced-error .error-raw summary {
  cursor: pointer;
  user-select: none;
  padding: 4px 0;
}

.enhanced-error .error-raw pre {
  margin-top: 8px;
  padding: 8px 12px;
  background: var(--bg-secondary);
  border-radius: 4px;
  overflow-x: auto;
  font-family: 'SF Mono', Monaco, monospace;
  font-size: 0.8rem;
  color: var(--text-secondary);
  white-space: pre-wrap;
  word-break: break-all;
}

@media (max-width: 640px) {
  .error-container {
    padding: 60px 20px;
  }
}
</style>
