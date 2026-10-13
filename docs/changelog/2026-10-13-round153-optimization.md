# Round 153/100 — 2026-10-13 — 候选撤回（createParagraphsWithRealFormats 安全子集展开→Object.assign 原地合并，端到端中性）

> 结论：**候选撤回，不升号、不发布，轮次计入。** 源码已 `git checkout` 还原；27 份逐字节一致、Round144 键序护栏 11/11、formatParser 137/137、vue-tsc 0。这是用户指定「风险结构改动」路径里**安全子集**的首次实测，结果中性，进一步坐实低/无风险空间已尽。

## 前提与目标
- 用户选「走风险结构改动：重构 createParagraphsWithRealFormats 的对象 spread（钉死 Round144 键集合与键序守卫）」。该函数 post-148 自耗 12.75%（第 1 大）。其内 6 处对象展开（714/738/744/831/836/853）构建段落 `paraFormat`/`charFormat` 输出对象。
- 安全子集：714/831/836/853 的展开目标是**每段落私有对象**（newPara.paraFormat/charFormat 来自 detectParagraphFormat/guessCharFormat，二者均返回新对象；merged 每段落新建），可原地 `Object.assign` 复用、零额外分配且键序与展开逐键一致；738/744 的展开目标是 `resolveStyleFormat` 返回的**共享**对象（经 resolvedParagraphStyles 缓存），原地合并会污染缓存，必须保留展开。

## 候选实现（已还原）
`src/utils/docparser/formatRecovery.ts` 的 `createParagraphsWithRealFormats`：把 4 处安全展开改为原地合并：
```ts
// 714
Object.assign(newPara.paraFormat, papx.format)            // 原 { ...newPara.paraFormat, ...papx.format }
// 831 / 836（merged 为本段落私有）
Object.assign(merged, styleFormat)                         // 原 { ...merged, ...styleFormat }
Object.assign(merged, pieceChp.format)                     // 原 { ...merged, ...pieceChp.format }
// 853
Object.assign(newPara.charFormat, merged)                  // 原 { ...newPara.charFormat, ...merged }
```
738/744 保留展开（目标 resolved 共享，不可原地改）。`Object.assign(target, src)` 的目标对象键保持原位、源的新键追加于末——与 `{ ...target, ...src }` 的展开键序**逐键相同**（已论证 + 实测）。

## 等价性
- 27 份 `parseWithFormat` 落盘 JSON 与 baseline（r149-head.mjs）`diff -rq` **逐字节完全一致**（键序 + 值）；
- 护栏 `tests/textHeuristics.round144.test.ts` **11/11**（含「真实语料 27 份全部段落文本与参照一致」的键序等价）；`tests/formatParser.test.ts` **137/137**；`vue-tsc` 0。

## 测量证据（中性）
- 同进程配对基准（`r149-paired.mjs`，baseline r149-head.mjs vs cand r153-cand.mjs）**400 对**：
  - baseMedian 84.851ms / candMedian 84.769ms，中位比值 **0.99512（候选中位快 0.49%）**；
  - 均值比值 **1.0041（候选慢 0.41%）**，胜 **219/400（54.75%）**。
- 中位略正、均值略负、胜率 ~55% → **中性**，与 149/150 同噪声地板。

## 归因
- 即便去掉的是「被持有、会进入序列化」的输出对象分配，V8 对短命/小对象的分代 GC 仍近乎免费；`Object.assign` 的函数调用开销抵消了 GC 节省。验证了低/无风险空间（含风险路径的安全子集）已无稳定收益。

## 纪律结论
候选端到端中性，按协议**撤回**（`git checkout -- src/utils/docparser/formatRecovery.ts`），不升号、不发布；本轮计入预算。剩余唯一理论点（738/744 共享 resolved 原地合并）风险高（跨段落/跨文档缓存污染），且按本模式大概率也中性，不建议继续。

## 给下一轮
- 安全/低风险空间确证榨尽：149 中性、150 中性、151 退化、152 勘察无热循环、153（风险路径安全子集）中性。仅余 738/744 高风险共享缓存原地合并（不推荐）与 applyStructuralFormats 默认否决。建议**暂停**，或仅在用户明确接受等价风险时再攻 738/744。下一轮 154（或暂停），目标 208。
