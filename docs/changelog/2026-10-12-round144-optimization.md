# Round 144：`detectCharacterStyles` 慢路径标量化（消除 99.3% 的每字符对象分配）

## 结论与候选

采纳「`detectCharacterStyles` 慢路径**不再每个字符物化一个 `CharStyle` 对象**，改为只跟踪标量
`(currentFont, currentUnderline, hasCurrent)`，**只在真正产出一个样式段时**才物化对象」候选。

- **前提（bundle 层 in-situ 插桩，`round143-charpatch.mjs` + `round143-charrun.mjs`）**：
  `detectCharacterStyles` 每轮 **33,702 次调用**、传入 **1,519,227 字符**；其中快路径 A（无 CJK 且无冒号）
  **32,121 次 = 95.31%**、快路径 B（无 CJK 且无数字）271 次 = 0.80%、**慢路径仅 1,310 次**。
  慢路径逐字符迭代 **241,756 次**（占传入字符 15.91%），最终只产出 **1,578 个样式段**
  ⇒ **99.3% 的每字符对象分配是纯浪费**；同轮剖析里 GC 占整轮 **10.53%**。
- **函数级（in-situ 计时包装，同进程交替）**：`detectCharacterStyles` 自身自耗
  **8.829 → 7.233 ms（−18.07%）**（n=90）与 **12.858 → 11.104 ms（−13.64%）**（n=40）；
  绝对节省 **1.595–1.754 ms / 轮**（占整轮 BASE 8.327% → CAND 6.905%）。
  同进程交替的**整轮**读数 n=90：CAND 104.758 / BASE 106.030 = **+1.200%**。
- **端到端配对差（最终源码重建双 bundle，相邻交错、逐对反转）**：
  - n=240：CAND 中位 94.356 / BASE 94.904 = **+0.577%**；配对差（BASE−CAND）中位 **+0.983 ms**、
    均值 **+1.026 ms（+1.081%）**、四分位 −2.334/+3.709 ms、**CAND 胜 141/240（58.8%）**、
    分块（20 对/块）**9/12 块为正**、块中位差之中位数 **+1.223 ms**。
  - n=600：CAND 中位 91.902 / BASE 92.596 = **+0.749%**；配对差中位 **+0.950 ms**、
    均值 **+1.625 ms（+1.755%）**、四分位 −1.206/+3.107 ms、**CAND 胜 376/600（62.7%）**、
    分块（30 对/块）**17/20 块为正**、块中位差之中位数 **+1.045 ms**。
    二项检验 z≈6.2 ⇒ **p ≈ 5e-10**。
- **等价性**：27 份完整 `parseWithFormat` 结果 **16,247,039 字符逐字节一致**（dist-lib 产物 `cmp` 直接比对）；
  护栏另做旧实现逐行转写 oracle 的**穷尽**比对（见下）。
- **包体（同工具链 HEAD 基线对比）反而变小**：`doc-preview.js` raw **365,380 → 365,310（−70 B）**、
  gzip-9 **95,059 → 95,039（−20 B）**；`umd.cjs` raw **273,301 → 273,198（−103 B）**、
  gzip-9 **82,906 → 82,875（−31 B）**。标量版比「每字符造对象」版**压缩后更小**，故本轮是
  「更快 + 更小」，无包体代价。
- `bench-diff 144` 与 `143` 除 `cycle`/`timestamp` **逐字段相同**（`median` 仍为 0.9502433994244857）。
- 拟从现场 0.7.64 升至 **0.7.65**。

## 候选来源

本轮候选正是 Round 142 changelog 里**明确记为「已否决、留给后续轮次」**的那一条，也是 Round 143
并发冲突中对方 worker 未提交、被无损留存到 `.workbuddy-ai/perf-harness/round143-concurrent/`
（`textHeuristics.round143-concurrent.ts` + `round143-concurrent.patch`）的那份改动。Round 143 已
把 143 轮完整闭环并提交（`ed63f8c`），故 144 直接以该备份为起点：`git apply --check` 通过后
`git apply` 落地，注释里的轮次号改为 144 并指向新护栏文件。

