# Round 169/1000 — 2026-10-14 — 采纳（两站点「样式格式非空」判据按 istd 提升 + 字符样式合并循环按 istd 缓存 `resolveStyleFormat`）——版本 0.7.82 → 0.7.83

> 结论：**技术采纳，版本 0.7.82 → 0.7.83，双包发布。** 27 份 `parseWithFormat` 16,247,039 字符**逐字节一致**（SHA-1 `8f127d0bdbb0a63718a5663f48d267972c753b0e`）。同进程配对端到端**两组独立样本**（800 / 1200 对）：**medianRatio 0.98372 / 0.97928（快 1.63% / 2.07%）、胜率 60.50% / 66.08%**，无符号翻转。护栏 `tests/docParser.round169.test.ts` **19 项** + **七组**离树负控全部检出。
>
> 本轮的定位：R168「下一轮」第 1 条点名 `createParagraphsWithRealFormats`（12.15% 自耗、仍是最大单项），并明令**避开身份键控缓存**（R168 教训 11）。本轮走的是**同一方法内的局部提升**（不跨调用、不键控可变对象），与那条禁令正交。

## 前提与目标

post-168 HEAD 重建 bundle 重剖析（60 轮，**67.7 ms/轮**）自耗前 10：

| 函数 | 自耗 |
|---|---|
| `createParagraphsWithRealFormats` | 12.15% |
| GC | 10.98% |
| `buildMagicScanIndex` | 6.61% |
| `applyStructuralFormats`（真函数 + 类方法包装器） | 6.24% + 4.93% |
| `decodeRangeWithoutGuard` | 4.25% |
| `extractFormattedText` | 3.82% |
| `mergeCharFormatForParagraph` | 3.79% |
| `bytesToBase64` | 3.71% |
| `parseChpxGrpprlWithFont` | 3.08% |
| `parsePapxGrpprl` | 2.57% |

`getHeadingLevel` **已不在前 10**（R168 记忆化落地生效）。

**先排除**（避免重复劳动）：`buildMagicScanIndex`（R142/143/145 已判 u32/位图/三字节展开均无益）、`decodeRangeWithoutGuard`（已表优化）、sprm 解析器（已扁平 switch）、`applyStructuralFormats`（R157/159/160 已重调、实测无 O(n²)）⇒ 回到 R168「下一轮」第 1 条点名的 `createParagraphsWithRealFormats`。

## 先量后改（调用计数插桩，27 份 × 20 轮）

| 项 | 次/轮 | 备注 |
|---|---|---|
| `Object.keys(resolved.paraFormat).length > 0` | **33,702** | = 段落数，每段落各算一次 |
| `Object.keys(resolved.charFormat).length > 0` | **35,056** | 同上 |
| **合计「非空」判据** | **68,758** | 只为判断「空不空」 |
| `resolveStyleFormat` **未命中** | **94** | = 27 份文档去重后的 istd 数 |
| 站点 2 字符样式合并循环（`parseFormatRuns`） | **1,354** | 每 run 一次 `styles.find` + 一次 `resolveStyleFormat` |

⇒ 两个「非空」判据被**重复算了 700+ 倍**（68,758 / 94 ≈ 731）。微基准（67,404 次 `Object.keys(o).length > 0`，2–6 键的小对象）：**0.693 ms/轮 = 1.02%**。

**等价性前提（本候选的承重石）**：`Object.keys(o).length > 0` 是 `o` 的纯函数；而 `resolved` 由 `resolveStyleFormat` **每次新建**（无模块级缓存，`styleParser.ts` 里 `const resolved: ResolvedStyleFormat = {}`）、存进**本方法局部** Map 后**全程只读**（两处使用点都只把 `resolved.paraFormat`/`charFormat` 展开进新对象，从不写回）⇒ 把「非空」提升到解析点**逐位等价**。

> 注意这是**局部提升**、不是 R168 禁令针对的**跨调用身份键控缓存**：键控对象是**本方法内新建、本方法内销毁、全程只读**的中间对象，不存在「跨调用被原地改动」的可能。B3 组用对抗用例把这条前提**钉成承重的**。

## 候选（`src/utils/docParser.ts`，两站点）

### 站点 1：`createParagraphsWithRealFormats` 的段落样式合并

