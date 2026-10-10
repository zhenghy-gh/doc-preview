# Round 123 优化记录（2026-10-10）

## 目标
基于真实语料 CPU profile，寻找 `createParagraphsWithRealFormats`、`applyStructuralFormats`、图像扫描和字符样式推断路径中的可证明等价微优化，并以独立进程交错端到端基准裁定是否采纳。

## 剖析与候选
- 真实 `docs/` 27 份样本、8 轮解析：中位 115.565 ms（profile 总样本 873）。
- 热点：GC 10.42%、`createParagraphsWithRealFormats` 10.42%、`applyStructuralFormats` 合计 8.93%、`extractImagesFromStream` 4.47%、`bytesToBase64` 4.12%、`detectCharacterStyles` 3.67%。
- 真实字符分布：1,456,460 字符；ASCII 99.869%、CJK 0.003%、空白 13.887%、数字 11.475%。
- 评估了沿用已验证快路径之外的进一步改写；未找到同时满足语义可证明、真实样本稳定收益和低风险的候选，未修改生产代码。

## 验证
- 基线 27 份完整 `parseWithFormat()` dump 已生成；无新候选，基线自检保持一致。
- `npm test`：76 文件 / 1448 项通过。
- `npx vue-tsc --noEmit`：通过。
- `npm run lint`：通过。
- `npm run build`、`npm run build:lib`：通过；包体保持主包 gzip 109.91 kB、库入口 94.95 kB、UMD 83.12 kB。
- `bench-diff 123`：27/27 解析成功；与 cycle-122 报告逐字段一致（排除 cycle/timestamp）。
- 基线端到端复测 8 轮中位 102.536 ms；本轮没有 NEW/OLD 候选交错收益数据，因此不采纳任何代码。

## 结论
本轮为否决/无候选轮：按硬纪律不为凑轮次提交变慢或收益不稳定的代码。版本保持 `0.7.57`，不发布双包。

## 风险与缺口
- `.workbuddy-ai/perf-harness/` 中历史 profile/脚手架属于协议常驻产物；本轮临时 bundle 已清理。
- 历史 progress/changelog 存在早期缺号，留待专门账本整理。

## 下一方向
Round 124：重新基于实时 profile，优先审计 `createParagraphsWithRealFormats` 与 `applyStructuralFormats` 中尚未验证的单点分配路径；仍须先做真实隔离与交错端到端验证。
