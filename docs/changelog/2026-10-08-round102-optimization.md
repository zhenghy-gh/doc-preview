# Round 102 — 码元缓冲转字符串改用原生 `TextDecoder`

日期：2026-10-08
版本：0.7.45 → 0.7.46
基线：`3770ceb`（round 101）

## 起因：Round 101 之后重新剖析

Round 101 把 `extractTextFromRange` 的逐字符 `+=` 换成了码元缓冲，GC 从
57.97 % 掉到 3.13 %。Round 101 交付时的计划是下一轮看 `extractTextWithFib`
（10.55 %）和 `splitPiecesByStory`（5.10 %），但那是**旧剖析**的读数。
重新跑一遍（200 轮，`--cpu-prof-interval=100`，缓冲区预加载、计时只覆盖
解析循环），库内分布完全变了：

| 函数 | 占**解析阶段** |
|---|---|
| `codesToString` | **40.0 %** |
| `decodeRangeWithoutGuard` | **33.9 %** |
| `readRegularStream` | 9.7 % |
| `(garbage collector)` | 5.3 % |
| `extractTextFromRange` | 5.1 % |
| `readStream` | 1.7 % |
| `extractTextWithFib` | 1.4 % |
| `getFatSectors` | 1.0 % |

`extractTextWithFib` 和 `splitPiecesByStory` 都跌到 1.4 % / 0.16 %——
**Round 101 的计划被这一轮的新读数推翻了**。真正的大头是 Round 101 自己
引入的那两步：解码循环（33.9 %）和它之后的转字符串（40.0 %）。

### 剖析口径的更正

Round 101 报的「`extractTextFromRange` 17.18 %」是占**整个进程**的比例，
而进程里 39.5 % 是沙箱的 `tryBrokerFileTokenSync @ node-brokered-fs-shim.cjs`
（12 MB 语料的文件读取）。把读取放在计时之外、把轮数拉到 200 轮之后，
才读得出上面这张表。**百分比的分母必须写清楚**，否则跨轮比较会误导。

## 先量清楚：`codesToString` 贵在哪

`codesToString` 是 Round 101 写的，逐块 `String.fromCharCode.apply(null, codes.subarray(...))`。
用 Round 101 采集的**真实区间**（140 段 / 1.61 M 码元）先跑出真实的
`Uint16Array` 缓冲，再让各策略在同一批缓冲上竞争：

| 策略 | 耗时 | 相对 |
|---|---|---|
| `apply` 分块 `0x8000`（现状） | 3.67 ms | 1.00x |
| `apply` 分块 `0x4000` | 3.66 ms | 1.00x |
| `apply` 分块 `0x2000` | 2.99 ms | 1.23x |
| `apply` 分块 `0x1000` | 3.00 ms | 1.22x |
| 展开运算符 `String.fromCharCode(...)` 分块 `0x1000` | 22.00 ms | **0.17x** |
| **`TextDecoder('utf-16le')` 读同一块内存的字节视图** | **1.22 ms** | **3.01x** |

调分块大小只能拿 1.23x；展开运算符反而慢 6 倍（它要先把 typed array 摊成
参数列表）。原生 `TextDecoder` 是 3.01x。

再看**整体**（解码循环 + 转字符串，因为换设计会影响循环）：

| 设计 | 耗时 | 相对 |
|---|---|---|
| A 现状：`Uint16Array` + 分块 `apply` | 6.48 ms | 1.00x |
| **A′ `Uint16Array` + `TextDecoder`** | **3.89 ms** | **1.67x** |
| B 直接写 `Uint8Array`（显式 UTF-16LE 字节）+ `TextDecoder` | 4.12 ms | 1.57x |

选 A′：保留单次存储的解码循环，只换转换方式。B 在每个码元上多一次存储，
慢 5.9 %，但换来的是「不依赖平台字节序」——A′ 用一个启动时算一次的
`LITTLE_ENDIAN` 常量 + 就地翻字节序（4 行）达到同样的效果，更划算。

## 改动：`src/utils/docparser/clxReader.ts`

```ts
const TEXT_DECODER = new TextDecoder('utf-16le', { ignoreBOM: true })
const LITTLE_ENDIAN = new Uint8Array(new Uint16Array([0x0100]).buffer)[0] === 0x00
```

`decodeRangeWithoutGuard` 的结尾由

```ts
return codesToString(codes, k)
```

改为

