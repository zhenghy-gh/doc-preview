# 搜索关闭回滚 htmlContent 修复

**日期**：2026-11-21　**类型**：正确性修复（Phase 3）　**影响面**：搜索 × 隐藏文字/修订显示切换 × 复制/打印。

## 现象与根因

`toggleSearch` 打开时把 `htmlContent` 存进 `originalHtml`，关闭时无条件恢复：

```ts
originalHtml.value = htmlContent.value   // 打开
...
htmlContent.value = originalHtml.value   // 关闭
```

但搜索高亮是通过 `searchUtils.highlightTextMatches` 用 DOM Range **包装 DOM 文本节点**
实现的，从不改写 `htmlContent` 字符串 —— 这段保存/恢复对搜索本身完全是死逻辑。

更糟的是：搜索打开期间若发生显示切换（`toggleHiddenText` / `setRevisionMode` →
`rerenderForDisplayChange` → `applyFormattedPages`），后者会**合法地**把 `htmlContent`
更新为新渲染结果 H1。此时关闭搜索会把 `htmlContent` 回滚到过期的 H0，而 `pages`
（预览 DOM 来源）仍是 H1 —— 两者不一致。复制纯文本与打印用的都是 `htmlContent`，
于是复制/打印出的是切换前的旧内容（缺失隐藏文字显示或修订模式效果）。

## 负控证据（修复前）

新增 `tests/components/searchHtmlRestore.test.ts`：渲染 "first version" → 打开搜索 →
搜索期间重新渲染为 "second version" → 关闭搜索。修复前断言失败：

```
Expected: ...second version...
Received: ...first version...
```

证明关闭搜索确实回滚了 `htmlContent`。

## 修复

删除 `originalHtml` ref 及打开时的保存、关闭时的恢复；关闭搜索只调用 `clearHighlights()`
清除 DOM 高亮，`htmlContent` 保持当前渲染结果不变。搜索高亮本就不碰该字符串，
删除死逻辑后复制/打印始终与预览一致。

修复后负控用例转绿；相关 `searchRerender`（2 项）、`pageNavigation`（3 项）全绿。

## 门禁

`npx vue-tsc --noEmit` 0；`npm test` **115 文件 / 2034 项**通过（新增 1 项）；
`npm run lint` 0 warning；`npm run build` + `npm run build:lib` 通过；
`npm run scan:corpus` 27/27 健康。
