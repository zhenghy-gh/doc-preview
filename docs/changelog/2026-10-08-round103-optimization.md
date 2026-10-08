# Round 103 — 一次被端到端否掉的解码重写，与一次被采纳的 base64 去重

本轮分两段。**第一段（解码重写）在函数级赢了 1.47x，却在端到端输了 7%，被回退**；
第二段（base64 去重）端到端稳定快 2.2%，被采纳。

第一段的失败比它的成功更有价值：它给出了「隔离基准会在什么情况下系统性高估收益」的一个
具体反例，并且是用二分实测定位的，不是猜的。

---

## 起因：Round 102 之后重新剖析

Round 102 的剖析口径是「占整个进程」，而进程里近一半是沙箱的文件读取。本轮沿用那个口径：
语料读取放在计时之外、只让解析循环进计时、跑 200 轮。

```
样本总时长 2578.6 ms（19587 样本）
── 分类 ──
  沙箱 shim         1264.9 ms   49.05 %
  其他               950.7 ms   36.87 %
  原生/无 url         274.7 ms   10.65 %
  Node/依赖           59.9 ms    2.32 %
  GC                 28.5 ms    1.10 %
── 自耗时 Top 10 ──
   48.98 %    1263.0 ms  [沙箱 shim]  tryBrokerFileTokenSync @ node-brokered-fs-shim.cjs
   24.31 %     626.9 ms  [其他]  decodeRangeWithoutGuard
    8.94 %     230.5 ms  [原生/无 url]  decode @ (native)
    6.53 %     168.3 ms  [其他]  readRegularStream
    1.69 %      43.6 ms  [Node/依赖]  decode @ encoding
    1.34 %      34.7 ms  [其他]  readStream
    1.29 %      33.2 ms  [其他]  extractTextWithFib
    1.10 %      28.5 ms  [GC]  (garbage collector)
    1.06 %      27.2 ms  [原生/无 url]  read @ (native)
    0.86 %      22.3 ms  [其他]  getFatSectors
```

扣掉 49.05 % 的沙箱 shim，**以解析阶段为分母**：

| 项 | 占解析阶段 |
|---|---|
| `decodeRangeWithoutGuard`（JS 循环） | **47.7 %** |
| `decode @ (native)`（`TextDecoder.decode`） | **17.5 %** |
| `readRegularStream` | 12.8 % |
| `decode @ encoding` | 3.3 % |
| `readStream` | 2.6 % |
| `extractTextWithFib` | 2.5 % |
| GC | 2.2 % |
| `getFatSectors` | 1.7 % |

解码相关（JS 循环 + 原生 decode）合计 **65.2 %**，是绝对大头；Round 102 列为「首次进入视野」
的 OLE 层（`readRegularStream` + `readStream` + `getFatSectors`）合计 17.1 %，优先级低于解码。
所以第一段的目标选的是 `decodeRangeWithoutGuard`。

---

# 第一段：把 `decodeRangeWithoutGuard` 换成「原生解码 + 原生正则过滤」

## 第 1 轮：判定 / 分配 / 访存分开量

非压缩分支每码元做三件事：

```ts
const c = data[i] | (data[i + 1] << 8)   // 两次带边界检查的访存 + 移位或
if (c >= 0x20) { if (isValidPrintableChar(c)) codes[k++] = c }  // 判定 + 存储
else { const m = LOW_CODES[c]; if (m >= 0) codes[k++] = m }
```

`.bench103.ts`（Round 102 交付前建的，15 轮，全部设计**逐字一致** 1 610 454 字符 / 0 差异）：

| 设计 | 耗时 | 相对 |
|---|---|---|
| V0 现状（分配 `Uint16Array(n)` + 一次 decode） | 3.86 ms | 1.00x |
| V1 复用固定 scratch + 分块 decode（CHUNK=16384） | 3.86 ms | 1.00x |
| **V2 V0 + 内联判定**（4 个条件替代函数调用） | **3.49 ms** | **1.11x** |
| V3 V1 + 内联判定 | 3.67 ms | 1.05x |
| V4 V0 + 64 KB 有效性查表 | 3.60 ms | 1.07x |

**复用 scratch 完全没用**（3.86 = 3.86）：每次分配 `Uint16Array(n)` 在当前 V8 上基本免费
（大对象直接进老生代）。**查表比内联判定慢**（3.60 vs 3.49）：64 KB 表的缓存代价超过了省下的比较。

