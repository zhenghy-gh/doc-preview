# Round 179 — 整轮否决（发布暂停模式）

**日期**：2026-11-21　**结论**：否决候选，未落地任何生产代码，版本保持 0.7.88。

## 方向筛选（先插桩，再选候选）

先用 `node --cpu-prof` 对「27 份真实语料 × 30 轮 `parseWithFormat`」做自耗剖析
（临时脚本置于系统临时目录，未入库）。样本 1946 个，主要自耗：

| 自耗占比 | 函数 |
|---|---|
| 11.61% | `createParagraphsWithRealFormats` |
| 10.43% | GC |
| 8.07% | `buildMagicScanIndex` |
| 6.22% + 4.88% | `applyStructuralFormats` |
| 4.16% | `decodeRangeWithoutGuard`（R177 已否决） |
| 3.91% | `bytesToBase64` |
| 3.29% | `mergeCharFormatForParagraph` |

确认 R177/R178 选中的热点仍是头部，但两者都因「省掉的操作本身仅几十纳秒」
落入噪声。本轮改挑 `applyStructuralFormats` 的**分配压力**（GC 占 10.43%）。

## 候选

`src/utils/docparser/heuristics/paragraphFilter.ts` 的 `applyStructuralFormats`
在 Step 2 为每个候选列表组新建 `lengths: number[]`（push 后跑两个 reduce 闭包）
计算 avgLen / cv。改为在已有的 `visibleTextLengths: Uint32Array` 上直接顺序累加，
用模块级 `meanAndVariance()` 返回 `{avg, variance}`，消除每组一次数组分配与
两个闭包。累加顺序与 `** 2` 运算均与原 reduce 一致。

## 证据

- **逐字节等价**：27 份 `parseWithFormat` 全量 JSON dump，SHA-1
  `31cd7c4a478c59e53981ba569842c3acf43431c3`，16,260,883 字节，base/cand 一致。
- **配对端到端**（`scripts/perf/localPaired.mjs`，同进程交错）：
  | 对数 | medianRatio | meanRatio | 胜率 |
  |---|---|---|---|
  | 300 | 0.999786 | 1.001449 | 51.00% |
  | 400 | 1.000379 | 0.999907 | 49.50% |
- 两次独立测量均落在 ~50% 噪声地板，符号翻转，median/mean 均在 ±0.05% 内。

## 裁决

按硬纪律否决并撤回（`git checkout` 回备份，工作区干净）。本轮的分配削减在
隔离层面成立，但候选组本身数量不多、单例成本过小，端到端完全被解析主循环
淹没。**连续三轮（R177/R178/R179）证明本机上「纳秒级微优化」已无法越过
57% 采纳门槛**；后续若继续性能循环，应转向影响毫秒级行为的**算法/数据量**
变更（例如减少一次整趟扫描、减少一次大对象深拷贝），而非继续抠单条语句。

## 教训（通用教训 17）

**剖析自耗高 ≠ 端到端可测**：`applyStructuralFormats` 合计占 11% 自耗，但其中
真正的热点是遍历 3 万余段的 `includes`/属性加载；本轮只动了「每组一次小数组」
这一子类，分配虽少但原本就只占该函数的零头，因此端到端仍为零。选择候选时
必须问「削掉的成本占该函数自耗的几成」，而非只看函数总占比。
