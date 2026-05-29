<script setup lang="ts">
import { ref } from 'vue'
import DocPreview from './components/DocPreview.vue'

const selectedFile = ref<File | null>(null)
const urlInput = ref('')
const previewSource = ref<File | string | null>(null)

const isValidFile = (file: File): boolean => {
  const ext = file.name.toLowerCase()
  return ext.endsWith('.doc') || ext.endsWith('.dot')
}

const handleFileChange = (event: Event) => {
  const target = event.target as HTMLInputElement
  const file = target.files?.[0]
  if (file && isValidFile(file)) {
    selectedFile.value = file
    previewSource.value = file
  }
}

const handleDrop = (event: DragEvent) => {
  event.preventDefault()
  const file = event.dataTransfer?.files?.[0]
  if (file && isValidFile(file)) {
    selectedFile.value = file
    previewSource.value = file
  }
}

const handleDragOver = (event: DragEvent) => {
  event.preventDefault()
}

const loadFromUrl = () => {
  const url = urlInput.value.trim()
  if (!url) return
  previewSource.value = url
  selectedFile.value = null // 清除文件选择状态
}

const resetFile = () => {
  selectedFile.value = null
  previewSource.value = null
  urlInput.value = ''
}
</script>

<template>
  <div class="app-container">
    <header class="header">
      <h1>DOC文件在线预览</h1>
      <p>上传或通过地址加载 .doc 文件进行在线预览（纯前端实现）</p>
    </header>

    <main class="main-content">
      <template v-if="!previewSource">
        <div
          class="upload-area"
          @drop="handleDrop"
          @dragover="handleDragOver"
        >
          <div class="upload-icon">📄</div>
          <h2>选择或拖拽DOC文档</h2>
          <p>支持 .doc / .dot 格式文件</p>
          <label class="upload-btn">
            <input
              type="file"
              accept=".doc,.dot"
              @change="handleFileChange"
              class="file-input"
            />
            <span>点击选择文件</span>
          </label>

          <div class="url-section">
            <div class="divider"><span>或者</span></div>
            <div class="url-input-row">
              <input
                type="text"
                v-model="urlInput"
                placeholder="输入 .doc 文件地址..."
                class="url-input"
                @keyup.enter="loadFromUrl"
              />
              <button class="url-btn" @click="loadFromUrl">加载</button>
            </div>
          </div>
        </div>
      </template>

      <template v-else>
        <div class="preview-header">
          <button class="back-btn" @click="resetFile">
            ← 返回
          </button>
        </div>
        <DocPreview :source="previewSource" />
      </template>
    </main>
  </div>
</template>

<style scoped>
.app-container {
  width: 100%;
  min-height: 100vh;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
}

.header {
  text-align: center;
  padding: 40px 20px;
  color: white;
}

.header h1 {
  font-size: 2.5rem;
  margin-bottom: 10px;
  text-shadow: 2px 2px 4px rgba(0, 0, 0, 0.2);
}

.header p {
  font-size: 1.1rem;
  opacity: 0.9;
}

.main-content {
  max-width: 900px;
  margin: 0 auto;
  padding: 0 20px 40px;
}

.upload-area {
  background: white;
  border-radius: 16px;
  padding: 60px 40px;
  text-align: center;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.15);
  border: 3px dashed #ddd;
  transition: all 0.3s ease;
}

.upload-area:hover {
  border-color: #667eea;
  box-shadow: 0 25px 70px rgba(0, 0, 0, 0.2);
}

.upload-icon {
  font-size: 6rem;
  margin-bottom: 20px;
}

.upload-area h2 {
  font-size: 1.8rem;
  color: #333;
  margin-bottom: 10px;
}

.upload-area p {
  color: #666;
  margin-bottom: 10px;
}

.format-tips {
  margin-bottom: 30px;
}

.tip {
  font-size: 0.9rem;
  color: #888;
  background: #f8f9fa;
  padding: 8px 16px;
  border-radius: 20px;
}

.upload-btn {
  display: inline-block;
  padding: 14px 40px;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
  border-radius: 30px;
  font-size: 1.1rem;
  cursor: pointer;
  transition: transform 0.2s ease, box-shadow 0.2s ease;
  box-shadow: 0 4px 15px rgba(102, 126, 234, 0.4);
}

.upload-btn:hover {
  transform: translateY(-2px);
  box-shadow: 0 6px 20px rgba(102, 126, 234, 0.5);
}

.file-input {
  display: none;
}

.url-section {
  margin-top: 30px;
}

.divider {
  display: flex;
  align-items: center;
  margin-bottom: 16px;
  color: #999;
  font-size: 0.85rem;
}

.divider::before,
.divider::after {
  content: '';
  flex: 1;
  border-top: 1px solid #e0e0e0;
}

.divider span {
  padding: 0 16px;
}

.url-input-row {
  display: flex;
  gap: 8px;
}

.url-input {
  flex: 1;
  padding: 12px 16px;
  border: 2px solid #e0e0e0;
  border-radius: 8px;
  font-size: 0.95rem;
  outline: none;
  transition: border-color 0.2s;
}

.url-input:focus {
  border-color: #667eea;
}

.url-btn {
  padding: 12px 24px;
  background: #667eea;
  color: white;
  border: none;
  border-radius: 8px;
  font-size: 0.95rem;
  cursor: pointer;
  transition: background 0.2s;
  white-space: nowrap;
}

.url-btn:hover {
  background: #5a6fd6;
}

.preview-header {
  background: white;
  border-radius: 16px 16px 0 0;
  padding: 20px 30px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  box-shadow: 0 4px 15px rgba(0, 0, 0, 0.1);
}

.file-name {
  font-size: 1.1rem;
  font-weight: 600;
  color: #333;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 70%;
}

.back-btn {
  padding: 8px 20px;
  background: #f0f0f0;
  border: none;
  border-radius: 8px;
  font-size: 0.95rem;
  cursor: pointer;
  transition: all 0.2s ease;
}

.back-btn:hover {
  background: #e0e0e0;
}
</style>
