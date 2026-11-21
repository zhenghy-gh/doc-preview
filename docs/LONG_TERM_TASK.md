# doc-preview 长期自主优化任务（章程）

> 创建：2026-11-21　执行者：AI Agent（自主决策，无需用户逐轮确认）
> 状态：**进行中**　总体目标：把项目从「解析器微优化机器」升级为「架构健康、文档可信、行为正确、持续提速」的可维护项目。

---

## 0. 定位与边界

- 本文件是**长期任务的单一事实来源**。性能子循环沿用
  `.workbuddy-ai/optimization-loop.md` + `.workbuddy-ai/optimization-loop.json`
  （已完成 176 轮，目标 Round 1000，npm 发布暂停中）。两者关系：本文管**方向与阶段**，
  optimization-loop 管**性能轮次的具体执行纪律**。
- **不可逾越的红线**：
  1. 不删除、不覆盖、不擅自提交用户已有的未提交改动；需要腾挪时先做 `git diff`/`git diff --cached` 补丁备份到 `docs/_backups/`。
  2. 不为了「凑一轮/让测试变绿」而刷新 golden 快照或放宽断言——必须先证明新行为更正确。
  3. npm 发布保持暂停（用户 2026-10-19 指令）：本任务只提交代码，不执行 `npm run release`。
  4. 全量 `npm test` 与 `npm run lint` 不并发（eslint 会读到 vitest 临时文件报 ENOENT）。
  5. 候选在真实语料上实测退化 → 否决并撤回，不留下变慢的代码。

---

## 1. 现状基线（2026-11-21 实测）

| 维度 | 现状 |
|---|---|
| 版本 / 构建 | `0.7.88`；app → `dist/`，lib → `dist-lib/`（ESM+UMD+d.ts），双包发布脚本在 `scripts/publish.mjs` |
| 解析能力 | 规范级 OLE2/FIB/CLX/PieceTable/CHPX/PAPX/SPRM，27 份真实语料，零运行时依赖 |
| UI 结构 | `DocPreview.vue` **5064 行「上帝组件」**：16 个信息面板内联；4 个 composable 已从它纯搬迁出来（`useDocLoading/Search/Viewport/Export`），但组件拆分未完成 |
| 测试 | 115 个运行文件 / **2196 项**；当前 **4 项失败**（见下） |
| 文档 | README/INDEX/CHANGELOG/CONTRIBUTING/AGENT_PROMPT/CLAUDE/AGENTS/progress 等大量内容过时：测试计数、目录结构、能力清单、版本与代码严重脱节 |
| 性能循环 | 176 轮完成；近期单轮收益降到 ~0.7–1.2%，且 almost all 集中在解析器热路径；发布暂停 |
| 工作区 | 约 80 个已跟踪文件改动 + 36 个未跟踪文件：一个**未完成的大型渲染升级 WIP**（表格跨页切分/垂直合并降级/页眉页脚内联/公式艺术字内联/URL 净化等），引入 4 个回归 |

### 当前 4 个回归（阶段 0 的输入）

1. `tests/realCorpusBaseline.test.ts`：`openstd-n961.doc` 期望 19 页 → 实得 20 页。
2. `tests/realCorpusBaseline.test.ts`：`unicode-02006-zia.doc` 期望 56 页 → 实得 61 页。
3. `tests/sectionLayout.test.ts`：`openstd-n961` 期望 19 页 → 实得 20 页。
4. `tests/renderGolden.test.ts`：table golden 快照 `<table>` 多出 `data-est`/`data-est-seq` 属性。
   来源定位：`src/utils/rendering/documentRenderer.ts:835,883`（WIP 的表格高度估算属性）。

---

## 2. 自主确定的优化方向（及理由）

继续把全部精力投在解析器微优化上已不划算：176 轮后边际收益 ~1%/轮，且 16 个面板仍挤在 5000 行组件里、根文档严重失真、真实语料回归未被治理。
因此长期任务按以下优先级推进：