于是转向**访存**：`data` 本身就是 `Uint8Array`，非压缩分支读的就是 UTF-16LE 字节，
`data[i] | (data[i + 1] << 8)` 可以用零拷贝的 `Uint16Array` 视图替掉。
`.bench103b.ts`（25 轮 × 3 次重复）：

| 设计 | run 1 | run 2 | run 3 | 中位 |
|---|---|---|---|---|
| V0 现状 | 3.69 | 3.88 | 3.74 | 3.74 |
| V2 V0 + 内联判定 | 3.58 | 3.59 | 3.56 | 3.58 |
| **V5 视图 + `isValidPrintableChar`** | 3.64 | 3.86 | 3.65 | **3.65（1.02x）** |
| V5i 视图 + 内联判定 | 3.41 | 3.44 | 3.54 | 3.44（1.09x） |
| V5L 视图 + 内联判定 + 低位位掩码 | 3.47 | 3.54 | 3.40 | 3.47 |
| V7 视图 + 两遍（干净则零拷贝） | 3.53 | 3.45 | 3.41 | 3.45 |

- **视图本身完全没用**（1.02x）：`data[i] | (data[i + 1] << 8)` 被 V8 优化得和单次 16 位访存差不多。
- V5i / V5L / V7 都在 1.09x 附近，**互相之间在噪声内**（轮间噪声约 9 %，所以做了三次重复）。
- V7 被数据否掉：**只有 0.5 % 的码元**（3 388 / 751 067）能走「全部原样输出」的零拷贝分支——
  Word 文本里 CR（0x0D）到处都是，而 CR 要映射成 LF，所以「干净区间」几乎不存在。
  140 个真实区间里奇数对齐 0 个，视图可用性本身不是问题。

**判定、分配、访存三条路都到头了，合计约 1.1x。必须换掉循环本身。**

## 第 2 轮：原生解码 + 原生正则

非压缩分支的输入本来就是 UTF-16LE 字节，那层循环只做「丢弃 + 两处映射」。交给原生实现：
`TextDecoder('utf-16le')` 一次解码整段，再用一条字符类正则丢掉该丢的码元（Irregexp）。
丢弃集合与映射表**穷尽枚举 65536 个码元**从 `isValidPrintableChar` / `LOW_CODES` 推导，不手写。
`.bench103c.ts`（20 轮）：

| 设计 | 耗时 | 相对 | 差异 |
|---|---|---|---|
| V0 现状（JS 循环） | 3.88 ms | 1.00x | 0 |
| V5i 视图 + 内联判定 | 3.38 ms | 1.15x | 0 |
| R1 正则（**非** fatal 解码器） | 2.96 ms | 1.31x | **5 处** |
| **R2 正则（`fatal: true`）** | **2.91 ms** | **1.33x** | **0** |
| R3 正则 + 合并正则 + replacer 回调 | 3.01 ms | 1.29x | 0 |
| R4 正则 + `split/join`（顺序写错） | 3.01 ms | 1.29x | **13 处** |

**R1 的 5 处差异正是设计里最需要担心的那条**：`TextDecoder` 默认把**孤立代理项**换成 U+FFFD，
而参照实现是**丢弃**它。差别不只是「多一个字符」——源里真的存在一个 U+FFFD 时参照实现会保留它
（`isValidPrintableChar(0xFFFD)` 返回 true），所以「丢掉所有 U+FFFD」这种蒙混写法也不成立。
**必须用 `fatal: true`**：源里没有孤立代理项时逐字等价，一旦有就**抛异常**，落回精确的逐码元路径。

`.bench103d.ts`（25 轮）量了这条路径的地板（**结果错误，仅计时**）：

| 设计 | 耗时 | 相对 |
|---|---|---|
| V0 现状 | 3.68 ms | 1.00x |
| **R2 正则（fatal）** | **2.79 ms** | **1.32x** |
| R5 正则 + `replaceAll` | 3.22 ms | 1.14x |
| R6 先映射 CR 再丢弃（丢弃类排除 LF） | 3.21 ms | 1.14x |
| （地板）仅 decode、完全不过滤 | 2.13 ms | 1.72x |
| （地板）decode + 丢弃正则、不做映射 | 2.65 ms | 1.39x |

