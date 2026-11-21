# 打印页数对照基线（printPageAudit）+ 打印布局纯函数抽取

**日期**：2026-11-21　**类型**：可验证审计基线 + 架构小切片（不改打印/预览行为）。
**影响面**：新增 `src/utils/rendering/printLayout.ts`；`DocPreview.vue#printDocument`
改为调用纯函数（已验证输出与 HEAD 内联模板**逐字节相同**）；新增 npm `audit:print`、
fixture 与 6 项 vitest 用例。

## 一、背景与适配说明

任务要求用 `printLayout.ts` 的 `buildPrintPageCss` / `buildPrintWindowHtml` 生成打印 HTML。
本 worktree 原本**没有** `printLayout.ts`——打印 CSS 全部内联在
`DocPreview.vue#printDocument`（约 80 行模板字符串），与此前
`2026-11-21-page-navigation-virtual-scroll-fix.md` 的审计结论一致。为让审计可重复、
可打包调用，本轮按 `docs/CONTRACT-split-r1.md` 的「utils/rendering 纯函数、无 vue/DOM」
边界把这段模板抽为纯函数模块：

- `buildPrintPageCss({ title, labels })` → `<style>` 内的 CSS 文本；
- `buildPrintWindowHtml({ title, labels, bodyHtml, lang? })` → 完整打印窗口 HTML。

`title` 仍由调用方 `escapeHtml()`（DOM 依赖，留在组件侧），模块本身纯字符串拼接。
**等价性证据**：以固定入参替换插值后，新模块输出与 `git show HEAD` 中内联模板
逐字节相同（CSS 与完整 HTML 均 `true`）；未改动任何 CSS 规则。

## 二、`scripts/printPageAudit.mjs` 的用法

```bash
npm run audit:print                          # 刷新 tests/fixtures/print-layout-audit.json
node scripts/printPageAudit.mjs --check      # 只校验 fixture 是否与当前源码一致（不写文件）
node scripts/printPageAudit.mjs --json x.json
```

流程（纯 Node + esbuild 临时打包 + happy-dom，无需浏览器）：

1. 临时 entry 同时导出 `parseDocFileFromBuffer`、`renderDocumentToPages`、
   `buildPrintPageCss`、`buildPrintWindowHtml`，与预览/打印共用同一份实现；
2. 对 `docs/*.doc` 逐个 parse + render，渲染入参**与
   `tests/realCorpusPageBaseline.test.ts` 完全同口径**（首节 `pageHeightPt`、
   `headerFooter`、修订 marks、字体回退），故审计的 `previewPages` 可与钉住的
   页数基线逐样本交叉核对；
3. 用打印纯函数生成每份样本的打印 HTML，统计 `@page` 规则数、margin box 数、
   CSS/正文中的分页规则数、分节数与 `.page-content` 容器数；
4. 输出对照表到 fixture，由 `tests/printLayoutAudit.test.ts` 钉住结构不变量。

## 三、结果（27/27 解析成功）

| 指标 | 值 | 可自动核验 |
|---|---|---|
| 预览页数合计 | 1055（与 `real-corpus-pages.json` 27/27 逐样本一致） | ✅ |
| `.page-content` 容器数 | 1055（= 预览页数，逐样本相等） | ✅ |
| `@page` 规则数 | 每份 1（全样本 `@page { size: A4; margin: 25mm 20mm … }`） | ✅ |
| margin box 数 | 每份 2（`@top-center` 标题 + `@bottom-center` 页码） | ✅ |
| CSS 分页规则数 | 每份 1（`.page-break { page-break-before: always }`） | ✅ |
| 正文显式分页标记 | 0–6 份不等（`break-before: page` / `page-break-before: always`） | ✅ |
| 分节数 | 1–4（`unicode-01351-N2376.doc` 最多，4） | ✅ |
| **打印页数** | **null（全部样本）** | ❌ 需人工打印验证 |

## 四、局限与裁决（不编造数字）

- 本环境 Playwright 包已装但 **Chromium 二进制不存在**
  （`chromium.executablePath()` 指向的文件不存在），无法用 `page.pdf()` 实测打印页数。
- 即便有浏览器，预览页数是 `pageBuilder` 的**字符估算分页**，打印页数是浏览器
  **回流结果**，两套布局独立；当前打印 CSS 也没有给 `.page-content` 设固定高度或
  `break-after: page`，预览分界线在打印时被忽略——因此二者天然不必相等。
- 按章程「不编造证据」，fixture 的 `printPageCount` 恒为 `null`，并在报告中显式
  声明 `manualOnly: ["printPageCount"]` 与三条局限。`tests/printLayoutAudit.test.ts`
  钉住「必须为 null」：任何把猜测数字写进来的改动都会失败。
- 因此本轮**不改打印 CSS**（如贸然加 `.page-content { break-after: page }`，缺实测
  基线，可能引入空白页/更差分页），只建立可刷新对照表与结构不变量。

## 五、门禁（本切片）

`npx vitest run tests/printLayoutAudit.test.ts` 6/6 通过；完整门禁见阶段日志。

后续建议：在装有 Chromium 的环境里扩展本脚本，新增经校验的 `page.pdf()` 页数采集
（统计 PDF `/Type /Page` 对象并与人工打印抽样对齐），填入 `printPageCount` 后再评估
是否让打印复用预览分界线。