```ts
if (k === 0) return ''
/* v8 ignore start */
if (!LITTLE_ENDIAN) {
  for (let i = 0; i < k; i++) codes[i] = ((codes[i] & 0xff) << 8) | (codes[i] >>> 8)
}
/* v8 ignore stop */
return TEXT_DECODER.decode(new Uint8Array(codes.buffer, 0, k * 2))
```

`codesToString` 与 `CODES_CHUNK`（16 行）**整段删除**——本文件里不再有任何
`String.fromCharCode.apply`。净行数 -12。

## 两个被实测抓出来的坑（都不是我预想到的）

### 坑一：`TextDecoder` 默认会把**开头的** U+FEFF 当 BOM 吃掉

第一版实现直接 `new TextDecoder('utf-16le')`，跑穷尽测试立刻红：

```
AssertionError: charCode=0xfeff 不一致: ref="﻿" new=""
```

`"\uFEFF"` → `""`、`"\uFEFFA"` → `"A"`（只有**开头**那一个被吃掉，中间的原样
保留）。而 `isValidPrintableChar(0xFEFF)` 返回 true——`(0xFEFF & 0xFFFE)`
是 `0xFEFE`，不等于 `0xFFFE`，所以 U+FEFF 完全可能出现在真实文本里。
加 `{ ignoreBOM: true }` 之后逐字等价。

**这是 Round 101 那条穷尽护栏第一次真正发挥作用**：如果当时用的是抽样差分，
0xFEFF 大概率不会被抽到。

### 坑二：我自己写的第一版断言是**空的**

写完快路径后加了一条护栏：「整个输入空间产出的码元里没有代理项」（因为
`TextDecoder` 会把孤立代理项换成 U+FFFD，而 `String.fromCharCode` 原样保留）。
阴性对照 D（往 `LOW_CODES` 里塞一个 `0xD800`）的结果是：

```
d     diverged         82       0  FAIL   低码元表塞进代理项 0xD800
      └─ 域断言未触发（值 无）
```

差分测试报出 82 处差异，**而那条断言一个都没触发**。原因：断言从
**快路径的输出**收集码元，而输出已经被 `TextDecoder` 净化过了，代理项早就
变成 U+FFFD——从那里收集永远看不到代理项。这是 Round 100「差分测试的空转
陷阱」的另一种形态：**断言的对象必须是没有被待测变换处理过的值**。

改法：从**参照实现**（`referenceDecode`，用 `String.fromCharCode`）收集，
它保留了原始码元。改完再跑对照 G（放行 `isValidPrintableChar` 的代理项分支）：

```
g     domain         2330    2048  OK     共用纯函数放行代理项
```

2048 个代理项，断言正常触发。

顺带厘清了职责划分：域断言覆盖两个实现**共用**的纯函数
（`HIGH_BYTE_MAP` / `isValidPrintableChar`）；快路径**私有**的两张表由穷尽
差分覆盖——代理项一旦进入快路径，`TextDecoder` 会把它变成 U+FFFD 而参照
实现不会，必然产生差异（对照 D 实测 82 处）。两条合起来才完整。

## 实测

### 端到端（27 份样本 / 12 MB 语料，独立进程，取 120 轮最小耗时）

| | 中位 | 最小 |
|---|---|---|
| Round 101 | 8.71 / 8.93 / 8.63 ms | 8.04 / 8.22 / 8.07 ms |
| Round 102 | 5.72 / 6.00 / 5.94 ms | **5.40 / 5.67 / 5.68 ms** |
| | **1.45x** | **1.45x** |

### 顺带量出的一个更重要的数字：Round 101 的真实收益是 3.03x

Round 101 用「回放真实区间」测到函数级 2.59x。这一轮顺手做了**端到端**对比
（同一份语料、独立进程、`git checkout` 到上一轮源码分别打包）：

| | 中位 |
|---|---|
| Round 100（逐字符 `+=`） | 25.13 ms |
| Round 101（码元缓冲 + 分块 `apply`） | 8.30 ms |
| | **3.03x** |

**函数级的隔离测量低估了端到端收益**：旧的 `+=` 实现每次调用产生上万个
ConsString，GC 成本会摊到整条解析链上，而隔离回放里那部分成本被算在了
「函数之外」。这条值得记下来——隔离基准给的是函数的上界/下界，不是端到端。

## 等价性证据（五重）

