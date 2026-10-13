# Round 165/1000 — 2026-10-13 — 采纳（`nextMagicOffset` 桶上二分 → 按 lead 分槽的顺序提示 + 有界线性前推）

> 结论：**技术采纳，版本 0.7.78 → 0.7.79，双包发布。** 27 份 `parseWithFormat` 16,247,039 字符逐字节一致（SHA-1 `8f127d0bdbb0a63718a5663f48d267972c753b0e`）。同进程配对端到端跑了**四组独立样本**（400 / 800 / 1200 / 800 确认复跑）：**medianRatio 四组全部 ≈0.976–0.977、胜率四组全部 > 68%**；合并 3200 对 **2243 胜 = 70.09%**（z≈22）。护栏 `tests/magicScanIndex.round165.test.ts` 22 项 + 五组离树负控（N1 9 项、N2 2 项、N3 4 项、N4 3 项、N5 1 项失败）。**≈2.3% 端到端，是自 Round 158（≈5.6%）与 Round 164（≈2.1%）之后又一个大收益轮次。**

## 前提与目标

post-164 HEAD 重建 bundle 重剖析（60 轮，**68.42 ms/轮**，load≈2.7）自耗前 8：

| 函数 | 自耗 |
|---|---|
| `createParagraphsWithRealFormats` | 14.22% |
| GC | 9.97% |
| `applyStructuralFormats`（真函数 + 类方法包装器） | 5.88% + 5.26% |
| `buildMagicScanIndex` | 5.53% |
| `decodeRangeWithoutGuard` | 4.30% |
| `mergeCharFormatForParagraph` | 4.18% |
| `bytesToBase64` | 3.53% |
| `extractFormattedText` | 3.47% |

Round 164 的「下一轮」方向里点名过 `mergeCharFormatForParagraph` 的二分游标；本轮先从**调用计数**入手，把「谁被真正高频调用」量清楚，再决定改哪里。

## 先量后改

### 1) 调用计数插桩（27 份 × 20 轮，patch 后跑真实 parse）

| 函数 | 次/轮 |
|---|---|
| `nextMagicOffset` | **57,189** |
| └ 其中 `0x50` 锚点 | **30,447** |
| └ 单份文档最大桶长 | **18,380** |
| 二分迭代（`log2(桶长)≈15` 折算） | **≈660,017** |

⇒ `nextMagicOffset` 每次在桶上做**一次全量二分**（`log2(桶长)` 步），单轮 ~66 万次迭代，是 `magicScanIndex` 侧最热的开销。

### 2) 被否决的方向（先测后否）

| 方向 | 结论 |
|---|---|
| `buildMagicScanIndex` 改 u32 一次读 4 字节 | 隔离 **1.37×**（更慢）—— 2 字节对查表的跳过快路径已近最优 |
| `buildMagicScanIndex` 位图（每字节 1 bit） | 隔离 **1.15×**（更慢）—— 位运算 + 掩码抵消了收益 |
| `buildMagicScanIndex` 三字节展开 | 隔离 **1.03×**（持平）—— 已是当前最优 |
| `bytesToBase64` 调块大小 | 330 次/轮、其中 85 次 > 2 KB；**0x800 已是最优**（R148 复核过 0x2000 更慢） |

### 3) 采纳方向的关键观察

**所有调用方都是「按 `from` 单调递增地枚举同一个桶」**：

- `chartParser` 的两个游标 `oleAt` / `zipAt` 各自只前进；
- `shapeParser` / `wordArtParser` / `equationParser` 的 `offset = next(..., offset + k)` 自推进。

于是**上一次二分的 `lo`（= 上次 target 的 lower bound）必然是本次 target 的 lower bound 的下界**（target 单调不减 ⇒ lower_bound 单调不减），可以从它继续，而不必每次从 0 开始。

