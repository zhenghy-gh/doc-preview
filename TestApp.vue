<template>
  <div class="container">
    <h1>📄 DOC Preview NPM 包测试</h1>
    <p class="subtitle">模拟 npm 包使用方式，本地测试 @zhenghy/doc-preview</p>
    
    <div 
      class="upload-area" 
      :class="{ dragover: isDragover }"
      @click="handleClick"
      @dragover.prevent="isDragover = true"
      @dragleave="isDragover = false"
      @drop.prevent="handleDrop"
    >
      <div class="upload-icon">📤</div>
      <div class="upload-text">点击或拖拽上传 .doc 文件</div>
      <input 
        ref="fileInput"
        type="file" 
        class="file-input" 
        accept=".doc"
        @change="handleFileChange"
      >
    </div>
    
    <div v-if="currentFile" class="file-info">
      <div class="file-name">文件名: {{ currentFile.name }}</div>
      <div class="file-size">大小: {{ formatFileSize(currentFile.size) }}</div>
    </div>
    
    <div v-if="errorMessage" class="error-message">
      {{ errorMessage }}
    </div>
    
    <div class="preview-container">
      <div v-if="isLoading" class="loading">加载中...</div>
      <DocPreview 
        v-else-if="currentFile"
        :source="currentFile"
        @error="handleError"
      />
      <div v-else class="empty-state">
        请选择一个 .doc 文件开始预览
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
// 真实从 npm 包导入（就像用户在自己项目中使用一样）
import { DocPreview } from '@zhenghy/doc-preview'
import './src/style.css'

const fileInput = ref<HTMLInputElement | null>(null)
const currentFile = ref<File | null>(null)
const isDragover = ref(false)
const isLoading = ref(false)
const errorMessage = ref('')

function handleClick() {
  fileInput.value?.click()
}

function handleFileChange(event: Event) {
  const target = event.target as HTMLInputElement
  const file = target.files?.[0]
  if (file) {
    processFile(file)
  }
}

function handleDrop(event: DragEvent) {
  isDragover.value = false
  const file = event.dataTransfer?.files?.[0]
  if (file) {
    processFile(file)
  }
}

function processFile(file: File) {
  if (!file.name.endsWith('.doc')) {
    errorMessage.value = '请选择 .doc 格式的文件'
    return
  }
  
  errorMessage.value = ''
  isLoading.value = true
  
  setTimeout(() => {
    currentFile.value = file
    isLoading.value = false
  }, 100)
}

function handleError(error: Error) {
  errorMessage.value = `解析失败: ${error.message}`
  isLoading.value = false
  console.error('DOC 解析失败:', error)
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}
</script>

<style scoped>
.container {
  background: white;
  border-radius: 12px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
  padding: 30px;
  max-width: 900px;
  margin: 0 auto;
}

h1 {
  color: #333;
  margin-bottom: 10px;
  font-size: 28px;
}

.subtitle {
  color: #666;
  margin-bottom: 30px;
  font-size: 14px;
}

.upload-area {
  border: 3px dashed #667eea;
  border-radius: 12px;
  padding: 40px;
  text-align: center;
  cursor: pointer;
  transition: all 0.3s ease;
  margin-bottom: 20px;
}

.upload-area:hover,
.upload-area.dragover {
  background: #f0f4ff;
  border-color: #764ba2;
}

.upload-icon {
  font-size: 48px;
  margin-bottom: 15px;
}

.upload-text {
  color: #666;
  font-size: 16px;
}

.file-input {
  display: none;
}

.file-info {
  background: #f5f5f5;
  padding: 15px;
  border-radius: 8px;
  margin-bottom: 20px;
}

.file-name {
  font-weight: bold;
  color: #333;
  margin-bottom: 5px;
}

.file-size {
  color: #666;
  font-size: 14px;
}

.error-message {
  background: #fee;
  color: #c33;
  padding: 15px;
  border-radius: 8px;
  margin-bottom: 20px;
}

.preview-container {
  border: 1px solid #e0e0e0;
  border-radius: 8px;
  padding: 20px;
  min-height: 200px;
  background: #fafafa;
}

.loading {
  text-align: center;
  padding: 60px;
  color: #666;
}

.loading::after {
  content: '';
  display: inline-block;
  width: 20px;
  height: 20px;
  border: 2px solid #667eea;
  border-top-color: transparent;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
  margin-left: 10px;
  vertical-align: middle;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.empty-state {
  text-align: center;
  color: #999;
  padding: 60px;
}
</style>