① **穷尽差分**（常驻，`tests/clxReader.fastDecode.test.ts`，本轮 13 → 15 项）：
压缩分支 256 个字节值、非压缩分支 65 536 个码元完整枚举，外加顺序/逆序/三连/
前垫 ASCII、全部依次、后垫可打印、各 500 组随机子区间、真实语料 27 份 × 9 区间。

② **域断言 + BOM 定点断言**（本轮新增 2 项，见上）。

③ **端到端逐位一致**：27 份样本 `parse()` 的完整文本（1 636 452 字符）在
`git stash` 前后逐字节相同。

④ **阴性对照 ×7**：

| 变体 | 改动 | 期望 | 实测 |
|---|---|---|---|
| A | 去掉 `{ ignoreBOM: true }` | diverged | **1 处** ✓ |
| B | `LITTLE_ENDIAN` 强制为 `false`（在小端机上翻字节序） | diverged | **64 137 处** ✓ |
| C | 字节视图长度 `k * 2` → `k * 2 - 2` | diverged | **64 384 处** ✓ |
| D | 快路径私有表塞进代理项 `0xD800` | diverged | **82 处** ✓ |
| E | 先建全长视图再 `subarray` | equivalent | **0 处** ✓ |
| F | 去掉 `k === 0` 早返回 | equivalent | **0 处** ✓ |
| G | 共用 `isValidPrintableChar` 放行代理项 | domain | **2330 处差异 + 2048 个代理项** ✓ |

对照 B 值得单独说：它证明**字节序判定是有承重的**——如果 `LITTLE_ENDIAN`
写反或恒为 `false`，小端机上会把每个码元的两个字节翻过来，64 137 处差异。
这条分支在真实平台上是 `/* v8 ignore */` 的，靠这条对照才有证据。

⑤ **定向测试**：`clxReader.fastDecode` + `docParser` + `clxParser` + `realDocs`
= 142 项通过。

## 验证

- `npx vue-tsc -p tsconfig.json --noEmit`：0 错误
- `npm run lint`：干净
- `npm run build` / `npm run build:lib`：通过
- `npm test`：**64 文件 / 1382 项**通过（较 Round 101 的 64/1380 **+2 项**）
- `node bench-diff.mjs 1020`：与改动前 `cycle-1010` 除 `cycle`/`timestamp`
  外全部字段逐位相同

## 指标

- 主包 gzip：109.31 → **109.32 kB**（raw 317.31 → **317.29 kB**）。
  删掉了 `codesToString` 与 `CODES_CHUNK`（16 行）与一个模块级常量，换来的
  是 `TextDecoder` 构造 + `LITTLE_ENDIAN` 判定 + 一个字节视图——**基本持平**
  （gzip +0.01 kB 在四舍五入噪声内，raw -0.02 kB）。这一轮是纯赚。
- 解析阶段端到端 **1.45x**；`codesToString` 那一档（40 % 的解析时间）基本消失。
- GC 3.13 %（Round 101 已从 57.97 % 降下来），本轮没有再动它。

## 下一轮候选

- **`decodeRangeWithoutGuard`（33.9 %）** 现在是解析阶段最大单项。两处可看：
  ① 非压缩分支每个码元都调一次 `isValidPrintableChar`（6 个比较），
  能否用一张紧凑的「无效区间」判定替掉而不改变语义；
  ② 循环里 `codes[k++] = c` 与 `data[i] | (data[i + 1] << 8)` 的访存模式。
- **`readRegularStream`（9.7 %）** + `readStream`（1.7 %）+ `getFatSectors`（1.0 %）
  —— OLE 层，本轮首次进入视野。
- **`bytesToBase64DataUrl`**（`src/utils/imageExtractor.ts:347`）的
  `binary += String.fromCharCode.apply(...)` 循环，可用同一套「收集后一次 join」。
- **`extractTextWithFib`（1.4 %）** / `splitPiecesByStory`（0.16 %）——
  本轮量过，**不值得动**；Round 101 把它们列为下一轮是旧剖析的误导。
- 大端分支（`/* v8 ignore */`）：当前只有阴性对照 B 证明它承重，没有平台能真跑。

## 清理的临时产物

`.prof102.ts`、`.prof102/`、`.profan102.mjs`、`.corpus102.ts`、
`.bench102.ts`、`.bench102b.ts`、`.e2e102.ts`、`.nc102.ts`、
`.nc102.manifest.json`、`src/utils/docparser/_nc2{a,b,c,d,e,f,g}.ts`。