分支拆分：**压缩 78 job 1.72 ms（未改）；非压缩 62 job 2.00 → 1.08 ms（1.86x）；合计 3.72 → 2.80（1.33x）。**

## 第 3 轮：压缩分支——一个被证伪的方向

`HIGH_BYTE_MAP` 的 0x80–0x9F 段**逐项等于 CP1252**（含 0x81 / 0x8D / 0x8F / 0x90 / 0x9D
五个未定义位），0xA0–0xFF 段等于 Latin-1（`null → 原字节`）。也就是说压缩分支的字节→码元映射
**就是** `TextDecoder('windows-1252')`，之后同样只剩丢弃与两处映射。穷尽 256 个字节验证了这一点
（0 处不符），也验证了 CP1252 是单射的（256 → 256 个互不相同的码点，0 处碰撞）。

**但基准把它否了**（`.bench103e.ts`，25 轮）：

| 设计 | 耗时 | 相对 |
|---|---|---|
| V0 现状（JS 循环 ×2） | 3.84 ms | 1.00x |
| **R2 只改非压缩** | **2.73 ms** | **1.41x** |
| C1 只改压缩 | 5.54 ms | 0.69x |
| RC 两条分支都改 | 4.55 ms | 0.84x |

压缩分支 1.56 → 3.47 ms（**0.45x，慢 2.2 倍**）。原因不神秘：它的循环是**一次 `Int32Array`
查表 + 一次存储**，每字节成本极低；而「单字节解码 + 三次正则扫描」的每字节成本明显更高。
**逐字节查表已经接近最优形态。**

### 顺带挖出的第二个 `TextDecoder` 陷阱：`ignoreBOM` 对单字节编码是反的

穷尽自校验报出 1 处不符、映射表里冒出一个没预料到的 `0x0→0xFF`，追下去发现
**`new TextDecoder('windows-1252', { ignoreBOM: true })` 会吞掉开头的一个 0xFF 字节**：

| 编码 | `ignoreBOM: true` | `ignoreBOM: false`（默认） |
|---|---|---|
| `utf-16le` | **保留**开头的 U+FEFF ✓ | 把它当 BOM 吃掉 |
| `windows-1252` / `latin1` / `iso-8859-1` | **吃掉**开头的一个 0xFF 字节 ✗ | 保留 ✓ |

```
windows-1252 ignoreBOM:true   [0xff]=""    [0xff,0x41]="A"   [0xff,0xfe,0x41,0x00]="þA\0"
windows-1252 ignoreBOM:false  [0xff]="ÿ"   [0xff,0x41]="ÿA"  [0xff,0xfe,0x41,0x00]="ÿþA\0"
```

**同一个标志在两种编码家族下的正确取值是相反的。** Round 102 的结论是「utf-16le 必须传
`ignoreBOM: true`」，这条结论**不能外推**到单字节编码。0xFF 在压缩分支里是合法且有意义的字节
（Latin-1 回退 → U+00FF），所以那个被否掉的设计里必须用默认值。

## 第 4 轮：字符类里的代理项区间必须保留（这一条差点写错）

`fatal: true` 保证输入里没有**孤立**代理项，于是很自然地想：字符类里的代理项区间
（`\ud800-\udfff`，2048 个码点，占整个类的 **96 %**）是不是可以删掉？删掉后类只剩 92 个码点，
基准里也**没有变慢**（1.46x vs 1.47x，在噪声内）。

**这个想法是错的。** 参照实现对代理项是**一律丢弃**——`isValidPrintableChar` 对 0xD800–0xDFFF
返回 false，所以**合法代理对的两个码元也会被分别丢掉**；而 `TextDecoder` 会把合法代理对
**合成一个星光平面字符**。删掉区间后那个星光平面字符不在 BMP 字符类里，就会原样漏出来：

| 输入码元 | 参照实现 | 完整类（保留区间） | 删掉区间 |
|---|---|---|---|
| `D83D DE00`（😀） | `""` | `""` ✓ | `"😀"` ✗ |
| `41 D83D DE00 42` | `"AB"` | `"AB"` ✓ | `"A😀B"` ✗ |
| `D83D 41`（孤立高位） | `"A"` | 抛异常 → 落慢路径 → `"A"` ✓ | 同左 ✓ |
| `FFFD`（字面） | `"\uFFFD"` | `"\uFFFD"` ✓ | `"\uFFFD"` ✓ |
| `FEFF 41`（开头） | `"\uFEFFA"` | `"\uFEFFA"` ✓ | `"\uFEFFA"` ✓ |