Round 142 当时的否决理由是「隔离 1.36×、该函数占比约 0.87%、低于本项目多次否决的亚 1% 阈值、
且未做任何验证」。本轮用 **in-situ 插桩**把「占比」这一前提重测了一遍：该函数的**自耗占比是
8.327%（不是 0.87%）**，且其对象分配是 GC 的主要来源之一；端到端大样本（n=600）给出
**+1.755%（均值口径）/ +0.749%（中位口径）、胜率 62.7%、p≈5e-10**，与 in-situ 的 +1.200% 同向同量级。
据此本轮改判为**采纳**，并把「0.87%」这一旧数字的来源与偏差写进本记录。

## 实现

改动只落在 `src/utils/docparser/heuristics/textHeuristics.ts` 的 `detectCharacterStyles` **慢路径**
（+44/−14）。三条快路径（A：`!HAS_CJK_OR_COLON_RE.test(text)`；B：`!HAS_CJK_OR_DIGIT_RE.test(text)`）、
`applyColonUnderline`、`shouldHaveUnderline`、`isSameStyle`、`uniformStyleForFirstCode`、
`collectColonPositions` 与 `isWhitespaceCode` **均未改动**。

- 状态由 `let currentStyle: CharStyle | null` 换成三个标量：`hasCurrent` / `currentFont` / `currentUnderline`。
- 逐字符分支不再造对象，只写 `fontName`（`string | undefined`）与 `underline`（`boolean`）：
  空白 ⇒ `fontName = undefined`；数字 ⇒ `'Times New Roman'` + `shouldHaveUnderline(...)`；
  大小写字母 ⇒ `'Times New Roman'`；CJK ⇒ `'仿宋'`；其余 ⇒ 按前缀 CJK 密度在 `'Times New Roman'`/`'宋体'`/`'仿宋'` 间选择。
  `isChinese` 分支的 `chineseSoFar++` 保持不变。
- 比较处**内联 `isSameStyle` 的语义**：任一方 `fontName` 为 `undefined` 时只比较 `underline`，
  否则同时比较 `fontName` 与 `underline`。
- 两处 `styles.push` 改为**条件物化**：
  `currentFont === undefined ? { underline: currentUnderline } : { fontName: currentFont, underline: currentUnderline }`
  —— 保持**键集合与键序**不变（空白段**没有** `fontName` 键，不是 `fontName: undefined`）。
- `applyColonUnderline(styles, colonPositions, text.length)` 的调用时机与参数不变。

## 护栏

新增 `tests/textHeuristics.round144.test.ts`（476 行，11 项），两个 describe：

**① 标量化等价性（6 项）**——以「改动前实现的逐行转写」`referenceDetectCharacterStyles` 为 oracle
（仍调用模块真实导出的 `isSameStyle`，不是复制品），比对用自实现的 `strictSameStyles`（同时比
`start`/`end`、`Object.keys` 键集合与每个值）与 `toStrictEqual`：

1. **穷举全部 65,536 个码元 × 3 种上下文**（`中1${ch}中`、`${ch}中1中`、`中：${ch}5`）；
2. 穷举 12 字母表 `ALPHA` 上长度 ≤ 4 的**全部串**；
3. 4,000 条定种子随机混合串（长度 ≤ 80）；
4. 16 条冒号/数字/日期单位密集串（含 `年1月2日3时4分5秒`、全角空格、`\t`/`\n`）；
5. 空串 / 单字符 / 快路径 A 与 B 的边界；
6. **真实 27 份语料的全部段落文本**：实测 **34,945 段落 / 1,456,460 字符**，其中 **533 个段落**走慢路径，
   断言 `paragraphs > 1000` 且 `slowPathParagraphs > 400`（否则等于没测到被改动的分支）。

**② 鉴别力（5 项）**——注入负控必须被检出：

