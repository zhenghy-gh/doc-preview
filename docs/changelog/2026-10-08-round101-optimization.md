# Round 101 — 文本抽取改用码元缓冲，消掉逐字符 `+=` 的 ConsString

日期：2026-10-08
版本：0.7.44 → 0.7.45
基线：`ad02981`（round 100）

## 起因：重新剖析把目标换掉了

Round 97–99 建立的选靶方法是 `node --cpu-prof` 跑未压缩构建
（`vite build --mode lib --minify false --outDir .prof-lib`），再用
`.profan101.mjs` 剔除沙箱噪声。Round 100 之后重新跑了一遍（40 轮），
结果**和前三轮完全不同**：当时被优化的四个目标（图片 / WordArt / shapes /
equations）在 40 轮里全部跌到 0.1 % 以下——因为库内真的变快了，
它们已经不再是热点。剔掉沙箱噪声后库内最大的项变成了文本抽取：

| 函数 | 自耗时占比 |
|---|---|
| `extractTextFromRange` | 17.18 % |
| `extractTextWithFib` | 10.55 % |
| `splitPiecesByStory` | 5.10 % |
| `(garbage collector)` | **57.97 %** |

GC 占 58 % 是**症状**，不是原因；而 `extractTextFromRange` 的实现正是
GC 的制造者——它逐字符 `text += …`，每追加一个字符就产生一个 ConsString
（rope）。140 次真实调用要追加 161 万个字符。

### 沙箱噪声的占比会随库变快而上升

`tryBrokerFileTokenSync @ node-brokered-fs-shim.cjs` 在 Round 97/98/99
占 33–40.7 %，本轮**升到 47.5 %（40 轮）/ 73.4 %（10 轮）**。不是 shim
变慢了，是分母变小了。样本太少会严重扭曲分布：10 轮时 shim 占 73.4 %，
库内任何函数都看不见；必须跑够 40 轮才能读出上表。

## 真实调用分布（插桩实测，不是假设）

优化值不值得做，取决于真实的区间尺寸分布，所以先插桩量了
（27 份样本，全部解析成功）：

| | 调用数 | 字节 | 占比 | p50 | p90 | p99 | max |
|---|---|---|---|---|---|---|---|
| 压缩（fComplex） | 78 | 894 969 | 37.3 % | 2 138 | 17 408 | 439 685 | 439 685 |
| 非压缩（UTF-16LE） | 62 | 1 502 134 | 62.7 % | 512 | 5 318 | 1 215 380 | 1 215 380 |

- **77.0 % 的字节集中在 3 次 ≥ 64 KB 的调用里**；< 256 B 的调用只占 0.1 %。
- 两个分支都值得改（37.3 % / 62.7 %，没有一边是可以忽略的）。
- `guardBinary=true` 的真实调用数：**0 次**。所有内部调用点都传 `false`，
  公开默认值 `true` 只被 `docParser.test.ts` 覆盖。

这条分布很关键：合成基准里「64 字节小片段」只测得 **0.95x**（`Uint16Array`
分配开销盖过收益），如果照着这个数下结论就会得出「不值得改」——而真实
负载里 p50 是 2 138 / 512，且近八成字节在 3 次大调用里。

## 改动：`src/utils/docparser/clxReader.ts`

新增模块级常量与辅助，`extractTextFromRange` 只在 `guardBinary === false`
时走快路径，**原实现一字未动**：

```ts
if (!guardBinary) return decodeRangeWithoutGuard(data, start, end, isCompressed)
```

快速路径把结果先写进 `Uint16Array` 码元缓冲，再用分块
`String.fromCharCode.apply` 一次转成字符串，中间不产生任何 rope：