保留区间后，正则（**不带 `u` 标志**）会分别命中星光平面字符的两个码元、两个都丢掉，与参照实现
一致。`.bench103f.ts` 的收尾比较（25 轮）确认完整类不亏：R2 2.69 ms（**1.47x**）、R2a（去区间）
2.71、R2b 2.68、R2c 2.68、R2d 2.86。**没有收益就不加复杂度**，选 R2。

> 这条不是被基准抓出来的——语料里没有合法代理对，基准的正确性检查覆盖不到星光平面字符。
> 它是被「把参照实现的语义重新想一遍」抓出来的。

## 第 5 轮：端到端实测 —— 结论反转

按纪律做完端到端 A/B（27 份样本 / 7.6 MB，独立进程，150 轮取最小）：

```
=== NEW（本轮改动）===   150 轮：min 175.82 ms  p50 179.76 ms
=== OLD（HEAD）===       150 轮：min 165.16 ms  p50 172.02 ms
完整文本 1491456 字符，逐字节相同
```

**函数级 1.47x，端到端 −7 %。** 三次重复、六个独立进程都复现（OLD 157.19/167.60/162.91，
NEW 174.43/174.27/171.68）。

### 二分定位

先剖析，按函数名聚合自耗时差：

| 函数 | OLD | NEW | 差 |
|---|---|---|---|
| `extractFormattedText` | 360.2 ms | 794.1 ms | **+433.8** |
| `createParagraphsWithRealFormats` | 1729.2 ms | 2037.3 ms | **+308.1** |
| `decodeRangeWithoutGuard` | 270.7 ms | 118.0 ms | −152.8 |
| `guessCharFormat` | 1135.5 ms | 1210.8 ms | +75.3 |
| `applyStructuralFormats` | 1133.1 ms | 1174.3 ms | +41.2 |
| `detectCharacterStyles` | 1411.2 ms | 1449.7 ms | +38.5 |
| GC | 1028.8 ms | 1066.1 ms | +37.3 |
| `RegExp: [丢弃类]` | 0 | 33.6 ms | +33.6 |
| `decodeUtf16RangeFast` | 0 | 17.4 ms | +17.4 |
| `decode @ (native)` | 170.3 ms | 187.1 ms | +16.8 |

**慢的不是解码函数**（它 −152.8 ms），而是下游两个函数（+742 ms）。这是「数据形状变了、
连带下游一起变慢」的形状，所以做二分：把新路径拆成「解码调用」和「三次正则替换」两半。

| 变体 | min | p50 |
|---|---|---|
| OLD（HEAD） | 165.16 | 172.02 |
| NEW（本轮改动） | 175.82 | 179.76 |
| M1 解码器改回非 fatal | 174.38 | 178.15 |
| **M2 跳过三次正则替换**（结果错误，只测代价） | **152.78** | 155.43 |
| M3 字节视图改用 `subarray`（等价改写） | 175.08 | 178.43 |
| **M4 只解码、不替换** | **150.95** | 155.24 |
| M5 单趟合并正则 + 回调（1 次分配） | 167.22 | 171.59 |
| M6 丢弃 + CR 两趟、CR 先探 | 175.40 | 179.55 |

- **M2/M4 比 OLD 还快 12 ms** —— 说明「原生解码整段」这一步**本身是赢的**，与函数级基准一致。
- **NEW/M1/M3 比 OLD 慢 10 ms** —— 加回三次 `String.replace` 就翻盘。
- 所以三次替换的代价约 **23 ms/轮**，而它替掉的 JS 循环只值约 **12 ms/轮**。
- `fatal` vs 非 fatal 无差异（175.82 vs 174.38，噪声内）；`subarray` vs `new Uint8Array` 无差异。
- M5（合并成一次替换、只分配一次）**只是打平 OLD**（167.22 vs 165.16），M6 更差。

**机制**：`String.prototype.replace` 是「命中就复制整串」的操作，而 .doc 文本里 CR（段落标记）
几乎必然存在，所以每段都要复制一份几乎同样大的新字符串；旧循环是「每码元一次判断 + 一次写」，
在 11 KB 这种尺度上常数因子更小。**这是 Round 102 那条结论的镜像，而且更强**：