- 正控：真实实现与 oracle 在穷举集上零失配；
- **负控 1**（空白段也物化 `fontName` 键）必须被检出；
- **负控 2**（`fontName` 严格相等，丢掉 `undefined` 通配）必须被检出；
- **负控 3**（段 `end` 差一）必须被检出；
- **元断言**：`expect(ncAlwaysFontKey(s)).toEqual(real)` **通过**（值相同），但
  `expect(() => expect(nc).toStrictEqual(real)).toThrow()` **成立**、`strictSameStyles(nc, real) === false`
  ——钉死「既有 `textHeuristics.charStyles.test.ts` 用的 `toEqual` 会漏掉负控 1，必须用 `toStrictEqual`」。

## 验证

- `npm test`：**81 文件 / 1685 项全部通过**（较 143 的 1674 项 +11，即本轮护栏）。
- `npx vue-tsc --noEmit`、`npm run lint`、`npm run build`、`npm run build:lib` **全部通过**
  （`npm test` 与 `npm run lint` **串行**，未并发）。
- 27 份 `parseWithFormat` 结果落盘后 `cmp`：**完全相同**（16,247,039 字符）。
- `bench-diff 144` 与 `143` 除 `cycle`/`timestamp` 逐字段相同。

## 本轮新发现的两个测量陷阱（重要）

1. **`perf-harness/build.mjs` 的 `ROOT` 是相对「脚本自身位置」解析的**，不是相对 `cwd`。
   因此从 `git worktree` 目录里用**相对入口**调用它（`node <main>/.workbuddy-ai/perf-harness/build.mjs src/utils/docParser.ts out.mjs`）
   会**静默地重新构建主仓库（= 候选）的源码**，而不是 worktree（= 基线）的源码。
   本轮据此得到了一次「CAND vs CAND」的假零差异读数（中位 +0.070%、胜 124/240），
   与 in-situ 的 +1.2% 直接矛盾才被察觉。**基线构建必须传绝对入口路径**，并且构建后**必须核验实现标记**。
2. **产出逐字节等价无法判定一个 bundle 里装的是哪个实现**——新旧实现本来就逐字节等价，
   所以 `cmp` 通过完全不能证明「这个 bundle 是基线」。判定 bundle 版本必须 grep 实现标记
   （本轮用 `currentStyle = charStyle` 计数 1 = 旧实现、`hasCurrent` 计数 4 = 新实现）。
   基线可靠性本身仍按 Round 143 的纪律单独证明：`/tmp/r144-base-final.mjs`（显式绝对入口重建）
   与 `perf-harness/round144-old.mjs` 在 27 份样本上输出逐字节相同。

## 已否决与边界

- **`CHAR_KIND` 65,536 项字符分类查表**（把 5 类字符判定压成一次查表）：三方配对里
  「标量化 + 查表」胜率仅 20/60，而「仅标量化」40/60 ⇒ 64 KB 表的缓存压力超过省下的比较，否决。
- **`buildMagicScanIndex` 变体**（Round 142 自己引入的热点，剖析自耗 4.40%）：
  B（单字节表逐字节）慢 31.2%；C（pair 表 4 字节展开）仅快 6.4%；两者桶内容与现状逐元素一致但收益不足。
  保留观察项 **F（`Uint16Array` 一次读一对，隔离快 20.3%，折算端到端约 0.9%）**——F 能成立是因为
  `PAIR_HAS_LEAD` 对调换高低字节**对称**，故 `u16[j]` 直接当索引与端序无关，只需 `data.byteOffset`
  偶数守卫；单独不足以开轮，留作后续轮次与其它改动合并考虑。
- 本轮未做 `--cpu-prof` 剖析（沿用 Round 143 遗留的 in-situ 插桩口径 + 本轮新插桩 + 端到端配对）。
- 不承诺整机空载 / 统计显著性外推 / 任意 `.doc` 收益；覆盖边界为 27 份 DOC/DOT。
- 证据常驻 `.workbuddy-ai/perf-harness/`（`round144-*`、`round143-char*`、`r143-*`）。

## 下一轮方向

- 观察项 F（`buildMagicScanIndex` 的 `Uint16Array` 一次读一对）与其它改动合并后再评估。
- `bytesToBase64` 的分块 `fromCharCode.apply`（Round 139 记录约 2.90%）；
  `createParagraphsWithRealFormats` 的对象展开（约 3.7%）——两者均待独立复核后再定。
- 目标终轮 208。
