# 页码导航虚拟滚动错位修复 + 预览/打印几何口径审计

**日期**：2026-11-21　**类型**：正确性修复（Phase 3）+ 审计结论　**影响面**：UI 导航，不改解析器/渲染 HTML。

## 一、真实 Bug：`scrollToPage` 用绝对页码索引稀疏 NodeList

### 现象与根因

虚拟滚动开启时，`.document-content` 下**只渲染窗口 `[visibleStart, visibleEnd]` 内的页**
为 `.page-host`（内含 `.page-content`），窗口外为 `.page-placeholder`。DOM 的
`.page-content` / `.page-placeholder` NodeList 是**稀疏**的，其下标 ≠ 绝对页码。

原 `scrollToPage`（`DocPreview.vue`）却直接用绝对页码 `idx` 去索引：

```ts
const pageElements = container.querySelectorAll('.page-content')
const target = pageElements[idx]              // ← 稀疏表用绝对页码当下标
...
const placeholders = container.querySelectorAll('.page-placeholder')
const ph = placeholders[idx]                  // ← 回退同样错位
```

触发路径：工具栏上一页/下一页、页码输入框 → `goToPage` → `scrollToPage`。
当目标页在窗口外时先扩窗（窗口宽 `2×VIRTUAL_BUFFER+1=3`），扩窗后 DOM 仅 3 个
`.page-content`，`pageElements[14]` 越界 → 落到 `placeholders[14]`，而该占位符
实际是**第 17 页**（窗口外页从索引 0 重新排，恰好错开窗口宽度 3 页）。

### 负控证据（修复前）

新增 `tests/components/pageNavigation.test.ts`，在修复前跑：

- 20 页、初始窗口 `[5,7]`、`goToPage(15)`（idx=14）→ 实际滚动到 **'17'**（期望 '14'）；
- 20 页、窗口 `[10,12]`、`goToPage(12)`（idx=11）→ 实际滚动到 **'14'**（期望 '11'）。

2/3 用例失败，精确复现「错开窗口宽度」的偏移。

### 修复

两种页容器都带 `data-page-idx`（绝对页码，PERF-T1 引入），按属性精确定位：

```ts
const target =
  container.querySelector(`.page-host[data-page-idx="${idx}"] .page-content`) ??
  container.querySelector(`.page-placeholder[data-page-idx="${idx}"]`)
target?.scrollIntoView({ behavior: 'smooth', block: 'start' })
```

不再依赖 NodeList 下标，扩窗/未扩窗/搜索态（全页渲染）三种情形统一正确。
修复后 3 项用例全绿（负控已验证 2/3 失败 → 修复后 3/3 通过）。

### 覆盖的边界

1. 跨窗口跳转（触发扩窗）—— 原实现错滚到 +3 页；
2. 窗口内跳转 —— 原实现同样错滚（窗口起始 >0 时）；
3. **搜索时临时关闭虚拟滚动 → 关闭搜索恢复**：开启搜索后全部 20 页真实渲染
   （0 占位符），关闭后恢复虚拟滚动、窗口外重新变回占位符。

## 二、预览页数 vs 打印 `@page` 几何口径审计（结论）

任务要求核对 `pageBuilder.ts` 与 `printLayout.ts` 的几何一致性。**本 worktree 不存在
`printLayout.ts`**（AGENTS.md 为简化视图；分页逻辑仅在 `src/utils/rendering/pageBuilder.ts`
与 `DocPreview.vue` 内联）。审计发现两套**独立且不对齐**的几何模型：

| 维度 | 预览（pageBuilder + 组件） | 打印（内联 `@page`，`printDocument`） |
|---|---|---|
| 页高口径 | `pageHeightPt × PT_TO_PX(1.333)`，默认 842pt | `@page { size: A4; margin: 25mm 20mm }` 浏览器排版 |
| 分页依据 | 字符估算（45 字/行、行高 `fontSize×1.5`、+4 padding；表格 100、图表 200 等魔数） | 浏览器实际回流，无估算 |
| 分页容器 | `.page-content` 逐页注入，`.paper-page` 内堆叠 | 同样注入 `.page-content`，但打印 CSS **无 `.page-content` 规则**（无 `page-break-*`、无定高） |
| 多栏 | 预览经 `column-count/gap/fill:auto` 内联样式分栏 | 打印 CSS 未重置/沿用栏样式，浏览器独立处理 |
| 页眉页脚 | 预览无 | `@top-center` / `@bottom-center` 页码（浏览器 margin box） |

**结论**：预览页数（`tests/fixtures/real-corpus-pages.json` 钉的基线，如 `fsample4.doc`
=234 页）与打印页数是**两个独立布局的结果**，天然不一致；`htmlContent` 里的
`.page-content` 边界在打印时被浏览器无视、连续回流。这不是单条语句可修的偏差：
要让二者对齐，需让打印显式尊重预览分界线（如 `.page-content { break-after: page }`
+ 定高），但缺少 `printPageCount.mjs` 之类的自动基线（本 worktree 无此脚本），
贸然改动可能引入空白页/更差分页。按「无证据不冒险」原则**仅记录审计结论，不改打印行为**。

后续建议（低风险、可验证）：先补一个无头浏览器打印页数采集脚本，建立 27 份语料的
「预览页数 ↔ 打印页数」对照表，再决定是否让打印复用预览分界线。

## 门禁

`npx vue-tsc --noEmit` 0；`npm test` **114 文件 / 2033 项**通过（新增 3 项）；
`npm run lint` 0 warning；`npm run build` + `npm run build:lib` 通过；
`npm run scan:corpus` 27/27 健康。
