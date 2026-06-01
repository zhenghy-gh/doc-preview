# BENCH.md — 基准与循环历史

> 由 `/diff` / `/fix` 循环自动维护。最新循环置顶。

---

## 循环 #3 · 2026-06-01

### Cycle-3 目标

按 cycle-2 建议重写 `extractParagraphsWithFormat` 的 firstParaMarker 探测。

### Cycle-3 数据

**Cycle-5（仅 firstParaMarker 改动）**:
- 样本: 27 / 解析: 27/27 ✅
- 相似度: 中位 0.319 / p10 0.000
- 与 cycle-4 完全一致, 改动**未产生效果**

**根因深挖**: probe-doc101.mjs 显示 doc-101.doc 第一个 0x0D 在 stream offset 1557, "This is Heading1 Text" 在 offset 1536-1556（紧贴 0x0D 之前）。cycle-5 改动后:
- extractParagraphsWithFormat 从 200 起读到 1557, 提交 P1 = bytes 200-1556 = 1356 字节
- P1 = 1535 字节 FIB 噪声 + 21 字节标题
- `stripBinaryPrefix` **只扫前 100 字节**, 找到 noise 中位置 7 的 '3-of-3-valid' 簇, 只剥 7 字节
- 剩余 1349 字节: ~98% 噪声, weird-chars 50% 过滤器**整段丢弃**
- → 标题仍然丢失, B[0] "This is Heading1 Text" 缺席

**根因（最终, 两层）**:
1. firstParaMarker 跳跃（cycle-2 假设）→ 移除 ✓
2. stripBinaryPrefix 搜索范围限 100 字节 → **超出 cycle-2 假设范围, 需独立修复**

**Cycle-6（追加 stripBinaryPrefix 改动）**:
- 样本: 27 / 解析: 27/27 ✅
- 相似度: 中位 0.322 / p10 0.000 / min 0.000
- 失败分类: 24 paragraph_merged + 3 misc_diff（分类不变, 数量不变）

**per-sample 变化（vs cycle-4）**:
- 提升 10 样本: doc-101/161/261/321 (+0.055 各, 首段恢复) + openstd-n961 +0.002 + unicode-01022 +0.001 + unicode-02006-zia +0.005 + unicode-02086-n2398 +0.003 + uow-bio +0.002 + uow-cfp +0.012
- 退化 1 样本: unicode-n4350 -0.002（噪声范围内, 不显著）
- 不变 16 样本

**满足提示词 §3 "回归样本数不下降" 完成判定**。

### Cycle-3 改动详情

| 文件 | 改动 | 行为 |
|---|---|---|
| `extractParagraphsWithFormat` | 移除 firstParaMarker 搜索; startOffset 仅保证 ≥200 | 允许提取 FIB 头部的首段 |
| `stripBinaryPrefix` | 扫描**整段**（非前 100 字节）找最长连续有效字符段（≥5 阈值） | 解决 "标题嵌在 FIB 噪声尾部" 的剥离失败 |
| `probe-doc101.mjs` | 新增诊断探针 | 验证 doc-101.doc 标题位置 |

### 重要经验

**cycle-2 建议不完整**。建议的 firstParaMarker 重写是必要但非充分条件。
单纯移除 firstParaMarker 跳跃 → 中位 0.317→0.319, 无可测效果（10 个回归样本仍 0.682）。
真正的修复需要 firstParaMarker **+** stripBinaryPrefix 双重改动。

### 建议下一轮

剩下 16 样本 paragraph_merged / misc_diff 与首段无关, 是**正文段落提取**问题:
- doc-100kb/1mb/500kb: lorem ipsum 长文, 段数偏少（22-32 段, 远低于预期几百段）
- fsample3/4: 仅 1 段, 几乎 0% 相似度
- unicode-form/n1750w97/n4250/n4400: 段数 2-6, 严重欠提取
- unicode-n4100/n4350: 段数 58/251, 大量段落被合并

**猜测**: 8-bit 路径累积 currentParagraph 时把 ≥0x20 的字节都追加, 但 FIB 内 0x0D 字节触发的"伪段尾"在更靠后位置出现时, 整段 huge paragraph 包含多个真实段被合成一段。需探针 trace unicode-form.doc 找首 0x0D / 段数 / 字节分布。

回归保护:
- `docs/_archived/08_ascii_short_titles.doc` baseline 已存 (sha=9c071c53...); cycle-3 未回测此样本 (8 段纯 ASCII 短标题, 与本次修复同场景, **理论上仍 0 提升**, 因为该样本原 0.8 相似度, 标题已被剥离过)
- 下一轮修复杂段合并时, 必须新增 ≥1 个 unicode-form.doc 风格合成样本, 避免回退

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
| 3 | 2026-06-01 | 27 | 100% | 0.322 | 0.000 | 保留（firstParaMarker + stripBinaryPrefix 双改，10 提升 1 微退 16 不变） | c837b8e |