> Round 102：「隔离基准给的是函数的上界/下界，不是端到端。」
> Round 103：**当函数的分配量与数据规模成正比时，隔离基准会系统性高估收益**——
> 因为它取的是同一批热数据上的最小耗时，而端到端里每段只跑一次、产出的字符串还会被下游长期持有。

## 结论：回退

`git checkout -- src/utils/docparser/clxReader.ts tests/clxReader.fastDecode.test.ts`。
第一段的所有基准、对照、剖析结论保留在本文档里，作为「这条路走不通」的证据。

---

# 第二段：三处重复的 base64 实现去重（**采纳**）

第一段回退后，端到端剖析（同一份语料）里的自耗时榜给出了下一个目标：

| 函数 | 自耗时 | 占比 |
|---|---|---|
| `createParagraphsWithRealFormats` | 1729.2 ms | 10.45 % |
| `detectCharacterStyles` | 1411.2 ms | 8.53 % |
| `extractImagesFromStream` | 1186.4 ms | 7.17 % |
| `guessCharFormat` | 1135.5 ms | 6.86 % |
| `applyStructuralFormats` | 1133.1 ms | 6.85 % |
| `detectAlignment` | 842.0 ms | 5.09 % |
| `parseFormatRuns` | 805.6 ms | 4.87 % |
| **`bytesToBase64DataUrl`** | **606.7 ms** | **3.67 %** |

`bytesToBase64DataUrl` 是 Round 101 的 changelog 就点名过的候选，而且它**有三份副本**：

```ts
// imageExtractor.ts:347   binary += String.fromCharCode.apply(null, slice as number[])      // 0x8000
// pictureParser.ts:527    binary += String.fromCharCode.apply(null, Array.from(slice) …)    // 0x8000
// headerFooterParser.ts:47 binary += String.fromCharCode.apply(null, slice as number[])     // 0x8000
```

三份已经漂移：`pictureParser` 那份多了一层 `Array.from`。

## 候选对比（2 KB / 20 KB / 100 KB / 500 KB / 2 MB，合计 2.6 MB）

先测第一版（30 轮）：

| 设计 | 耗时 | 相对 |
|---|---|---|
| A 现状 `binary += apply`（0x8000） | 8.07 ms | 1.00x |
| B 攒 chunk 再 `join`（0x8000） | 8.37 ms | 0.96x |
| B2 攒 chunk 再 `join`（0x2000） | 6.34 ms | 1.27x |
| E 纯 JS base64 查表 | 39.06 ms | **0.21x** |
| D `Buffer`（仅作上界参考，浏览器不可用） | 0.51 ms | 15.86x |

再扫分块大小与 `join` 的组合（40 轮）：

| 设计 | 耗时 | 相对 |
|---|---|---|
| 现状 0x8000 `+=` | 7.71 ms | 1.00x |
| **`Array.from` 0x8000 `+=`（pictureParser 现状）** | **36.67 ms** | **0.21x** |
| 0x1000 `+=` | 5.97 ms | 1.29x |
| **0x2000 `+=`** | **6.02 ms** | **1.28x** |
| 0x4000 `+=` | 8.17 ms | 0.94x |
| 0x1000 `join` | 6.05 ms | 1.27x |
| 0x2000 `join` | 5.98 ms | 1.29x |
| 0x4000 `join` | 8.29 ms | 0.93x |
| 0x8000 `join` | 7.81 ms | 0.99x |
| `Buffer`（上界参考） | 0.31 ms | 25.02x |

三条结论：

1. **分块 0x2000 是关键**（0x4000 及以上反而更慢）。`Function.prototype.apply` 的实参个数有上限，
   超过之后 V8 走慢路径——Round 102 在 `String.fromCharCode.apply` 上量到同一现象。
2. **`join` 与逐步 `+=` 无差异**（6.02 vs 5.98），所以保留更简单的写法。
3. **`Array.from(slice)` 慢 4.8 倍**——每一块都多分配一个 JS 数字数组。
   `apply` 接受类数组对象，`Uint8Array` 本身就够了。

## 两个被证伪的方向

