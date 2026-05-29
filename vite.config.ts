import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'path'

export default defineConfig(({ mode }) => {
  const isLib = mode === 'lib'

  return {
    plugins: [vue()],
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src')
      }
    },
    build: isLib
      ? {
          lib: {
            entry: resolve(__dirname, 'src/index.ts'),
            name: 'DocPreview',
            fileName: 'doc-preview',
            formats: ['es', 'umd']
          },
          rollupOptions: {
            external: ['vue'],
            output: {
              globals: {
                vue: 'Vue'
              }
            }
          }
        }
      : undefined
  }
})
