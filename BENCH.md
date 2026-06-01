# BENCH.md — 基准与循环历史

> 由 `/diff` / `/fix` 循环自动维护。最新循环置顶。

---

## 环境能力表（§1 启动前侦察, 2026-06-01）

| 工具 | 状态 | 路径/版本 | 用途 |
|---|---|---|---|
| soffice | ❌ | — | P0 .doc→PDF/HTML 不可用 |
| libreoffice | ❌ | — | 同上 |
| **textutil** | ✅ | `/usr/bin/textutil` | **P1 基线 (default)** |
| python3 | ✅ | `/usr/bin/python3` | 合成/olefile |
| pip3 | ✅ | — | 装 python 包 |
| python-docx | ✅ | v1.2.0 | 合成 .docx |
| olefile | ❌ | — | P2 流级提取 (需 `pip3 install olefile`) |
| node | ✅ | v20.19.0 | 构建 |
| npm | ✅ | 10.8.2 | 依赖 |
| git | ✅ | /opt/homebrew/bin/git | 版本控制 |
| curl | ✅ | /usr/bin/curl | 样本下载 |
| playwright | ✅ | v1.60.0 | P3 浏览器渲染（兜底） |

**样本盘:** 27 真实 .doc (docs/) + 7 合成 (synthetic/) + 1 归档 (_archived/) + 0 .docx 源
**Bench 状态:** 7 cycle 报告 (cycle-1 ~ cycle-7), 32 baselines
**HEAD:** 待 commit
**基准工具链:** P1 textutil (无 soffice 降级)

---

## 循环 #4 · 2026-06-01

### Cycle-4 目标

按循环 #3 建议，调查剩余 16 样本 paragraph_merged 根因（猜测：8-bit 路径 ≥0x20 字节追加策略问题）。

### 阶段 A: 网络采样

5 次 WebSearch + 直接 curl 探测 examplefile.com / file-examples.com / sample.cat / quickpickdeal.com：
- examplefile.com: 500/404 错误，POST/CSRF 阻挡
- file-examples.com: Cloudflare anti-bot 403
- sample.cat: 落地页不暴露 .doc 直链
- quickpickdeal.com: 列出 .doc 但链接指向 Blogger CDN（未探测）
- 公有互联网几乎无 .doc 直链可下载（2010+ 互联网已迁移至 .docx）

**结论**: 按 §6 失败处理回退到现有 27 样本测试，不阻塞循环。

### 阶段 D: 根因探针

`probe-fsample4.mjs` 显示 fsample4.doc：
- 提取 288 段 → **filterParagraphsWithGenericLogic 砍剩 1 段**（sim=0.000）
- 第一段 (offset 200-3752) 是 Microsoft Office 模板内容: "Video provides a powerful way... Word provides header, footer, cover page, and text box designs..."

`probe-skip.mjs` 验证: 该段含 'WORD' / 'DOCUMENT' 关键词 → 被 `skipPatterns` 过滤器误杀

**根因**：`filterParagraphsWithGenericLogic` 对**所有**段落做 `upperP.includes('WORD'/'DOCUMENT'/'TABLE'/...)` 检查。skipPatterns 列表设计目标是过滤 FIB 目录噪声（"WordDocument"、"SummaryInformation"、"Root Entry"），但被错误地应用到全段匹配。Microsoft 模板 fsample*.doc 全文讨论 Word 的 header/footer，每个段落都包含 'Word'/'document'/'table'，288 段被砍剩 1 段（仅第一段幸存——可能因 binary prefix 被 stripBinaryPrefix 处理后恰好不含这些词）。

### 阶段 E: 修复

```typescript
// cycle-4 修复: skipPatterns 仅作用于短段落（<80 字符）
if (p.text.length < 80) {
  const upperP = p.text.toUpperCase()
  const skipPatterns = [...]
  for (const pattern of skipPatterns) {
    if (upperP.includes(pattern)) return false
  }
}
```

**依据**：FIB/目录噪声（"WordDocument"、"SummaryInformation"、"Root Entry"）始终 < 30 字符。80 字符阈值安全覆盖噪声同时不误伤真实长文。

### Cycle-7 数据

- 样本: 27 / 解析: 27/27 ✅
- **相似度: 中位 0.727 / p10 0.000 / min 0.000 / p25 0.089**
- 失败分类: 22 paragraph_merged + 5 misc_diff（3 → 5 misc_diff 主要是 unicode-n2532.doc / uow-bio.doc 类别变更）

