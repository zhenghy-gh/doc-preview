# Round 162/1000 — 2026-10-13 — 采纳（OLE FAT/MiniFAT 链遍历循环检测：`Set` → 共享世代戳位图）

> 结论：**技术采纳，版本 0.7.75 → 0.7.76，双包发布。** 27 份 `parseWithFormat` 16,247,039 字符逐字节一致（SHA-1 `8f127d0bdbb0a63718a5663f48d267972c753b0e`）。同进程配对端到端跑了**四组独立样本**（400 / 800 / 1200 / 1200 对）：**medianRatio 四组全部 < 1（0.99231 / 0.98849 / 0.99438 / 0.98959）、胜率四组全部 > 57%（57.75 / 62.25 / 57.25 / 62.25 %）**；合并 3600 对 **2163 胜 = 60.08%**（z≈12.1，p≈1e-33），合并 meanRatio **0.99757**。护栏 `tests/oleParser.round162.test.ts` 12 项 + 四组离树负控（N1 6 项、N2 4 项、N3 7 项、N4 2 项失败）。**未压缩 bundle 反而小 692 字节**。

## 前提与目标

Round 161 的「否决备记 B」留下了一条精确线索：把 OLE 的 6 处链遍历循环检测**整体删除**的天花板探针给出 400 对 **0.9883 / 胜 61.0%**，说明该空间上限约 0.5–1.2%；但同一轮的「`Set` → 每次 `new Uint8Array(fat.length)` 位图」候选端到端为**中性**（800 对 0.99849 / 胜 51.6%）。当时给出的解释是：**位图方案只是把「分配 + 哈希」换成「分配 + 下标读写」，分配成本抵消了哈希节省**。

本轮就是去吃掉这部分上限：**同时消掉分配与哈希**。

## 先量后改

### 1) 真实操作数（沿用 Round 161 插桩）

`visited` 操作 **48,652 次/轮**（24,326 `has` + 24,326 `add`）⇒ 链遍历**迭代 12,163 次/轮**。按站点：`readRegularStream` 19,169（78.8%）、`resolveStyleFormat` 4,963（20.4%）、`readMiniStream` 99、`getDirectorySectors` 86、`getMiniFatSectors` 10。

### 2) 隔离基准（三档对照，同进程交错 200 次取中位）

每轮 1,153 次链遍历（含分配）、每次链长 18 扇区：

| 实现 | ms/轮 | 比值 |
|---|---|---|
| `Set<number>`（旧） | 0.4895 | 1.0000 |
| `Uint8Array` 位图（R161 已否决） | 0.2930 | 0.5987 |
| **共享世代戳位图（本轮采纳）** | **0.0803** | **0.1640** |

即世代戳比 `Set` 快 **6.1×**，而 R161 那个被否决的位图只快 1.7×——**这正好复现了 R161 的结论**：位图省了哈希却仍要分配，世代戳两者都省。

> **口径提醒**：该隔离基准每轮 20,754 次迭代，比真实值（12,163）高 1.7×。按真实迭代数折算，隔离节省约 **0.24 ms/轮 ≈ 0.34%**——**低于端到端噪声量级**，所以本轮定值只能靠配对端到端（下节），隔离值仅用于确认方向。

### 3) 机制

```ts
let visitStamps = new Uint32Array(0)
let visitEpoch = 0

function beginVisit(size: number): number {
  if (visitStamps.length < size) {           // 只在需要时增长一次，之后长期复用
    let n = visitStamps.length > 0 ? visitStamps.length : 1024
    while (n < size) n *= 2
    visitStamps = new Uint32Array(n)
    visitEpoch = 0
  }
  if (visitEpoch >= 0xffffffff) {            // 世代号回绕保护
    visitStamps.fill(0)
    visitEpoch = 0
  }
  return ++visitEpoch                        // 恒 ≥ 1，绝不与「零值数组 = 未访问」的 0 相撞
}
```

