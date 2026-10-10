# Round 120 优化记录

日期：2026-10-10

## 目标
评估 `mergeCharFormatForParagraph` 中消除每个 CHPX run 的样式 spread 临时对象，改为逐字段回退读取，降低格式合并分配。

## 候选与等价性
候选来自真实 CPU profile：`mergeCharFormatForParagraph` 自耗约 3.10%。候选仅在隔离 bundle 中验证，生产源码保持 Round 119 基线。27 份真实 `.doc` 样本的完整 `parseWithFormat()` dump 逐字节一致。

## 验证
- 全量测试：76 个测试文件、1448 项通过。
- `vue-tsc --noEmit`：通过。
- `npm run lint`：通过。
- `npm run build` / `npm run build:lib`：通过。
- 包体：应用主 JS gzip 109.91 kB；库入口 gzip 94.95 kB；UMD gzip 83.11 kB。
- 交错 4×NEW / 4×OLD，每进程 30 轮：
  - 组 1：NEW 111.320 ms / OLD 111.491 ms
  - 组 2：NEW 113.052 ms / OLD 108.492 ms
  - 组 3：NEW 111.230 ms / OLD 110.513 ms
  - 组 4：NEW 109.771 ms / OLD 108.160 ms
  - 仅 1/4 组胜出；整体 NEW 约 111.32 ms、OLD 约 110.51 ms，候选略慢且无稳定收益。
- `bench-diff 120`：27/27 解析成功；median 0.950243、p25 0.915450、p10 0.896816、min 0.811547，与上一轮逐字段一致（仅 cycle/timestamp 除外）。

## 结论
候选在真实端到端数据上没有稳定收益并略有退化，按协议硬纪律否决并撤回。未升号、未提交生产代码、未发布双包。轮次计入状态计数，版本保持 `0.7.56`。

## 风险与下一方向
生产代码无变化，无新增兼容性风险。下一轮重新剖析 `createParagraphsWithRealFormats`、`applyStructuralFormats` 或图片提取调用点级候选；避免重复尝试已否决的 CHPX 预计算和图片扫描变体。
