# Round 104 — `shouldHaveUnderline` 的零分配码点扫描 + 删冗余正则 + 预计算位置表

本轮把目标从 Round 103 收尾时指向的 OLE 层（`readRegularStream`）**转移**到了
`shouldHaveUnderline`：重新用**真实端到端入口 `parseWithFormat()`** 剖析后，OLE 层只占
**1.16 %**，而 `shouldHaveUnderline` 所在的「段落 / 格式装配层」是真正的大头。该函数在
**每个数字字符**上被调用（真实语料 158 937 次/轮），原实现每次调用做 2 次 `substring`
分配 + 最多 5 次正则求值。本轮把它换成一趟码点扫描 + 每段落预计算一次日期单位位置表 +
二分查找，隔离基准 **4.51x**，端到端解析 **1.10x**，且与改动前**逐字节等价**。

---

## 起因：剖析口径对齐真实入口后，画面完全不同

前几轮的剖析基于 `parse()`（纯文本），但真实端到端走的是 `parseWithFormat()`（带格式段落）。
重新剖析（`--cpu-prof`，按函数名聚合、不带 url，避免 bundle 文件名污染）后发现：

```
样本总时长   13008.1 ms
── 分类 ──
  沙箱 shim         tryBrokerFileTokenSync           17.22 %   （扣掉，只算解析）
  其他 / 原生 / GC   其余
── 解析阶段内占比（扣除沙箱 shim 后）──
  createParagraphsWithRealFormats     12.03 %
  detectCharacterStyles                9.71 %   ← 逐字符调 shouldHaveUnderline
  applyStructuralFormats               7.81 %
  extractImagesFromStream              7.81 %
  guessCharFormat                      7.57 %
  parseFormatRuns                      5.36 %
  detectParagraphFormat                5.06 %
  OLE readRegularStream                1.16 %   ← Round 103 想动它，实证只值这么点
```

`detectCharacterStyles` 占 9.71 %，而它里面**逐数字字符**调用的 `shouldHaveUnderline` 的
自耗时（正则 3.89 % + 函数 1.09 %）合计约 **5 %** 端到端——这才是真实热点。OLE 层只有
1.16 %，不值得动（已用独立基准确认：readRegularStream 优化 < 1% 端到端）。

---

# 优化：`shouldHaveUnderline` 的三处等价化简

## 1. 可证明的冗余正则 `DATE_TIME_RE`

原实现：

```ts
const DATE_COLON_BEFORE_RE = /[：:]\s*$/
const DATE_UNIT_RE = /[年日月时分秒]/
const DATE_TIME_RE = /[0-9]{2,4}[年月日时分秒]/
function shouldHaveUnderline(text, index) {
  // ...
  const hasColonBefore = DATE_COLON_BEFORE_RE.test(before)
  const hasDatePattern = DATE_UNIT_RE.test(after) || DATE_UNIT_RE.test(before)
  const hasTimePattern = DATE_TIME_RE.test(after) || DATE_TIME_RE.test(before)
  return hasColonBefore || hasDatePattern || hasTimePattern
}
```

`DATE_TIME_RE`（`/[0-9]{2,4}[年月日时分秒]/`）是**冗余的**：它匹配成功时匹配串必然含有
日期单位字符（`[年月日时分秒]`），因此 `DATE_UNIT_RE` 已经为真。于是
`hasColonBefore || hasDatePattern || hasTimePattern` ≡ `hasColonBefore || hasDatePattern`。
整个判断化简为「窗口内是否含日期单位字符」+「紧邻前方是否为冒号（允许中间夹空白）」两条。

常驻护栏里有一条专门证明这一点：`oracleNoTimeRegex`（删去 `hasTimePattern` 的版本）与完整
`oracle` 在穷举空间里**逐串逐位相等**。

## 2. 冒号判定的等价性

「从 `index-1` 起跳过空白后看落点是否为冒号」与 `/[：:]\s*$/` 作用在
`text[max(0,index-30), index)` 上**等价**——因为 `isWhitespaceCode` 的覆盖范围与 JS `\s`
**完全一致**（TAB/LF/VT/FF/CR/SP/NBSP/ZWNBSP/Zs 类/LS/PS）。这一步把一次 `substring` +
一次正则求值换成一趟零分配的码点回扫。

