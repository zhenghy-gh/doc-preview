# Round 160/1000 — 2026-10-13 — 采纳（`applyStructuralFormats` Step 3c 短段落分支：惰性求值 + 两处恒真判断删除）

> 结论：**技术采纳，版本 0.7.73 → 0.7.74，双包发布。** 27 份 `parseWithFormat` 16,247,039 字符逐字节一致（SHA-1 `8f127d0b…`）；同进程配对端到端 **400 对：中位比值 0.98667 / 胜 266（66.5%）**、**800 对：0.9857 / 均值 0.98974 / 胜 515（64.4%）**，两轮规模同向、**无 400→800 符号翻转**。护栏 `tests/paragraphFilter.round160.test.ts` 9 项 + 三组离树负控（N1 3 项、N2 2 项、N3 3 项失败）。

## 前提与目标

Round 159 已把 `applyStructuralFormats` 的两处改动落地（删除恒空转的 Step 3.5、正文着色循环局部量提升），并在 changelog 末尾把下一轮方向指向 **Step 3c（该函数内最大子步）**。

本轮在 **post-159 HEAD** 上重建 bundle（`/tmp/r160-head.mjs`）并重跑 `--cpu-prof`（60 轮，**70.31 ms/轮**）。自耗前 10：`createParagraphsWithRealFormats` 13.67%、GC 10.64%、`applyStructuralFormats` **6.51% + 5.41%**（同一函数两处代码对象 = 真函数 + 类方法包装器，勿当两个独立热点）、`buildMagicScanIndex` 4.54%、`mergeCharFormatForParagraph` 4.47%、`bytesToBase64` 4.24%、`decodeRangeWithoutGuard` 4.10%、`extractFormattedText` 3.22%；`RegExp:` 节点单独汇总 **5.00%**（R158 前 7.01% → R159 后 5.45% → 本轮 5.00%）。

按 R159 的方法论（入口早退探针给上限、`performance.now()` 逐 Step 计时、计数插桩），Step 3c 约占该函数的 38.8% ⇒ **约占整轮 4.5%**，是函数内最大子步。

## 先量后改（本轮计数插桩）

对 Step 3c **短段落分支**（`else` 侧）新增计数（27 份 × 20 轮 = 540 次解析 / 675 次调用 / 842,550 段落）：

| 计数 | 值（20 轮） | 占比 |
|---|---|---|
| `shortIter` 短段落分支进入次数 | 772,800 | — |
| `pibTrue`（`prevIsBody` 为真） | **11,850** | **1.53%** |
| `pibFalse`（`prevIsBody` 为假） | **760,950** | **98.47%** |
| 其中 `nextPara.text.length >= 100` | 5,250 | — |
| 其中 `nextPara.text.includes('\u0007')` 被调用 | 6,575 | — |
| 其中该 `includes` 返回真 | 3,650 | — |
| 参考：`s3cShortHead`（最终判为标题） | 8,900 | 1.15% |
| 参考：`s3cShortBody`（判为普通正文） | 763,900 | 98.85% |

⇒ **`prevIsBody` 只有 1.53% 为真**，而原实现**无条件**先算出 `nextPara`（`paragraphs[i+1]` 数组加载 + `.text` / `.length` 属性加载）与 `nextIsLong`（后者在 `nextPara` 为短段时还要调用一次 `String.prototype.includes('\u0007')`），再进 `if`。也就是说 **98.47% 的迭代里这两个局部量纯属白算**。

## 候选实现（`src/utils/docparser/heuristics/paragraphFilter.ts`）

原实现：

```js
} else if (len > 0) {
  const prevPara = i > 0 ? paragraphs[i - 1] : null
  const nextPara = i < paragraphs.length - 1 ? paragraphs[i + 1] : null
  const prevIsBody = prevPara && prevPara.text.length >= BODY_MIN_LEN && !prevPara.paraFormat?.listType
  const nextIsLong = nextPara && (nextPara.text.length >= BODY_MIN_LEN || nextPara.text.includes('\u0007'))

  if (prevIsBody && nextIsLong && len < 100) { /* 标题 18pt */ }
  else { /* 普通正文 10.5pt */ }
}
```

改为：

