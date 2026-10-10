# Round 118 优化记录（2026-10-10）

## 结论
本轮候选否决，未落地生产代码、未升号、未发布；轮次计入完成计数。候选为在 `mergeCharFormatForParagraph` 中预计算每个 CHPX run 的合并样式，避免段落级回退路径重复创建 style spread 对象。

## 剖析与候选
- 基于真实 27 份 `.doc/.dot` 样本检查 `createParagraphsWithRealFormats` 的字符格式合并热点。
- 候选将 `styleFormat + run.format` 的合并从每个段落重叠 run 调用点前移为 `effectiveChpxFormats` 数组，再按 run 下标复用。
- 候选仅在性能脚手架中隔离验证，未修改生产源码。

## 等价性验证
- 27/27 份真实样本完整 `parseWithFormat()` dump 逐字节一致。
- 候选输出与基线均为 27 份样本，`diff -rq` 无差异。
- 全量护栏测试：76 个测试文件、1448 项通过。
- `vue-tsc --noEmit`、`npm run lint`、`npm run build`、`npm run build:lib` 均通过。
- `bench-diff.mjs 118`：27/27 解析成功；统计与既有基线一致（中位相似度 0.950、p25 0.915、p10 0.897、min 0.812）。

## 真实端到端基准
独立进程、每进程 20 轮、交错 4 组 NEW/OLD：

- 组 1：NEW 105.050ms，OLD 105.081ms
- 组 2：NEW 104.785ms，OLD 104.688ms
- 组 3：NEW 105.511ms，OLD 103.788ms
- 组 4：NEW 105.004ms，OLD 106.931ms

仅 2/4 组胜出，整体处于噪声范围且出现退化，无稳定收益。按硬纪律撤回/否决，不提交候选生产改动。

## 版本、发布与风险
- 版本保持 `0.7.56`，双包不发布。
- 包体保持 Round 116/117：主包 gzip 109.91 kB，库入口 gzip 94.95 kB，UMD gzip 83.11 kB。
- 工作区临时剖析、基准、dump 产物已清理；生产源码未改变。

## 下一轮
Round 119：重新基于真实剖析寻找尚未证伪且能在交错端到端中稳定获益的调用点级候选。