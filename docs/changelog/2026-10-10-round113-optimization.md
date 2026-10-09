# Round 113 — 2026-10-10

## 结论

候选全部否决，未落地生产代码、未升号、未发布。轮次计入完成计数。`createParagraphsWithRealFormats` 的 pieceMap 重叠覆盖率求和改写与旧实现逐结果等价，但真实端到端没有稳定收益，按硬纪律撤回。

## 目标与剖析

基于真实 27 份 `.doc/.dot` 样本（7.6 MB）建立未混淆 bundle 并执行 120 轮 CPU 剖析。主要热点为：`createParagraphsWithRealFormats` 13.00%、GC 9.39%、`extractImagesFromStream` 6.17%、`applyStructuralFormats` 9.39%（按函数名聚合）、`bytesToBase64` 4.25%。本轮选择 createParagraphsWithRealFormats 中 `overlapping.reduce` 的可读性/分配消除候选。

## 候选改动与等价性

将：

```ts
const ratio = overlapping.reduce((s, p) => {
  const overlapStart = Math.max(p.start, cpStart)
  const overlapEnd = Math.min(p.end, cpEnd)
  return s + (overlapEnd - overlapStart)
}, 0) / (cpEnd - cpStart)
```

改为显式 `for...of` 累计 `overlapLength`，再计算相同的 ratio。遍历顺序、Math.max/Math.min、数值累加和阈值完全不变。27 份样本逐文件结果 0 差异；撤回后全量测试仍 75 文件 / 1446 项通过。

## 性能与否决依据

候选新版/旧版均为独立预构建 bundle，交错 4×NEW/4×OLD、每进程 20 轮：

- NEW 中位数：102.220 / 100.433 / 101.170 / 106.897 ms；
- OLD 中位数：97.287 / 100.363 / 100.363 / 98.980 ms；
- 各组没有稳定方向，NEW 在一组明显慢于 OLD；初始 30 轮也为 NEW 103.551 ms、OLD 100.828 ms。

因此候选没有可证明的真实端到端收益，按协议撤回，不升号、不发布。包体未改变。

## 验证

- 真实样本新旧 dump：27/27 文件逐文件相同（`diff -rq` 无输出）。
- 撤回后 `npm test`：75 文件 / 1446 项通过。
- 工作区已清理本轮临时产物并恢复干净。

## 风险与下一轮

本轮没有生产代码风险。下一轮为 Round 114，重新剖析并优先评估 `applyStructuralFormats` 的调用点级热点或 `extractImagesFromStream` 的多次调用权重；不得重复尝试本轮和 Round 110 已证伪的 pieceMap 重叠临时数组/覆盖率写法。
