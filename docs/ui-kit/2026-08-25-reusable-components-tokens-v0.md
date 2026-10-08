# 《可复用组件与规范 v0》

- **作者**: ui-kit-dev（组件库工程师）
- **日期**: 2026-08-25
- **范围**: 静态盘点 `src/components/*` 五组件 props 契约与复用率 + `src/style.css` 及各 `<style>` 块的主题 token 归纳。**未改动任何业务代码。**
- **状态**: v0 草案，待 captain 初验、architect 会签后升级 v1

---

## 一、组件 props 契约盘点（5 个）

### 1. CollapsiblePanel.vue（45 行）★ 唯一通用资产

| 类别 | 契约 |
|---|---|
| props | `modelValue: boolean`（必填，展开态）、`title: string`（必填）、`summary?: string`（标题右侧摘要）、`panelClass?: string`（根节点样式钩子） |
| emits | `update:modelValue: [value: boolean]` |
| slots | 默认插槽（面板体） |
| a11y | toggle 按钮 `aria-expanded` |
| i18n | 无依赖（纯展示壳，文案全由调用方传入）✅ 可直接沉淀为库组件 |

### 2. DocStatsPanel.vue（52 行）⚠️ 当前为死组件

| 类别 | 契约 |
|---|---|
| props | `modelValue: boolean`、`stats: { wordCount, charCount, paragraphCount, pageCount, imageCount, tableCount }` |
| emits | `update:modelValue` |
| 组合 | 内部消费 CollapsiblePanel；i18n `t()` |
| 现状 | DocPreview.vue **L16 导入被注释、L3695 使用被注释**，运行时 0 挂载 |

### 3. ShortcutsPanel.vue（55 行）

| 类别 | 契约 |
|---|---|
| props | `modelValue: boolean` |
| emits | `update:modelValue`（遮罩点击 / 关闭钮） |
| 内容 | 13 条快捷键列表**硬编码在组件内**（已 i18n 化）；模态遮罩 + `role="dialog"` |
| 备注 | 若其他面板要复用模态壳，需抽出 Overlay 结构 |

### 4. LoadingOverlay.vue（61 行）

| 类别 | 契约 |
|---|---|
| props | 全可选：`fileName?: string`、`fileSize?: string`、`loadingTime?: number`、`isUsingWorker?: boolean`、`progressStep?: string`、`progressPercent?: number` |
| 模式 | `progressPercent` 为 undefined 或 <0 时进入 **indeterminate 动画**；否则受控宽度 + 百分比文本 |
| a11y | 容器 `role="status" aria-live="polite"`；进度条 `role="progressbar"` + aria-value* |

### 5. ErrorDisplay.vue（46 行）

| 类别 | 契约 |
|---|---|
| props | `error: string`（原始错误信息，内部经 `errorClassifier.classifyError` 分类） |
| emits | `retry`（仅分类结果 `retryable` 时显示重试钮） |
| 依赖 | `errorClassifier.ts`、i18n、`ERROR_CATEGORY_ICON` |
| 结构 | 图标 + 标题 + 详情 + 建议列表 + 重试 + `<details>` 技术细节折叠 |

---

## 二、复用率统计（生效挂载口径）

| 组件 | 挂载点 | 实例数 | 结论 |
|---|---|---|---|
| CollapsiblePanel | DocPreview.vue 侧栏面板 ×16 + DocStatsPanel 内部 ×1 | **17** | ✅ 高频复用，props 四项覆盖率见下 |
| LoadingOverlay | DocPreview.vue L2874 | 1（6 个 props 全量传入） | 单点组件 |
| ErrorDisplay | DocPreview.vue L2885 | 1 | 单点组件 |
| ShortcutsPanel | DocPreview.vue L3698 | 1 | 单点组件 |
| DocStatsPanel | —（L16/L3695 注释中） | **0** | ⚠️ 死组件，需裁决：恢复挂载 or 移除 |
| （App.vue） | 不消费任何子组件 | — | 上传页自成一体 |

