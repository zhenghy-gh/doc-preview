# 2026-11-23 — 渲染正确性审查：表头 colspan 列数错位（真实 bug 修复）

**范围**：任务 A（重点）— `src/utils/rendering/` 与 `src/utils/tableText.ts` 边界审查。
**结论**：发现并修复 1 处真实 bug（表头 colspan 列数错位），其余审查项在 clean HEAD worktree 中不存在对应实现，记为审计结论。

---

## 1. 审查口径：本 worktree 与「WIP 特性」的边界

本 worktree 基于 clean HEAD `e7d722e`，**不包含**用户主目录那份未提交 WIP 的以下特性（红线：绝不触碰）：

| 任务点名项 | 本 worktree 实际状态 | 处理 |
|---|---|---|
| `documentRenderer.ts` 表格跨页切分 / `estimateTableHeight` / 切点落在 token 内 | **不存在**。表格由 `collectTableBlock` 整体收集，`renderNestedTableHtml` 一次成表，经 `addToPage(html, 100)` 单块入页；`estimateTableHeight` 符号全仓无定义 | 审计结论：无切分逻辑，故无「跨页切点/表头重复/垂直合并跨页」可审；`tableText.ts` 的合并与列数边界另审（见 §2） |
| `pageBuilder.ts` 页眉页脚内联 / `NUMPAGES`/`SECTIONPAGES` 标记回填 | **不存在**。`pageBuilder` 仅管分页/分栏状态机（`finalizePage`/`addToPage`/`findSectionForCp`），无 inline/marker 概念 | 审计结论：特性属于主目录 WIP，不在本 worktree；不实现、不猜测 |
| 空表 | `collectTableBlock` 行数 <1 返回 `null`；`renderTableHtml([])`/`renderNestedTableHtml([])` 返回 `''` | 新增守卫测试，行为正确 |
| 表头重复 | `renderTableHtml` 最多 1 个 `<thead>`（条件 `headerRowCount>0 && <rows.length`） | 新增守卫测试，行为正确 |

> `tests/realCorpusPageBaseline.test.ts` / `scripts/printPageAudit.mjs` 传入的 `headerFooter`/`equations`/`wordArts` 字段在本 worktree 的 `RenderInput` 中未被声明、渲染器亦不消费；这是 WIP 接口残留（经对象展开绕过 excess-property 检查），不构成可修 bug，保持原样。

## 2. 真实 bug：稀疏表头行的 colspan 延伸到行尾后，尾部空单元格被重复渲染

`tableText.ts#renderTableHtml` 的 `renderRow` 在没有 `TableInfo` 的表头行上用启发式：把「末个非空单元格」以 `colspan = columnCount - c` 延伸到行尾。但循环**仍继续渲染** `c > lastNonEmptyHeaderCell` 的空 `<th>`，这些列已被 colspan 覆盖 ⇒ 表头实际列数 = `columnCount + (尾部空列数)`，浏览器将后续正文列整体右移。

### 负控（先写测试证伪）

新增 `tests/tableHeaderColumnAudit.test.ts`，以 `theadColumnSpan()`（所有 `<th>` 的 colspan 之和）钉契约：

| 用例 | 修复前 | 期望 |
|---|---|---|
| `['A','','B','']` + 满行正文 | **5** | 4 |
| `['A','B','','']` + 满行正文 | **6** | 4 |

修复前 2 项失败、2 项守卫通过 ⇒ 确证 bug。

### 修复

`renderRow` 在 `singleNonEmptyHeader` 跳过分支之后增加：当 `!hasCellInfo && isHeader && !singleNonEmptyHeader && lastNonEmptyHeaderCell>=0 && nonEmptyCount<columnCount && c>lastNonEmptyHeaderCell` 时 `continue`。仅作用于启发式表头路径，真实合并信息（`cellInfo`）路径零影响。修复后 4/4 通过，原 `tableText.test.ts` 61 项全绿。

### 真实语料佐证（非合成用例）

`git archive HEAD` 与当前源码分别 esbuild 打包、渲染三份语料逐字节对比：`unicode-n4100.doc` / `unicode-n4250.doc` / `unicode-n4350.doc` 的表头原为
`<th>Author…</th><th colspan="3">2012-02-08</th><th></th><th></th>`（4 列表格里 6 列），
修复后为 `<th>Author…</th><th colspan="3">2012-02-08</th>`（恰好 4 列）。**页数不变**，仅去掉多余空 `<th>`。

## 3. 基线刷新（有据，非掩盖回归）

按章程红线 #2「必须先证明新行为更正确」：已用负控 + 真实语料 thead 逐字节对比证明列数契约恢复，且页数不变，故刷新受影响的指纹而非放宽断言：

- `tests/fixtures/real-corpus-pages.json`：仅上述 3 份的 `sha1` 变化，`pages`/`firstPageLen` 不变。
- `tests/fixtures/print-layout-audit.json`：仅上述 3 份的 `printHtmlBytes` 变化（108415→107235 / 151799→150265 / 82302→81948），`previewPages`/`pageContentCount`/`sectionCount` 及总计 1055 不变。

## 4. 否决：`collectTableBlock` 的 `\u0007\u0007` 行边界歧义（证据不足）

`collectTableBlock` 的「2+ 连续 \u0007 = 行边界」分支在真实语料中**高频触发**：21/27 份语料含此类段落。逐段抽样：

- 绝大多数是**行尾** `…\u0007\u0007`（如 `ITEM\u0007NEEDED\u0007\u0007`）：当前实现把尾部空段切掉，结果恰好是正确的一行 ⇒ 行为碰巧正确。
- 仅 `unicode-02006-zia.doc` 有 **68 处行内** `\u0007\u0007`（如 `49\u000730\u0007\u000706F0\u0007EASTERN ARABIC-INDIC DIGIT ZERO\u0007\u0007`），这是「单行的空中间单元格」，但当前实现切成 2 行 × 2 列，应为 1 行 × 5 列。

**为什么不改**：MS-DOC 规范里 0x07 是单元格结束符、0x0D 才是行结束符，故行内 `\u0007\u0007` 本应是空单元格；但本 worktree 的解析器在部分回退路径只按 `\n` 切段，行尾同样残留 `\u0007\u0007`，导致「行尾边界」与「空单元格」在文本轴上无法区分。移除该分支会让 20+ 份语料的表格列数变化（多数是尾部空列被保留），需重写 3 项钉住多行启发式的既有测试并刷新大量基线 —— 属功能级重构，不是低风险修复。按章程「证据不足即否决并记录」⇒ **不改行为**，留作需「parser 保留 0x0D/CP 行边界 + 每行 TAP 属性」的独立切片。

## 5. 门禁

`npm test` 131 文件 / 2115 项全绿；`npx vue-tsc --noEmit` 0；`npm run lint` 0；`npm run build` + `build:lib` 通过；`npm run scan:corpus` 27/27；`node scripts/printPageAudit.mjs --check` OK；`npm run audit:i18n` exit 0。
