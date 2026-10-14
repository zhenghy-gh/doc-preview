# Round 167/1000 — 2026-10-14 — 采纳（FKP 运行构造：`pieces` 全量扫描 → 单调游标；并**发现并修正**一个 NaN 等价性缺陷）——版本 0.7.80 → 0.7.81

> 结论：**技术采纳，版本 0.7.80 → 0.7.81，双包发布。** 27 份 `parseWithFormat` 16,247,039 字符逐字节一致（SHA-1 `8f127d0bdbb0a63718a5663f48d267972c753b0e`）。同进程配对端到端共跑**七组样本**（400/800/1200/1200/800 预修正 + **最终源码** 1200/800）：**medianRatio 全部 ≈0.977–0.992、胜率全部 56.6–63.5%**；**合并 6400 对 3727 胜 = 58.2%（z≈13.2）**，最终源码两组 1184/2000 = **59.2%**。护栏 `tests/formatParser.round167.test.ts` **20 项** + 六组离树负控全部按预期（N1 4 项、N2 6 项、N3 1 项失败；N4 行为保持型按预期通过；N5/N6 仅 D 组元断言抓到）。**本轮在写护栏时发现并修正了一个此前潜伏的等价性缺陷**（`NaN` 掩盖 `fcStart` 降序导致早停误跳）——见下「附带修正」。
>
> 本轮的定位：R166「下一轮」第 5 条明确点名「FKP 解析链合计约 9%（`parseChpxGrpprlWithFont` 2.77% + `parsePapxGrpprl` 2.19% + `parseChpxRunsFromFkp` 2.06% + `parsePapxRunsFromFkp` 1.94%），尚未被任何一轮触及」。

## 前提与目标

post-166 HEAD 重建 bundle 重剖析（60 轮，**70.48 ms/轮**，load≈2.7）自耗前 10：

| 函数 | 自耗 |
|---|---|
| `createParagraphsWithRealFormats` | 12.05%（inclusive 27.96%） |
| GC | 10.83% |
| `applyStructuralFormats`（真函数 + 类方法包装器） | 11.77%（两处；直接计时 **9.8 ms/轮 = 14.0% wall**） |
| `buildMagicScanIndex` | 6.70% |
| FKP 链合计 | ≈9.3% |
| `decodeRangeWithoutGuard` | — |
| `mergeCharFormatForParagraph` | —（R166 已优化） |

**先排除了几个方向**（避免重复劳动）：`buildMagicScanIndex`（R142/143/145 已调至近最优）、`bytesToBase64`（仅 66 次/轮，R148 已调）、`decode`（MiniFAT 遍历）、`applyStructuralFormats`（R157/159/160 已重调；**实测无 O(n²)**——仅 25 次空段插入、0 次 step-4 插入，各阶段摊薄，最大 `P7_step3body` 仅 4.27ms）。⇒ 回到 R166 点名的 FKP 链。

## 先量后改

### 1) 调用计数插桩（27 份 × 20 轮，patch 后跑真实 parse）

| 项 | 次/轮 | 内层迭代/轮 | 真正相交/轮 | 空转 |
|---|---|---|---|---|
| CHPX（22 次调用/轮） | — | **195,227** | **26,651** | — |
| PAPX（27 次调用/轮） | — | **248,540** | **39,657** | — |
| **合计** | **49 次** | **443,767** | **66,308** | **85.1%** |

### 2) 采纳方向的三个前提（真实调用序列回放实测）

- **(a) `pieces` 按 `fcStart` 升序**：22 次调用 119 个 piece **0 次逆序**，单次最多 **33 个** piece。
- **(b) 同一次调用内条目 `fcStart` 单调不减**：**0 次回退**。
- **(c) 每个相交条目恰好命中 1 个 piece**（因为 piece 的 fc 区间互不相交，而 FKP 条目的 fc 区间也不重叠）。

⇒ 与 `[fcStart, fcEnd)` 相交的 piece 构成**一段连续区间**，其起点随 `fcStart` **单调后移** ⇒ 可维护一个只前进的游标，且可用 `p.fcStart >= fcEnd` 早停。

## 候选与等价性论证

### 候选（`src/utils/formatParser.ts`，两个构造函数同形）