> **必须按 lead（槽位）分槽**：`chartParser` 里两个游标**交错**调用 `nextMagicOffset`，共用单槽时每次换 lead 提示即失效，命中率只有 **88.8%**；按 lead 分槽后实测 **99.76%**，且其中 **99.6% 只前进 1 步**。

## 候选与等价性论证

```ts
const HINT_MAX_STEPS = 8
const hintBucket: Array<number[] | null> = new Array(MAGIC_LEAD_COUNT).fill(null)
const hintTarget: number[] = new Array(MAGIC_LEAD_COUNT).fill(-1)
const hintLo: number[] = new Array(MAGIC_LEAD_COUNT).fill(0)

// … 在 nextMagicOffset 内：
const si = slot - 1
const bucket = index.buckets[si]
let lo = 0
if (bucket === hintBucket[si] && target >= hintTarget[si]) lo = hintLo[si]   // 提示只抬高起点
const scanLimit = lo + HINT_MAX_STEPS
while (lo < bucket.length && bucket[lo] < target && lo < scanLimit) lo++      // 有界线性前推
if (lo < bucket.length && bucket[lo] >= target) { /* 写回 */ return bucket[lo] }
/* 否则从 lo 起全量二分（写回） */
```

**等价性（提示自证，不依赖调用方守序）**：提示只可能**抬高**二分起点，而起点合法性由守卫本身保证 —— `hintLo` 是上次 target 的 lower bound，故对一切 `i < hintLo` 有 `bucket[i] < 上次 target <= target`，即 `i < 起点` 都不满足 `bucket[i] >= target`，起点仍是合法下界。**守卫不成立时起点退回 0，与旧实现逐字节相同；即使某个调用方乱序调用，也只会退回全量二分，绝不会算错。** 有界线性前推同理：只在确认 `bucket[lo] < target` 时才前进，退出时 `lo` 仍是合法下界（命中则直接返回 lower bound）。桶在构造后不再变更，故「同一桶对象」即「同一内容」；跨文档换桶时身份不同，提示自动失效。

**为什么用「桶对象身份」而非「桶长度 / 内容哈希」作守卫**：桶数组由 `buildMagicScanIndex` 一次性产出、此后只读，身份比较是 O(1) 且零歧义；长度会撞（同长不同内容），内容哈希是 O(n) 反而更贵。

## 隔离基准（真实调用序列回放，R161 纪律）

回放真实 **57,189 次调用序列 + 27 份真实桶**（同进程交错取中位）：

| 变体 | 结果 | 二分迭代 | 墙钟 |
|---|---|---|---|
| v0 = 现状（每次全量二分） | 逐项相同 | 660,017 | 42–45 ms |
| **v1 = 按 lead 分槽的顺序提示 + 有界线性前推** | **逐项相同** | **0** | **16.6 ms（2.6×）** |

容量上限扫描：`HINT_MAX_STEPS ∈ {2, 4, 8, 16}` 结果**全部等价**、比值 **0.37–0.39**；取 **8**（在「足够覆盖 1 步前进」与「越界时尽快退化」之间留余量）。

## 等价性（逐字节）

- 27 份 `parseWithFormat` 结果序列化后 **`cmp` 逐字节一致**，16,247,039 字符，SHA-1 双方均 `8f127d0bdbb0a63718a5663f48d267972c753b0e`（dump 16,261,351 字节）。
- **实现标记核对**（陷阱 B）：基线 bundle `HINT_MAX_STEPS` 0 / `hintBucket` 0 / `hintTarget` 0 / `hintLo` 0；候选 **2 / 4 / 4 / 4** ⇒ 确认两侧装的确实是不同实现。
- **构建确定性双向核对**：用**最终源码**重建候选 bundle == 跑性能证据的候选 bundle（`cmp` 逐字节相同，**320,966 B**）；基线 320,337 B。
- **既有差分 oracle 全部通过（独立佐证）**：`tests/magicScanIndex.test.ts` **46 项全过**（该文件是 R142 引入本模块时写下的桶上二分 oracle，内含真实语料与穷举），等于对本次改动做了一次独立差分复核。

