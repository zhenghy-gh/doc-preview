# Round 117 — 2026-10-10

## 结论

本轮候选否决，**未升号、未发布**；轮次计入完成计数。候选为「在 `detectParagraphFormat` 中共享一次 `trim()` 结果，并透传至 `detectAlignment` / `detectListInfo`」。

背景：本轮执行期间检测到**并发自动化运行**已把该候选提交为 `bcea037`（`optimize round 117: reuse trimmed paragraph text`），但该提交既未升号也未发布，且随后另一次运行又把它记为「已否决、已撤回」，留下不一致状态。本会话对 `bcea037` 做了独立复核并据实处理。

## 独立复核

- **语义等价**：候选与 Round 116 基线在 27 份真实 `.doc/.dot` 样本上的完整 `parseWithFormat()` 结果（16,247,039 字符）**逐字节一致**。
- **端到端**：交错 4×NEW/4×OLD、每进程 20 轮，NEW 中位数 `114.215 / 112.306 / 111.857 / 104.667 ms`，OLD 中位数 `114.820 / 112.162 / 107.746 / 104.620 ms`。NEW 仅 1/4 组优于 OLD，其余 3 组退化（最多约 3.8%），中位数中位数 NEW ≈ 110.76 ms、OLD ≈ 109.84 ms，**无稳定收益**。
- **裁定**：候选语义等价但性能无稳定收益，按硬纪律否决并撤回。

## 处理

- 撤回 `bcea037` 的生产代码：`src/utils/docparser/heuristics/textHeuristics.ts` 恢复至 Round 116 基线（`1de88cd`）。
- 删除其新增测试 `tests/textHeuristics.paragraphFormat.test.ts`。
- 保留 `bcea037` 中无害的 `.gitignore` 新增项（`.autopilot/`）。
- 同时否决本会话发现的另一候选「`resolveStyleFormat` 全局 `WeakMap` 缓存」：该缓存按数组身份键控，会破坏「公开函数须反映调用方可变数组内容」的语义，不可证明等价。已改为新增**常驻护栏** `tests/styleParser.test.ts` 的 `should reflect mutations to the caller-owned style definitions`，并用缓存版做负控——实测触发断言失败，证明护栏有鉴别力。

## 验证（撤回后）

- 全量 `npm test`：**76 个测试文件、1448 项通过**。
- `vue-tsc --noEmit`、`eslint .`、`npm run build`、`npm run build:lib` 均通过。
- 包体与 Round 116 一致：主包 gzip **109.91 kB**；库入口 gzip **94.95 kB**、UMD gzip **83.11 kB**。
- `bench-diff 1170`：27/27 解析成功，中位数 0.950、p25 0.915、p10 0.897、min 0.812，与既有基线统计一致。

## 风险与下一轮

版本保持 `0.7.56`，未创建发布包，registry `latest` 仍为 `0.7.56`。下一轮 Round 118：重新剖析真实热点，优先验证尚未证伪的调用点级候选。