```ts
interface ResolvedParagraphStyleEntry {
  resolved: ReturnType<typeof resolveStyleFormat>
  paraHasKeys: boolean
  charHasKeys: boolean
}

const resolvedParagraphStyles = new Map<number, ResolvedParagraphStyleEntry>()
// ...
let entry = resolvedParagraphStyles.get(papx.istd)
if (!entry) {
  const resolved = resolveStyleFormat(styles, papx.istd)
  const paraFormat = resolved.paraFormat
  const charFormat = resolved.charFormat
  entry = {
    resolved,
    paraHasKeys: !!paraFormat && Object.keys(paraFormat).length > 0,
    charHasKeys: !!charFormat && Object.keys(charFormat).length > 0,
  }
  resolvedParagraphStyles.set(papx.istd, entry)
}
const resolved = entry.resolved
if (entry.paraHasKeys) { newPara.paraFormat = { ...resolved.paraFormat, ...newPara.paraFormat } }
if (entry.charHasKeys) { newPara.charFormat = { ...resolved.charFormat, ...newPara.charFormat } }
```

### 站点 2：`parseFormatRuns` 的字符样式（sprmCIstd）合并循环

原实现**每个 run 各跑一次** `styles.find(...)`（线性）+ `resolveStyleFormat(styles, run.istd)`：

```ts
interface ResolvedCharStyleEntry {
  charFormat?: Partial<CharacterFormat>
  charHasKeys: boolean
  fontIndex?: number
}

if (styles.length > 0 && chpxRuns.length > 0) {
  const charStyleById = new Map<number, StyleDefinition>()
  for (const s of styles) if (!charStyleById.has(s.istd)) charStyleById.set(s.istd, s)
  const resolvedCharStyles = new Map<number, ResolvedCharStyleEntry>()
  for (const run of chpxRuns) {
    if (run.istd === undefined) continue
    const charStyle = charStyleById.get(run.istd)
    if (!charStyle || charStyle.type !== 'character') continue
    let entry = resolvedCharStyles.get(run.istd)
    if (!entry) {
      const resolved = resolveStyleFormat(styles, run.istd)
      const charFormat = resolved.charFormat
      entry = { charFormat, charHasKeys: !!charFormat && Object.keys(charFormat).length > 0, fontIndex: resolved.fontIndex }
      resolvedCharStyles.set(run.istd, entry)
    }
    if (entry.charHasKeys) { run.format = { ...entry.charFormat, ...run.format } }
    if (run.fontIndex === undefined && entry.fontIndex !== undefined) { run.fontIndex = entry.fontIndex }
  }
}
```

**站点 2 的两个语义细节是刻意的**：
- `charStyleById` 建表时**只保留首个匹配**（`if (!charStyleById.has(s.istd))`）—— 与 `styles.find(...)` 的「首个匹配」语义严格一致（C7 用真实 styles 验证）。
- `entry.charHasKeys` 守卫**必须保留**：`resolveStyleFormat` 在 `charFormat` 为空时返回 `undefined`/`{}`，此时 `{ ...undefined, ...run.format }` 虽不改变键值但会**多分配一个冗余对象**；更关键的是「无条件展开」与「条件展开」在 `charFormat` 为空时**键序不同**（空展开不插入键）——守卫是行为保持的一部分，不是优化。

## 隔离基准

站点 1（真实单轮 68,758 次「非空」判据回放）与站点 2（真实 1,354 次字符样式循环回放）合并微基准：**OLD 0.693 ms/轮 → NEW ≈0（判据只剩 188 次/轮）**。绝对量小（1.02%），故**必须靠端到端配对定值**（R103 教训：隔离快 ≠ 端到端快）。

## 等价性（逐字节）

- 27 份 `parseWithFormat` 结果序列化后 `cmp` **逐字节一致**，16,247,039 字符，SHA-1 `8f127d0bdbb0a63718a5663f48d267972c753b0e`（dump 16,261,351 字节）。
- **实现标记核对**（陷阱 B）：基线 bundle 内 `ResolvedParagraphStyleEntry`/`ResolvedCharStyleEntry`/`charStyleById`/`resolvedCharStyles` 计数 **0/0/0/0**；候选 **1/1/2/2** ⇒ 确认两侧装的确实是不同实现。
- **构建确定性**：用**最终源码**重建的候选 bundle == 跑端到端证据的候选 bundle（**324,894 B**）；基线 324,076 B（R168 收尾值）。

