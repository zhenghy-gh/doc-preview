/**
 * ESLint flat config（TD-4 · vue-dev-4 · 2026-08-25）
 *
 * 门禁口径（captain 裁决）：warn 级起步、不设门禁。
 * lint 结果不阻塞 build/test；定位是"新增类型债务的可见性护栏"，
 * 存量债务由 TD-1~TD-3 治理后逐项升 error（届时再议是否纳入 CI 硬门禁）。
 *
 * 选型说明：
 * - eslint-plugin-vue 取 flat/essential（错误捕获集），避免 recommended 的风格类
 *   噪音淹没类型债信号；后续可评估升级 flat/recommended。
 * - vueTsConfigs.recommended 提供 <script setup lang="ts"> 的 TS 解析与规则；
 *   未启用 type-aware（projectService）规则以保持 lint 秒级速度。
 */
import pluginVue from 'eslint-plugin-vue'
import { defineConfigWithVueTs, vueTsConfigs } from '@vue/eslint-config-typescript'

export default defineConfigWithVueTs(
  {
    ignores: [
      'dist/**',
      'dist-lib/**',
      'node_modules/**',
      'coverage/**',
      'tests/__snapshots__/**',
      'scripts/**',
      'docs/wip-parking/**',
      '.qoder/**',
      // 本地 agent 工具状态（已 gitignore）：剖析/基准脚手架，不进仓库
      '.workbuddy-ai/**',
      'tests/_probe*.test.ts',
    ],
  },
  pluginVue.configs['flat/essential'],
  vueTsConfigs.recommended,
  {
    rules: {
      // —— TD-4 首批 warn 基线 ——
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      // 单文件组件命名豁免：App.vue / DocPreview.vue 为既有命名
      'vue/multi-word-component-names': 'off',

      // —— 基线期降级（2026-08-25，TD-4 启动时存量 15 error 全部来自以下三类纯风格规则，
      //    且分布在他人在办文件域：docParser(TD-1a)/documentRenderer(T3-SNAP)/tests(sdet) ——
      //    不做跨域 --fix；待 TD-1~TD-3 落地后由各域负责人顺手修复并恢复默认 error） ——
      'prefer-const': 'warn',
      'no-unused-expressions': 'warn',
      '@typescript-eslint/no-unused-expressions': 'warn',
      '@typescript-eslint/ban-ts-comment': 'warn',
    },
  },
  {
    // —— tests/ 定向豁免（循环 #10 · 2026-09-22）——
    // 测试大量以 `(parser as any).privateMethod()` 模式访问解析器私有 API 做白盒断言，
    // 这是测试代码的常见合理权衡（正确性由断言而非类型系统背书）；逐条改
    // as unknown as {...} 收益低噪音大。其余规则（prefer-const/unused 等）保持 warn。
    // src/ 已于 TD-1 治理为 0 any，本豁免不构成生产代码债务入口。
    files: ['tests/**'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
)
