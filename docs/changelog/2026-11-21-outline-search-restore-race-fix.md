# 大纲导航恢复定时器 × 搜索虚拟滚动竞态修复

**日期**：2026-11-21　**类型**：真实 bug 修复（Phase 3）　**影响面**：仅 `DocPreview.vue` 的虚拟滚动恢复路径，不改解析/渲染。

## 一、现象与根因

`scrollToOutline` 为让目标段落（可能落在未渲染页）可查询，会临时把
`virtualScrollEnabled` 置为 `false`，滚动后用固定 600ms 定时器无条件恢复为 `true`：
若这 600ms 内用户打开搜索（`toggleSearch` 同样把虚拟滚动关掉，以便遍历所有页面
DOM 做高亮），定时器到点后把虚拟滚动重新打开，窗口外页面退回 `.page-placeholder`，
正在生效的搜索高亮与 `1 / N` 计数随之失效。

属于典型的「两个写入方共享一个布尔状态、用自己的定时器收尾」竞态。

## 二、负控证据（修复前）

新增 `tests/components/outlineSearchRace.test.ts`，用 fake timer：
`scrollToOutline` → `toggleSearch`（搜索仍开）→ `advanceTimersByTime(700)`。

- 修复前：`virtualScrollEnabled === true`（期望 `false`）——1/2 失败，精确复现竞态；
- 修复后：2/2 通过（含「搜索未开启时仍正常恢复」的正向用例）。

## 三、修复：恢复职责收口到单一函数

```ts
function restoreVirtualScroll() {
  if (showSearch.value) return          // 搜索需要全页 DOM，保持虚拟滚动关闭
  virtualScrollEnabled.value = true
  nextTick(() => { measureVisiblePageHeights(); updateVisibleRange() })
}
```

- `scrollToOutline` 的两处恢复（容器缺失早退 / 600ms 定时器）统一改调该函数；
- `toggleSearch` 关闭分支也改调该函数（并保留 toolbar focus）；
- 未引入新全局状态：唯一判据是已有的 `showSearch`，恢复动作集中在组件内一处。

搜索开启期间大纲的过期定时器被安全忽略；随后关闭搜索时由 `toggleSearch` 正常恢复。
两条路径都执行窗口重测，不会出现「恢复后窗口未更新」的二次偏差。

## 四、`scrollToPage` 一致性确认

`scrollToPage` 已用 `data-page-idx` 定位（见 `2026-11-21-page-navigation-virtual-scroll-fix.md`）：
查询 `.page-host[data-page-idx=N] .page-content` / `.page-placeholder[data-page-idx=N]`，
与虚拟滚动开关状态无关——本次恢复逻辑改动不影响其正确性，`tests/components/pageNavigation.test.ts`
3 项（含搜索临时关闭/恢复边界）继续全绿。

## 五、门禁（本切片）

目标测试 5 文件 / 14 项通过（含新增 2 项）；完整门禁见阶段日志。
