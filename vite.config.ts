import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'path'

export default defineConfig(({ mode }) => {
  const isLib = mode === 'lib'

  return {
    plugins: [vue()],
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src'),
        // 让 @zhenghy/doc-preview 指向本地源代码，模拟真实 npm 包导入
        '@zhenghy/doc-preview': resolve(__dirname, 'src/index.ts')
      }
    },
    base: isLib ? './' : '/doc-preview/',
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
      : {
          outDir: 'dist',
          assetsDir: 'assets',
          rollupOptions: {
            input: {
              main: resolve(__dirname, 'index.html'),
              test: resolve(__dirname, 'test.html')
            }
          }
        }
  }
})