```ts
function isAscendingByFcStart(pieces: readonly PieceFcRange[]): boolean {
  for (let z = 1; z < pieces.length; z++) {
    if (!(pieces[z].fcStart >= pieces[z - 1].fcStart)) return false   // ← 取反式，NaN ⇒ 非升序
  }
  return true
}

// parseChpxRunsFromFkp / parsePapxRunsFromFkp 内（各一份）：
const piecesAscending = isAscendingByFcStart(pieces)
let pieceCursor = 0
let pieceCursorFc = -1
// … 每个 FKP 条目：
let pi0 = 0
if (piecesAscending) {
  if (fcStart < pieceCursorFc) pieceCursor = 0        // 回退重置守卫
  pieceCursorFc = fcStart
  while (pieceCursor < pieces.length) {
    const pc = pieces[pieceCursor]
    if (pc.fcStart + (pc.cpEnd - pc.cpStart) * (pc.compressed ? 1 : 2) > fcStart) break
    pieceCursor++                                     // pieceFcEnd <= fcStart ⇒ 永不再相交，永久跳过
  }
  pi0 = pieceCursor
}
for (let pi = pi0; pi < pieces.length; pi++) {
  const p = pieces[pi]
  if (piecesAscending && p.fcStart >= fcEnd) break    // 早停（升序才合法）
  /* … 与原实现逐字相同的内层体 … */
}
```

**等价性（对任意输入逐字节等价）**：被跳过的两类 piece 在原实现里都必然命中 `if (e <= s) continue` ——
- 第一类（游标跳过）：`e = min(fcEnd, pieceFcEnd) <= pieceFcEnd <= fcStart <= s`；
- 第二类（早停跳过）：`s = max(fcStart, p.fcStart) >= p.fcStart >= fcEnd >= e`。

故保留区间的**执行集合与执行顺序完全一致**，`runs` 逐元素相同。两个前提**在运行时显式校验**，任一不成立即退回原实现（起点 0、不 `break`），与旧实现逐字节相同。

## 附带修正：`NaN` 掩盖降序（本轮写护栏时发现）

初版判据写的是 `if (pieces[z].fcStart < pieces[z - 1].fcStart) return false`。**`NaN` 与任何数比较恒为 false**，于是 `[1005, NaN, 990]` 被判成「升序」⇒ 错误启用 `break` ⇒ 在 `p.fcStart = 1005 >= fcEnd` 处提前停止，**丢掉后方仍相交的 piece（990 起点）**。

复现（`[1000,1002)`）：

| 路径 | 输出 |
|---|---|
| 改动前 oracle（全量扫描） | `[[30,32]]` |
| 误判升序（旧判据） | `[]` ← **不一致** |
| 取反式判据（修正后） | 判非升序 ⇒ 退回全量扫描 ⇒ `[[30,32]]` |

修正：判据改为 `if (!(pieces[z].fcStart >= pieces[z - 1].fcStart)) return false` —— 任一侧出现 `NaN` 立即返回 false，等价性由此自证；`±Infinity` 按普通大小参与比较（`[1005, Infinity, 990]` 中 `990 >= Infinity` 为 false ⇒ 正确判非升序）。

> **为什么 R131/R132 的常驻 NaN 护栏没抓到**：它们的 NaN 用例里所有 piece 的 `fcStart` 都相等（1001），**没有可被掩盖的降序**。这说明「随机模糊」比「定点对抗」更容易命中等价性漏洞——本轮 A5 组的 1200 组随机用例正是为此。
>
> 该修正**不改真实语料行为**（语料无 NaN），且 `!(a>=b)` 与 `a<b` 在无 NaN 时分支结果相同 ⇒ 此前 4400 对的端到端结论仍然有效；修正后仍在**最终源码**上重跑了两组端到端确认。

## 隔离基准（真实调用序列回放）

回放真实 49 次调用（chpx=22 / papx=27）的真实 `pieces` 与 FKP：

| 变体 | 结果 | 墙钟 |
|---|---|---|
| v0 = 现状（每条目全量扫 pieces） | 逐项相同 | **8.371 ms** |
| **v1 = 单调游标 + 早停** | **逐项相同** | **6.956 ms（0.8309，1.20×）** |

胜 **40/40**，输出逐项一致。⇒ 隔离收益约 1.20×（低于 R166 的 2.22×/5.15×，因为省下的是「一次比较 + 一次加法」而非「一次二分迭代」；但绝对迭代数 443,767 → ≈66,308 很可观）。

