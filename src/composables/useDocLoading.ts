/**
 * useDocLoading —— 加载态、错误态、进度与秒表（从 DocPreview.vue 抽离）。
 */
import { ref } from 'vue'
import type { ParseProgressStage } from '../utils/docParser'
import type { ParseErrorCode, Translator } from '../utils/docFormat'

export function useDocLoading(t: Translator) {
  const loading = ref(true)
  const error = ref('')
  /** 结构化错误码：与 error 同步设置/清空，供 ErrorDisplay 直映射分类 */
  const errorCode = ref<ParseErrorCode | undefined>(undefined)
  const loadingTime = ref(0)
  const loadingTimer = ref<ReturnType<typeof setInterval> | null>(null)
  const fileSize = ref('')
  const progressStep = ref('')
  const progressPercent = ref<number>(-1)
  const isUsingWorker = ref(false)

  function getProgressStepText(stage: ParseProgressStage): string {
    switch (stage) {
      case 'verifying': return t('loading.progress.reading')
      case 'parsing_fib':
      case 'parsing_clx':
      case 'parsing_formats':
      case 'parsing_fields':
      case 'parsing_shapes': return t('loading.progress.parsing')
      case 'building_paragraphs':
      case 'extracting_properties':
      case 'extracting_images':
      case 'finalizing': return t('loading.progress.rendering')
      default: return t('loading.text')
    }
  }

  /** 启动解析秒表：先清理上一轮定时器，避免快速切源时叠加。 */
  function startLoadingTimer() {
    stopLoadingTimer()
    loadingTime.value = 0
    loadingTimer.value = setInterval(() => loadingTime.value++, 1000)
  }
  function stopLoadingTimer() {
    if (loadingTimer.value) {
      clearInterval(loadingTimer.value)
      loadingTimer.value = null
    }
  }

  function resetProgress() {
    progressPercent.value = -1
    progressStep.value = ''
  }

  return {
    loading, error, errorCode, loadingTime, loadingTimer, fileSize,
    progressStep, progressPercent, isUsingWorker,
    getProgressStepText, startLoadingTimer, stopLoadingTimer, resetProgress,
  }
}
