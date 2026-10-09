# Round 116 — 2026-10-10

## 结论

采纳 1 项真实数据优化并完成发布：在 `createParagraphsWithRealFormats` 内缓存按 `papx.istd` 的段落样式继承解析结果，避免重复遍历相同样式继承链。真实端到端交错基准四组均获益，27 份文档结果逐字节一致。

## 目标与剖析

基于真实 `docs/` 下 27 份 `.doc/.dot` 样本、120 轮 CPU 剖析。热点为 `createParagraphsWithRealFormats` 12.68%；行级归因显示样式继承解析位于段落构造循环内，每个使用相同 `papx.istd` 的段落都会重复调用 `resolveStyleFormat(styles, papx.istd)`。

## 改动与等价性

在 `src/utils/docParser.ts` 的 `createParagraphsWithRealFormats` 中新增本次调用局部的 `Map<number, ReturnType<typeof resolveStyleFormat>>`。首次遇到某个 `papx.istd` 时解析并缓存，后续复用同一解析结果；缓存生命周期限定于单次文档调用，不跨文档共享，也不改变样式合并顺序、PAPX 覆盖优先级或输出对象内容。

真实 27 份样本的旧/新完整 `parseWithFormat()` dump 逐文件 `diff -rq` 一致。故意将缓存键改为 `papx.istd + 1` 的负控检测到输出差异，说明护栏可鉴别错误缓存。

## 性能

独立旧/新 bundle，交错 4×OLD/4×NEW，每进程 20 轮、27 份真实样本：

- OLD 中位数：98.481 / 98.641 / 98.656 / 98.927 ms；
- NEW 中位数：94.795 / 95.670 / 95.670 / 96.532 ms；
- 四组 NEW 均优于 OLD，组内约 3.9% / 3.0% / 3.0% / 2.4% 改善。

## 验证

- 定向样式缓存护栏：1/1 通过。
- `npm test`：76 文件 / 1447 项通过。
- `npx vue-tsc --noEmit`：通过。
- `npm run lint`：通过。
- `npm run build`：通过；主包 319.05 kB，gzip 109.91 kB。
- `npm run build:lib`：通过；库入口 353.02 kB，gzip 94.95 kB；UMD 263.66 kB，gzip 83.11 kB。
- `bench-diff.mjs 1160`：27/27 解析成功；中位数 0.950、p25 0.915、p10 0.897、min 0.812，与 cycle-1150 逐字段相同（除 cycle/timestamp）。
- 工作区临时 bundle、dump、profile 在收尾清理；生产代码变更为 1 个缓存 Map 与对应护栏测试。

## 风险与下一轮

缓存只在单次段落构造调用中生效，样式数组在调用期间不变；Map 额外占用与文档中不同 `istd` 数量成正比。下一轮为 Round 117，继续从真实 CPU 剖析确认尚未证伪的热点，避免重复已否决的 pieceMap、图片查表和列表 CV 变体。
