# Round 111 — 2026-10-09

## 结论

采纳 1 项优化：`detectCharacterStyles` 新增**整段快路径**。函数级隔离 **7.34x**，端到端 **1.117x（约 +11 %）**——近十轮最大单轮收益。

## 目标

`detectCharacterStyles` 在剖析里是最大单项（未混淆 bundle，4672 samples 中占 11.15 %）。Round 106（合并冒号扫描）、Round 108（键比较去分配，1.39x 更慢）已两次尝试，本轮换角度：**从「每字符更快」改为「大多数段落根本不需要逐字符」**。

## 关键洞察与量化

先用插桩实测真实语料的字符/段落分布（27 份 / 33 819 段 / 1 456 460 字符）：

| 特征 | 段落占比 | 字符占比 |
| --- | --- | --- |
| 无 CJK | 99.98 % | 99.97 % |
| 无 CJK 且无数字 | 9.48 % | 56.14 % |
| 无 CJK 且无冒号 | **97.63 %** | **90.59 %** |

**等价性论证（快路径 A：整段无 CJK 且无冒号）**

1. 无 CJK ⇒ 主循环里 `chineseSoFar` 恒为 0 ⇒ 兜底分支的 fontName 恒为 `'Times New Roman'`；
2. 无 CJK ⇒ `isDateUnitCode` 的六个日期单位（**年月日时分秒，全部是 CJK**）一个都不出现 ⇒ `shouldHaveUnderline` 的日期分支恒返回 false；
3. 无冒号 ⇒ 它的冒号分支也恒返回 false；而 `shouldHaveUnderline` **只对数字字符**可能返回 true ⇒ **任何数字都不会带下划线**；
4. 于是每个字符的样式对象只可能是 `{underline:false}`（空白）或 `{fontName:'Times New Roman', underline:false}`（字母 / 数字 / 标点 / 兜底）。由 `isSameStyle`「任一方 fontName 为 undefined 时只比较 underline」的语义，**两两等价** ⇒ 整段只产出 **1 个**样式段，style 即 `text[0]` 的对象；且 `colonPositions` 必为空，后处理是空操作。

快路径 B（有冒号但无 CJK / 无数字）同理，只多跑一次冒号后处理。

## 改动

`src/utils/docparser/heuristics/textHeuristics.ts`（+104 / −24）：

- 新增两张守卫正则 `HAS_CJK_OR_COLON_RE = /[\u4e00-\u9fff:\uff1a]/`（快路径 A）与 `HAS_CJK_OR_DIGIT_RE`（区分「有冒号无数字」与「有 CJK/数字」）；
- 新增 `uniformStyleForFirstCode(code)`（首字符为空白 → `{underline:false}`，否则 → `{fontName:'Times New Roman', underline:false}`）；
- 把冒号下划线后处理抽成 `applyColonUnderline(styles, colonPositions, textLength)`，主循环与快路径 B 共用（**逻辑逐字未变**）；
- 主循环本身**一行未改**。

`eslint.config.js`：`ignores` 增加 `.workbuddy-ai/**`（本轮起保留一套常驻剖析/基准脚手架在该 gitignore 目录内，避免 `npm run lint` 被本地工具状态污染）。

## 隔离基准（33 819 段，同进程 A/B，Round 109 纪律）

同一进程内放四个变体（`OLD` = 改动前逐行副本；`V_prod` = import 的生产实现；`V1` = 中途版本，仅覆盖「无 CJK 且无数字」54.26 % 字符；`V2` = 最终版本）：

```
OLD     788.9 / 793.4 / 792.0 / 808.4 ms   min=788.9
V_prod  108.0 / 107.6 / 107.5 / 111.1 ms   min=107.5
V1      122.5 / 122.7 / 125.6 / 123.7 ms   min=122.5
V2      109.9 / 109.4 / 111.0 / 111.1 ms   min=109.4
```

- **最终版 / 改动前 = 7.34x**（V2 内联副本 7.21x，两者在会话态漂移内一致）；
- 中途版本 V1 只有 6.44x —— 放宽守卫（把「无数字」换成「无冒号」）多覆盖 36 个百分点字符，是本轮从 +1.3 % 跃到 +11 % 的关键。

## 端到端（27 份 / 7.6 MB，独立进程，交错 5×NEW / 5×OLD 再反向 5 对，共 20 进程 × 20 轮）

- 中位数之中位数：NEW **114.08 ms** vs OLD **127.42 ms** → **1.1169x**
- 最小值之中位数：NEW **107.13 ms** vs OLD **118.20 ms** → **1.1033x**
- 分离度：NEW 的 10 个最小值全部 ≤ 111.2 ms，OLD 的 10 个最小值全部 ≥ 115.0 ms（**完全分离**）；中位数只有 NEW 的一个离群点（128.5）与 OLD 最低值（119.3）交叠。

## 等价性证据（四重）