```ts
const n = isCompressed ? end - start : (end - start) >> 1
const codes = new Uint16Array(n)
let k = 0
if (isCompressed) {
  for (let i = start; i < end; i++) {
    const c = COMPRESSED_CODES[data[i]]
    if (c >= 0) codes[k++] = c
  }
} else {
  for (let i = start; i < end - 1; i += 2) {
    const c = data[i] | (data[i + 1] << 8)
    if (c >= 0x20) { if (isValidPrintableChar(c)) codes[k++] = c }
    else { const m = LOW_CODES[c]; if (m >= 0) codes[k++] = m }
  }
}
return codesToString(codes, k)
```

`COMPRESSED_CODES`（256 项）与 `LOW_CODES`（32 项）是原 if 链的**逐项、
按同样顺序**推导出来的查表。推导时有两处必须小心：

1. **顺序**：`0xA0` / `0xAD` / `0x1E` 在原链里排在 `byte >= 0x80` 之前，
   所以它们永远不会走到 `HIGH_BYTE_MAP` 查表。表里先写这三个，
   后面的 `for (b = 0x80; b <= 0xff)` 循环覆盖不到它们——因为
   `HIGH_BYTE_MAP` 在 `0xA0`–`0xFF` 区间全是 `null`，落到
   `else if (b >= 0xa0) t[b] = b`，值与显式赋值相同。
2. **非压缩分支的低码元**：原链在 `0x0a` / `0x00` 上 `continue`，其余
   `< 0x20` 的值交给 `isValidPrintableChar`——而它的第一行就是
   `if (charCode < 0x20) return false`。所以「< 0x20 且不在表里」等价于
   「跳过」，`LOW_CODES` 用 `-1` 表示即可，不需要给 `isValidPrintableChar`
   在低区间单列一条。

`codesToString` 用 `0x8000` 分块（与 `bytesToBase64DataUrl` 同值），
因为 `String.fromCharCode.apply` 的参数个数有上限。

### 为什么护栏路径不能一起改

二进制签名护栏需要**按字符增量地**检查累积文本、并在命中处按最后一个
换行截断（`text = lastNewline >= 0 ? text.slice(0, lastNewline) : ''`），
与「先攒码元、后转字符串」不相容。所以快路径只在
`guardBinary === false` 时启用；公开默认值 `true` 仍走原实现。

## 实测（真实区间回放，独立进程）

Round 100 的教训是同进程跑多版本会被 JIT 污染（`.bench100c.ts` 里测得
「全 `0xF0` 只 1.58 ms」，独立进程重测才得到真实的 9.10 ms）。所以本轮
先把 140 次真实调用区间落盘（`/tmp/r101ranges.json`），再用
`MODE=old|new` 在**独立进程**里各自回放。

| | 中位 | 最小 |
|---|---|---|
| 旧（逐字符 `+=`） | 17.57 ms | 17.09 ms |
| 新（码元缓冲） | **6.79 ms** | **6.46 ms** |
| | **2.59x** | **2.65x** |

分组明细（最小耗时，两轮独立测量一致）：

| 分组 | 调用数 | 字节 | 旧 | 新 | 比值 |
|---|---|---|---|---|---|
| 压缩 < 4 KB | 48 | 59 135 | 0.17 ms | 0.16 ms | 1.06x |
| 压缩 ≥ 4 KB | 30 | 835 834 | 4.60 ms | 2.82 ms | 1.63x |
| 非压缩 < 4 KB | 55 | 27 674 | 0.06 ms | 0.06 ms | 1.00x |
| 非压缩 ≥ 4 KB | 7 | 1 474 460 | 10.67 ms | 3.14 ms | **3.40x** |

第二次独立测量：旧 17.75 / 新 6.90（**2.57x**），分组比例一致。
小片段这一档第一轮测到 0.94x，第二轮 1.06x——**在计时精度内**，
即合成基准里的 0.95x 在真实 p50（2 138 / 512）上不复现。
本轮**未观察到退化**，因此没有为它引入共享 scratch 缓冲。

