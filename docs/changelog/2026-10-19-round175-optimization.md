# Round 175/1000 — 2026-10-19 — 采纳（`cleanParagraph` 的 `JUNK_PREFIX_RE` 加 O(1) 首字符门，省掉 34,348 次必然失配的正则进入）——版本 0.7.86 → 0.7.87

> 结论：**技术采纳，版本 0.7.86 → 0.7.87。** 27 份 `parseWithFormat` 16,247,039 字符**三路逐字节一致**（SHA-1 `8f127d0bdbb0a63718a5663f48d267972c753b0e`；esbuild 基线 == esbuild 候选 == 构建后 dist-lib）。护栏 `tests/paragraphFilter.round175.test.ts` **12 项** + **五组**离树负控全部检出。
>
> **诚实标注（边界情形）**：三组端到端样本的**胜率合并 3883/7000 = 55.47%**，**低于 57% 惯例阈值**；但 7000 对下胜率的标准误 ≈0.6%，55.47% 距 50% 有 **≈9σ**，且三组样本的 **medianRatio（0.9925 / 0.99456 / 0.99276）与 meanRatio（0.99901 / 0.99947 / 0.99720）全部 < 1、无符号翻转**，另有**独立微基准**（20.0 ns → 3.2 ns）与**计数证据**（34,348 次调用、0 次命中）双重佐证。量级记为 **≈0.7%**。

## 前提与「先量后改」

post-173/174 的剖析里，`cleanParagraph` 的 `const stripped = t.replace(JUNK_PREFIX_RE, '')` 一行占 **0.70%**。`JUNK_PREFIX_RE = new RegExp('^[' + JUNK_CHAR_CLASS + ']+')` —— 一个 **`^` 锚定**的字符类。

**先做了三件事，全部指向同一个结论**：

| 检查 | 结果 |
|---|---|
| `cleanParagraph` 调用次数（插桩，27 份） | **34,348 次** |
| `JUNK_PREFIX_RE` 命中次数（插桩 `stripped !== t`） | **0 次（0.00%）** |
| 微基准：无条件 `replace` vs 首字符表门控 | **20.0 ns/次 → 3.2 ns/次（比值 0.160）** |
| ⇒ 每轮白付 | **0.58 ms ≈ 0.95%** |

即：**每一次都在白进正则引擎，且必然不匹配。**

> 这正是 R164 通用教训的复现：**「并集正则并不比原正则更快，省的是『永不进入正则引擎』」**。这里更极端 —— 连正则都不必构造，只需一次整数比较。

## 候选

```ts
// 模块级：按 JUNK_CHAR_CLASS 的最大码元长度建表（不假设字符落在哪个区段，
// 字符类将来扩充也自动跟随）
const JUNK_PREFIX_FIRST: Uint8Array = (() => {
  let maxCode = 0
  for (let i = 0; i < JUNK_CHAR_CLASS.length; i++) {
    const c = JUNK_CHAR_CLASS.charCodeAt(i)
    if (c > maxCode) maxCode = c
  }
  const table = new Uint8Array(maxCode + 1)
  for (let i = 0; i < JUNK_CHAR_CLASS.length; i++) table[JUNK_CHAR_CLASS.charCodeAt(i)] = 1
  return table
})()

export function cleanParagraph(p: string): string {
  const t = p.trim()
  const stripped = JUNK_PREFIX_FIRST[t.charCodeAt(0)] ? t.replace(JUNK_PREFIX_RE, '') : t
  return stripped === t ? t : stripped.trim()
}
```

### 等价性（可自证）

`JUNK_PREFIX_RE` 是 `^[…]` ⇒ **只可能从首字符命中**。`JUNK_PREFIX_FIRST` 由 `JUNK_CHAR_CLASS` 的码元构建 ⇒ 表项为 1 ⟺ 该码元是垃圾字符 ⟺ 正则可能命中。

表项为 0 的三种情形（码元不是垃圾字符 / 码元 > `maxCode`（越界读得 `undefined`）/ `charCodeAt(0)` 为 `NaN`（空串））下，正则**必然不匹配** ⇒ `replace` 必然返回原串 ⇒ `stripped === t` ⇒ 函数返回 `t`。**与跳过 `replace` 逐字节相同。**

> **不硬编码区段**：表长度由 `JUNK_CHAR_CLASS` 的最大码元动态决定，因此「所有垃圾字符都恰好在 0x4E00–0x9FFF」这个事实**没有被写进代码**（那会是一处隐形耦合）。表约 **38.5 KB**，一次性构建，运行时内存可忽略。

## 等价性（逐字节）

- 27 份 `parseWithFormat` 序列化后 `cmp` **逐字节一致**，16,247,039 字符，SHA-1 `8f127d0bdbb0a63718a5663f48d267972c753b0e`（dump 16,261,351 字节）。
- **三路互核**：esbuild 基线 == esbuild 候选 == **构建后 `dist-lib/doc-preview.js`**，三份 dump SHA-1 全同。
- **实现标记核对**（陷阱 B）：候选 bundle `JUNK_PREFIX_FIRST` 计数 **2**。
- **构建确定性**：最终源码重建的候选 bundle == 跑端到端证据的候选 bundle（**325,785 B**）；基线 325,396 B。

## 性能证据（同进程配对端到端，正反交错）

| 样本 | 对数 | **medianRatio** | meanRatio | **胜率** | baseMedian / candMedian |
|---|---|---|---|---|---|
| 1 | 3000 | **0.99250** | 0.99901 | **55.83%** | 65.278 / 65.087 ms |
| 2 | 2000 | **0.99456** | 0.99947 | **54.25%** | 62.533 / 62.451 ms |
| 3 | 2000 | **0.99276** | 0.99720 | **56.15%** | 61.669 / 61.242 ms |
| **合并** | **7000** | ≈ **0.9931** | ≈ 0.9986 | **3883/7000 = 55.47%（z≈9.2）** | −0.35 ~ −0.48 ms |