每个循环开头取一次世代号并快照数组：

```ts
const epoch = beginVisit(fat.length)
const stamps = visitStamps
...
if (stamps[currentSector] === epoch) { logger.warn(`…检测到循环…`); break }
stamps[currentSector] = epoch
```

- **不需要清零**：上一次调用留下的戳记是**更小的世代号**，与本调用不同即视为未访问。
- **不需要分配**：数组只在首次需要时增长一次。
- **快照数组**（`const stamps = visitStamps`）使「中途扩容」也不会让本循环换到另一张表；即便将来出现嵌套调用，外层仍用自己那张表，判据不受影响。

### 4) 等价性前提：只有下标有上界的 4 处能换

下面 4 处的循环守卫都含 `currentSector < fat.length`（或 `< miniFat.length`），故下标恒落在 `[0, size)`，位图必然覆盖：

| 站点 | 守卫上界 |
|---|---|
| `getDirectorySectors` | `currentSector < fat.length` |
| `readRegularStream` | `currentSector < fat.length` |
| `getMiniFatSectors` | `currentSector < fat.length` |
| `readMiniStream` | `currentMiniSector < miniFat.length` |

**另外三处一律保留 `Set`**（已写入源码注释与护栏 D2/D3 钉死）：

- `_getExtendedDifat`：`currentSector` 只校验 `< 0 / === FREESECT / === ENDOFCHAIN`，**没有上界**。位图下标越界时 TypedArray 写入是**静默 no-op**、读出 `undefined`，会退化成「不做循环检测」（虽然仍会被随后的 `sectorToOffset` 越界检查兜住，但会换成另一条 warn 文案——属可观察行为变化）。
- `_normalizeDifat`：`sector` 来自 DIFAT 原始值，同样无上界。
- `styleParser.resolveStyleFormat`：键是 `istd`，为其建位图不划算（且 R161 已实测该处改为 `chain.some` 为中性）。

### 5) 内存

数组容量按 `size` 向上取 2 的幂，与 FAT 条目数同量级（≈ 文件大小/扇区大小的 4 倍字节），**一次性常驻复用**。调用方本就持有整个文件缓冲，占比可忽略；换来的是每轮少 12,163 次哈希查找与约 1,153 次 `Set` 分配。

## 候选实现（`src/utils/oleParser.ts`）

新增模块级 `visitStamps` / `visitEpoch` / `beginVisit`；4 处链遍历的 `const visited = new Set<number>()` → `const epoch = beginVisit(…); const stamps = visitStamps`，`visited.has(x)` → `stamps[x] === epoch`，`visited.add(x)` → `stamps[x] = epoch`。日志文案、`break` 位置、`maxIterations` 兜底全部不动。

## 被否决 / 未采用的候选（备记）

- **`Uint8Array(fat.length)` 位图**：R161 已否决（800 对 0.99849 / 胜 51.6%，中性）。本轮隔离复现其「省哈希但没省分配」的本质（0.5987 vs 世代戳 0.1640）。
- **`resolveStyleFormat` 改 `chain.some`**：R161 已否决（同一轮合并候选的一部分），本轮不重复。
- **删掉循环检测（天花板探针）**：行为改变，不可采纳；仅作上限诊断（R161：0.9883 / 胜 61.0%）。

## 等价性（逐字节）

- 27 份 `parseWithFormat` 结果序列化后 **`cmp` 逐字节一致**，16,247,039 字符，SHA-1 双方均 `8f127d0bdbb0a63718a5663f48d267972c753b0e`。
- **实现标记核对**（陷阱 B）：基线 bundle `beginVisit` 0 次 / `new Set` 15 次；候选 bundle `beginVisit` 6 次 / `new Set` 11 次 ⇒ 确认两侧装的确实是不同实现。
- **构建确定性双向核对**：① 用最终源码重建候选 bundle == 跑性能证据的候选 bundle；② 用 `git worktree`（detached HEAD `70e3e7c`）重建的基线 bundle == 跑性能证据的基线 bundle `/tmp/r162-head.mjs`（构建时**传绝对入口**，规避陷阱 A）。两者均逐字节相同。
- 包体：未压缩 esbuild bundle **320,427 → 319,735 字节（−692 B）**。

