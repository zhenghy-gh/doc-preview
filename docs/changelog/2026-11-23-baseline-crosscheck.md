# 2026-11-23 — 双基线交叉校验与第三消费者口径统一

**范围**：任务 B — `tests/fixtures/real-corpus-pages.json` 与 `tests/fixtures/print-layout-audit.json` 交叉校验；补充一致性测试。

## 1. 两份基线的交叉校验结论

逐份比对 27 项：

| 检查 | 结果 |
|---|---|
| 文档集合（27/27，逐名一致） | ✅ 一致 |
| `real-corpus-pages.pages` ↔ `print-layout-audit.previewPages` | ✅ 27/27 一致，无漂移 |
| `pageContentCount` ↔ `previewPages` | ✅ 27/27 一致 |
| `totals.previewPages` = `totals.pageContentCount` = 27 份之和 = 1055 | ✅ 一致 |
| `printPageCount` 恒为 `null`（本机无 Chromium，不编造） | ✅ 一致 |
| `sections` 总计 31（openstd-n961=2、unicode-01351-N2376=4，其余 25 份=1） | ✅ 自洽 |

**没有发现两份基线之间的互相矛盾断言**，故不修任何一份基线的数值（拒绝「刷新两份了事」）。

## 2. 真正的口径不一致：第三个页码消费者 `scan:corpus`

`scripts/corpusHealth.mjs` 是第 3 个渲染语料并报告页数的消费者，但**硬编码 `pageHeightPt: 842`**，
而两份钉住基线都用 `firstSection?.pageHeightPt || 842`。实测 7/27 份页数漂移：

```
openstd-n961.doc        scan=18  baseline=19
unicode-02006-zia.doc   scan=13  baseline=15
unicode-03042-voting.doc scan=60 baseline=64
unicode-n1750w97.doc    scan=12  baseline=13
unicode-n4100.doc       scan=10  baseline=11
unicode-n4250.doc       scan=16  baseline=17
uow-bio.doc             scan=10  baseline=11
```

这不是两份基线互相矛盾，而是**扫描脚本口径有误**。修复方式是把 `corpusHealth.mjs` 改成与两份基线
完全相同的「首节页高优先」口径 —— 不刷新任何基线。修复后 27/27 页数一致，`scan:corpus` 仍 27/27 健康。

### 负控

在 `tests/baselineConsistency.test.ts` 新增第 3 项：实跑 `scripts/corpusHealth.mjs --json` 并逐份核对
页数与基线。负控（把 `pageHeightPt` 改回硬编码 842）⇒ 1 失败 / 2 通过；恢复后 3/3 通过。

## 3. 一致性测试覆盖（现共 3 项）

1. `baselineConsistency.test.ts`：文档集合 + `previewPages` 逐份一致 + `printPageCount` 不被当作 0/页数。
2. `baselineConsistency.test.ts`：`printPageCount` 全部 `null`，`autoVerifiable`/`manualOnly` 非空。
3. `baselineConsistency.test.ts`（新增）：第三消费者 `scan:corpus` 与两份基线同口径、27/27 页数一致、零健康 issue。

`printLayoutAudit.test.ts` 原有 6 项另覆盖 `pageContentCount`、`totals` 与打印 CSS 规则数不变量，两者互补。

## 4. 附带更正

`docs/changelog/2026-11-21-render-correctness-audit.md` 原称「NUMPAGES/SECTIONPAGES 回填在 finalizePage
后统一执行」——与本 worktree 源码不符（`pageBuilder.finalizePage` 只注入分栏 CSS）。已更正为「该特性属
主目录 WIP，不在本 worktree」。

## 5. 门禁

`npm test` 131 文件 / 2115 项全绿（新增 1 项基线一致性测试）；`npx vue-tsc --noEmit` 0；`npm run lint` 0；
`npm run build` + `build:lib` 通过；`npm run scan:corpus` 27/27；`node scripts/printPageAudit.mjs --check` OK；
`npm run audit:i18n` exit 0。