```js
} else {
  const prevPara = i > 0 ? paragraphs[i - 1] : null
  if (prevPara && prevPara.text.length >= BODY_MIN_LEN && !prevPara.paraFormat?.listType) {
    const nextPara = i < paragraphs.length - 1 ? paragraphs[i + 1] : null
    if (nextPara && (nextPara.text.length >= BODY_MIN_LEN || nextPara.text.includes('\u0007'))) {
      /* 标题 18pt */
      continue
    }
  }
  /* 普通正文 10.5pt */
}
```

三处改动，各自独立可证等价：

1. **惰性求值**：`nextPara` / `nextIsLong` 只在 `prevIsBody` 为真时才计算；命中标题时用 `continue` 取代原 `if/else` 的 `else` 分支。原实现里这两个局部量在 `prevIsBody` 为假时**从未被读取**，故搬进条件内不改变任何可观察行为。JS 的 `&&` 左侧为假即短路，语义与原 `prevIsBody && nextIsLong && …` 完全一致。
2. **删掉 `else if (len > 0)` 的 `len > 0`**：进入该分支前已有 `if (paraText.length === 0) continue` ⇒ `len ≥ 1` 恒成立。
3. **删掉条件里的 `len < 100`**：`BODY_MIN_LEN === 100`，而 `len >= BODY_MIN_LEN` 已被同一 `if/else` 的前半支吃掉 ⇒ 进入 `else` 时必有 `1 ≤ len < 100` ⇒ `len < 100` 恒真。

顺带把长 / 标题 / 普通正文三个分支里的 `paragraphs[i]` 全部改用循环头部已取的局部量 `para`（循环体内 `paragraphs` 不发生 `splice`、`i` 不变、`para === paragraphs[i]`，故等价）。

**为什么这次能赢而 R149/R150/R153/R154 的微优化不能**：那几轮改的是「分配」或「纯算术」，V8 的分代 GC 与寄存器分配把它们吃掉了；本轮砍掉的是**真实的工作**——98.47% 的迭代里少一次数组元素加载、两次属性加载、以及（在 `nextPara` 为短段时）一次 `String.prototype.includes` 调用。

## 被否决 / 未采用的候选（备记）

| 候选 | 结论 |
|---|---|
| 把 `prevIsBody` 作为循环变量携带（省掉 `paragraphs[i-1]` 加载） | 循环体有 4 处 `continue`，需在每处之前更新携带变量或改写为 `if/else` 链，收益仅约 0.3%，复杂度与出错面不划算；未实现 |
| 用「单调指针」替代 `_subtitleSet.has(i)` | `subtitleLines` 升序（且 `splice` 插在末位副标题之后，不移动任何副标题下标）故可行；但 Set 元素数很小（非空调用平均 ~12.6 个），预估收益 ~0.45%，留作后续轮次 |
| Step 2 的 `prefixBodyCounts` 第二趟（`startsWith` + `substring`） | `t.substring(1).length` 可换 `t.length - 1` 免分配，但 `substring` 极少发生；预估 < 0.1%，未实现 |
| 预清洗循环的 `includes('HYPERLINK')` / 字段码正则门 | R159 已证「超集门」非严格等价；本轮未再尝试 |

## 等价性（逐字节）

- 27 份 `parseWithFormat` 落盘 JSON：`cmp` **完全一致**（16,247,039 字符；SHA-1 均 `8f127d0bdbb0a63718a5663f48d267972c753b0e`）。
- 三路互核：**基线 esbuild bundle == 候选 esbuild bundle == 重建后的 `dist-lib/doc-preview.js`**，SHA-1 全部相同。
- 合成语料差分：9 条构造语料上「改动前 Step 3 决策的逐行转写」与生产输出逐段一致；基线与候选 bundle 在同一探针上的输出 `diff` **逐行相同**。
- 构建确定性复核：`git stash` 后重建的基线 bundle 与改动前构建的 `/tmp/r160-head.mjs` **逐字节相同**（排除「陈旧 bundle」陷阱）。

## 性能证据（同进程配对端到端，正反交错）

`r149-paired.mjs`（baseline `/tmp/r160-base.mjs` vs cand `/tmp/r160-cand.mjs`）：