## 性能证据（同进程配对端到端，正反交错）

`r149-paired.mjs`（`/tmp/r169-head.mjs` vs `/tmp/r169-cand.mjs`）：

| 样本 | 对数 | **medianRatio** | **胜率** | baseMedian / candMedian |
|---|---|---|---|---|
| 1 | 800 | **0.98372** | **484/800 = 60.50%** | — |
| 2 | 1200 | **0.97928** | **793/1200 = 66.08%** | — |
| **合并** | **2000** | ≈ **0.9815** | **1277/2000 = 63.85%** | −1.3 ms/轮 |

**判读**：两组独立样本 medianRatio 同向（0.98372 / 0.97928），胜率均 **>60%**，远高于 57% 采纳阈值与 ~54% 噪声地板，**无符号翻转** ⇒ **采纳**。量级 **≈1.6–2.1%**，绝对省 **≈1.3 ms/轮**。机制与 R156/157/158/160/161/163/164 同类（**砍真实工作**：68,758 次 `Object.keys` + 1,354 次线性 `find` → 188 次；每次 `Object.keys` 都会**分配一个键数组**，砍掉它同时减少 GC 压力），与 R149/150/153/154「只减分配 ⇒ 中性」方向相反、结果为正。

## 护栏（`tests/docParser.round169.test.ts`，19 项）

- **A 组（决策差分，穷举形状）**
  - A1 穷举「样式格式 × 段落覆盖」全叉积（6 × 6 × 4 × 4 = 576 例），逐例断言**结果 JSON 与键序**都与 oracle 一致；
  - A2 键数 0..8 逐点扫，含「样式覆盖段落」与「段落覆盖样式」两侧；
  - A3 真实语料：断言 `resolveStyleFormat` 的返回形状**确实覆盖「空 / 非空」两类**（否则本护栏是空转）。
- **B 组（真实语料锚定 + 前提承重性）**
  - B1 27 份 `parseWithFormat` 全量输出 **SHA-1 锚定 `8f127d0b…`** + chars **恰 16,247,039**；
  - B2 真实语料上「空 / 非空」两类都能走到（防 B1 空转）；
  - **B3 前提承重性**：缓存后**原地改动** `resolved.paraFormat`/`charFormat` ⇒ 提升版与 oracle **必须分歧**（`{alignment:'center'}` vs `{}`）—— 把「resolved 只读」这一前提钉成承重的，若将来有人写回即静默出错（R168 教训 11 的延续）。
- **D 组（骨架负控，证明本文件有鉴别力）**：`round169Gate(o, mode)`，模式 `ok | noNullGuard | forInNoHasOwn | alwaysTruthy | wrongSource`。
  D1 正控与 oracle 在真实形状上一致；D2 去空对象守卫、D3 取错来源（用 charFormat 判 paraFormat）、D4 for-in 不查 `hasOwnProperty`（用 `Object.create({inheritedKey:1})` 探针）、D5 去空值守卫（`null`/`undefined` 必须抛 `TypeError`）；D6 元断言（四模式在穷举形状上确有分歧点，护栏非空转）。
- **C 组（接线元断言，源码文本）**：C1 入口类型与 Map 类型齐备且各只定义一次；C2 两个判据只在 `if (!entry)` 分支各算一次、用局部量（`charFormat` 判据**恰 2 处** = 两站点）；C3 使用点已改读入口字段、**每段落路径上不再出现 `Object.keys(resolved.*)`**、且合并本身未被删；C4 承重前提文本钉子（`docParser.ts` 内**不得**对 `resolved.paraFormat/charFormat` 赋值，反向正控证明该正则能命中 `styleParser.ts`）；C5 `resolveStyleFormat` 无模块级缓存；C6 站点 2 已按 istd 缓存、旧 `styles.find(s => s.istd === run.istd)` 消失、`entry.charHasKeys` 恰 2 处、站点 2 守卫形状钉死；C7 `charStyleById` 首个匹配语义 == `styles.find`（真实 styles 验证）。