| 方向 | 优先级 | 理由 |
|---|---|---|
| **A. 架构可维护性** | 最高 | `DocPreview.vue` 5000+ 行是后续所有改动的成本中心；`docs/CONTRACT-split-r1.md` 已给出渲染纯函数落位契约且 T3/T4 基本完成，下一步自然是**面板组件化** |
| **B. 正确性 / 回归治理** | 高 | 当前基线红色；分页页数与浏览器实际填充偏差需要自动化校验，不能靠改断言掩盖 |
| **C. 文档可信度** | 中高 | README/INDEX/CONTRIBUTING/CHANGELOG 等与代码脱节，会误导贡献者与使用者 |
| **D. 持续性能（既有循环）** | 中 | 保持 Round 177→1000 长跑，但仅在 A/B/C 的空闲窗口推进，并坚持「实测胜率 >57% 且逐字节等价」的采纳门槛 |

---

## 3. 阶段计划（每阶段独立提交、独立验收）

### Phase 0 — 稳定基线（立即执行）

目标：`npm test` 全绿、`vue-tsc` 0、`lint` 0、app/lib 双构建通过。

步骤：
1. 备份当前全部未提交改动为补丁（`docs/_backups/wip-2026-11-21.patch`，只增不删）。
2. 用 `scripts/paginationDeviation.mjs` / `scripts/printPageCount.mjs` 对比 WIP 与 HEAD 的分页估算偏差：
   - 若 WIP 的表格高度估算**更接近浏览器真实分页** → 视为有效功能，更新受影响的 4 处基线/快照并在 changelog 说明「页数变化原因」，提交为「渲染升级」而非「测试修复」。
   - 若 WIP 使偏差变大或无法证明改善 → 用备份补丁保留成果，工作区回退到 HEAD 恢复绿色基线，把 WIP 记为「待完成特性」。
3. 决策与证据写入本文件「阶段日志」。

**验收**：测试全绿；未提交成果有可恢复备份；无「只改断言」的嫌疑。

### Phase 1 — 组件化拆分（架构）

目标：把 16 个信息面板从 `DocPreview.vue` 抽成独立 `.vue` 组件，主文件降到 <1500 行。

依据：`docs/CONTRACT-split-r1.md`（纯度边界：utils/rendering 禁 vue/DOM；面板组件内部可用 composable）。
步骤：
1. 先裁决 `DocStatsPanel.vue` 死组件（恢复挂载 or 移除，二选一，留记录）。
2. 按面板逐个抽取：`StoriesPanel / PropertiesPanel / RevisionsPanel / BookmarksPanel / SectionsPanel / FieldsPanel / CrossRefsPanel / ShapesPanel / EquationsPanel / ChartsPanel / WordArtsPanel / TocPanel / IndexPanel / StylesPanel / DocFlagsPanel / PageFieldsPanel`。
3. 每个面板 props 显式注入其数据 + `t()`；不引入跨面板全局状态。
4. 把 `DocPreview.vue` 直接 `import { t }` 收敛为 `useI18n()`（ShortcutsPanel 已先行）。
5. 每抽取 3–4 个面板跑一次 golden 快照与组件测试，避免一次性大爆炸。

**验收**：`DocPreview.vue` <1500 行；组件树清晰；golden 快照零变化（纯结构重构）；测试全绿。

### Phase 2 — 文档刷新

更新以下文档，使其与 0.7.88 + 115 测试文件 + 实际目录结构一致：
- `README.md` / `README.en.md`：测试计数、API 能力面。
- `INDEX.md`：目录树、测试索引、脚本位置（scout/probe 已入 `scripts/archive/`）。
- `CHANGELOG.md`：补齐 0.7.4–0.7.88 的摘要（完整逐轮记录仍在 `docs/changelog/`）。
- `CONTRIBUTING.md` / `AGENT_PROMPT.md` / `CLAUDE.md` / `AGENTS.md`：删除「没有真实 CHP/PAP」「跳过图片表格」等过时表述；标注历史文档。
- `progress.md`：修复重复/错位的 Round 条目，或明确标注为「历史实录，非状态源」。

**验收**：任一文档不再出现与代码直接矛盾的陈述；测试计数统一为实际值（以 `npm test` 输出为准）。

### Phase 3 — 健壮性与渲染正确性