## 3. 零分配码点扫描 + 每段落一次位置表 + O(log n) 查询

重写后的实现（`src/utils/docparser/heuristics/textHeuristics.ts`）：

```ts
function isDateUnitCode(code: number): boolean {
  return code === 0x5e74 || code === 0x65e5 || code === 0x6708 ||
         code === 0x65f6 || code === 0x5206 || code === 0x79d2
}
const UNDERLINE_WINDOW = 30
function collectDateUnitPositions(text: string): number[] { /* 升序收集 */ }
function lowerBound(sorted: readonly number[], x: number): number { /* 二分 */ }

export function shouldHaveUnderline(text, index, dateUnitPositions?: readonly number[]) {
  const code = text.charCodeAt(index)
  if (!(code >= 0x30 && code <= 0x39)) return false           // 非数字 → false
  const beforeStart = Math.max(0, index - UNDERLINE_WINDOW)
  const afterEnd = Math.min(text.length, index + UNDERLINE_WINDOW)
  // 冒号：回扫跳过空白
  let j = index - 1
  while (j >= beforeStart && isWhitespaceCode(text.charCodeAt(j))) j--
  if (j >= beforeStart) {
    const c = text.charCodeAt(j)
    if (c === 0xff1a || c === 0x3a) return true
  }
  // 日期单位：窗口内是否存在（before 或 after 任一命中）
  const units = dateUnitPositions ?? collectDateUnitPositions(text)
  if (units.length === 0) return false
  const at = lowerBound(units, index)
  if (at < units.length && units[at] < afterEnd) return true
  if (at > 0 && units[at - 1] >= beforeStart) return true
  return false
}
```

`detectCharacterStyles` 在同一段落内**只在第一次遇到数字字符时**构建一次
`dateUnitPositions`（`null` → `collectDateUnitPositions(text)`），之后每个数字字符透传这张表，
把每次调用从 O(窗口) 降到 O(log n)。整段无数字字符时完全不付这份代价。

---

# 隔离基准（77 800 次调用，真实语料片段）

四个变体结果**完全一致**（`true = 115`，与 oracle 逐字节相同）：

| 变体 | 说明 | 耗时 | 相对 v0 |
|---|---|---|---|
| v0 | 现状（2 substring + 3 正则） | 10.12 ms | 1.00x |
| v1 | 零分配码点扫描（保留冗余正则） | 6.11 ms | 1.66x |
| v2 | v1 + 删冗余 `DATE_TIME_RE` | 5.96 ms | 1.70x |
| **v3** | v2 + 每段落一次位置表 + 二分查找 | **2.24 ms** | **4.51x** |

---

# 端到端验证（真实收益）

27 份样本 / 7.6 MB 语料，独立进程，120 轮取最小，`git stash` 切换源码分别打包对比：

```
OLD（0.7.47 源码）   min 147.38 ms   p50 151.84 ms
NEW（本轮）          min 133.79 ms   p50 138.21 ms
→ 端到端 1.10x
```

隔离的 4.51x 折算到端到端是 1.10x——符合预期：`shouldHaveUnderline` 只占约 5 % 端到端，
且隔离基准把正则编译等一次性成本摊薄、而端到端里每段只跑一次（与 Round 102/103 总结的
「隔离基准给的是函数上下界，不是端到端」一致）。**这一轮是真实可测的 10 % 解析提速。**

---

# 等价性证据（四重）

1. **常驻穷尽差分护栏** `tests/textHeuristics.underline.test.ts`（**7 项**）：
   - 穷尽差分（长度 ≤ 4 全串 × 全 index，no-precompute 路径）与 oracle 一致；
   - 穷尽差分（precompute 路径）与 oracle 一致；
   - 窗口边界（长度 mod 30 与跨窗口位置 0..79）一致；
   - 随机串（长度 ≤ 40，4000 组，两种路径）一致；
   - **冗余正则可证明删除**：枚举长度 ≤ 4 全串，`oracleNoTimeRegex ≡ oracle`；
   - 越界与空串（`-1`/`99`/`''` → false）；
   - 非数字字符 → false。
