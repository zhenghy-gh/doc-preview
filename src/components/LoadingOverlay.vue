<script setup lang="ts">
import { computed } from 'vue'
import { t } from '../utils/locale'

const props = defineProps<{
  /** 文件名 */
  fileName?: string
  /** 文件大小（已格式化字符串） */
  fileSize?: string
  /** 加载耗时（秒） */
  loadingTime?: number
  /** 是否使用 Worker */
  isUsingWorker?: boolean
  /** 进度阶段文字 */
  progressStep?: string
  /** 进度百分比 0-100，未提供时为 indeterminate 动画 */
  progressPercent?: number
}>()

const isIndeterminate = computed(
  () => props.progressPercent === undefined || props.progressPercent < 0,
)

const barStyle = computed(() => {
  if (isIndeterminate.value) return {}
  const pct = Math.max(0, Math.min(100, props.progressPercent as number))
  return { width: `${pct}%` }
})

const percentLabel = computed(() => {
  if (isIndeterminate.value) return ''
  return `${Math.round(props.progressPercent as number)}%`
})
</script>

<template>
  <div class="loading-container" role="status" aria-live="polite" aria-busy="true">
    <div class="loading-spinner" aria-hidden="true"></div>
    <p class="loading-step">{{ progressStep || t('loading.text') }}</p>
    <p class="loading-filename" v-if="fileName">{{ fileName }}</p>
    <div
      class="progress-track"
      role="progressbar"
      :aria-label="t('loading.progress.label')"
      :aria-valuemin="0"
      :aria-valuemax="100"
      :aria-valuenow="isIndeterminate ? undefined : Math.round(progressPercent as number)"
    >
      <div
        class="progress-bar"
        :class="{ indeterminate: isIndeterminate }"
        :style="barStyle"
      ></div>
    </div>
    <p class="progress-percent" v-if="!isIndeterminate">{{ percentLabel }}</p>
    <p class="loading-meta">
      <span v-if="fileSize">{{ t('loading.size', { size: fileSize }) }}</span>
      <span v-if="(loadingTime ?? 0) > 2">{{ t('loading.time', { sec: loadingTime }) }}</span>
      <span v-if="isUsingWorker" class="worker-badge">{{ t('loading.worker') }}</span>
    </p>
  </div>
</template>

<style scoped>
/* ==================== Loading ==================== */
.loading-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 100px 20px;
  background: var(--bg-secondary);
  border-radius: 0 0 16px 16px;
}

.loading-spinner {
  width: 50px;
  height: 50px;
  border: 4px solid var(--border-color);
  border-top: 4px solid var(--accent);
  border-radius: 50%;
  animation: spin 1s linear infinite;
  margin-bottom: 20px;
}

@keyframes spin {
  0% { transform: rotate(0deg); }
  100% { transform: rotate(360deg); }
}

.loading-container p {
  color: var(--text-secondary);
  font-size: 1.1rem;
}

.loading-step {
  margin-top: 4px;
  font-size: 0.95rem;
  min-height: 1.4em;
}

.progress-track {
  width: 280px;
  max-width: 80%;
  height: 6px;
  background: var(--border-color);
  border-radius: 4px;
  margin: 16px auto 8px;
  overflow: hidden;
}

.progress-bar {
  height: 100%;
  border-radius: 4px;
  background: linear-gradient(90deg, var(--accent), var(--accent-light));
  transition: width 0.3s ease;
}

.progress-bar.indeterminate {
  width: 35%;
  animation: progressIndeterminate 1.5s ease-in-out infinite;
  background: linear-gradient(
    90deg,
    var(--accent) 0%,
    var(--accent-light) 50%,
    var(--accent) 100%
  );
  background-size: 200% 100%;
  animation: progressIndeterminate 1.5s ease-in-out infinite,
             progressShimmer 2s linear infinite;
}

@keyframes progressIndeterminate {
  0% { transform: translateX(-100%); }
  100% { transform: translateX(380px); }
}

@keyframes progressShimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}

.loading-filename {
  color: var(--text-muted);
  font-size: 0.85rem;
  margin-top: 8px;
}

.loading-meta {
  color: var(--text-muted);
  font-size: 0.8rem;
  margin-top: 4px;
  display: flex;
  gap: 12px;
  justify-content: center;
  flex-wrap: wrap;
}

.worker-badge {
  background: var(--accent-light);
  color: var(--accent);
  padding: 2px 8px;
  border-radius: 10px;
  font-weight: 500;
  font-size: 0.75rem;
}

</style>
