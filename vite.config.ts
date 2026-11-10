import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import dts from 'vite-plugin-dts'
import { resolve } from 'path'

export default defineConfig(({ mode }) => {
  const isLib = mode === 'lib'

  return {
    plugins: [
      vue(),
      isLib && dts({
        entryRoot: resolve(import.meta.dirname, 'src'),
        include: ['src/index.ts', 'src/utils/docParser.ts', 'src/utils/docFormat.ts', 'src/utils/parseWithWorker.ts', 'src/components/DocPreview.vue', 'src/vite-env.d.ts'],
        outDir: resolve(import.meta.dirname, 'dist'),
        tsconfigPath: resolve(import.meta.dirname, 'tsconfig.json'),
      }),
    ].filter(Boolean),
    resolve: {
      alias: {
        '@': resolve(import.meta.dirname, 'src'),
        // 让 @zhenghy/doc-preview 指向本地源代码，模拟真实 npm 包导入
        '@zhenghy/doc-preview': resolve(import.meta.dirname, 'src/index.ts'),
      },
    },
    base: isLib ? './' : '/doc-preview/',
    publicDir: isLib ? false : 'public',
    build: isLib
      ? {
          lib: {
            entry: resolve(import.meta.dirname, 'src/index.ts'),
            name: 'DocPreview',
            fileName: 'doc-preview',
            formats: ['es', 'umd'],
          },
          rollupOptions: {
            external: ['vue'],
            output: {
              exports: 'named',
              globals: {
                vue: 'Vue',
              },
            },
          },
        }
      : {
          outDir: 'dist',
          assetsDir: 'assets',
          rollupOptions: {
            input: {
              main: resolve(import.meta.dirname, 'index.html'),
            },
          },
        },
  }
})