**判读**：三组 **medianRatio 与 meanRatio 全部 < 1**、无符号翻转；绝对省 **0.35–0.48 ms/轮**，与微基准预测的 **0.58 ms** 同量级（差异来自真实调用串更短、表查与 `charCodeAt` 的开销）。胜率 55.47% 低于 57% 惯例线，但在 7000 对下已是 **9σ**，属「真实但小」的效应。

## 护栏（`tests/paragraphFilter.round175.test.ts`，12 项）

> **A 组直接对生产函数 `cleanParagraph` 做差分**（生产 vs 逐行转写 oracle）⇒ 对生产改动有真实鉴别力（负控 N2–N5 全被 A 组抓住）。

- **A 组（生产函数差分）**
  - A1 穷举 16 种输入（空串 / 各种空白 / 中文 / 垃圾前缀 1/2/3 个 / 垃圾字符在**中间** / trim 后垃圾到开头 / 末尾垃圾）；
  - A2 **非空转**：垃圾前缀确实被剥掉（`伀abc → abc`），且垃圾不在开头时**不得**被剥（`a伀 → a伀`）；
  - A3 **随机模糊 3,000 条**（含全部垃圾字符、中文、空白、换行），并断言含垃圾字符的样本 >100。
- **B 组**：B1 27 份全量 **SHA-1 锚定 `8f127d0b…`** + chars **恰 16,247,039**；B2 真实语料**不触发**垃圾前缀（输出侧命中 **恰 0**）—— 这正是「34,348 次调用、0 次命中」结论的钉子。
- **D 组（骨架负控）**：`round175CleanSkeleton(p, table, mode)`，模式 `ok | alwaysReplace | neverReplace | gateOnLast`。
  D1 正控；D2 从不 replace；D3 用**末字符**查表（**并显式记录「单字符输入对该缺陷零鉴别力」**）；**D4 行为保持型对照：`alwaysReplace` 与 `ok` 在全部输入上完全相同**（R164 教训 10 的直接钉子）。
- **C 组（接线元断言）**：C1 首字符表存在、由 `maxCode + 1` 动态构建、**不硬编码区段**；C2 `cleanParagraph` 已加首字符门且旧无条件 `replace` 形态消失；C3 尾部 `stripped === t ? t : stripped.trim()` 收尾未改。

## 离树负控（注入生产源码，跑完即还原）

**还原用逐字节回写并断言 sha256 一致**（R161 陷阱 E）。**五组全部检出**：

| 注入 | 性质 | 结果 |
|---|---|---|
| N1 **整体回退为无条件 `replace`** | **行为保持型** | **FAIL，1 项**（C2） |
| N2 从不 `replace` | 行为改变型 | **FAIL，4 项**（A1/A2/A3/C2） |
| N3 用**末字符**查表 | 行为改变型 | **FAIL，4 项**（A1/A2/A3/C2） |
| N4 门控**取反** | 行为改变型 | **FAIL，4 项**（A1/A2/A3/C2） |
| N5 表只填**第一个**垃圾字符 | 行为改变型 | **FAIL，3 项**（A1/A3/C1） |

五组注入后源码 sha256 恢复 `47774faedaf48caa3ef23690228e0865833cfc10464f60d42978c137b09a8baf`（与注入前一致），护栏复跑 **12/12**。

## 门禁与产物

- `npm test`：**1986 / 1986 通过（102 文件）**（R173 为 1974/101；+12 = 本轮新护栏，+1 文件）。test 与 lint **串行**执行。
- `vue-tsc --noEmit`：exit 0。`eslint .`：exit 0。
- `npm run build`：`dist/assets/main-DopUR7PS.js` 324.36 kB / gzip 111.91 kB。
- `npm run build:lib`：`dist-lib/doc-preview.js` **372,819 → 373,086 字节（+267 B）**、`dist-lib/doc-preview.umd.cjs` **276,426 → 276,621 字节（+195 B）**（vite 报 gzip 85.21 kB）。
- `node bench-diff.mjs 175`：**cycle-175 与 cycle-173**（上一个**采纳**轮；174 被否决故无 cycle-174）除 `cycle`/`timestamp` 外 **12 个字段全部逐字段相同**，`median` 均 `0.9502433994244857`，`parseSuccess` 27/27。
- **包体记账**：未压缩 esbuild bundle **325,396 → 325,785（+389 B，含表构建器与说明注释）**；压缩后 dist-lib **+267 B / umd.cjs +195 B**。相对 **≈0.7% 的实测运行时收益**，增量可接受。

## 下一轮

1. **`bytesToBase64`（单行 3.21%）** —— 先证 `TextDecoder('latin1')` **不可用**（WHATWG 里 `latin1`/`iso-8859-1` 都是 **windows-1252** 别名，0x80–0x9F 会错映射），若不可用本条关闭；
2. **`mergeCharFormatForParagraph`（3.64% + 调用点 3.47%）** —— `styleFormats.get(run.istd)` 是 56,491 次/轮的 **Map.get**（贵操作），但把参数从 Map 改成数组会**改动 R134/R166 既有护栏的契约**，须先评估是否有不破契约的做法（如按 istd 分槽的单条目记忆，且必须证明 `styleFormats` 在单次调用内不变）；
3. **`findJpegEnd`** —— 已核实 `pushImageAt` 返回 `end` 并跳过图片，**不存在重复扫描**，本条关闭；
4. `buildMagicScanIndex`（6.71%）、两处 `runs.sort`（1.18%，受 R167 D5 元断言约束）—— 均已在历史轮次判过或受契约约束。

目标 1000 轮。