## 性能证据（同进程配对端到端，正反交错）

`r149-paired.mjs`，基线/候选同进程交替、逐对记录差值：

| 样本 | 对数 | **medianRatio** | meanRatio | **胜率** |
|---|---|---|---|---|
| 1 | 400 | **0.97724** | — | **≈69.5%** |
| 2 | 800 | **0.97623** | — | **≈71.63%** |
| 3 | 1200 | **0.97742** | — | **≈70.17%** |
| 4（最终源码确认复跑） | 800 | **0.97643** | 0.98659 | **550/800 = 68.75%** |
| **合并** | **3200** | ≈ **0.9769** | — | **2243/3200 = 70.09%** |

**判读**：

- **medianRatio 四组全部 ≈0.976–0.977、胜率四组全部 > 68%**，方向完全一致，无 400→800 符号翻转；合并 70.09% ⇒ z≈22（p≪1e-100）。
- 量级 **≈2.3%**，是 R156/157/158/160/161/162/163/164 序列里仅次于 R158（5.6%）的第二大收益；机制同类（**砍真实工作：把 ~66 万次二分迭代降到 ~0**）。
- 与隔离折算的差距（隔离 2.6× 对应函数自耗的更大占比）说明：剖析里「二分那三行 1.4%」只计了 `while` 行本身，未计循环比较/边界与提示簿记；真实收益比单行自耗更大。

## 护栏（`tests/magicScanIndex.round165.test.ts`，22 项）

- **A 组（差分：生产 ≡ 改动前逐行转写 `refNextMagicOffset`）**：
  - A1 对抗流（长度 0/1、锚点铺满、锚点只在首/末、交替锚点）上**穷举 `from ∈ [-3, len+2] × 5 个锚点`**；
  - A2 真实 27 份 WordDocument 流按 `from` 单调枚举，**返回序列必须逐项等于桶本身**，且总命中数 > 50,000（非空转）；
  - A3 **乱序访问**：回退式 `from` / 跨索引对象 / 跨文档 / 负值·NaN·非整数（500 步 × 30+ 流随机）；
  - A4 跨桶回退（先深部搜索再回 0，必须回到首个锚点）；A5 穷尽枚举后（`hintLo == bucket.length`）再从 0 搜索；A6 同一调用重复执行幂等。
- **B 组（绝对锚点，防「两路同时冻结」的零鉴别力）**：B1 五个锚点各自首个命中位置；B2 `from` 越过唯一命中 → -1；B3 精确命中；B4 非整数**向零截断**（不是 floor）；B5 NaN → 0；B6 负数相对流末尾；B7 非锚点/越界 lead、索引不属于该流 → 退回原生 `indexOf`；B8 第二个索引对象结果一致。
- **C 组（骨架负控，证明本文件有鉴别力）**：`makeSkeleton('ok'|'noBackGuard'|'noBucketGuard'|'capAsAnswer')` 与实现同形、各去掉一处守卫。C1 正控与 oracle 一致；**C2 缺回退守卫**在回退式 `from` 上可辨；**C3 缺桶身份守卫**在跨文档同 lead 上可辨（见下）；C4 把「到上限」当成「已命中」可辨。
- **D 组（接线元断言，源码文本）**：D1 常量与三个分槽状态数组；D2 守卫与新起点计算；D3 两条返回路径写回**恰为 2**；D4 `const si = slot - 1` 存在且 `index.buckets[slot - 1]` 已消失。

> **C3 的坑（本轮教训）**：负控必须让**桶身份守卫是唯一阻止错答的东西**。初版 C3 第二次调用传 `target=0`，`0 >= hT(=5)` 为假 ⇒ 提示被**回退守卫**拦下、桶身份守卫根本没被用到，骨架于是返回了正确答案（负控漏检）。修正为：先在 A 上以 `target=8` 把 `hT` 压到 8、`hL` 压到 2，再对**另一个桶** B（`[10,20]`）用**同一个 `target=8`**（`8 >= 8` 通过回退守卫）——此时 B 的正确 lower bound 是索引 0，而陈旧 `hL=2` 会返回 −1，桶身份守卫成为唯一防线。

