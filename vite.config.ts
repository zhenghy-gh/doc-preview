import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import dts from 'vite-plugin-dts'
import { resolve } from 'path'
import { rmSync } from 'node:fs'

export default defineConfig(({ mode }) => {
  const isLib = mode === 'lib'

  return {
    plugins: [
      vue(),
      isLib && dts({
        entryRoot: resolve(__dirname, 'src'),
        include: ['src/index.ts', 'src/utils/docParser.ts', 'src/utils/docFormat.ts', 'src/utils/parseWithWorker.ts', 'src/components/DocPreview.vue'],
        outDir: resolve(__dirname, 'dist-lib'),
        tsconfigPath: resolve(__dirname, 'tsconfig.json'),
      }),
      // PERF-T4①：演示样本 doc 仅服务开发期手动拖拽验证，生产 dist 不携带
      // （demo 页面无任何代码引用该文件，GH Pages 演示功能不受影响）
      !isLib && {
        name: 'exclude-sample-doc-from-dist',
        closeBundle() {
          try {
            rmSync(resolve(__dirname, 'dist/file-sample_100kB.doc'))
          } catch {
            /* 文件不存在时忽略 */
          }
        },
      },
    ].filter(Boolean),
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src'),
        // 让 @zhenghy/doc-preview 指向本地源代码，模拟真实 npm 包导入
        '@zhenghy/doc-preview': resolve(__dirname, 'src/index.ts'),
      },
    },
    base: isLib ? './' : '/doc-preview/',
    publicDir: isLib ? false : 'public',
    build: isLib
      ? {
          // 库产物独立输出，避免与 app 模式(dist)互相覆盖（W1-D 发布安全）
          outDir: 'dist-lib',
          emptyOutDir: true,
          lib: {
            entry: resolve(__dirname, 'src/index.ts'),
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
              main: resolve(__dirname, 'index.html'),
            },
          },
        },
  }
})
