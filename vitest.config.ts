import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

export default defineConfig({
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'json'],
      include: ['src/utils/**', 'src/components/**'],
      exclude: ['src/**/*.d.ts', 'src/components/DocPreview.vue', 'src/utils/docParser.worker.ts'],
    },
  },
})