| 规模 | baseMedian / candMedian (ms) | 中位比值 | 均值比值 | 胜率 | 配对中位差 |
|---|---|---|---|---|---|
| 400 对（load ≈ 3.41） | 69.981 / 69.137 | **0.98667**（快 1.33%） | 0.98956 | 266/400 = 66.5% | −0.925 ms |
| 800 对（load ≈ 3.47） | 70.565 / 69.661 | **0.9857**（快 1.43%） | 0.98974 | 515/800 = 64.4% | −1.006 ms |

两轮规模同向、无 400→800 符号翻转；胜率 66.5% / 64.4%，显著高于「≥57% 采信、~54% 噪声地板」的历史口径。

## 护栏（`tests/paragraphFilter.round160.test.ts`，9 项）

- **A1 差分**：10 条构造语料上，生产输出（去空段后按序）与**改动前 Step 3 决策的逐行转写**在 `text` / `fontSize` / `firstLineIndent` 上逐段一致；并断言语料里不形成任何列表组（保证 `prevIsBody` 的 `!listType` 项在本语料上恒真）。
- **A2 正控**：同一转写必须能同时给出 `heading` 与 `regular` ⇒ 证明转写有鉴别力，A1 不是空转。
- **A3 非空转**：语料覆盖 `heading ≥ 3` / `regular ≥ 3` / `long ≥ 5` 三种决策。
- **B1 边界**：`BODY_MIN_LEN` 恰为 100 —— 99 字符走短分支（`firstLineIndent=0`），100 字符走长分支（`firstLineIndent=24`）。
- **B2 邻居缺失**：首位（`prevPara=null`）与末位（`nextPara=null`）都不得判为标题。
- **B3 `\u0007` 替代路径**：`nextPara` < 100 字符但含 `\u0007` 时仍判标题；对照（短且不含）判普通正文。
- **B4 副标题路径**：`subtitleLines` 非空时标题 28pt / 副标题 18pt / 正文 10.5pt，且每个非空段落都落到字号。
- **C1/C2 接线元断言**：源码已无 `const prevIsBody = `、`prevIsBody && nextIsLong`、`nextIsLong && len < 100`、`} else if (len > 0) {`；已含新的嵌套守卫与标题分支末尾的 `continue`，且 `para.charFormat = para.charFormat || {}` 至少 3 处。

**负控（离树注入生产源码，注入后 `cmp` 核验逐字节复原）**：

| 编号 | 注入 | 结果 |
|---|---|---|
| N1 | 删掉 `nextIsLong` 的 `\|\| nextPara.text.includes('\u0007')` 替代路径 | **3 项失败** ✓ |
| N2 | `len >= BODY_MIN_LEN` → `len > BODY_MIN_LEN`（边界右移） | **2 项失败** ✓ |
| N3 | 删掉标题分支末尾的 `continue`（等价于把 `if/else` 退化成「先写 18pt 再被 10.5pt 覆盖」） | **3 项失败** ✓ |

三组注入后源码 `cmp` 恢复逐字节相同（sha256 前缀 `33d6239bd0533400`）。

## 门禁与产物

- `npm test` **1772/1772（89 文件）**（较 R159 的 1763/88 增加本护栏 9 项 + 1 文件）；`npx vue-tsc --noEmit` 0 错；`npm run lint` 0 告警；`npm run build` + `npm run build:lib` 均通过（test 与 lint 串行执行）。
- `bench-diff.mjs 160` 与 `cycle-159.json` **除 `cycle`/`timestamp` 外逐字段相同**（median 0.9502433994244857 不变）。
- `dist-lib/doc-preview.js` **369,538 → 369,488 字节（−50 B）**；`dist-lib/doc-preview.umd.cjs` 274,394 → 274,305 字节（−89 B）。esbuild 未压缩 bundle 319,473 → 319,173 字节（−300 B）。
- 性能证据建立在最终源码上：改动后再重建候选 bundle 与取证用 bundle **逐字节相同**。

## 下一轮

Round 161，目标 1000。方向：Step 3c 剩余子项（`_subtitleSet` 单调指针、`prevIsBody` 携带）与 Step 2 列表分组（函数内第二大子步）；并注意本轮实测到的「惰性求值才是真收益、纯分配削减被 GC 吸收」这一分野。
