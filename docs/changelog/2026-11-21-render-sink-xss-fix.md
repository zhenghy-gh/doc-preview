# 渲染汇聚点 XSS 修复（存储型，高危）

**日期**：2026-11-21　**结论**：确认并修复真实漏洞；未刷新任何 golden 快照。

## 漏洞

`renderDocumentToPages`（`src/utils/rendering/documentRenderer.ts`）的
`renderParagraphHtmlCore` 把「可信 HTML 片段」与「普通段落正文」拼到同一个字符串，
随后以 `hasHtml=true` 交给 `paragraphStyleRenderer`。后者在 `hasHtml=true` 时
**不再转义文本**。问题在于两个片段注入点只转义了「被标记的那一段」：

1. **超链接路径**（`documentRenderer.ts`）：只 `escapeHtml(linkText)`，
   `before`/`after`（链接之外的正文）原样拼接。
2. **修订路径**（`revisionRender.ts` `applyRevisionsToText` marks 模式）：
   只 `escapeHtmlSimple(revText)`，`before`/`after` 原样拼接。

于是外部 `.doc` 里一段同时含 HYPERLINK 域（或修订标记）与
`<img src=x onerror=alert(1)>` 的正文，会把该 `<img>` 作为真实标签注入 `v-html`
⇒ 存储型 XSS。此前 `sanitizeUrl` 只修了 `href` 的 scheme，未覆盖正文逃逸。

**复现（修复前实测输出）**：
```
<p ...><img src=x onerror=alert(1)><a href="https://...">CLICK</a></p>
<p ...><img src=x onerror=alert(1)>R<ins class="rev-insert">EV</ins></p>
```

## 修复

- `revisionRender.ts`：marks 模式改为**自尾向前分段拼接**——每段普通文本单独
  `escapeHtmlSimple`，只有 `<ins>/<del>` 标签是原生 HTML。对不重叠修订与旧实现
  逐字节等价（降序处理保证靠后修订不影响靠前下标）。无实际标签产出（如全零长
  修订）时仍返回 `hasRevisionHtml=false`，维持旧语义。
- `documentRenderer.ts`：超链接注入同样改为自尾向前分段拼接，`before`/`after`
  等普通文本段逐段 `escapeHtml`，仅 `<a>` 标签可信。placements 本就按 `from`
  降序排列，故不等价风险仅限重叠链接（异常输入）。

accepted/rejected 修订模式不产出 HTML（`hasRevisionHtml=false`，下游照常转义），
保持原样以避免双重转义。

## 证据

- 新增 4 项回归测试（`tests/renderSecurity.test.ts`）：链接外文本、多链接间隙、
  修订前后文本、修订标记内文本，全部断言恶意标签以 `&lt;` 形式出现。
- **负控已验证**：把两个生产文件 checkout 回 HEAD 后重跑，4 项新测试全部失败
  （`4 failed | 4 passed`）；恢复修复后 `8/8` 通过。
- 27 份真实语料**均无 revisions/hyperlinks 抵达渲染器**（脚本实测 0/27），
  故 golden 快照与 `real-corpus-pages.json` 指纹零变化，无「刷新快照掩盖回归」。
- 全量门禁：`vue-tsc` 0、`lint` 0、`npm test` 113 文件 / 2030 项、`build` +
  `build:lib` 通过、`scan:corpus` 27/27 健康。
