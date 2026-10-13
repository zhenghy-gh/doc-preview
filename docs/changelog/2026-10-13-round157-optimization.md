# Round 157/1000 — 2026-10-13 — 采纳（applyStructuralFormats Step 4：删除一次恒真的 `\u0001` 全串扫描）

> 结论：**技术采纳，版本 0.7.70 → 0.7.71，双包发布。** 27 份 `parseWithFormat` 16,247,039 字符逐字节一致（shasum `8f127d0b…`）；同进程配对端到端 **600 对：中位比值 0.98997 / 均值 0.99396 / 胜 372（62.00%）**，**800 对：中位比值 0.98787 / 均值 0.99249 / 胜 497（62.12%）** —— 两轮规模同向为正、无 400→800 符号翻转（噪声特征），判为真实收益。护栏 `tests/paragraphFilter.round157.test.ts` 8 项 + 三组离树负控（A 5 项、B 4 项、C 2 项失败）。

## 前提与目标

在 **post-156 HEAD**（Round 156 已落地）上重建 bundle 并重跑 `--cpu-prof`（60 轮），自耗前 10：

| 函数 | 自耗 |
|---|---|
| `createParagraphsWithRealFormats` | 12.00% |
| (garbage collector) | 10.06% |
| `applyStructuralFormats` @6737 | 7.19% |
| `applyStructuralFormats` @8482（类方法包装器，体内联） | 6.09% |
| `buildMagicScanIndex` | 4.50% |
| `bytesToBase64` | 4.15% |
| `mergeCharFormatForParagraph` | 3.89% |
| `decodeRangeWithoutGuard` | 3.72% |
| `extractFormattedText` | 3.65% |
| `parseChpxGrpprlWithFont` | 2.52% |

行级归因（`positionTicks`）在 `applyStructuralFormats` 内给出若干**逐段落字符串扫描**热点：L6748 `includes("HYPERLINK")` 0.82%、L6781 `includes("\u0001")` 0.75%、L7010 `includes("\u0001") && para.__hasEmbeddedPic` **0.69%**、L6940 `includes("\x07")` 0.52%。

> 先量后改：`applyStructuralFormats` 每轮被调用 **27 次（= 27 份文档各一次）**，平均 **1248 段落/次**（合计 33,702 段落/轮）——确认无「同一份段落被重复处理」的冗余调用，候选只能落在单次调用内部的逐段落开销上。

## 发现（本轮核心）

`applyStructuralFormats` 的 Step 4（把混合了 `\u0001` 图片占位符的段落拆成「正文段 + 独立占位符段」）原本判定为：

```ts
if (text.includes('\u0001') && para.__hasEmbeddedPic) { … }
```

其中 `para.__hasEmbeddedPic` **只在** Step 2 的 `if (text.includes('\u0001'))` 分支内、且「剥离占位符后仍有非空白内容」时置位。因此 **`__hasEmbeddedPic === true` 恒蕴含 `para.text.includes('\u0001')`** —— L7010 的 `includes` 是一次**恒真的全串扫描**。

**实证**（计数补丁 `patch157b.mjs` + `r157-count4.mjs`，27 份样本 × 20 轮）：

| 计数项 | 每轮值 |
|---|---|
| Step 4 循环迭代（段落数） | 34,828 |
| `text.includes('\u0001')` 为真 | 126 |
| `para.__hasEmbeddedPic` 为真 | 117 |
| 二者同时为真 | 117 |
| 仅 includes 为真（Step 4 自己插入的纯 `\u0001` 段落） | 9 |
| **仅 flag 为真（即 flag ⟹ includes 的反例）** | **0** |

`flagOnly = 0` ⇒ 冗余性在真实语料上**实证成立**；且结构上可证：Step 2 之后没有任何路径会从 `para.text` 里删掉 `\u0001`（Step 3.5 的合并只是把 `prev.text` **前插**、不删字符；Step 3.6 只插入空段落；Step 4 自身插入的 `picPara` 没有该标志，两版都会跳过）。

