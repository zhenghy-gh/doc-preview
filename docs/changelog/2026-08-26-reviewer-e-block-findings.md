# reviewer E 块差异评审结论（T4-P1 门禁）

- 评审人：reviewer · 2026-08-26 · 对象=src/utils/docparser/assets/documentAssets.ts（新建 290 行）+ src/utils/docParser.ts 薄委托置换（-217 行）
- 方法：HEAD(worktree 基线) 四函数体逐字节抽取 diff（归一化 `this.→ctx.`、`DocParser.MAX_IMAGES→MAX_IMAGES`）；反向依赖 grep；消费者面核查；定向测试复跑
- 验证：vitest 定向 7 文件/265 用例全绿（renderGolden 11 例/realDocs/imageExtractor/pictureParser/propertyParser/dopParser/docParser）；vue-tsc --noEmit 0 错误

## 总裁决：**有条件通过 —— 可放行 B 域（clxReader）**

## 要点① move-only 保真核验
| 函数 | 判定 |
|---|---|
| extractProperties | ✅ 逐字节等价（仅签名 ctx 化） |
| extractDop | ✅ 逐字节等价（另加可选链 `?.` 一处，见要点②） |
| extractImages | ⚠️ 恰 1 处行为 hunk：魔数扫描预算化 `scanBudget=Math.max(maxScanBytes, MIN_IMAGE_SCAN_BYTES=1MB)` + 截断显式告警（PERF-T2 注记）。其余逐字节等价 |
| extractPictures | ⚠️ 恰 1 处行为 hunk：手工 chunk+btoa 编码器置换为 `bytesToBase64DataUrl`（PERF-T2/C5 注记）。**输出等价已核实**（同为 0x8000 分块、String.fromCharCode 数值语义一致、mime 同走 imageFormatMime） |

结论：**非严格 move-only**，混入 2 处经 inline 注记的行为适配。编码器置换输出等价可直接追认；扫描预算化对 >10MB Data 流为真实行为变更（超限图片不再入候选，但由静默变显式告警，方向与 DEF-004「去静默」及 PERF-T2 台账一致）→ 需 captain 追认并在 D4 回链 PERF-T2/DEF-004。划界纪律正面确认：同文件在飞的 DEF-004 scanLimitReached 改动未被本块吸收。

## 要点② AssetExtractionContext 注入设计
合理：ole/maxScanBytes 值注入边界清晰；readTableStream 以可选方法注入为 B 域 clxReader 预留，过渡期设计成立。两点建议：
- 漏接线时 `ctx.readTableStream?.()` 返回 undefined → 与"表流真实缺失"同形告警，不可辨识（现唯一调用点已 `.bind(this)` 传入，无现实风险）；B 域落地后应收紧为必选字段或 ctx 构造期校验。
- 每次调用新建 ctx 字面量对象：开销可忽略，接受。

## 要点③ 反向 import / 外部消费者
零风险 ✅：documentAssets 无 docParser 反向依赖（契约 §2.2 规则 2 达标）；唯一消费者 docParser.ts:32；src/index.ts 导出面不变；MAX_IMAGES 原为 private static 无外部消费面；tests 目录零引用迁出符号。

## 要点④ 薄委托与迁移注释
委托层质量好：4 个 private 包装保持类 API，5 处调用点（:326/:335/:360/:365/:2006）零改动。两处瑕疵：
- **E-F1（合并前必改·文档失实）**：模块头与常量注释称 MIN_IMAGE_SCAN_BYTES 为"原 DocParser.MIN_IMAGE_SCAN_BYTES"，但 HEAD 与现工作区 docParser.ts 均无此符号——它是本次新造常量，被标注成迁出符号会使 move-only 审计轨迹失真。更正为"新增常量（预算下限）"。
- E-F2（cosmetic）：docParser 侧薄包装上残留原实现的完整 docComment（已成孤儿文档，与新一行迁移注释叠加）；新模块函数体保留 class 缩进层级。顺手清理即可。

## 阻塞项单列
**功能级阻塞项：无。**
条件放行（3 项，均小改/流程性）：
1. E-F1 注释更正后方可合并（move-only 审计诚信）；
2. 两处行为适配由 captain 显式追认并回链 PERF-T2 / DEF-004 台账；
3. readTableStream 收紧计划写入 B 域（clxReader）任务卡验收条件。

—— reviewer · 2026-08-26 · 只评不改，本文档为唯一产出物