**CollapsiblePanel props 覆盖率**（16 个业务实例）：

| prop | 使用率 | 说明 |
|---|---|---|
| `v-model` | 16/16 = 100% | 全部走受控展开态 |
| `title` | 16/16 = 100% | 均带计数插值 `${t(...)}（N）` |
| `panelClass` | 16/16 = 100% | stories/properties/toc/revisions/bookmarks/sections/page-fields/cross-refs/shapes/equations/charts/wordart/images/doc-flags 等 15+ 种钩子 |
| `summary` | 14/16 ≈ 87.5% | toc-panel(L3265)、index-panel(L3287) 两处未传 |

> 结论：CollapsiblePanel 已事实上承担"侧栏信息面板"标准容器职责，v1 应正式定版 API 并冻结；其余 3 个单点组件属于"拆分产物"而非复用资产，暂不强制抽象。

---

## 三、主题 Token 归纳（现状）

### 3.1 定义位置与机制

- 唯一定义点：`src/style.css` —— `:root`（浅色）与 `.dark`（暗黑）两套**同名 25 变量一一对应**。
- 暗黑切换机制：**class 切换**（非 media query）。App.vue L134–140 在 `document.documentElement` 上挂 `.dark`，`localStorage('dark-mode')` 持久化。
- 局部动态变量：DocPreview.vue 大纲缩进用 `--level: 1|2|3`（L4405–4414，配合 `calc()`），属组件私有，不入库。

### 3.2 Token 清单（25 个 × 双主题）

| 分类 | Token | 浅色值 | 暗黑值 |
|---|---|---|---|
| 背景 | `--bg-primary` | #f5f5f5 | #1a1a2e |
| 背景 | `--bg-secondary` | #ffffff | #16213e |
| 背景 | `--bg-tertiary` | #f8f9fa | #1e2a4a |
| 纸张 | `--paper-bg` | #ffffff | #1e2a4a |
| 工具栏 | `--toolbar-bg` | #f8f9fa | #16213e |
| 搜索条 | `--search-bar-bg` | #fffde7 | #2a2a1e |
| 文本 | `--text-primary` | #333333 | #e0e0e0 |
| 文本 | `--text-secondary` | #666666 | #b0b0b0 |
| 文本 | `--text-muted` | #999999 | #888888 |
| 边框 | `--border-color` | #e0e0e0 | #2a3a5c |
| 边框 | `--border-light` | #eee | #1e2e4e |
| 工具栏边框 | `--toolbar-border` | #e0e0e0 | #2a3a5c |
| 强调 | `--accent` | #667eea | #7c8cf0 |
| 强调底 | `--accent-light` | #e8f0fe | #1a2a4a |
| 错误 | `--error-bg` | #fff0f0 | #2a1a1a |
| 错误 | `--error-border` | #ffcccc | #4a2a2a |
| 错误 | `--error-text` | #d63031 | #e06060 |
| 高亮 | `--highlight` | #ffeb3b | #8a7a20 |
| 高亮当前 | `--highlight-current` | #f44336 | #a03030 |
| 阴影 | `--shadow` | 0 10px 40px rgba(0,0,0,.1) | …rgba(0,0,0,.3) |
| 阴影 | `--shadow-sm` | 0 1px 4px rgba(0,0,0,.12) | …rgba(0,0,0,.3) |
| 纸张阴影 | `--paper-shadow` | 双层柔和 | 双层加深 |

### 3.3 Token 引用频率（var() 共约 220 处）

```
--border-color ×35   --bg-secondary ×28   --text-primary ×27
--text-muted ×27     --accent ×24         --bg-primary ×16
--text-secondary ×15 --bg-tertiary ×9     --accent-light ×5
其余（error/highlight/paper/toolbar/search 等）各 1~2 处
```

