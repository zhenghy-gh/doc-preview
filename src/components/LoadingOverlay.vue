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

const isIndeterminate = computed(() => (
  props.progressPercent === undefined ||
  !Number.isFinite(props.progressPercent) ||
  props.progressPercent < 0
))
const progressValue = computed(() =>
  Math.max(0, Math.min(100, Math.round(props.progressPercent ?? 0))),
)

const barStyle = computed(() => {
  if (isIndeterminate.value) return {}
  return { width: String(progressValue.value) + '%' }
})

const percentLabel = computed(() => {
  if (isIndeterminate.value) return ''
  return String(progressValue.value) + '%'
})
</script>

<template>
  <div class="loading-container">
    <div class="loading-spinner"></div>
    <p class="loading-step">{{ progressStep || t('loading.text') }}</p>
    <p class="loading-filename" v-if="fileName">{{ fileName }}</p>
    <div
      class="progress-track"
      role="progressbar"
      :aria-label="t('loading.progressbar')"
      :aria-valuemin="0"
      :aria-valuemax="100"
      :aria-valuenow="isIndeterminate ? undefined : progressValue"
      :aria-valuetext="isIndeterminate ? (progressStep || t('loading.text')) : percentLabel"
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
