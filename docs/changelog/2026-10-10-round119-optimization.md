# Round 119 — 2026-10-10

## 结论

本轮候选否决，**未升号、未发布**；轮次计入完成计数。评估复用同一 `PlcfFld` 字段位置表解析结果，避免 hyperlinks/TOC、page fields、cross-references 三处重复 `parsePlcfFld`。

## 候选与等价性

- 候选把同一 `tableData + fcPlcfFldMom + lcbPlcfFldMom` 的字段表解析移到一次共享位置，三个消费路径复用同一个 `fldEntries` 数组。
- 27 份真实 `.doc/.dot` 样本完整 `parseWithFormat()` 结果逐字节一致，共 16,247,039 字符。

## 端到端裁定

独立进程交错 4×NEW/4×OLD，每进程 20 轮：

- NEW/OLD 中位数：`114.061/107.528`、`105.183/112.578`、`107.734/106.507`、`106.235/104.868 ms`。
- 仅 2/4 组 NEW 胜出；四组中位数中 NEW 约 `108.30 ms`、OLD 约 `107.87 ms`，整体略慢且无稳定收益。
- 按协议硬纪律否决并撤回，未把变慢代码提交或发布。

## 撤回后验证

- `npm test`：76 个测试文件、1448 项通过。
- `vue-tsc --noEmit`、`eslint .`、`npm run build`、`npm run build:lib` 均通过。
- 包体保持 Round 116 基线：主包 gzip 109.91 kB、库入口 gzip 94.95 kB、UMD gzip 83.11 kB。
- `bench-diff 1190`：27/27 解析成功，中位数 0.950243、p25 0.915450、p10 0.896816、min 0.811547，与上一轮字段一致（除 cycle/timestamp）。

## 风险与下一轮

版本保持 `0.7.56`，未发布；下一轮为 Round 120，重新剖析真实热点，优先验证尚未证伪的调用点级候选。