### 3.4 缺失维度（v0 判定：目前只有"颜色 token"，没有体系）

| 维度 | 现状 | 实测分布 |
|---|---|---|
| 圆角 | ❌ 无 token | 12 种取值；主频 `4px`×23、`8px`×22、`3px`×13、`6px`×7、`12px`×5，长尾 2/10/16/30px、50% |
| 间距 | ❌ 无 token | padding 主频组合 `8px 12px`×9、`12px 16px`×9、`1px 6px`×9 |
| 字号 | ❌ 无 token | 散落 px/pt 混用 |
| z-index | ❌ 无 token | 工具栏/遮罩/悬浮各自写死 |
| 动效 | ❌ 无 token | transition 时长散落（body 有 0.3s 示例） |

### 3.5 硬编码渗透率（token 化最大欠账)

- DocPreview.vue：**182 处硬编码 hex** + 19 处 rgba()；TOP：`#94a3b8`×19、`#333`×10、`#667eea`×9（与 `--accent` 同值异名）、`#4f81bd`×8、`#27ae60`×7…
- App.vue：27 处 hex，**var() 引用为 0** —— 上传页完全游离于主题体系外。
- 暗黑双轨制：全局 token 切换之外，DocPreview.vue 还有 **8 条 `:root.dark …` 手写覆盖规则**（L4124 表头、L4199 搜索选项选中、L5124–5134 文本框锚点、L5161–5166 内联图片、L5208 图表占位），全部直写色值，绕过 token。

### 3.6 🐛 缺陷级发现：未定义变量引用（P0）

| 位置 | 问题 |
|---|---|
| DocPreview.vue **L2160 / L2231** | 分页分隔线内联样式使用 `var(--border)`、`var(--bg)`、`var(--muted)` —— 三者均**未在任何地方定义**且无 fallback，整条声明失效（guaranteed-invalid），"— 分页 —"标记的虚线颜色/背景/文字色实际不生效 |
| DocPreview.vue **L4918** | `color: var(--text-tertiary)` 未定义，应改 `--text-muted` 或补定义 |

---

## 四、v1 规范提案（供 architect 会签）

1. **兼容优先**：现有 25 个语义 token 名称冻结不变（220 处引用零迁移成本）。
2. **新增结构 token**（只增不改）：
   - 圆角四档：`--radius-sm: 3px` / `--radius-md: 6px` / `--radius-lg: 10px` / `--radius-xl: 16px`（覆盖现 12 种取值的 90% 分位）
   - 间距阶梯：`--space-1..6 = 4/8/12/16/24/32px`
   - 补 `--text-tertiary` 或将 L4918 改判 `--text-muted`
3. **收敛暗黑双轨**：新增暗黑适配一律走 token；存量 8 条 `:root.dark` 覆盖随触达逐条回收到 token。
4. **迁移策略**："谁改哪个面板，谁把该面板的硬编码换 token"；新组件 100% token 化为验收门槛。
5. **组件沉淀路线**：CollapsiblePanel 定版冻结 API → 下一步抽 `BaseModal`（ShortcutsPanel 壳）与 `ProgressTrack`（LoadingOverlay 进度条段）两个可复用子件。

## 五、建议下轮拆单（供 captain 参考，均未执行）

| # | 任务 | 量级 |
|---|---|---|
| 1 | 修复 L2160/L2231/L4918 三处未定义变量（改 token 名即可） | S |
| 2 | DocStatsPanel 去留裁决（恢复挂载 or 连注释一起删除） | S |
| 3 | style.css 新增 radius/space token 并出映射表 | M |
| 4 | App.vue 接入主题 token（27 处 hex 替换） | M |
| 5 | CollapsiblePanel API 定版 + 使用文档 | S |

---
*ui-kit-dev · 组件库工程师 · 2026-08-25 · 本文档仅静态分析，未改动任何业务代码*
