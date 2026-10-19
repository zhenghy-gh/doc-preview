# Round 172/1000 — 2026-10-19 — **整轮否决**（`decodeRangeWithoutGuard` 的 UTF-16 分支改用对齐 `Uint16Array` 读对）——版本保持 0.7.85（不升号）

> 结论：**候选在真实数据上端到端无效（符号翻转）⇒ 整轮否决，未落地任何生产代码，不升号。** 按协议「若某轮验证失败或候选被否决 → 不发布，把否决理由写进 changelog 与 memory，轮次仍可计入」。
>
> 隔离层面它确实更快（每码元从「两次字节读 + 移位 + 或」降到「一次 16 位读」），27 份 `parseWithFormat` 也**逐字节一致**（SHA-1 `8f127d0bdbb0a63718a5663f48d267972c753b0e`）。但**同进程配对端到端两组样本符号翻转**：3000 对 medianRatio **0.99255** / 胜率 **56.17%**，2000 对 medianRatio **1.00398** / 胜率 **47.55%**，合并 **2636/5000 = 52.72%**（低于 ~54% 噪声地板）。

## 前提

post-171 HEAD 重建 bundle 重剖析（60 轮，**61.30 ms/轮**，3,548 samples，load≈3.4）：

| 函数 | 自耗 |
|---|---|
| `createParagraphsWithRealFormats` | 11.56% |
| GC | 10.51% |
| `buildMagicScanIndex` | 6.71% |
| `applyStructuralFormats`（包装器 + 真函数） | 6.17% + 4.54% |
| **`decodeRangeWithoutGuard`** | **4.82%** |
| `mergeCharFormatForParagraph` | 3.64% |
| `bytesToBase64` | 3.58% |
| `extractFormattedText` | 3.38% |
| `parseChpxGrpprlWithFont` | 2.99% |

`applyStructuralFormats` 已从 11.12% 降到 **10.71%**（R171 生效）。选定 `decodeRangeWithoutGuard`（4.82%，140 次调用/轮），其行级热点：压缩分支 `COMPRESSED_CODES[data[i]]` 0.82%、UTF-16 分支 `isValidPrintableChar(c)` 0.79% + `data[i] | (data[i+1] << 8)` 0.39%。

## 候选

UTF-16 分支原本每码元付「两次字节读 + 一次移位 + 一次或」：

```ts
for (let i = start; i < end - 1; i += 2) {
  const c = data[i] | (data[i + 1] << 8)
  // ……
}
```

改为在**对齐 + 小端**时用 `Uint16Array` 视图一次读出一对（即 R145 在 `buildMagicScanIndex` 上验证过的同一手法）：

```ts
const byteStart = data.byteOffset + start
if (LITTLE_ENDIAN && (byteStart & 1) === 0) {
  const u16 = new Uint16Array(data.buffer, byteStart, n)
  for (let j = 0; j < n; j++) {
    const c = u16[j]
    // ……与原分支逐字相同的过滤逻辑
  }
} else {
  // 原逐字节循环（奇数偏移 / 大端平台）
}
```

**等价性（已逐条核对）**：小端下 `u16[j]` 恰为 `data[start+2j] | (data[start+2j+1] << 8)`；迭代次数 `n = (end - start) >> 1` 与原 `for (i = start; i < end - 1; i += 2)` 完全一致（逐边界核对 `end-start ∈ {1,2,3,4,5}` 均相符）；`byteStart + 2n ≤ data.byteOffset + end ≤ buffer.byteLength` 保证视图不越界。

**验证结果**：27 份逐字节一致（SHA-1 `8f127d0b…`），实现标记 `byteStart` 9 → 12，构建确定性成立。

## 为什么它不转化（本轮教训）

| 样本 | 对数 | medianRatio | meanRatio | 胜率 |
|---|---|---|---|---|
| 1 | 3000 | **0.99255** | 0.99859 | **56.17%** |
| 2 | 2000 | **1.00398** | 1.01002 | **47.55%** |
| 合并 | 5000 | — | — | **2636/5000 = 52.72%** |

**两组符号翻转 ⇒ 中性/噪声。** 归因：

1. **`data[i] | (data[i+1] << 8)` 在 V8 上本来就极便宜** —— 两次 Uint8Array 元素读 + 移位 + 或，几乎全是单周期指令，且不分配。换成 `u16[j]` 只省下约两条指令，**没有减少任何「真实工作」**（读的字节数一样多）。
2. 这正是 R149/R150/R153/R154 的同一类失败：**把同一份工作换成更省的做法**，被 V8 的寄存器分配与分代 GC 吸收；而 R145 之所以成功，是因为它在 `buildMagicScanIndex` 上把 **288 万次迭代**的读法换掉（量大到能穿透噪声），且那里还伴随**表对称性**带来的分支消除。
3. 另外**新增了对齐守卫分支**与一次 `Uint16Array` 视图构造（140 次/轮），在效应本就极小时足以抵消收益。

> **可复用判据（本轮新记）**：**「减少每条指令的条数」不等于「减少工作量」。** 只有当改动**减少了被处理的数据量 / 调用次数 / 扫描次数**时，才可能转成端到端收益；仅仅把同一段计算写得更短（更少的 load/移位、更少的临时变量、更少的分配），在本项目已被反复证明为**中性**（R149/150/153/154/R172）。判据落地方式：改前先问「**被读/被写/被扫的字节数或次数是否真的下降**」，答否就别做。

## 处置

- **撤回**：`git checkout -- src/utils/docparser/clxReader.ts`，sha256 恢复 `93d12615147886970ff139312527175aa7cf724529a5d9f930abfa185ccb12a3`（= HEAD）。
- **还原核对**：用最终源码重建的 bundle 与基线 bundle **逐字节相同**（`cmp` 通过）。
- **不升号、不提交生产代码**：`package.json` 保持 **0.7.85**；本轮只有一个「记录否决」的文档提交。

## 下一轮

`decodeRangeWithoutGuard` 的**逐指令优化**路线已关闭。下一轮候选：

1. **压缩分支的「整段 bulk `set` + 定点修正」**（`COMPRESSED_CODES` 对 ASCII 是恒等映射）—— 但这属于「减少被处理字节数」吗？需要先量出「恒等字节占比」；若接近 100% 才有意义，否则仍是逐指令优化；
2. `applyStructuralFormats`（10.71%）—— `prefixBodyCounts` 并趟（省一整趟遍历），但需先量「有候选组的文档占比」，否则会变成「总是多分配一个 Int32Array」；
3. `bytesToBase64`（3.58%，单行 3.21%）—— 需先证 `TextDecoder('latin1')` **不可用**（WHATWG 里 `latin1` 是 windows-1252 别名，0x80–0x9F 会错映射）；
4. `buildMagicScanIndex`（6.71%）—— R142/143/145/165 已到顶；
5. `mergeCharFormatForParagraph`（3.64% + 调用点 3.47%）—— 建议先用「入口早退探针」量出真实占比，再决定是否值得动。

目标 1000 轮。
