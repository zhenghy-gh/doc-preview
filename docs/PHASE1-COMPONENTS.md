# Phase 1 · DocPreview 信息面板组件化结果

> 2026-11-21。本文记录 `DocPreview.vue` 16 个信息面板的拆分结果，供后续维护参照。

## 背景

`DocPreview.vue` 原为 5160 行上帝组件，16 个信息面板的模板与 CSS 全部内联。
Phase 1 把它们拆为独立 `.vue` 组件，主文件降到 **3902 行**（-1258）。

## 组件清单与契约

所有面板都复用 `CollapsiblePanel.vue`（`modelValue` / `title` / `summary` / `panelClass` + 默认 slot），
内部只接收数据 props，不引入跨面板全局状态：

| 组件 | 主要 props | emit |
|---|---|---|
| `StoriesPanel.vue` | `sections`, `formatStoryText` | `update:modelValue` |
| `PropertiesPanel.vue` | `properties`, `docFields`, `styleSetLabel`, `wordVersionLabel`, 两个 title/summary | `update:modelValue` |
| `DocFlagsPanel.vue` | `items` | `update:modelValue` |
| `TocIndexPanel.vue` | `toc`, `index`, `v-model:tocOpen`, `v-model:indexOpen` | 两个 update 事件 |
| `RevisionsPanel.vue` | `mode`, `items` | `update:modelValue`, `change-mode` |
| `BookmarksPanel.vue` | `bookmarks` | `update:modelValue` |
| `SectionsPanel.vue` | `sections`, `formatSizePt` | `update:modelValue` |
| `PageFieldsPanel.vue` | `fields` | `update:modelValue` |
| `CrossReferencesPanel.vue` | `references` | `update:modelValue` |
| `ShapesPanel.vue` | `shapes` | `update:modelValue` |
| `EquationsPanel.vue` | `equations` | `update:modelValue` |
| `WordArtsPanel.vue` | `wordArts` | `update:modelValue` |

注：`PropertiesPanel` 内两个折叠面板在旧实现中共用同一个 `showProperties` 状态，拆分后继续共用 `modelValue`。

## CSS 归属规则

- 每个面板的 scoped CSS 随组件迁移；`DocPreview.vue` 只保留工具栏、纸张、搜索、快捷键、打印与响应式断点。
- 移动端 `@media (max-width: 640px)` 里被抽出的面板选择器统一改为 `:deep(...)`，
  让父组件 scoped 样式仍能命中子组件内部节点。
- `@media print` 中 `.stories-panel` / `.images-panel` 的隐藏规则保留在 `DocPreview.vue`。

## 验证

- `vue-tsc --noEmit` 0，`eslint .` 0，`npm test` 105 文件 / 2001 项通过。
- `tests/components/infoPanels.test.ts` 覆盖 12 个面板的渲染与 emit。
- 文档 HTML 分页黄金快照（`renderGolden.test.ts`）未变化。

## 收尾决定

- `DocStatsPanel.vue` 从未挂载、未导出、仅自身测试引用 ⇒ 已移除（连同 2 项测试与孤儿 CSS）。
- `DocPreview.vue` 的 i18n 从裸 `import { t, currentLocale }` 收敛为 `useI18n()`。