- **`TextDecoder('latin1')`**：WHATWG 里 `latin1` 与 `iso-8859-1` **都是 `windows-1252` 的别名**，
  字节 0x80–0x9F 会解成 U+20AC 这类 > 0xFF 的码点，`btoa` 直接抛 `InvalidCharacterError`。
  规范里**没有**「真 Latin-1」解码器。第一版候选一跑就红，立刻排除。
- **纯 JS base64 查表**：0.21x，比 `btoa` 慢 4.8 倍。`btoa` 是原生的，不要自己写。

`Buffer.from(bytes).toString('base64')` 快 25 倍，但库要跑在浏览器里（`src/` 里没有任何 `Buffer` 引用），
不可用。

## 改动

新增 `src/utils/binaryReader.ts` 的 `bytesToBase64`。放进这个模块的理由与它原有的四个原语相同
——那个模块的存在本身就是「11 个解析器各存一份 `readUint16`」的去重结果：

```ts
export function bytesToBase64(bytes: Uint8Array): string {
  const CHUNK = 0x2000
  if (bytes.length <= CHUNK) {
    return btoa(String.fromCharCode.apply(null, bytes as unknown as number[]))
  }
  const parts: string[] = []
  for (let i = 0; i < bytes.length; i += CHUNK) {
    const end = Math.min(i + CHUNK, bytes.length)
    parts.push(String.fromCharCode.apply(null, bytes.subarray(i, end) as unknown as number[]))
  }
  return btoa(parts.join(''))
}
```

三处调用点改为调用它：`imageExtractor.bytesToBase64DataUrl`（只剩加 `data:` 前缀）、
`pictureParser.picturesToDataUrls`、`headerFooterParser.pictureToHeaderFooterImage`。
**净 +17 行**（−39 +56），三个副本变一个。

---

## 实测

### 第二段：端到端（27 份样本 / 7.6 MB，独立进程，150 轮取最小）

| 口径 | OLD | NEW | 相对 |
|---|---|---|---|
| min（3 次重复的中位） | 167.18 ms | **163.44 ms** | **1.023x** |
| p50（3 次重复的中位） | 170.29 ms | **168.02 ms** | 1.013x |

三次重复：OLD `166.98 / 167.50 / 167.18`，NEW `163.33 / 164.05 / 163.44`（min）；
OLD `170.15 / 171.03 / 170.29`，NEW `168.02 / 167.76 / 170.11`（p50）。

### 第一段（已回退，留档）

函数级 `decodeRangeWithoutGuard` 3.94 → 2.69 ms（**1.47x**），非压缩分支 1.94 → 1.12 ms（**1.73x**）；
端到端 **−7 %**。

---

## 等价性证据

1. **穷尽差分（第二段新增的常驻护栏 `tests/binaryReader.base64.test.ts`，10 项）**：
   全部 256 个单字节值、全部 65 536 个双字节组合、空输入、分块边界
   （`0x1ffe/0x1fff/0x2000/0x2001/0x2002/0x3fff/0x4000/0x4001/0x5fff/0x6000/0x6001`）、
   长度 mod 3 的三种余数 × 跨块位置、**每个字节值都跨过 0x2000 分块边界**、1 MB 输入。
   参照实现是改动前 `bytesToBase64DataUrl` 的**逐行转写**（`chunkSize = 0x8000` + `binary += apply`）；
   另有最朴素的逐字节拼接作为第二参照。
2. **集成层护栏**：`pictureParser.picturesToDataUrls` 的输出与参照实现逐字一致（这一处改动前
   多一层 `Array.from`，是三个副本里唯一行为不同的那个）；真实语料里的图片字节区间直接比 base64
   文本，比对字节数 > 5 MB。
3. **端到端逐位一致**：27 份样本 `parseWithFormat()` 的**完整文本**（1 491 456 字符）`cmp` 逐字节相同；
   另落一份**整棵解析结果**的 sha256（`bc0dfd81e52038ae7545455f71f8a67b0e27e0e5f1c62a40304aeb5fc85f2e26`），
   把每个图片 data URL 的完整内容都算进去——段落文本覆盖不到图片的 base64，所以这一层是必需的。
   同进程内复算两遍确认结果本身是确定的，跨进程比对才有意义。
4. **阴性对照 ×20**（两段合计，见下）。

---

## 阴性对照

### 第一段（解码重写，对照跑在**真实测试文件**上）

