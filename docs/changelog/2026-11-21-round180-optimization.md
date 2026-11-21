# Round 180 — 整轮否决（发布暂停模式）

**日期**：2026-11-21　**结论**：按纪律否决候选，未落地任何性能代码，版本保持 0.7.88。

## 先量后改（本轮主线）

按任务要求，本轮不再抠单条语句，先用 `node --cpu-prof` + 调用计数插桩 +
分阶段计时定位**算法级**浪费。

### 1. CPU 自耗剖析（27 份 × 30 轮 `parseWithFormat`，810 次）

| 自耗占比 | 函数 |
|---|---|
| 10.92% | GC |
| 8.82% | `createParagraphsWithRealFormats` |
| 5.94% + 5.15% | `applyStructuralFormats` |
| 5.54% | `buildMagicScanIndex` |
| 5.15% | `decodeRangeWithoutGuard` |
| 3.62% | `bytesToBase64` |
| 3.17% | `mergeCharFormatForParagraph` |

### 2. 调用计数（`unicode-01351-N2376.doc`，27505 段）

```
decodeRangeWithoutGuard        8 次 / 442,778 字节
buildMagicScanIndex            1 次 / 935,036 字节
createParagraphsWithRealFormats 1 次
mergeCharFormatForParagraph   27,504 次（每段一次）
applyStructuralFormats          1 次 / 27,504 段 / 2,690 候选组
```

确认**不存在 O(n²)**：已知 O(n²)（每列表组 `slice+filter` 求正文数）
已在 Round 171 用 `prefixBodyCounts` 修掉；当前 `mergeCharFormatForParagraph` /
`findPapxRunContaining` 均为「二分 + 顺序提示」，`buildMagicScanIndex` 是单趟
9 锚点扫描。没有重复整趟扫描或大对象重复拷贝残留。

### 3. 分阶段计时（同一份大文档，单次 ≈64ms）

```
extractFormattedText            61.11ms
  ├ parseClxWithStories          2.65ms
  ├ parseFormatRuns            17.14ms
  ├ createParagraphsWithRealFormats 20.36ms
  └ applyStructuralFormats      20.32ms
  （其中正文样式循环 13.41ms、HYPERLINK 预处理 2.00ms、列表组检测 2.33ms）
plainText 字符串拼接             0.90ms
normalizeParagraphCpAxis         0.85ms
extractImages + extractPictures  0.96ms
```

### 4. 候选：`plainText` 由 `+=` 链式拼接改为 `Array.join`

`parseWithFormat` 为 27,505 段用 `+=` 拼 `text` 字段。用 4 个变体
（base / join / prealloc / skip）做**交错配对**实测（27 份语料 × 300 对，
同进程交替顺序）：

| 变体 | medianRatio | meanRatio | 胜率 |
|---|---|---|---|
| `join` | 1.0241 | 1.0232 | **27.00%** |
| `prealloc` | 1.0381 | 1.0401 | **22.00%** |
| `skip`（不建 text） | 0.9967 | 0.9995 | 53.33% |

`join`/`prealloc` 明显更慢（V8 cons-string 的 `+=` 在此反而优于中间数组 +
join）；`skip` 仅比噪声地板（54.67%）略低，且「不产出 `text`」不是合法优化
（公共 API 与 Worker 序列化都会读取它）。⇒ 否决，撤回全部临时补丁。

## 裁决与教训

剖析再次印证：经过 179 轮后解析器热路径的「算法级浪费」已被前序轮次清理干净
（O(n²) 修复、5 趟魔数扫描合并为 1 趟、二分改顺序游标等）。本轮唯一可测量的
数据量级候选（`plainText`）方向相反。按硬纪律**不留下任何变慢代码**。

**通用教训 18**：当剖析显示「某函数自耗高」时，先做分阶段计时确认它到底花在
哪一段循环；若那段循环本身是**必要的逐元素写入**（如 `applyStructuralFormats`
对每段写 5 个样式字段），就不存在「少扫一趟」的空间，再抠写法只会落入噪声。
后续轮次若继续性能，应转向**跨阶段数据共享**（例如 structural 样式与
`createParagraphsWithRealFormats` 的样式写入融合），但那属于高风险重构，需独立评估。
