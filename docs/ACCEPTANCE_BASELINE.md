# 《doc-preview 优化验收基线与度量口径》v1.0

维护人：pm · 生效 2026-08-25 · 适用范围：doc-preview 全部 1000 轮持续优化
变更流程：修改本口径属需求变更，须经用户确认后由 pm 更新版本号并同步 captain。

## 0. 基线快照（Baseline @ commit 9670a30, 2026-08-25 实测）

| 项 | 数值 | 状态 |
|---|---|---|
| npm run build | vue-tsc + vite，1.37s，退出码 0 | ✅ |
| npm test (vitest run) | 1116 用例：1114 通过 / **2 失败**；37 文件：36 通过；3.83s | ⚠️ 存量失败 |
| 构建体积（app 形态） | index.html 0.50KB(gzip 0.34)；main.js 312.97KB(gzip 106.41)；docParser.worker.js 125.93KB；main.css 44.37KB(gzip 7.76)；JS+CSS 合计 raw ≈ 483KB / gzip ≈ 151KB | 已登记 |
| 正确性（BENCH 体系） | 27 个真实样本 27/27 解析成功；textutil 相似度中位 0.727 / p25 0.089（cycle-4） | 已登记 |
| 解析耗时（Node） | tests/realDocs.test.ts 逐样本 ms 输出，SLOW 阈值 2000ms | 已登记 |
| 首屏耗时 | 未测 | 待 perf-dev 回填 |
| 库形态体积（build:lib） | 未测 | 待首轮补测 |

存量测试失败（登记为 P0，最优先清零）：
- **P0-1** `tests/docParser.test.ts:1508` — parseWithFormat field assembly（hyperlinks/toc/index/fields/page fields/cross references/sections 组装断言失败）
- **P0-2** `tests/docParser.test.ts:1882` — CLX-unreachable fallback paths（scoring fallback 选 UTF-16 分支，expected false to be true）

## 1. 每轮完成判定标准（Definition of Done）

一轮优化判「完成」须同时满足以下四条：

- **D1 构建通过**：`npm run build` 退出码 0（含 vue-tsc 类型检查 0 错误）。
- **D2 测试通过（棘轮制）**：`npm test` 不出现**新增**失败——失败用例数与失败文件数均不得高于最近一次登记基线。P0-1/P0-2 清零后，D2 升级为硬性门槛：必须全绿（0 failed），此后不再回退。
- **D3 无功能回退**，三条子判据：
  - (a) 文本正确性（对齐 BENCH.md 相似度棘轮）：27 样本中位相似度较上一登记值下降不超过 0.005 噪声带；单样本下降 >0.01 记回归；回归样本数 ≤3；解析成功率保持 27/27。
  - (b) 结构化能力：tests/realDocs.test.ts 的 28 个夹具全部 success，无新增 EMPTY / NOPARAS / SLOW(>2000ms) 标记。
  - (c) 功能面：本轮改动直接涉及的特性（对照 FEATURES.md / AGENTS.md 特性表）必须人工验证并在变更摘要写明结论；未涉及特性按改动面抽查。
- **D4 可追溯**：变更摘要看板留痕——改了什么 / 为什么 / 影响面 / 关键度量前后对比。

项目红线（沿承团队协作约定）：任何轮次不得引入硬编码的文档特定模式。
处置：任一条不满足即当轮不判完成，修复后重验；确因客观条件暂无法闭环的，转登记为任务并说明原因。

## 2. 性能指标口径

统一测量环境：Chrome 最新稳定版 + `npm run preview` 本地服务 + 默认硬件无节流；每组数据取 **3 次中位数**；每条记录附 commit 号与日期。纯 Node 侧度量（构建产物、测试内计时）以脚本实际输出为准，不依赖浏览器。

### 2.1 构建体积
- 口径：`npm run build` 后 dist 内全部 `.js`+`.css` 产物，逐文件记录 vite 报告的原始 KB 与 gzip KB，另记最大单 chunk 与合计。库形态 `npm run build:lib`（es/umd/style.css/.d.ts）作为独立口径，首轮补测登记。
- 基线：见 §0 快照。
- 阈值：JS+CSS 合计（raw 或 gzip 任一）较最近登记值上涨 >5% → 变更摘要必须说明理由；上涨 >15% → 判为性能回退（P1 缺陷），当轮不判完成。

### 2.2 首屏耗时
- 口径 A（应用首屏）：导航开始 → 上传界面主容器渲染完成。
- 口径 B（文档首屏）：中档基准样本（建议 doc-100kb.doc）从拖入/选中 → 正文第一页可见（含解析完成）。
- 工具：Chrome DevTools Performance 或 Lighthouse，记录所用工具。基线待 perf-dev 首轮回填上板。

### 2.3 解析耗时
- Node 口径（现成）：`parseDocFileFromBuffer` 入口到返回，`performance.now()` 计时；以 tests/realDocs.test.ts 逐样本 ms 输出为准，SLOW 阈值 2000ms，**不允许新增 SLOW 样本**。
- 浏览器口径：worker 路径 `parseWithWorker`（含 postMessage 往返），小(<100KB)/中(100KB–5MB)/大(>5MB) 三档各 ≥1 样本 ×3 次中位数；perf-dev 首轮建立测量脚本并回填基线。
- 内存（可选）：大档样本 DevTools heap 峰值，只记趋势不设硬阈值。

## 3. 优先级框架

**P0 正确性 > P1 性能 > P2 结构 > P3 体验 > P4 测试补充**

| 级别 | 定义 | 当前典型项 |
|---|---|---|
| P0 正确性 | 解析崩溃/OOM、OLE 签名或编码误判、文本错乱丢失、格式张冠李戴、XSS/安全问题 | 存量 P0-1/P0-2；BENCH cycle-4 遗留 5 个 CJK 样本相似度 0.000 |
| P1 性能 | 超出 §2 阈值或明显劣化：构建体积、首屏 A/B、解析耗时、内存 | 大档样本解析时长；main.js 313KB 的 chunk 拆分空间 |
| P2 结构 | DocPreview.vue 瘦身、模块拆分、类型治理、死代码清理 | 面板继续迁移 CollapsiblePanel；docFormatTypes.ts 去留 |
| P3 体验 | UI / 交互 / i18n / 移动端适配细节 | — |
| P4 测试补充 | 单测覆盖、E2E（playwright 已在 devDependencies）、CI 化、覆盖率基线 | — |

执行规则：
1. 存在未清零 P0 时，不开 P1–P4 专项（顺手修复允许，须在摘要注明）。
2. 同优先级内按「影响面 × 复现率」排序。
3. 性能专项先测后改：动手前按 §2 取基线，完成后复测并记入台账。
4. 优先级争议由 captain 裁决；仍不一致上报用户定夺。
5. 本口径或优化目标的任何修改走需求变更流程：用户确认 → pm 更新版本号 → 同步 captain。

## 4. 度量台账

共享看板注记键 `perf-ledger`：每轮完成后由该轮执行人追加一行：

```
轮次 | commit | build(raw/gzip KB) | test(pass/fail) | 首屏A/B(ms) | 解析ms(小/中/大) | BENCH中位相似度 | 备注
```

首行（第 0 轮基线）：`0 | 9670a30 | 483/151 | 1114/2 | 待测 | 待测 | 0.727 | 存量失败 P0-1,P0-2`
pm 定期汇总趋势并向 captain 提示劣化项。