## 离树负控（注入生产源码，跑完即还原）

**还原用 `cp` 回写而非 `git checkout`**（Round 161 陷阱 E 的教训）。

| 注入 | 失败项数 |
|---|---|
| N1 去掉回退守卫（`target >= hintTarget`） | **9 failed** |
| N2 去掉桶身份守卫（`bucket === hintBucket`） | **2 failed** |
| N3 把「到上限」当成「已命中」 | **4 failed** |
| N4 **整体回退为旧二分实现** —— **行为完全等价** | **3 failed**（仅 D2/D3/D4 元断言） |
| N5 **保留形状但删除两处写回** —— **行为完全等价** | **1 failed**（仅 D3 元断言） |

五组注入后源码 sha256 恢复为 `196e79867103738f1e6cb51bc747d3459df060c9acc736f4bfb9eb38d935c3bc`（与注入前一致），护栏复跑 22/22。

> **N4/N5 是本轮方法论要点（延续 R164 通用教训 10）**：把代码改回**行为等价**的旧写法（或保留形状但断开写回），任何「比输出」的测试都抓不住 —— **只有源码文本元断言能抓**。N4 由 D2/D3/D4 三重抓到，N5 只由 D3（写回计数恰为 2）抓到，再次印证「行为保持型改动，元断言不可省」。

## 门禁与产物

- `npm test`：**1851 / 1851 通过（94 文件）**（R164 为 1829/93；+22 = 本轮新护栏，+1 文件）。test 与 lint **串行**执行。
- `vue-tsc --noEmit`：exit 0。`eslint .`：exit 0。
- `npm run build`：`dist/assets/main-BI9F7ZtI.js` 322.65 kB / gzip 111.21 kB。
- `npm run build:lib`：`dist-lib/doc-preview.js` **369,944 → 370,284 字节（+340 B）**、`dist-lib/doc-preview.umd.cjs` **274,684 → 274,937 字节（+253 B）**（vite 报 gzip 98.30 kB）。
- `node bench-diff.mjs 165`：**cycle-165 与 cycle-164 除 `cycle`/`timestamp` 外 12 个字段全部逐字段相同**，`median` 均 `0.9502433994244857`，`parseSuccess` 27/27。
- **包体记账**：未压缩 esbuild bundle **320,337 → 320,966（+629 B）**（含模块顶部大段说明注释）；压缩后 dist-lib **+340 B / umd.cjs +253 B**。相对 **≈2.3% 的实测运行时收益**，这个增量可忽略。

## 下一轮

Round 165 吃掉了 `magicScanIndex` 的桶查询开销。Round 165 之后候选方向：

1. `createParagraphsWithRealFormats` 自身 14.22%（仍是最大自耗）；行级里 `mergeCharFormatForParagraph` 调用、`{...newPara.charFormat, ...merged}` 展开、`includes('\f')`；
2. `mergeCharFormatForParagraph` 4.18%（33,702 次/轮，R156 判「成本在调用 + 二分非分配」）——**其 papx 二分同样可改为随 `cpStart` 单调推进的游标**（与本轮同构！段落按文档序处理 ⇒ `lo` 单调不减），需先证调用序单调；
3. `applyStructuralFormats` 的预清洗 `includes('HYPERLINK')` 与 `OTHER_FIELD_CODE_TEST_RE`（R159 已否决「超集门」，但可考虑按文档级一次性门控）；
4. FKP 解析链合计约 11.5%（`parsePapxGrpprl` 39,909 次/轮、`parseChpxGrpprlWithFont` 27,989 次/轮），尚未被任何一轮触及。

目标 1000 轮。