## 等价性（逐字节）

- 27 份 `parseWithFormat` 结果序列化后 **`cmp` 逐字节一致**，16,247,039 字符，SHA-1 双方均 `8f127d0bdbb0a63718a5663f48d267972c753b0e`（dump 16,261,351 字节）。**修正前/后两次 dump 均与此一致。**
- **实现标记核对**（陷阱 B）：基线 bundle `isAscendingByFcStart`/`piecesAscending`/`pieceCursorFc`/`pi0` 计数 **0/0/0/0**；候选 **5/6/6/6** ⇒ 确认两侧装的确实是不同实现。
- **构建确定性核对**：用**最终源码**（含 NaN 修正）重建候选 bundle == 跑最终端到端证据的候选 bundle（**323,602 B**）；预修正候选 323,598 B；基线 322,170 B。
- **既有差分 oracle 全部通过（独立佐证）**：`tests/formatParser.test.ts` **137 项全过**（含 R131/132 的 FKP oracle 与 R132 的「跳过稳定 sort」契约），等于对本次改动做了一次独立差分复核。

## 性能证据（同进程配对端到端，正反交错）

`r149-paired.mjs`，基线/候选同进程交替、逐对记录差值：

| 样本 | 对数 | bundle | **medianRatio** | meanRatio | **胜率** |
|---|---|---|---|---|---|
| 1 | 400 | 预修正 | **0.97670** | 0.98743 | **254/400 = 63.5%** |
| 2 | 800 | 预修正 | **0.98795** | 0.99533 | **453/800 = 56.63%** |
| 3 | 1200 | 预修正 | **0.98929** | 0.99288 | **690/1200 = 57.5%** |
| 4 | 1200 | 预修正（确认） | **0.99151** | 1.00598 | **686/1200 = 57.17%** |
| 5 | 800 | 预修正（确认） | **0.98973** | 0.99643 | **460/800 = 57.5%** |
| 6 | 1200 | **最终源码** | **0.98684** | 0.99525 | **718/1200 = 59.83%** |
| 7 | 800 | **最终源码** | **0.98912** | 0.99692 | **466/800 = 58.25%** |
| **合并（全部 7 组）** | **6400** | — | ≈ **0.987** | — | **3727/6400 = 58.23%** |
| **合并（最终源码 6+7）** | **2000** | — | ≈ **0.988** | — | **1184/2000 = 59.2%** |

**判读**：

- **medianRatio 七组全部 ≈0.977–0.992**，方向完全一致，无符号翻转；胜率七组全部 ≥56.6%（均高于 ~54% 噪声地板）。
- **全部七组合并 58.23%** ⇒ z≈13.2（p≪1e-40）；**最终源码两组合并 59.2%** ⇒ z≈8.2。
- 量级 **≈1–2%**，机制同类（**砍真实工作：把 44.4 万次内层迭代降到 6.6 万**）。较 R165/R166（≈2.3%/≈2%）略弱：隔离仅 1.20×（省的是单次比较而非二分迭代），但 FKP 链占比高（≈9.3%）。
- **无并发污染**：本轮全部七组均在「不并发编译/跑测试/dump」的前提下串行执行（load 4.5–6.3 属机器背景负载，非本项目引起；同进程配对法本身抑制系统负载噪声）。

## 护栏（`tests/formatParser.round167.test.ts`，20 项）

- **A 组（差分：生产 ≡ 改动前逐行转写 `round167OldParseChpxRunsFromFkp` / `round167OldParsePapxRunsFromFkp`）**：
  - A1 真实 27 份两种 FKP 逐项一致，**计数锚定 chpx=26698 / papx=39657**（直接调用口径，含 DocParser 快速路径未调用的 47 条 CHPX）；
  - A2 **NaN 掩盖降序回归**（本轮修正的直接钉子，chpx/papx 各一）：断言输出为 `[[30,32]]`；
  - A3 乱序 / 完全反序 / 跨 run 回退 / 同 cpStart tie 保持稳定序；
  - A4 空 piece / UTF16 奇数起止 / ±Infinity pieces；
  - **A5 随机模糊 1200 组**（确定性 LCG；乱序 + 特值 + 多 run，覆盖 piece 数 0–6、run 数 1–4）；
  - A6 跨调用反映可变 piece 内容且不改动输入。