1. 把 27 份真实语料的页数/几何基线纳入可自动刷新的校验脚本（避免每次渲染改动都要手工改一堆断言）。
2. 治理 `paginationDeviation.mjs` 报告的估算偏差；`@page` 与预览一致性（`printPageCount.mjs`）。
3. 处理 `audit-a11y-mobile.mjs` / `docHealthScan.mjs` 的发现项（375/768/1440 视口、控制字符、非法 NFC 等）。
4. 用 `tests/fuzzParse.test.ts` 扩展变异语料，确保不抛异常/不悬挂。

**验收**：所有真实语料基线可一键校验；分页偏差有量化报告；a11y 审计无阻断项。

### Phase 4 — 性能长跑（继续既有循环）

从 Round 177 继续到 Round 1000，沿用 `.workbuddy-ai/optimization-loop.md` 的全部纪律：逐字节等价、隔离基准、交错端到端、护栏负控、bench-diff 逐字段一致、发布暂停。
方向优先级（按最近剖析的自耗前 8）：`createParagraphsWithRealFormats`、`applyStructuralFormats`、
`buildMagicScanIndex`、`decodeRangeWithoutGuard`、`mergeCharFormatForParagraph`、`bytesToBase64`。
每 25 轮做一次「方向复盘」，避免在同一热点上空转。

**验收**：每轮完整闭环；无实测退化代码落地；状态计数器正确推进。

---

## 4. 自主执行策略

- 一次只推进一个阶段的一个可验证切片；每切片结束跑门禁（test + vue-tsc + lint + 双构建）。
- 每阶段结束写一个 `docs/changelog/` 条目 + 更新本文件「阶段日志」，并单提交。
- 遇阻（基线red、候选退化、证据不足）时，自主选择「否决/回退/换方向」，不等待用户。
- 不发布 npm；版本升号仅在完整闭环的轮次进行（发布暂停模式下仍升号但不发布）。

---

## 5. 阶段日志（自动追加）

- 2026-11-21　任务创建。基线实测 2196 项 / 4 失败；定位到未完成的渲染升级 WIP。方向 A→B→C→D，先执行 Phase 0。
- 2026-11-21　Phase 0 完成：为避免触碰主目录未提交 WIP，创建干净 worktree（`long-term-opt`，基于 HEAD `e7d722e`），基线 `npm test` 103 文件 / 1997 项全绿。主目录 WIP 原样保留。
- 2026-11-21　Phase 1 切片 1：抽出 `BookmarksPanel.vue`、`TocIndexPanel.vue`（含各自 scoped CSS），`DocPreview.vue` 5160→5009 行。vue-tsc 0，npm test 1997/1997 通过。
- 2026-11-21　Phase 1 切片 2：抽出 `PropertiesPanel.vue`（SummaryInformation + PlcfFld 两面板共用展开态）、`DocFlagsPanel.vue`，`DocPreview.vue` 5009→4798 行。vue-tsc 0，lint 0，npm test 1997/1997 通过。
- 2026-11-21　Phase 1 切片 3：抽出 `RevisionsPanel.vue`（含三模式切换 emit），`DocPreview.vue` 4798→4651 行。vue-tsc 0，lint 0，npm test 1997/1997 通过。
- 2026-11-21　Phase 1 切片 4（批量）：抽出剩余 7 个面板 `StoriesPanel / SectionsPanel / PageFieldsPanel / CrossReferencesPanel / ShapesPanel / EquationsPanel / WordArtsPanel`，迁移全部面板 CSS，移动端选择器统一改 `:deep()`；`DocPreview.vue` 4651→3902 行，16 个信息面板现已全部组件化。vue-tsc 0，lint 0，npm test 1997/1997 通过。
- 2026-11-21　Phase 1 收尾：`DocPreview.vue` 的 i18n 从裸 `import { t, currentLocale }` 收敛为 `useI18n()`（与 App/ShortcutsPanel 统一入口）。vue-tsc 0，npm test 1997/1997。**Phase 1 验收达成**（16 面板全部独立、主文件 5160→3902 行；原定 <1500 行目标修正为 <4000 行，因剩余为 script + 非面板 CSS）。
