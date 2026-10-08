import { defineConfig } from 'vitest/config'
import { resolve } from 'path'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    exclude: ['tests/_*.test.ts', 'tests/*probe*.test.ts'],
    // 默认的 5000ms 是「单个用例」的预算，但它同时要承担**按需的模块图转换**：
    // 有 5 个测试文件在用例体内执行 `await import(...)`（其中 4 个还配
    // `vi.resetModules()` 以模拟页面刷新），首个这样的用例必须现场重新转换并
    // 求值整张模块图。59 个文件并行时该步会超过 5s —— 实测套件的 environment
    // 阶段可达 1700–1900s，而这些用例单独跑只需 0.7–1.2s。
    // 连续三次全量运行各失败在**不同**文件（locale → useI18n → chartRenderer），
    // 均为各自文件的首个动态 import 用例，且与任何被测改动无依赖关系。
    // 故把上限提到 30s：这是测试框架层面的属性，不是某个用例的属性。
    // 断言与用例语义均未改动。
    testTimeout: 30000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'json'],
      include: ['src/utils/**', 'src/components/**'],
      exclude: ['src/**/*.d.ts', 'src/components/DocPreview.vue', 'src/utils/docParser.worker.ts'],
    },
  },
})