## 性能证据（同进程配对端到端，正反交错）

`r149-paired.mjs`，基线/候选同进程交替、逐对记录差值。本轮跑了**四组独立样本**（因为 400 对单独看信号混杂，故加测）：

| 样本 | 对数 | baseMedian | candMedian | medianDiff | **medianRatio** | meanRatio | **胜率** |
|---|---|---|---|---|---|---|---|
| 1 | 400 | 73.523 | 73.324 | −0.536 ms | **0.99231** | 1.00208 | **231/400 = 57.75%** |
| 2 | 800 | 70.798 | 70.465 | −0.814 ms | **0.98849** | 0.99372 | **498/800 = 62.25%** |
| 3 | 1200 | 69.911 | 69.864 | −0.388 ms | **0.99438** | 1.00107 | **687/1200 = 57.25%** |
| 4 | 1200 | 69.596 | 69.027 | −0.722 ms | **0.98959** | 0.99514 | **747/1200 = 62.25%** |
| **合并** | **3600** | — | — | — | ≈ 0.9912 | **0.99757** | **2163/3600 = 60.08%** |

**判读**：
- **medianRatio 四组全部 < 1、胜率四组全部 > 57%**，方向完全一致，无 400→800 符号翻转。
- **meanRatio 四组里两组略 > 1（+0.21%、+0.11%）、两组 < 1（−0.63%、−0.49%）**——单看任一组都不可靠（这正是协议反复强调的噪声特征）。按对数加权合并后 meanRatio = **0.99757**（候选快 0.24%）。
- 胜率是最稳健的指标（配对符号检验）：合并 60.08% ⇒ z≈12.1、p≈1e-33，远超噪声地板（~54%）与阈值（57%）。
- 量级与 R148（采纳，胜 57.5% / 中位 +0.544%）相当；方向与 R156/157/158/160/161 同侧（都是**砍真实工作**：本轮少 12,163 次哈希查找 + 约 1,153 次分配）。
- 本轮**绝对值**小于 R161（中位 +1.85%），与隔离折算（≈0.34%）相符——**这是一个真实但很小的收益，记录时应按小收益对待**。

## 护栏（`tests/oleParser.round162.test.ts`，12 项）

本轮独有的、逐字节 dump **抓不到**的风险是「**世代号必须自增**」：共享位图从不清零，靠「上次调用的戳记 = 更小的世代号」区分已访问/未访问；若忘了自增，**第二次**调用会在链的首扇区就误判成循环——**单次调用完全看不出来**。因此 A 组必须**连续调用同一夹具并比较两次结果**。

- **A 组（跨调用隔离）**：A1 同一自环目录夹具连续解析 3 次，每次都必须读到恰好 1 条目录条目（若世代号未自增，第 2/3 次会变成 0）；A2 中间夹一次健康的多扇区目录链解析后再解析循环夹具，循环仍被检出；A3 目录链与流链两个站点共用同一张位图但互不串扰。
- **B 组（健康链不得误报）**：B1 8 扇区连续流链完整读出 4096 字节（不被残留戳记提前 break）；B2 多扇区目录链 9→10→11 两条条目都读到；B3 B1/B2 与循环夹具交替 5 轮，健康链始终走满。
- **C 组（骨架负控，证明 A/B 判据非空转）**：与生产同构的世代戳遍历骨架，`increment=false` 复刻「忘了自增」⇒ C2 第二次遍历退化为 0、C3 在健康长链上同样退化。骨架的世代号**从 1 起**（与 `beginVisit` 的 `++visitEpoch` 一致），否则会退化成「第一次就误判」，形状与真实缺陷不符。
- **D 组（接线元断言）**：D1 `const epoch = beginVisit(` 恰 4 处、`const stamps = visitStamps` 恰 4 处；D2 声明行 `const x = new Set<number>()` 恰 2 处（只数代码行，不数注释）；D3 `stamps[currentSector] === epoch` 3 处 + `stamps[currentMiniSector] === epoch` 1 处，残留 `visited.has/add` 与 `seen.has/add` 各 1 处。