| # | 变体 | 期望 | 实测 |
|---|---|---|---|
| A | 去掉 `fatal: true`（孤立代理项被换成 U+FFFD） | 应被抓出 | **测试失败 ✓** |
| B | 字符类去掉代理项区间（合法代理对漏出星光平面字符） | 应被抓出 | **测试失败 ✓** |
| C | 去掉 `ignoreBOM: true`（开头 U+FEFF 被吃掉） | 应被抓出 | **测试失败 ✓** |
| D | 交给解码器的字节数少 2（丢掉最后一个码元） | 应被抓出 | **测试失败 ✓** |
| E | 去掉 CR → LF 映射 | 应被抓出 | **测试失败 ✓** |
| F | 去掉 0x1E → U+2011 映射 | 应被抓出 | **测试失败 ✓** |
| G | 抛异常时返回空串而不是回退 | 应被抓出 | **测试失败 ✓** |
| H | 字节视图起点错位一个字节 | 应被抓出 | **测试失败 ✓** |
| I | 等价改写：两处映射顺序对调 | 应判等价 | **测试通过 ✓** |
| J | 等价改写：用 `subarray` 取字节视图 | 应判等价 | **测试通过 ✓** |
| K | 等价改写：先 `test` 再 `replace` | 应判等价 | **测试通过 ✓** |

**11 个全部符合预期。** K 说明「先 `test` 再 `replace`」在**当前**实现下恰好等价
（带 `g` 的 `replace` 每次都从 0 开始并把 `lastIndex` 复位，实测无状态残留）；源码注释里禁止它的
理由不是「会算错」而是「多一次全量扫描、且一旦以后改成别的形态就会算错」——这一点写清楚，
免得后人以为它在防一个不存在的问题。

### 第二段（base64 去重）

| # | 变体 | 期望 | 实测 |
|---|---|---|---|
| A | `join` 分隔符改成逗号 | 应被抓出 | **测试失败 ✓** |
| B | `push` 改成 `unshift`（块顺序反了） | 应被抓出 | **测试失败 ✓** |
| C | `subarray` 起点错位一个字节 | 应被抓出 | **测试失败 ✓** |
| D | 循环步长多走一个字节 | 应被抓出 | **测试失败 ✓** |
| E | 短输入快路径少传一个字节 | 应被抓出 | **测试失败 ✓** |
| F | `data:` URL 少一个字节 | 应被抓出 | **测试失败 ✓** |
| G | 等价：快路径阈值 `0x2000 → 0x1fff` | 应判等价 | **测试通过 ✓** |
| H | 等价：去掉 `Math.min`（`subarray` 自己会夹取） | 应判等价 | **测试通过 ✓** |
| I | 等价：`CHUNK 0x2000 → 0x8000`（只影响性能） | 应判等价 | **测试通过 ✓** |

**9 个全部符合预期。** 这一轮的对照设计有个特殊之处值得写下来：**分块大小只影响性能、
不影响结果**——块是顺序拼接的，所以把 `CHUNK` 从 `0x2000` 改成别的值不会产生差异
（对照 I 正是用这一点反向确认了「结果不依赖分块」这个前提本身）。真正承重的只有
**拼接顺序**（B）、**拼接分隔符**（A）、**`subarray` 边界**（C/D/E/F）四处。
换句话说，这条护栏保护的是「边界与顺序」，**不保护**「分块尺寸」——尺寸选错只会变慢，
而变慢在测试里是不可见的，只能靠基准。G 顺带确认了阈值恰好取在 `<= CHUNK` 还是 `< CHUNK`
是等价的（`0x1fff` 与 `0x2000` 在恰好等于阈值时走不同分支，但两条分支在这一点上结果相同）。

---

## 验证

| 检查 | 结果 |
|---|---|
| `npx vue-tsc --noEmit` | **0 错误** |
| `npm run lint` | 干净 |
| `npm run build` | 通过（71 modules，12.41 s） |
| `npm run build:lib` | 通过（60 modules，2 m 35 s） |
| `npm test` | **65 文件 / 1392 项全过**（较 Round 102 的 64 / 1382 **+1 文件 +10 项**） |
| `npx vitest run tests/binaryReader.base64.test.ts` | 10 项全过 |
| `node bench-diff.mjs 1030` | 与 `cycle-1020` **除 `cycle`/`timestamp` 外全部字段逐位相同** |
| 端到端 `parseWithFormat()` 完整文本 | 27 份样本 1 491 456 字符，`cmp` **逐字节相同** |
| 端到端整棵解析结果 sha256 | `bc0dfd81e52038ae7545455f71f8a67b0e27e0e5f1c62a40304aeb5fc85f2e26`，OLD / NEW 相同 |
| 阴性对照 | 第一段 11/11、第二段 **9/9**，全部符合预期 |