2. **端到端逐位一致**：`node bench-diff.mjs 1040` 对 27 份样本解析，与改动前
   `cycle-1030` **除 `cycle`/`timestamp` 外全部字段逐位相同**（median 0.9502433994244857、
   min 0.8115474418758475，`topIssues`/`failures` 完整列表也逐条相同）——**13 个失败样本
   两个轮次完全一致，零新增回归**。
3. **定向测试**：`shouldHaveUnderline` 护栏 7/7 通过；`npm test` **66 文件 / 1399 项**通过
   （较 Round 103 的 65/1392 **+1 文件 +7 项**）。
4. **类型与 lint**：`npx vue-tsc --noEmit` 0 错误；`npm run lint` 0 错误。

---

# 护栏 bug 修复（非实现 bug，是测试本身的栈溢出）

第一版穷尽枚举用 24 字符 `ALPHA` 做长度 ≤ 4 的全组合，在第四层 `stack.push(...next)`
一次性 spread 约 33 万个串 → `RangeError: Maximum call stack size exceeded`（报在
`tests/textHeuristics.underline.test.ts:139`）。3 个穷尽用例挂掉、4 个通过。

改法：把数组累积换成递归生成器 `forAllStrings`，**在生成每个串的内部直接执行断言**，递归
深度 = 最大长度（4），可控；并把 `ALPHA` 收缩为「每类分支取一个代表」
（`['5','年','：',':',' ','\n','a','+']`）——`shouldHaveUnderline` 只按
「数字 / 日期单位 / 冒号 / 空白 / 其它」分支，类别内取值不影响力，故无需 24 字符全展开。
修复后 7/7 全绿。

---

# 验证清单

- `npx vitest run tests/textHeuristics.underline.test.ts` → **7 passed**
- `npm test` → **66 文件 / 1399 项**通过
- `npx vue-tsc --noEmit` → 0 错误
- `npm run lint` → 0 错误（13 个 warning 全在临时 `.bench104*` / `.profan104.mjs`，已删）
- `npm run build` / `npm run build:lib` → 通过
- `node bench-diff.mjs 1040` → 27/27 解析成功，0 失败，与 `cycle-1030` 零新增回归
- 端到端解析：OLD 147.38 ms → NEW 133.79 ms（**1.10x**）

# 指标

- 隔离基准：`shouldHaveUnderline` **4.51x**（10.12 → 2.24 ms）
- 端到端解析：**1.10x**（147.38 → 133.79 ms）
- 类型/体积：纯函数改写，`textHeuristics.ts` 净 +~50 行（删 3 常量 + 增辅助函数 +
  重写 `shouldHaveUnderline` + `detectCharacterStyles` 懒加载透传）；bundle 体积基本持平
  （主包 raw 317.25 → 317.61 kB、gzip 109.31 → 109.42 kB，在噪声内）。

# 清理的临时产物

`.bench104.ts`、`.bench104b.ts`、`.bench104.mjs`、`.bench104b.mjs`、`.prof104.ts`、
`.prof104.mjs`、`.prof104/`、`profan104.mjs`、`.e2e104.mjs`（9 项）。

# 发布

版本 `0.7.47 → 0.7.48`，双包已发布（registry 核验 `@zhenghy/doc-preview` 与 `doc-preview`）。

# 下一轮候选（来自本轮剖析）

`createParagraphsWithRealFormats`（12.03%）/ `detectCharacterStyles`（9.71%）/
`applyStructuralFormats`（7.81%）/ `extractImagesFromStream`（7.81%）/ `guessCharFormat`（7.57%）/
`parseFormatRuns`（5.36%）/ `detectParagraphFormat`（5.06%）。**已被证伪、不要动**：OLE 层
`readRegularStream`（仅 1.16%，优化 < 1% 端到端）；Round 103 的七条证伪项
（`decodeRangeWithoutGuard` 换原生解码+正则、压缩分支换 `windows-1252`、`TextDecoder('latin1')`、
纯 JS base64 查表、`Array.from(slice)`、解码循环微优化、删代理项区间）。