回放输出逐字节比对：`cmp /tmp/r101out.old.json /tmp/r101out.new.json`
→ 一致（140 段 / 1 610 454 字符）。

## 等价性证据（四重）

### ① 穷尽比对（比抽样强）

这一轮的映射可以**完整枚举**，而不是抽样差分：压缩分支的输入空间只有
256 个字节值，非压缩分支只有 65 536 个 UTF-16 码元。`tests/clxReader.fastDecode.test.ts`
（新建，13 项，常驻）对两个输入空间逐个比对：

- 压缩：256 个字节值**单独**出现 + 顺序 / 逆序 / 三连 / 前垫 ASCII 四种上下文；
- 非压缩：65 536 个码元**单独**出现 + 全部依次出现 + 每个后面垫可打印字符；
- 两个分支各 500 组随机子区间（起点/终点任意切）；
- `guardBinary=true` 路径一致性（含两处会触发护栏截断的样本）；
- 越界与空区间（`[0,0] [-1,2] [0,99] [64,64] [10,5]`）；
- `HIGH_BYTE_MAP` 每项都是单个 UTF-16 码元（快路径用 `charCodeAt(0)`
  取值，若某项是多个字符就会**静默丢数据**）；
- 4 MB 复杂度护栏 + 分块边界（`0x7ffe / 0x7fff / 0x8000 / 0x8001 / 0x10000 / 0x18000`）。

### ② 真实语料差分

27 份 `.doc` 的整文件 + 8 等分区间，两个分支各跑一遍，断言实际比对字节
数 > 5 MB。

### ③ 回放差分

140 次真实调用区间（1.61 M 字符）逐字节一致。

### ④ 阴性对照 ×5 + 等价对照 ×4

对照由脚本从当前 `clxReader.ts` 生成（每处只改一行，生成时断言 needle
恰好命中一次，避免「改了但没改到」的假对照）：

| 变体 | 改动 | 期望 | 实测差异 |
|---|---|---|---|
| A | 压缩表漏掉 `0x1e → 0x2011` 映射 | diverged | **247 处** ✓ |
| B | 低码元表把 `0x0a` 映射成 `0x0a`（原实现 `continue`） | diverged | **77 处** ✓ |
| C | 非压缩分支循环上界 `end-1` → `end` | diverged | **116 处** ✓ |
| D | 分块末块上界 `n` → `n-1`（丢最后一个字符） | diverged | **79 处** ✓ |
| F | 压缩分支循环上界 `end` → `end-1`（丢最后一个字节） | diverged | **508 处** ✓ |
| E | 码元缓冲多分配一个（输出由 `k` 限定） | equivalent | **0 处** ✓ |
| G | 分块大小 `0x8000` → `0x4000`（分块是透明的） | equivalent | **0 处** ✓ |
| H | 非压缩分支两条判定合成单个三元表达式 | equivalent | **0 处** ✓ |
| I | 按位或 `\|` 改成加法 `+`（两操作数都 < 256，位不重叠） | equivalent | **0 处** ✓ |

9 个对照全部符合预期，且生产实现 vs oracle 差异 0 处。**差分判定有鉴别力。**

### ⑤ 端到端逐位一致

把 27 份样本 `parse()` 的完整文本（1 636 452 字符）在 HEAD 与改动后各跑
一次落盘，`cmp` 两份 JSON：**逐字节相同**。这条覆盖了从 OLE 容器、
FIB、CLX/Piece Table、`extractTextWithFib`、段落装配到最终文本的整条链，
是比单函数差分更强的证据。

`node bench-diff.mjs 1010` 与改动前的 `cycle-990` 报告对比：除 `cycle` /
`timestamp` 外**全部字段逐位相同**（`median` 0.950243、`p10` 0.896816、
`p25` 0.915450、`min` 0.811547、`max` 0.999926，以及 `topIssues` 与
`failures` 的完整列表）。该脚本比的是与 macOS `textutil` 基准的相似度，
不是字节相等；它在这里的作用是确认相对基准的行为**没有位移**。

