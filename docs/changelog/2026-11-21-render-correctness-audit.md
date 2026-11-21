# 2026-11-21 · 渲染正确性与双基线交叉审计

## 结论

审查 `src/utils/rendering/documentRenderer.ts` / `pageBuilder.ts` / `tableText.ts` 的分页与表格路径，以及两份真实语料基线的一致性。

### 发现并修复：内联图片 `src` 未转义（属性注入面）

`documentRenderer.ts` 有三处直接拼 `<img src="${src}">`（`\u0001` 占位替换两处、末尾兜底一处），
而同仓库 `inlineAssetRenderer.renderInlinePictureHtml` 使用 `escapeHtmlAttribute(pic.dataUrl)`。
虽然当前 `images`/`pictures` 的 dataUrl 由内部 base64 转换构造，但任何畸形字符串中的引号都会
击穿 `src` 属性并注入标记。三处统一改为 `escapeHtmlAttribute(src)`，与既有图片/图表渲染口径一致。

- 护栏：`tests/renderSecurity.test.ts` 新增 1 项（dataUrl 含 `"` + `onerror=`）。
- 负控验证：撤回转义后该测试失败（1 failed / 8 passed），恢复后 9/9 通过。
- 27 份语料 HTML 指纹零变化（base64 不含被转义字符）。

### 双基线交叉校验

`tests/fixtures/real-corpus-pages.json`（27 份页数 + HTML 指纹）与
`tests/fixtures/print-layout-audit.json`（预览/打印版式）逐份对照：
- 文档集合完全一致（27/27）
- `previewPages` 与 `pages` 无一处漂移
- `printPageCount` 全部为 `null`（本机无 Chromium，未编造数字）

新增 `tests/baselineConsistency.test.ts`（2 项）把上述不变量钉成可自动校验的测试。

### 否决的改动

- 表格固定高度 100px（`documentRenderer.ts` 表格分支）：属"表格跨页切分"功能缺口，
  修复需引入整套切块/表头重复/垂直合并降级逻辑（即主目录 WIP 的方向），
  超出本轮低风险范围，**不改动**，留作独立功能级切片。
- 页眉页脚 `NUMPAGES`/`SECTIONPAGES` 标记回填：未发现可达缺陷（回填在 `finalizePage` 后统一执行），不修改。

## 门禁

`vue-tsc` 0 · `lint` 0 · `npm test` 125 文件 / 2092 项 · `build` + `build:lib` 通过 ·
`scan:corpus` 27/27 · `audit:i18n` exit 0。
