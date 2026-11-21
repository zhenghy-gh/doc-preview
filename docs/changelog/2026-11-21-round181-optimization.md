# Round 181 — 整轮否决（发布暂停模式）

**日期**：2026-11-21　**结论**：按纪律否决候选，未落地任何性能代码，版本保持 0.7.88。

## 任务背景

上一轮（R180）建议评估「把 `applyStructuralFormats` 的正文样式写入并入
`createParagraphsWithRealFormats`，省去对 27k 段的第二次整趟写入」。这是高风险
重构，本轮按要求先做调用计数 + 分阶段计时确认真实耗时占比，再判定是否值得动手。

## 1. 调用计数 + 分阶段计时（先量后改）

`git diff 7195b3c..HEAD -- src/utils/docparser src/utils/docParser.ts` 为空 ——
自 R180 剖析以来**解析器代码零改动**，故直接复用 R180 在同一份大文档
（`unicode-01351-N2376.doc`，27,505 段，单次 ≈64ms）上的插桩结果，口径一致：

```
applyStructuralFormats          1 次 / 27,504 段 / 2,690 候选组
  └ 正文样式循环（Step 3）        13.41ms   ← 候选声称要「并入」的那一趟
  ├ HYPERLINK 预处理              2.00ms
  └ 列表组检测                    2.33ms
createParagraphsWithRealFormats  1 次 / 20.36ms
```

正文样式写入耗时占比 ≈ 13.41 / 64 ≈ **21%**，并非 <1%。但耗时高 ≠ 可省：
下一步做数据流依赖分析判定这 13.41ms 是否为「冗余的第二趟」。

## 2. 数据流依赖分析（本轮核心证据：候选前提不成立）

候选的前提是「这是一趟可以在别处顺手做掉的冗余写入」。逐行核对后确认**前提为假**：

1. **写入对象不同、且晚于过滤**：`createParagraphsWithRealFormats`
   （`formatRecovery.ts:587`）产出的是**过滤前/原始**段落数组（含 `_cpStart`
   元数据）。随后 `filterParagraphsWithGenericLogic` / `filterAndEnhanceParagraphs`
   会**删除空段、插入空行**，段落数量与索引都会变。`applyStructuralFormats`
   （`paragraphFilter.ts:305`）的正文写入作用于**过滤后**的数组。
2. **依赖同函数内更早阶段的检测结果**：正文循环（Step 3，行 601-657）依赖
   - `paraFormat.listType`（同函数 Step 2 列表组检测写入，行 520），
   - `charFormat.fontSize === 28`（同函数 Step 1 标题检测写入，行 355），
   - 相邻段落 `prevPara.text.length` / `nextPara`（依赖 Step 3.6 的空行 splice），
   - `_subtitleSet`（同函数副标题检测，行 595）。
   这些状态在 `createParagraphsWithRealFormats` 返回时**尚不存在**，无法在其内部复现。
3. **写入前还会改写 `text`**：`applyStructuralFormats` 开头（行 320-343）会剥掉
   `HYPERLINK` 域码、改写 `para.text`；正文循环用的是改写后的 `paraText.length`。
   把写入提前会改变长度判定与断点，逐字节等价无法保证。
4. **调用点共 5 处，仅 1 处相邻**：`docParser.ts:1617/1691/1741/1788/1830`。其中
   1691 之外的路径分别来自 `filterAndEnhanceParagraphs`、`filterParagraphsWithGenericLogic`、
   `createFormattedParagraphsFromText` —— 即便把 1691 处合并，其余 4 条路径仍必须保留
   原趟写入，无法「省掉第二次整趟」，反而要维护两套分支。

结论：这 13.41ms 是**必要的、数据依赖的独立计算**，不是可合并的冗余写入。合并等于把
标题检测/列表检测/空行插入/域码清洗整条流水线前移重构，风险与 27 份语料回归面
远大于收益（即便忽略依赖，合并最多省一次循环遍历开销，亚毫秒级）。

## 3. 裁决

- **无算法级浪费**：R179/R180 已证无 O(n²)、无重复整趟扫描；本轮进一步证伪了
  「第二次整趟写入是冗余」这一前提。
- **收益无法验证且风险极高**：改动跨越 5 个调用点与整条检测流水线，独立环境
  逐字节等价与 57% 胜率门槛均无从谈起；本机噪声地板 ~55%（R177–R180 四连否决）。
- 按章程「证据不足即否决、不冒险」「不留下变慢/未证代码」⇒ **撤回，未落地任何代码**。

**通用教训 19**：分阶段计时定位到「某趟写入耗时 21%」只说明它**重要**，不说明它
**冗余**。在合并两趟之前必须先画数据流依赖图：若被合并的写入依赖另一阶段在它
之后才产出的状态（标题/列表/邻居/过滤后数组），则「合并」实为整条流水线重构，
应作为独立的功能级变更评估，而非性能微优化。

Next: Round 182（方向建议：转渲染/分页正确性与回归治理，见 Phase 3；性能循环在
跨阶段数据共享方向缺乏低风险切口，暂缓）。
