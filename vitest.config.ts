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
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'json'],
      include: ['src/utils/**', 'src/components/**'],
      exclude: ['src/**/*.d.ts', 'src/components/DocPreview.vue', 'src/utils/docParser.worker.ts'],
    },
  },
})