夹具：自建最小 CFB 构造器 `buildOle()`（头 + FAT + 目录条目 + 扇区填充），四个夹具 F1 自环目录 / F2 自环流 / F3 健康 8 扇区流 / F4 健康多扇区目录。

**离树负控**（注入生产源码 `src/utils/oleParser.ts`，跑完即还原；**还原用 `cp` 回写而非 `git checkout`** —— Round 161 陷阱 E 的教训）：

| 注入 | 失败项数 |
|---|---|
| N1 `beginVisit` 恒返回 1（忘记自增） | **6 failed** / 6 passed |
| N2 删掉全部 4 处戳记写入（循环永不检出） | **4 failed** / 8 passed |
| N3 判据取反（`===` → `!==`，首扇区即误判） | **7 failed** / 5 passed |
| N4 局部回退：只把 `readMiniStream` 一处改回 `Set`（四处之一静默漏改） | **2 failed** / 10 passed |

四组注入后源码 sha256 恢复为 `3aec384b457ea48a365b5dc717e68e400342e0f0ff25a480b2e99d6b2d3da516`（与注入前一致），护栏复跑 12/12。**N4 只被 D1/D3 两项抓住**，说明「四处必须同时改」这条约束确实靠元断言兜住。

## 门禁与产物

- `npm test`：**1798 / 1798 通过（91 文件）**（R161 为 1786/90；+12 = 本轮新护栏，+1 文件）。test 与 lint **串行**执行。
- `vue-tsc --noEmit`：exit 0。`eslint .`：exit 0。
- `npm run build`：`dist/assets/main-DiY6MIxK.js` 322.25 kB / gzip 111.06 kB。
- `npm run build:lib`：**`dist-lib/doc-preview.js` 369,488 → 369,727 字节（+239 B）**、**`dist-lib/doc-preview.umd.cjs` 274,305 → 274,520 字节（+215 B）**（gzip 97.95 → 98.08 kB）；`style.css` 37.71 kB、`docParser.worker` 131.72 kB。
- `node bench-diff.mjs 162`：**cycle-162 与 cycle-161 除 `cycle`/`timestamp` 外 12 个字段全部逐字段相同**，`median` 均 `0.9502433994244857`，`parseSuccess` 27/27。

> **包体记账（须明说）**：未压缩 esbuild bundle **−692 B**（模块级状态 + 一个辅助函数，去掉了 4 处 `Set` 构造），但**压缩后的 dist-lib 反而 +239 B / gzip +130 B** —— 压缩器对「4 处 `new Set` → 1 个共享 helper + 4 组常量/快照」的重命名与内联结果不同。按项目纪律「微优化包体增长需有明确运行时收益」：本轮的运行时收益是实测的（合并 3600 对 medianRatio≈0.9912、胜 60.08%），故接受这 +239 B；但**收益量级小，属边际采纳**，已在性能小节标注。

## 下一轮

Round 162 已把 Round 161 留下的 OLE 线索吃完。Round 163 候选方向：① `createParagraphsWithRealFormats`（13.26%，仍是最大自耗，R156 只覆盖了 piece-CHPX 门控）；② `RegExp:` 汇总 5.53% 中 `HAS_CJK_RE` 占 1.48%，而它在 `guessCharFormatCore` 与 `detectAlignment` 里对**同一段文本**各跑一次——若能证明两者入参同源，可省掉一半扫描；③ `mergeCharFormatForParagraph` 3.87%（33,702 次/轮，R156 判定「成本在调用 + 二分非分配」）。目标 1000 轮。