1. **端到端逐字节一致（最强）**：27 份 `parseWithFormat()` 的**完整结果**（含段落、格式、图片 data URL）序列化后 `cmp` —— **27 文件 / 16 247 039 字符，0 处差异**。
2. **常驻差分护栏** `tests/textHeuristics.fastPath.test.ts`（**7 项**）：参照实现是改动前实现的逐行转写（无条件逐字符循环）；① 穷举「无数字无 CJK」字母表长度 ≤ 5（约 3.7 万串）；② 穷举混合字母表长度 ≤ 4（跨快路径开关两侧）；③ **穷尽全部 65 536 个 BMP 单字符**；④ 随机 5 000 串（长度 ≤ 80，**断言产出 > 4 900、多段 > 100 防空转**）；⑤⑥⑦ 结构不变式与边界（含「数字起头无冒号仍为单段」「冒号+数字退回通用循环」）。隔离差分：mismatch **0**，有产出 104 393 段，多段 2 537 段。
3. **鉴别力（负控 4 组）**：① `uniformStyleForFirstCode` 的 fontName 改成 `'宋体'` → **6 failed / 1 passed** ✓；② 守卫漏掉冒号 → **5 failed / 2 passed** ✓；③ 守卫漏掉 CJK → **4 failed / 2 passed** ✓；④ **更慢但等价**（快路径 A 内加一次冗余逐字符扫描）→ **7 passed**（正确地零差异）✓。
4. **一条「不是 bug」的记录**：中途版本还试过「守卫漏掉数字」这一负控，结果 **6/6 全绿**。核查后确认它是**等价改写**而非护栏失灵 —— 无 CJK 时日期单位不存在、`shouldHaveUnderline` 只可能由冒号触发，故「无冒号」已蕴含「无带下划线的数字」。这与 Round 107 的负控 C 同源，已如实记录。

## 验证

- `npx vue-tsc --noEmit`：0 错误。
- `npm run lint`：**0 问题**（新增 `.workbuddy-ai/**` ignore 后）。
- `npm run build` / `npm run build:lib`：通过。
- `npm test`：**74 文件 / 1440 项**通过（较 Round 109 的 73/1433 **+1 文件 +7 项**）。
- `node bench-diff.mjs 1110` 与 `cycle-1090`：`total`/`parseSuccess`/`median`(0.9502433994244857)/`p10`/`p25`/`min`(0.8115474418758475)/`max` **逐位相同**，13 个失败样本与 `topIssues` 完全一致，**零新增回归**。

## 指标与包体

- 隔离 `detectCharacterStyles` **7.34x**（788.9 → 107.5 ms）；**端到端 1.117x（约 +11 %）**。
- 主包 raw 318.38 → **318.88 kB**、gzip 109.68 → **109.83 kB**；
- 库 `dist-lib/doc-preview.js` raw 352.15 → **352.75 kB**、gzip 94.72 → **94.86 kB**（**+0.14 kB gzip**）；
- 库 UMD raw 263.01 → **263.50 kB**、gzip 82.92 → **83.05 kB**（+0.13 kB）。
- **+0.14 kB gzip 换 11 % 端到端**，收益明确、增长已论证。

## 剖析口径的两条修正

1. **行级归因会误导**：首版把冒号收集的守卫（两次 `indexOf`）读成「占全进程 1.07 %」，据此改成合并正则；但同进程 A/B 实测合并版只比 `indexOf` 版快 **1.7 %**（527.1 → 518.5 ms），远小于行级归因的暗示。
2. **隔离收益仍然系统性高于端到端**：函数级 7.34x 折算端到端理论上限约 9.6 %，实测 11 % —— 本轮**首次出现端到端超过折算上限**，因为快路径同时消掉了 1 456 460 次/轮的对象分配，收益的一部分落在 GC 上（GC 占比 8.86 %），不在被计时的函数体内。

## 清理

本轮起不再逐轮删除剖析/基准脚手架，改为常驻 `.workbuddy-ai/perf-harness/`（已 gitignore，并加入 eslint ignores）。本轮新建：`build.mjs`、`run.mjs`、`analyze.mjs`、`lines.mjs`、`charstats.mjs`、`paraStats.mjs`、`e2e.mjs`、`dump.mjs`、`bench111.mjs`、`bench111b.mjs`、`bench111c.mjs`、`bench111d.mjs`、`mk111c.mjs`、`mk111d.mjs`。临时中间产物（`.cpuprofile`、`lib-*.mjs`、`dump-*.txt`、`*.instr.mjs`、`th.bak.ts`）不入库。

## 下一轮方向

- `createParagraphsWithRealFormats`（9.91 %，剩余热点是 L7842 的 `mergeCharFormatForParagraph` 调用点 2.23 % 与 L7845–7847 的 spread+rest 1.86 %）；
- `guessCharFormat`（7.17 %，本轮快路径后已从 4.86 % 升到 7.17 %，说明它现在是 `detectCharacterStyles` 之后的次热点：内部有 `countChineseAndWhitespace` 全串扫描 + `trim()` + 多个正则，可考察「无 CJK 段落的标题探测短路」）；
- `applyStructuralFormats`（7.27 %，需先做调用点级归因）；
- `bytesToBase64`（3.40 %，`fromCharCode.apply` 占该函数绝大部分，Round 103 已确认分块 0x2000 接近最优；Node 22 无原生 `Uint8Array.prototype.toBase64`，已排除）；
- `extractImagesFromStream`（5.07 %）、`detectAlignment`（5.12 %）。

**已被证伪、不要动**：`detectCharacterStyles` 键比较去分配（慢 1.39x，Round 108）；Round 110 pieceMap 重叠临时数组消除；`Uint16Array` 视图 + 奇偶守卫（打平）；越界读取代替守卫（1.156x 更慢）；图片扫描「范围守卫 + 表」（打平）；`imageExtractor` 四锚点游标（0.90x）；段落格式共享文本上下文（真实样本慢 19–23 %）；`countChineseAndWhitespace` 合并（两个调用点输入不同）；OLE 层 `readRegularStream`（1.16 %）；Round 103 七条证伪项；`DATE_TIME_RE` 已删；Round 104–110 的重复遍历合并已完成。