`bench-diff.mjs 1030` 的读数与 `cycle-1020` 完全一致：`median` 0.9502433994244857、
`p10` 0.8968160758834334、`p25` 0.9154504595379104、`min` 0.8115474418758475、
`max` 0.9999259480622746，`topIssues`（`middle_diff` 7 例 / `misc_diff` 6 例）与
`failures` 的 13 条完整列表也逐条相同。**这个脚本比的是与 macOS `textutil` 基准的相似度，
不是字节相等**，所以判据是「与改动前逐字段相同」，不是「相似度 = 1」。

---

## 指标

主包（`dist/assets/main-*.js`）：

| 口径 | Round 102 | Round 103 | 变化 |
|---|---|---|---|
| raw | 317.29 kB | **317.25 kB** | **−0.04 kB** |
| gzip | 109.32 kB | **109.31 kB** | **−0.01 kB** |

库产物（`dist-lib/doc-preview.js`）350.55 kB / gzip 94.22 kB。

**净 +17 行（−39 +56）换来体积基本持平**：三个副本合并成一个，删掉的是三段重复的循环骨架，
加进来的是一个带分块的函数——重复代码本身的体积与一份带分支的实现相当，所以打包体积没涨。
真正的收益在运行时的 base64 编码那 3.67 % 上（**1.28x**）。

---

## 下一轮候选

- **`extractImagesFromStream`（7.17 %）** —— 图片扫描（找 JPEG 结尾、PNG 边界），本轮只动了它
  下游的 base64 编码。
- **`readRegularStream`（12.8 % 解析阶段）+ `readStream`（2.6 %）+ `getFatSectors`（1.7 %）**
  —— OLE 层，合计 17.1 %。本轮首次拿到干净的占比，是除解码外最大的一块。
- **`detectCharacterStyles`（8.53 %）/ `createParagraphsWithRealFormats`（10.45 %）/
  `guessCharFormat`（6.86 %）/ `applyStructuralFormats`（6.85 %）** —— 段落与格式装配层，
  本轮首次拿到它们的端到端占比（之前的剖析口径太窄，看不到它们）。
- **已被证伪、不要再动**：
  - 把 `decodeRangeWithoutGuard` 换成「原生解码 + 原生正则过滤」（函数级 1.47x，**端到端 −7 %**）；
  - 压缩分支换 `windows-1252` 原生解码（**0.45x**）；
  - 去掉字符类里的代理项区间（**语义错误**）；
  - `TextDecoder('latin1')` 做字节→字符映射（**别名是 windows-1252，`btoa` 会抛异常**）；
  - 纯 JS base64 查表（**0.21x**）；
  - `decodeRangeWithoutGuard` 的判定 / 分配 / 访存三处微优化（合计约 1.1x）；
  - `extractTextWithFib`（2.5 %）、`splitPiecesByStory`、`extractChartsFromWordDocumentStream`。

---

## 清理的临时产物

`.bench103.ts`、`.bench103b.ts`、`.bench103c.ts`、`.bench103d.ts`、`.bench103e.ts`、
`.bench103f.ts`、`.bisect103.mjs`、`.e2e103.ts`、`.neg103.mjs`、`.neg103b.mjs`、
`.prof103.ts`、`.prof103/`、`.profan103.mjs`、`.profdiff103.mjs`（14 项）。

其中两个值得留在记录里：

- **`.bisect103.mjs`** 是这一轮唯一被「复用价值」验证过的工具——它把新路径拆成
  「只解码」「解码 + 替换」两半分别计时，从而把 −7 % 定位到 `String.replace` 上。
  下一轮若再遇到「函数级赢、端到端输」，同一套二分可以照搬。
- **`.profdiff103.mjs`** 的第一版把 bundle 文件名也当成聚合键，导致前 25 名全是噪声
  （两个 bundle 叫 `e2e103-new.mjs` / `e2e103-old.mjs`，每一行都显示成 ±）。
  **按函数名聚合时不要带上 url。**