> **R164 通用教训 10 再现**：本改动是**行为保持型** —— `resolved.paraFormat` 为空时「展开空对象」与「不展开」**输出内容完全相同**（只多分配一个冗余对象）⇒ 任何「比输出」的测试都抓不住它被整体回退。**只有 C 组源码文本元断言能抓**（N1/N2b/N6 三组负控即为此设）。

## 离树负控（注入生产源码，跑完即还原）

**还原用逐字节回写并断言 sha256 一致**（R161 陷阱 E 的教训）。**七组全部检出**：

| 注入 | 性质 | 结果 |
|---|---|---|
| N1 站点 1 整体回退为每段落就地判（无缓存） | **行为保持型** | **FAIL**（C1/C2/C3） |
| N2 站点 2 回退为每 run `styles.find` | 行为改变型（丢缓存） | **FAIL**（C6/C7） |
| N2b 站点 2 回退为每 run 就地判「非空」 | **行为保持型** | **FAIL**（C6） |
| N3 站点 1 判据取反（`!== 0`） | 行为改变型 | **FAIL**（A1/B1） |
| N4 站点 1 取错来源（用 charFormat 判 paraFormat） | 行为改变型 | **FAIL**（A1/B1） |
| N5 站点 2 `charStyleById` 取**最后**匹配（与 `find` 不符） | 行为改变型 | **FAIL**（C7） |
| N6 站点 2 守卫改为无条件展开 | **行为保持型**（内容同、键序可能异） | **FAIL**（C6） |

七组注入后源码 sha256 恢复 `b8ab357826fd4846c9e10c1a6d99934590425c15346614821f96e4f0e383e1f6`（与注入前一致），护栏复跑 **19/19**。

> **N1 / N2b / N6 延续 R164 通用教训 10**：三组都是把代码改回**行为完全等价**的写法，只有**源码文本元断言**能抓住。

## 门禁与产物

- `npm test`：**1928 / 1928 通过（98 文件）**（R168 为 1909/97；+19 = 本轮新护栏，+1 文件）。test 与 lint **串行**执行。
- `vue-tsc --noEmit`：exit 0。`eslint .`：exit 0。
- `npm run build`：`dist/assets/main-D-7J26vN.js` 324.00 kB。
- `npm run build:lib`：`dist-lib/doc-preview.js` **371,924 → 372,531 字节（+607 B）**、`dist-lib/doc-preview.umd.cjs` **275,991 → 276,251 字节（+260 B）**。
- `node bench-diff.mjs 169`：**cycle-169 与 cycle-168 除 `cycle`/`timestamp` 外 12 个字段全部逐字段相同**，`median` 均 `0.9502433994244857`，`parseSuccess` 27/27。
- **包体记账**：未压缩 esbuild bundle **324,076 → 324,894（+818 B，含两段接口说明注释）**；压缩后 dist-lib **+607 B / umd.cjs +260 B**。相对 **≈1.6–2.1% 的实测运行时收益**，增量可忽略。

## 下一轮

Round 169 吃掉了 `createParagraphsWithRealFormats` 内两个「非空」判据（68,758 次/轮）与站点 2 的每-run 线性 find。候选方向：

1. `createParagraphsWithRealFormats` 自身 12.15%（仍是最大自耗）—— 须继续避开「跨调用身份键控」类想法（R168 教训 11）；
2. `applyStructuralFormats` 合计 11.17%（R157/159/160 已重调；实测无 O(n²)，需换角度）；
3. `buildMagicScanIndex` 6.61%（R142/143/145 已判 u32/位图/三字节展开均无益）；
4. `formatParser.ts` 两处无条件 `runs.sort(...)`（L1424 `parsePapxRunsFromFkp` / L1519 `parseChpxRunsFromFkp`，各约 0.55% 自耗）—— **须先核实是否真的逆序**，且 **Round 132 契约要求稳定 sort 不得跳过**（R167 曾误加 sort-skip 致 R132 护栏 4 项失败）；
5. `mergeCharFormatForParagraph` 3.79%（R166 已做顺序游标；**R168 已证身份键控不可行**，若要再动只能减少单次调用的真实工作量）；
6. `decodeRangeWithoutGuard` 4.25%。

目标 1000 轮。