### 转写的忠实性

为了让这条穷尽护栏**常驻**而不必在 `src/` 里留一份旧实现的副本，测试文件
里的参照实现 `referenceDecode` 是改动前 `extractTextFromRange` 的逐行转写。
转写完成后用一次性脚本（`.verify101.ts`）把它与 `git show HEAD:` 导出的
**逐字原件**在 67 878 次比对上对照：**0 处差异**。确认后才删除原件。

`referenceDecode` 从生产模块借用 `HIGH_BYTE_MAP` / `isValidPrintableChar` /
`containsBinarySignature` / `SIGNATURE_CHECK_INTERVAL` 四个**本轮未改动**、
各自有独立测试的纯函数；它独立重述的是**控制流**（两个分支的 if 链、循环
边界、护栏触发时机与截断方式），也就是本轮改动的部分。这个作用域边界写进
了测试文件的注释。

## 验证

- `npx vue-tsc -p tsconfig.json --noEmit`：0 错误
- `npm run lint`：干净
- `npm run build` / `npm run build:lib`：通过
- `npm test`：**64 文件 / 1380 项**通过（较 Round 100 的 63/1367
  **+1 文件 +13 项**）
- `node bench-diff.mjs 1010`：除 `cycle`/`timestamp` 外全部字段与改动前逐位相同（见证据 ⑤）
- 定向测试：`tests/clxReader.fastDecode.test.ts` + `docParser.test.ts` +
  `clxParser.test.ts` = 139 项通过

## 指标

- 主包 gzip：109.01 → **109.31 kB（+0.30 kB，raw +0.92 kB）**。增量来自
  两张查表的构造（256 + 32 项 `Int32Array`，各由一个 IIFE 填充）、
  `codesToString`（分块 + `subarray`）与 `decodeRangeWithoutGuard`；
  原来的 if 链被保留在护栏路径里，**没有**被删掉，所以这部分是净增。
  这个代价是明的：+0.30 kB 换真实负载 2.59x。
- `extractTextFromRange` 在真实负载上 **2.59x**；GC 压力随之下降
  （每次调用少产生约 1.6 万个 ConsString）。

## 下一轮候选

- **`extractTextWithFib`（10.55 %）** —— `src/utils/docParser.ts:404`，
  是 `extractTextFromRange` 的调用方。本轮只让它调用的东西变快了，
  它自身的开销（每段一次 `Uint8Array` 切片？）还没看。
- **`splitPiecesByStory`（5.10 %）** —— `src/utils/docparser/storySplitter.ts:66`。
- **`bytesToBase64DataUrl`** —— `src/utils/imageExtractor.ts:347` 的
  `binary += String.fromCharCode.apply(...)` 循环，可以用同一套
  「收集 chunk 后一次 join」的手法。
- **`(garbage collector)` 57.97 %** 仍是症状；本轮拿掉了一个大来源，
  下一轮需要重新剖析才能知道剩下的是谁。
- OLE 层：`readRegularStream`（2.18 %）、`getFatSectors`（0.80 %）、
  `readStream`（0.58 %）。
- `extractChartsFromWordDocumentStream`（10.5 ms、产出 0）：Round 100 量过
  并放弃，要做必须同时解决「两目标密度不同导致二次方」与「已耗尽标记」。

## 清理的临时产物

`src/utils/docparser/_oldClxReader.ts`、`src/utils/docparser/_nc{a,b,c,d,e,f,g,h,i}.ts`、
`.nc101.ts`、`.nc101.manifest.json`、`.verify101.ts`、`.cap101.ts`、
`.e2e101.ts`、`.replay101.ts`、`.bench101.ts`、`.probe101.ts`、`.prof101.ts`、
`.profan101.mjs`、`.prof101/`、`.prof-lib/`。
