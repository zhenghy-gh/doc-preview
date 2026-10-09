# Round 106 — `detectCharacterStyles` 的冒号扫描并进主遍历

本轮把 `detectCharacterStyles` 里**单独一趟 O(n) 的冒号扫描**并进已有的主遍历，去掉
每个段落一次多余的全串遍历。隔离基准 `detectCharacterStyles` **1.40x**、`guessCharFormat`
**1.32x**，端到端**约 1.9%**（真实但远小于隔离值——又一次印证「隔离基准会系统性高估
端到端收益」）。改动零语义风险。

---

## 起因：段落级热函数范围测定

Round 105 之后对语料全部 33 819 个段落压测段落级辅助函数：

```
cleanParagraph:          0.906 ms
shouldSkipParagraph:     0.812 ms
detectAlignment:        13.783 ms
detectListInfo:          4.232 ms
detectParagraphFormat:  18.129 ms   （≈ detectAlignment + detectListInfo）
guessCharFormat:        53.024 ms   （含内部调用的 detectCharacterStyles 34.79 ms）
```

`guessCharFormat` 是最大单项，而其中 `detectCharacterStyles` 又占大头。`detectCharacterStyles`
原本对**每个段落**做两次全串遍历：

1. 主遍历：逐字符判定字符样式、合并同款样式段（O(n)）；
2. **单独的冒号扫描**（O(n)）：只为收集全角/半角冒号位置，供后面的下划线区间合并用。

第 2 趟完全可以并进第 1 趟——主遍历本来就访问每个字符。

---

# 改动（`src/utils/docparser/heuristics/textHeuristics.ts`）

把冒号收集移入主遍历（放在循环体最前，早于任何 `continue`，故每个 `i` 都经过）：

```ts
// 冒号位置与字符样式在同一次遍历里收集（Round 106：原先单独跑一趟 O(n)）。
const colonPositions: number[] = []

for (let i = 0; i < text.length; i++) {
  const code = text.charCodeAt(i)
  if (code === 0xff1a || code === 0x3a) colonPositions.push(i)   // ← 新增
  const isDigit = code >= 0x30 && code <= 0x39
  // ... 原有字符样式逻辑不变
}
```

并删除原来那段独立循环：

```ts
// 删除：
// const colonPositions: number[] = []
// for (let i = 0; i < text.length; i++) {
//   const code = text.charCodeAt(i)
//   if (code === 0xff1a || code === 0x3a) colonPositions.push(i)
// }
```

**等价性**：主遍历对 `i ∈ [0, length)` 每个值恰好访问一次，冒号判定位于 `continue` 之前，
故 `colonPositions` 的内容与顺序与独立一趟完全一致；后续下划线区间合并逻辑未改动。

---

# 隔离基准（语料 33 819 段落）

| 函数 | 改动前 | 改动后 | 加速 |
|---|---|---|---|
| `detectCharacterStyles` | 34.794 ms | 24.892 ms | **1.40x** |
| `guessCharFormat`（含内部调用） | 53.024 ms | 40.228 ms | **1.32x** |

---

# 端到端验证（真实收益——远小于隔离值）

27 份样本 / 7.6 MB 语料，独立进程，120 轮取最小，`git stash` 切换源码分别打包，
**交错重复 3×NEW / 2×OLD** 以控制机器漂移：

```
NEW:  143.72 / 144.35 / 144.33 ms   （min，均值 ≈ 144.1）
OLD:  146.61 / 147.06 ms            （min，均值 ≈ 146.8）
→ 端到端 ≈ 1.019x（约 +1.9%）
```

三组 NEW 与两组 OLD 各自紧聚且清晰分离，故 1.9% 是真实的、非噪声的——但**只有隔离
1.40x 折算预期（~7%）的四分之一**。原因与 Round 103 同源：隔离基准在**同一批短文本上
紧凑循环**，放大了每次调用的循环建立开销；而端到端里 `detectCharacterStyles` 对全语料的
总贡献本身只有几毫秒。**「函数级赢」与「端到端赢」是两个独立命题**这条纪律再次生效。

---

# 等价性证据（四重）

1. **常驻差分护栏** `tests/textHeuristics.charStyles.test.ts`（**4 项**）：把**改动前**的
   `detectCharacterStyles` 逐行转写为参照（冒号单独一趟，调用导出的 `shouldHaveUnderline`
   与 `isSameStyle`，本文件内复刻 `isWhitespaceCode`），与新实现做差分：
   - 穷举长度 ≤ 4 全串（含冒号/数字/日期单位/空白/字母/CJK/标点）；
   - 随机串 3000 组（长度 ≤ 60）；
   - 冒号密集串（触发下划线区间合并）；
   - 空串 / 无冒号串。
2. **护栏鉴别力**：把新实现的冒号判定注入 bug（只在偶数下标收集）→ **3/4 用例失败**，
   证明差分护栏确实有鉴别力（随后已还原）。
3. **端到端逐位一致**：`node bench-diff.mjs 1060` 与 `cycle-1050` **除 `cycle`/`timestamp`
   外全部字段逐位相同**（median 0.9502433994244857、min 0.8115474418758475，`topIssues`/
   `failures` 完整列表也逐条相同）——**13 个失败样本两个轮次完全一致，零新增回归**。
4. **全量测试 / 类型 / lint**：`npm test` **68 文件 / 1407 项**通过（较 Round 105 的
   67/1403 **+1 文件 +4 项**）；`npx vue-tsc --noEmit` 0 错误；`npm run lint` 0 错误。

---

# 验证清单

- `npx vitest run tests/textHeuristics.charStyles.test.ts` → **4 passed**
- `npm test` → **68 文件 / 1407 项**通过
- `npx vue-tsc --noEmit` → 0 错误
- `npm run lint` → 0 错误
- `npm run build` / `npm run build:lib` → 通过
- `node bench-diff.mjs 1060` → 27/27 解析成功，0 失败，与 `cycle-1050` 零新增回归
- 端到端解析：OLD ≈ 146.8 ms → NEW ≈ 144.1 ms（**约 1.9%**）

# 指标

- 隔离基准：`detectCharacterStyles` **1.40x**、`guessCharFormat` **1.32x**
- 端到端解析：**约 1.9%**
- 类型/体积：纯循环合并，净约 +4 行（注释 + 一行收集）；bundle 体积基本持平
  （主包 raw 317.65 → 317.61 kB、gzip 109.46 → 109.45 kB；库 UMD 262.24 → 262.20 kB，噪声内）。

# 清理的临时产物

`.bench106.ts`、`.bench106.run.mjs`、`.e2e106.mjs`（3 项）。

# 发布

版本 `0.7.49 → 0.7.50`，双包已发布。

# 下一轮候选（沿用本轮剖析）

`detectAlignment`（13.78 ms）/ `detectParagraphFormat`（18.13 ms）/ `detectListInfo`（4.23 ms）
这三个段落级函数仍是 `createParagraphsWithRealFormats` 的主要构成，且 `detectParagraphFormat`
内部对同一段文本先后调用 `detectAlignment` 与 `detectListInfo`（各做一次 `trim()` 与前导空白
扫描）——存在跨函数的重复遍历，可作为下一轮候选（需谨慎设计签名以避免语义漂移）。
**已被证伪、不要动**：OLE 层 `readRegularStream`（1.16%）；Round 103 的七条证伪项；
`DATE_TIME_RE` 已删；Round 104/105/106 的重复遍历合并已完成。
