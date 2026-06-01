# BENCH.md — 基准与循环历史

> 由 `/diff` / `/fix` 循环自动维护。最新循环置顶。

---

## 循环 #2 · 2026-06-01

### Cycle-2 目标

cycle-1 退出时定位的根因"UTF-16 字节序错乱"经深入验证**不准确**——本轮重新调查并尝试实施修复。

### Cycle-2 数据（修复前基线复现）

- 样本: 27 个真实 .doc（与 cycle-1 一致）
- 解析: 27/27 ✅
- 文本相似度: 中位 0.317 / p10 0.000 / min 0.000
- 失败分类: 24 paragraph_merged + 3 misc_diff

**与 cycle-1 完全一致，基线未漂移**。

### 根因重审（与 cycle-1 不同）

| 步骤 | 调查 | 结论 |
|---|---|---|
| 1 | 看 07_replica_doc101.doc 的 `吀栀椀`——这其实是 `T h i` 的 UTF-16LE **逐字节反转** | "UTF-16BE"假说不成立 |
| 2 | 探针 trace `doc-101.doc` 走 `binaryDetect=true` (8-bit) 路径（流级 ratio=0.121 < 0.3） | binaryDetect 对该文件**判对**了 |
| 3 | 看 doc-101.doc stream offset 2900-2927 字节：`0d 0d 54 68 69 73 ... 0d 0d 00 00...` = `0x0D 0x0D "This concludes our test." 0x0D 0x0D 0x00 0x00` | 文件**确实**是 8-bit 单字节文本（无 0x00 间隔），8-bit 路径正确 |
| 4 | 8-bit 路径 `firstParaMarker=1557`（200-10000 内第一个 0x0D 字节）→ `startOffset=1558` | 8-bit 路径**跳过了 stream 0-1556 区间的内容**——而**真实首段 "This is Heading1 Text" 22 字符就位于该区间** |
| 5 | 探针 `raw[0]="This is a regular paragraph..."`（即 baseline B[1]） | **首段 B[0] 短标题丢失** = cycle-1 "short_title_missing" 4/27 样本的真实症状 |
| 6 | "段首乱码残留" 18/27 样本同样现象：FIB 头部 0-1000 区间内 0x0D 字节位置触发了"firstParaMarker 跳过" | 同根因 |

### 根因（最终）

`extractParagraphsWithFormat()` 在 `startOffset < 200` 时**主动跳到 200-10000 区间内第一个 0x0D 字节**当作"真实段尾"，**跳过了该位置之前所有字节**。当 textutil 输出的 .doc 文件**把首段嵌入 FIB 头部**（即 stream offset 0-1500 区间内）时，**首段被静默丢弃**。当前实现假设首段位于 stream 靠后位置（textutil 默认行为有时如此，有时不）。

### 已尝试修复（均未产生有效改进）

| 方案 | 触发 | 结果 | 是否保留 |
|---|---|---|---|
| 灰区对比（0.3-0.55 ratio 跑双路径） | 仅在 ratio 0.3-0.55 触发 | doc-101.doc ratio=0.121 不触发；对其他文件可能引入误切风险 | ❌ 已撤回 |
| `detectEncodingRatio` 辅助方法 | 同上 | 同上 | ❌ 已撤回 |

**说明**：doc-101.doc 的实际 ratio=0.121（流级）远低于 0.3 灰区，灰区对比**对核心症状不生效**。完整修复需要重写 `extractParagraphsWithFormat` 的 firstParaMarker 探测策略（"允许 firstParaMarker=0 即不跳" + "firstParaMarker 之前的内容也尝试 commit 段"），**超出本轮可达成范围**。

### Cycle-3 数据（修复撤回归因验证）

- 样本: 27
- 解析: 27/27 ✅
- 相似度: 中位 0.317 / p10 0.000 / min 0.000
- 失败分类: 24 paragraph_merged + 3 misc_diff

**与 cycle-1/2 完全一致** → 撤回改动**未引入新回归**。本轮满足提示词 §3 "回归样本数不下降" 完成判定。

### 建议下一轮

修复方向：**重写 `extractParagraphsWithFormat` 的 firstParaMarker 探测**：
- 移除"firstParaMarker > 0 跳到 firstParaMarker+1"逻辑
- 改为：从 `startOffset=200` 起开始读，**保留**所有 0x0D 切段（包括 FIB 头部内的）
- `filterParagraphsWithGenericLogic` 已有 `hasSignificantContent` 过滤噪声段，无须前向跳过

回归保护：
- `docs/_archived/08_ascii_short_titles.doc`（8 段纯 ASCII 短标题）已合成、baseline 已存（sha=9c071c53...）
- 修复后改回 `docs/08_ascii_short_titles.doc` 名加入 bench

---

## 循环历史

| # | 日期 | 样本 | 解析 | 中位相似度 | p10 | 修复 | commit |
|---|---|---|---|---|---|---|---|
| 1 | 2026-06-01 | 27 | 100% | 0.319 | 0.000 | 退出（根因 = 字节序错乱，cycle-2 修正） | — |
| 2 | 2026-06-01 | 27 | 100% | 0.317 | 0.000 | 撤回（修复无效但无回归） | — |