## 候选实现

`src/utils/docparser/heuristics/paragraphFilter.ts` Step 4：把复合判定收紧为标志位早退（同时把 `const text` 挪进分支，省一次属性读）。

```ts
for (let i = paragraphs.length - 1; i >= 0; i--) {
  const para = paragraphs[i]
  if (!para.__hasEmbeddedPic) continue      // ← 原：const text = para.text || ''; if (text.includes('\u0001') && para.__hasEmbeddedPic) {
  const text = para.text || ''
  const textWithoutPic = text.replace(PIC_PLACEHOLDER_RE, '')
  …
}
```

**等价性论证**：`__hasEmbeddedPic` 仅在 `text.includes('\u0001')` 为真时置位（Step 2），且此后 `para.text` 的 `\u0001` 不会被删除 ⇒ `flag` 与 `includes && flag` 在**全部输入**上恒等。原判定中 `includes` 一侧完全冗余。

## 等价性（逐字节）

- 27 份 `parseWithFormat` 落盘 JSON：`cmp` **完全一致**（16,247,039 字符；两路 shasum 均 `8f127d0bdbb0a63718a5663f48d267972c753b0e`）。

## 性能证据（同进程配对端到端，正反交错）

- `r149-paired.mjs`（baseline `/tmp/r157-head.mjs` vs cand `/tmp/r157-cand.mjs`）：
  - **600 对**：baseMedian 75.435ms / candMedian 75.011ms，**中位比值 0.98997（候选快 1.00%）**；**均值比值 0.99396（快 0.60%）**，**胜 372/600（62.00%）**。
  - **800 对**：baseMedian 75.804ms / candMedian 75.117ms，**中位比值 0.98787（候选快 1.21%）**；**均值比值 0.99249（快 0.75%）**，**胜 497/800（62.12%）**。
- 两轮规模**中位与均值同向为正**，胜率稳定在 ~62%，**无 400→800 的符号翻转**（历史噪声特征）；显著高于采纳阈值（57%+）与本轮前噪声地板（~54%）。
- 采样时 load average ≈ 3.2–3.6，故同时采信「同进程配对差」与「min 口径」，不做绝对值跨会话比较。

## 护栏（`tests/paragraphFilter.round157.test.ts`，8 项）

- **P1** 混合内容含占位符 ⇒ 拆出恰 1 个独立占位符段落（`text==='\u0001' && charFormat.fontSize===0`），原段落去掉占位符。
- **P2** 纯占位符（剥离后 trim 为空）⇒ 不拆分（标志不置位）。
- **P3** 占位符 + 纯空白 ⇒ 不拆分。
- **P4** 无占位符的普通段落 ⇒ 不拆分。
- **P5** 多个占位符且仍有可见内容 ⇒ 仅拆出 1 个占位符段落，原段落清空全部占位符。
- **P6 慢但等价对照**：13 条合成语料上，「实际是否拆分」≡ 改动前口径 `referenceShouldSplit(text) = includes && (剥离后 trim 非空)`。
- **负控 A**（注入 `if (false) continue` 无条件拆分）：**5 项断言失败**。
- **负控 B**（注入 `if (true) continue` 从不拆分）：**4 项断言失败**。
- **负控 C**（把 Step 2 的 `if (text.includes('\u0001'))` 改成 `if (true)`，破坏「flag ⟹ includes」不变量）：**2 项断言失败**。
- **元断言**：源码含 `if (!para.__hasEmbeddedPic) continue`，且**不再含** `text.includes('\u0001') && para.__hasEmbeddedPic`。
- 三组负控注入后源码均以 `cmp` 校验恢复为**逐字节相同**。

## 门禁

`npm test`（全量）+ `npx vue-tsc --noEmit` + `npm run lint` + `npm run build` + `npm run build:lib` 全通过（test/lint 串行，避免 vitest 临时文件致 eslint ENOENT）。

## 下一轮

Round 158，目标 1000。