- **C 组（骨架负控，证明本文件有鉴别力）**：`round167CursorScan(fcRanges, pieces, mode)` 与实现同形、可逐一注错。C1 正控与 naive 一致（含 600 组随机 + 单调）；C2 缺升序守卫可辨；C3 缺回退重置可辨；C4 前进条件写错可辨；**C5 行为保持型回退（去掉 break）仍与 naive 相同**（用于说明元断言不可省）。
- **D 组（接线元断言，源码文本）**：D1 升序判据为**取反式**且只定义一次（旧写法必须消失）；D2 两处游标状态与启用判据；D3 回退重置守卫与游标前进恰各两次；D4 内层早停 break 与游标起点恰各两次、**旧全量扫描 `for (const p of pieces)` 已消失**；D5 **Round 132 契约保持**（稳定 `sort` 未被跳过、无 `sortRunsIfNeeded` 残留）。

## 离树负控（注入生产源码，跑完即还原）

**还原用 `cp` 回写而非 `git checkout`**（Round 161 陷阱 E 的教训）。

| 注入 | 性质 | 结果 |
|---|---|---|
| N1 回退 NaN 修正（升序判据改回 `a < b`） | 行为改变型 | **FAIL，4 项**（A2×2 + D1） |
| N2 去掉升序守卫（break 恒启用） | 行为改变型 | **FAIL，6 项** |
| N3 去掉回退重置守卫 | 行为改变型 | **FAIL，1 项**（A3） |
| N4 **禁用游标**（`if (piecesAscending)` → `if (false)`） | 行为保持型 | **PASS**（输出不变，仅变慢） |
| N5 **去掉 break** | 行为保持型 | **FAIL，1 项**（仅 D4 元断言） |
| N6 **整段退回旧全量扫描** | 行为保持型 | **FAIL，1 项**（仅 D4 元断言） |

六组注入后源码 sha256 恢复 `2de5480e9a35e9d002435e91acd0e853a731b1a2453b8310ad32c8df5685946e`（与注入前一致），护栏复跑 20/20。

> **N4/N5/N6 延续 R164 通用教训 10**：把代码改回**行为等价**的旧写法，任何「比输出」的测试都抓不住 —— **只有源码文本元断言能抓**。N4 连元断言都没变化（游标状态仍存在），故**按预期通过**——它是「行为保持型回退零鉴别力」的正向证明；N5/N6 由 D4 抓到。

## 门禁与产物

- `npm test`：**1893 / 1893 通过（96 文件）**（R166 为 1873/95；+20 = 本轮新护栏，+1 文件）。test 与 lint **串行**执行。
- `vue-tsc --noEmit`：exit 0。`eslint .`：exit 0。
- `npm run build`：`dist/assets/main-CY8ob9u2.js` 323.58 kB / gzip 111.62 kB；worker 133.04 kB；css 45.47 kB。
- `npm run build:lib`：`dist-lib/doc-preview.js` **370,845 → 371,729 字节（+884 B）**、`dist-lib/doc-preview.umd.cjs` **275,358 → 275,851 字节（+493 B）**（vite 报 gzip 98.71 kB / 84.85 kB）。
- `node bench-diff.mjs 167`：**cycle-167 与 cycle-166 除 `cycle`/`timestamp` 外 12 个字段全部逐字段相同**，`median` 均 `0.9502433994244857`，`parseSuccess` 27/27。
- **包体记账**：未压缩 esbuild bundle **322,170 → 323,602（+1,432 B）**（含模块顶部大段说明注释与 `isAscendingByFcStart` 辅助函数）；压缩后 dist-lib **+884 B / umd.cjs +493 B**。相对**≈1–2% 的实测运行时收益**，这个增量可忽略。

## 下一轮

Round 167 吃掉了 FKP 运行构造的内层扫描。候选方向：

1. `createParagraphsWithRealFormats` 自身 12.05%（仍是最大自耗，inclusive 27.96%）；
2. `applyStructuralFormats` 合计 11.77%（R157/159/160 已重调；实测无 O(n²)，需换角度）；
3. `buildMagicScanIndex` 6.70%（R142/143/145 已判 u32/位图/三字节展开均无益）；
4. `parseChpxGrpprlWithFont` 2.77% + `parsePapxGrpprl` 2.19%（sprm 解析本体，尚未触及）；
5. `decodeRangeWithoutGuard`（MiniFAT 遍历）。

目标 1000 轮。
