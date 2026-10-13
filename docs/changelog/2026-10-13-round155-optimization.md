# Round 155/100 — 2026-10-13 — 候选撤回（活代码 createParagraphsWithRealFormats 原地合并被 Round133 非变异护栏否决；并揭出 150/153 优化的是死代码）

> 结论：**候选撤回，不升号、不发布，轮次计入。** 源码已 `git checkout` 还原。
> 本轮有两个实质发现：**(1)** `src/utils/docparser/formatRecovery.ts` 是**死代码**（无任何 `src/` 引用、被 tree-shake，`FormatRecoveryContext` 在 dist-lib bundle 中出现 0 次）——因此 **Round 150 与 Round 153 优化的是死代码，其性能结论（「中性」）不构成优化证据**；**(2)** 把同一想法落到**活代码** `src/utils/docParser.ts` 的私有方法 `createParagraphsWithRealFormats`（第 1186 行）后，27 份逐字节等价、`vue-tsc` 0，但被 Round 133 的 `expectLegacyMerge` **非变异护栏**否决（9 项测试失败）。

## 前提与目标

- post-148 HEAD 的 `--cpu-prof`（80 轮×27 份）自耗：`createParagraphsWithRealFormats` 12.75%（第 1 大）、GC 11.05%、`applyStructuralFormats` 13.56%、`bytesToBase64` 4.76%、`buildMagicScanIndex` 3.83%、`extractFormattedText` 3.65%、`mergeCharFormatForParagraph` 2.70%。
- 149/150/151/152/153/154 六轮连续中性/退化后，本轮重新审视「对象 spread 消除」候选的落地位置。

## 发现 1（死代码）：`formatRecovery.ts` 从未进入构建图

- `grep -rn "formatRecovery" src/` → **无任何命中**（无静态 import、无动态 import、无 re-export）。
- `dist-lib/doc-preview.js` 中 `FormatRecoveryContext` 出现 **0 次** ⇒ 该模块被 esbuild tree-shake，不在产物内。
- 该文件导出的 `parseFormatRuns` / `createParagraphsWithRealFormats` / `tryParseFormatsFromTableStream` / `applyParsedStylesToParagraphs` 是 `docParser.ts` 同名活实现的**平行副本**（活实现：`docParser.ts:1186 / 1985 / 2075`，均为类私有方法，bundle 中 `tryParseFormatsFromTableStream` 4 处出现全部来自 `this.` 调用点）。
- Git 历史：commit `5222a9a chore: exclude pre-existing format recovery file`；`progress.md` 记为「被刻意停放的半成品…不可达故已被 tree-shake，删除不会减小包体」。
- **推论**：Round 150（`Object.keys→hasKeys`）与 Round 153（安全子集展开→`Object.assign`）改动的都是**死代码**。其「27 份逐字节一致」正是因为改动从未进入产物；其「中性」性能结论**不构成任何优化证据**（被测代码根本不执行）。两轮仍按协议计入轮次，但证据等级降级为「无效」。

## 发现 2（活代码候选）：原地合并被非变异护栏否决

- 活热点为 `src/utils/docParser.ts` 的私有方法 `createParagraphsWithRealFormats`（第 1186 行，调用点 1556）。其内 4 处段落格式合并：
  - L1355 `newPara.paraFormat = { ...newPara.paraFormat, ...papx.format }`（`newPara.paraFormat` 为每段落私有对象）；
  - L1447 `const realCharFormat = { ...newPara.charFormat, ...merged }`（`merged` 每段落新建）；
  - L1379 / L1385 目标含 `resolved`（`resolvedParagraphStyles` 缓存的**共享**对象），**必须保留展开**，不可原地改。
- 候选：把 L1355、L1447 两处改为原地 `Object.assign`：
  ```ts
  // L1355
  Object.assign(newPara.paraFormat, papx.format)
  // L1447
  const realCharFormat = Object.assign(newPara.charFormat, merged)
  ```
  `Object.assign(target, src)` 的键序与 `{ ...target, ...src }` 逐键相同（target 键保持原位、src 新键追加于末）。

## 验证结果

- **逐字节等价通过**：27 份 `parseWithFormat` 落盘 JSON 与 baseline 逐字节一致（改动语义等价，输出不变）。
- **`vue-tsc --noEmit` 通过**。
- **`tests/docParser.test.ts` 失败 9 项** —— Round 133 `expectLegacyMerge` 护栏（`tests/docParser.test.ts:2330-2376`）要求合并**产生新对象且不改动输入**：
  ```ts
  expect(actual).not.toBe(base)      // 原地 assign 返回 base ⇒ 失败
  expect(actual).not.toBe(merged)
  expect(Object.getOwnPropertyDescriptors(base)).toEqual(baseBefore)   // base 被改写 ⇒ 失败
  expect(Reflect.ownKeys(merged)).toEqual(mergedKeysBefore)
  ```
  原地 `Object.assign` 返回 `base` 本身且改写 `base`，**结构上不可能同时满足**「零新对象分配」与「返回新对象且输入不变」。

## 归因与纪律结论

- 该护栏是 Round 133 为「合并必须无副作用」立的正确性契约（输入对象可能被调用方复用）。**不因优化而弱化护栏**——候选与护栏直接冲突，判定为**不可采纳**，按协议撤回（`git checkout -- src/utils/docParser.ts`），不升号、不发布，轮次计入。
- 本轮同时纠正账本：150/153 的证据标注为「死代码，无优化证据」。**教训（新）**：**优化前必须确认目标文件在构建图内**（有 `src/` 引用、或导出名出现在 bundle 中）；仅凭 CPU 剖析里的函数名去 `src/` 找「同名文件」会误中平行死代码副本。剖析显示的 `createParagraphsWithRealFormats` 只能来自 bundle 内的活实现（`docParser.ts`），绝非未打包的 `formatRecovery.ts`。
- 连续七轮（149/150/153/154 中性、151 退化、152 无点、155 护栏否决）在解析路径低/无风险面均无稳定收益。向 1000 轮推进若要真实收益，须**转向不同优化面**（渲染 / bundle / 未覆盖热点）或承担正确性风险的结构改动。

## 下一轮

Round 156，目标 1000。