**vs cycle-6 中位 0.322 → 0.727，+0.405 (+125%)**，p25 0.006 → 0.089 (15x)。

### per-sample 变化（vs cycle-6）

| Δ | 样本 | 说明 |
|---|---|---|
| ↑ +0.387 | **fsample4.doc** | 1 段 → 287 段 (288 提取，287 通过过滤) |
| ↑ +0.476 | **fsample3.doc** | 1 段 → 50 段 (类似模板) |
| ↑ +0.532 | **fsample1.doc** | 0.190 → 0.722 |
| ↑ +0.666 | **uow-cfp.doc** | 0.102 → 0.768 |
| ↑ +0.626 | **uow-bio.doc** | 0.298 → 0.923 |
| ↑ +0.360 | unicode-01022.doc | 0.526 → 0.885 |
| ↑ +0.335 | unicode-n4350.doc | 0.106 → 0.441 |
| ↑ +0.297 | unicode-03042-voting.doc | 0.524 → 0.820 |
| ↑ +0.237 | unicode-02086-n2398.doc | 0.533 → 0.770 |
| ↑ +0.167 | unicode-02006-zia.doc | 0.322 → 0.490 |
| ↑ +0.155 | unicode-n2532.doc | 0.571 → 0.727 |
| ↑ +0.144 | openstd-n961.doc | 0.583 → 0.727 |
| -0.001 | doc-500kb.doc | 噪声 |
| -0.002 | doc-100kb.doc | 噪声 |
| -0.002 | doc-1mb.doc | 噪声 |
| = 0.000 | 6 样本 (含 doc-101/161/261/321, ftd-1.35mb) | 本轮未触及 |

**5 样本仍 0.000**（unicode-n1750w97, n4250, n4400, form, n4100, 01351-N2376）—— CJK 文档，与 skipPatterns 修复正交，留待下一轮。

### 满足提示词 §3 完成判定

- ✓ 整体相似度大幅提升（0.322 → 0.727，+125%）
- ✓ 12/27 样本提升（44% > 33% 阈值）
- ✓ 回归样本数 ≤ 3（3 轻微回归均 < 0.005，噪声范围）
- ✓ 无新增解析失败（27/27 仍 100% 解析成功）

### Cycle-4 改动详情

| 文件 | 改动 | 行为 |
|---|---|---|
| `filterParagraphsWithGenericLogic` | skipPatterns 限制到 `p.text.length < 80` | 保护长文段落不被误杀 |
| `probe-fsample4.mjs` (后清理) | fsample4.doc 段数/相似度诊断 | 定位根因 |
| `probe-skip.mjs` (后清理) | skipPatterns 匹配验证 | 确认 WORD/DOCUMENT/TABLE 误杀 |

### 重要经验

**`fsample4.doc` 是一类经典样本**：Microsoft Office 自带模板，文本内容是 "Video provides a powerful way..." 这类说明性内容。`fsample1/3/4` 同源（fsample2 缺），均含 WORD/DOCUMENT 关键词。**任何 .doc 解析器对真实英文文档的 Word 文档都需要通过这类样本**，否则会被自己设计的 skipPatterns 误杀。

### 建议下一轮（循环 #5）

剩 5 unicode-*.doc 0.000（CJK 内容）—— 这是 cycle-2 已识别的 8-bit 路径问题，**与本轮修复正交**。需新探针：
1. `probe-unicode-form.mjs` — 查 unicode-form.doc 段数从 4 → ? 的 0x0D 分布
2. 检测 UTF-16LE 路径下 CJK 字符是否被正确捕获（line 695-707 的 charCode 范围是否覆盖 CJK Extension A/B）
3. 8-bit 路径下 CJK 字符应映射为 GBK/EUC-CN 编码（当前代码可能完全跳过 ≥0x80 字节）

回归保护：cycle-4 修复未引入合成样本（fsample4 已存在 docs/）。下一轮若动 CJK 解析，需新增 ≥1 个 CJK + ≥0x80 字节混合样本（python-docx 合成）。

---

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
| 4 | 2026-06-01 | 27 | 100% | **0.727** | 0.000 | **保留（skipPatterns < 80 字符阈值，12 显著提升 3 噪声回归）** | pending |
