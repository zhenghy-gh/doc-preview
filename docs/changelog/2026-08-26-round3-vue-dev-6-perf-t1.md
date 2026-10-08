# PERF-T1 接管完工变更摘要 · vue-dev-6 · 2026-08-26

## 任务
PERF-T1 虚拟滚动高度缓存专项——接管 perf-dev 遗留 WIP（其执行中失败离场，遗留 tests/perfT1VirtualScroll.test.ts 1 失败：zoom-normalized 断言 expected 3 got 2）。任务书四条：①绝对页码键 ②渲染后测量 ③zoom>100% 测量一致性 ④renderGolden 零漂移。

## 归属辨认（接管第一步，已核）
工作区 DocPreview.vue 的 M 含三层叠加：T3-W3 接线（vue-dev-3 在案）、FIX-VUEW 三 hunk（我上一任务在案）、perf-dev PERF-T1 WIP。经 git diff + 失败模式分析辨认，perf-dev WIP 已含：
- ① 绝对页码键：模板 .page-host 挂 :data-page-idx（L1919/1926）+ measureVisiblePageHeights 按 dataset.pageIdx 入缓存 ✓
- ② 渲染后测量：handleVirtualScroll 的 rAF 只算窗口；测量改由 watch([visibleStart,visibleEnd])→nextTick 在 DOM 更新后执行 ✓
- ③ 部分：测量值 ÷zoom 归一化入库 + 视口度量 ÷zoom 换算 + watch(zoomLevel) 重测 ✓
测试三用例中前两例（键、归一化）绿，第三例（视口不变量）红——即本次接管的落点。

## 本轮净增量（3 hunk + 测试参照循环修正）
1. **updateVisibleRange 起始边界 `<` → `<=`**（失败根因）：页底恰好等于视口顶（pageBottom === viewportTop）的页可见面积为零，应判为已滚出；严格小于把这条零高度缝算作"可见"，使 start 系统性偏小一页。修后 rawStart=4→缓冲后 visibleStart=3，与布局坐标推导的不变量一致。
2. **watch(zoomLevel) 清空 pageHeights 再重测**：缓存存布局像素，zoom 改变布局语义——旧 zoom 下测得的条目（尤其未渲染页占位所依赖者）全部失效；原 WIP 仅重测当前窗口渲染页，残留旧值会让占位高度与新布局混用两套单位系。现在缩放即整体失效，回流完成后重测。
3. **tests/perfT1VirtualScroll.test.ts 参照循环同源笔误修正**：其内联期望推导循环同样用严格 `<`，与自身注释语义（"index 0..3 页底均≤viewportTop → rawStart=4"）及末尾硬编码不变量（visibleStart===3）互相矛盾（按旧循环推得 2，131 行与 134 行断言互斥、永不可同时成立）。改为 `<=` 后参照推导与不变量统一为 3/5。

## 四条任务书对照结论
① 绝对页码键 = perf-dev WIP 已实现，本轮验证保持 ✓
② 渲染后测量 = WIP 已实现（rAF 窗口计算 / watcher+nextTick 测量的职责分离），验证保持 ✓
③ zoom 一致性 = WIP 归一化基础 + 本轮补齐缓存失效闭环（清空重测）+ 边界单位系修正 → 完整达成 ✓
④ renderGolden = 全量套件内 8/8 通过零漂移（本任务不触碰渲染管线 HTML）✓

## 关键度量（前→后）
- npm test：**55 文件 / 1266 用例全绿**（接管时点 1 失败 → 0；只增不减）
- npm run build ✅ vue-tsc 0 错误 / vite 0.74s；main 310.15KB/gzip105.55
- 定向：perfT1VirtualScroll 3/3 绿

## 效果与语义基线（供 COMPOSABLES-C 门控引用）
消除虚拟滚动三类症状：visibleStart>0 后占位高度错位跳变、窗口误判多渲/漏渲、>100% 缩放下累计漂移。**测量语义基线**：pageHeights 缓存=布局像素、键=data-page-idx 绝对页码、视口度量÷zoom 同单位换算、zoom 变更=缓存整体失效重测、边界=页底≤视口顶判出。

## 记账提示
DocPreview.vue 工作区 M 为多层在案改动叠合（T3-W3/FIX-VUEW/PERF-T1），我的本轮净增量以上列 3 项为限；main chunk 增量亦含他人并行改动成分。
