# Round 115 — 2026-10-10

## 结论

候选否决，未落地生产代码、未升号、未发布；轮次计入完成计数。尝试将 `applyStructuralFormats` 列表候选组 CV 计算中的临时 `lengths` 数组与 `reduce` 替换为两遍 Uint32Array 累加，真实端到端未形成稳定收益，按硬纪律撤回。

## 目标与剖析

基于真实 `docs/` 下 27 份 `.doc/.dot` 样本（约 7.6 MB）进行 120 轮 CPU 剖析。函数聚合热点：`createParagraphsWithRealFormats` 12.18%、GC 9.69%、`applyStructuralFormats` 9.67%、`extractImagesFromStream` 6.20%、`bytesToBase64` 4.42%。行级归因显示列表组统计是 `applyStructuralFormats` 的局部可优化点，候选改动针对其中两个 `lengths` 临时数组及两次 `reduce`。

## 候选改动与等价性

候选仅将两个列表候选组分支中的：收集 `lengths` 数组、`reduce` 求和、`reduce` 求方差，改为遍历 `visibleTextLengths` 的数值累加；数学结果相同，未改变候选组边界、平均长度、CV 或后续评分。旧/新独立 bundle 对真实 27 份样本逐文件 dump 完全一致（`diff -rq` 无输出）。

## 性能与否决依据

独立构建旧/新 bundle，交错 4 组、每进程 20 轮端到端：

- OLD 中位数：97.395 / 96.465 / 97.758 / 97.269 ms；
- NEW 中位数：98.244 / 97.926 / 98.165 / 97.483 ms。

NEW 四组均未优于 OLD，且每组均有轻微退化；没有稳定真实收益，候选已撤回，正式源码保持 `0.7.55`。

## 验证

- 候选真实样本：27/27 份完整 dump 一致。
- 撤回后 `npm test`：75 文件 / 1446 项通过。
- `npx vue-tsc --noEmit`：通过。
- `npm run build`：通过；主包 318.98 kB，gzip 109.87 kB。
- `npm run build:lib`：通过；库主入口 352.93 kB，gzip 94.91 kB；UMD 263.61 kB，gzip 83.08 kB。
- `npm run lint`：通过。
- `bench-diff.mjs 1150`：27/27 解析成功；中位数 0.950、p25 0.915、p10 0.897、min 0.812，与 cycle-1140 逐字段一致（除 cycle/timestamp）。
- 工作区已恢复干净；本轮未生成生产代码提交。

## 风险与下一轮

本轮无生产代码风险，候选已完全撤回。下一轮为 Round 116，应重新围绕 `createParagraphsWithRealFormats` 或其他尚未验证的真实热点做调用点级剖析，避免重复列表 CV 计算和图片扫描查表变体。
