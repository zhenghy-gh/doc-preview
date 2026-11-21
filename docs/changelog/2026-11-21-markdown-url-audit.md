# Markdown 导出 URL 策略审计与收紧

**日期**：2026-11-21　**结论**：发现 1 处功能性不一致 + 1 处白名单过宽，均已修复。

## 审计目标

`markdownExport.ts` 的 `isSafeUrl`（不可信 `href`/`src` → Markdown 汇聚点）。

## 发现与修复

### 1. `tel:` 缺失（功能性 bug）

`isSafeUrl` 的 scheme 白名单只有 `https?|mailto`，而渲染侧
`documentRenderer.sanitizeUrl` 放行 `http/https/mailto/tel`。结果 `.doc` 中的
`tel:` 超链接在 Markdown 导出里被降级为纯文本，与预览行为不一致。
→ 在白名单补上 `tel:`，两者对齐。

### 2. `data:image` 白名单过宽（安全加固）

旧正则 `/^data:image\/[a-z0-9.+-]+(?:;[^,]*)?,/i` 放行了任意图片子类型，
包括 `data:image/svg+xml,...`。SVG 可携带 `<script>`/事件处理器，部分 Markdown
渲染器会把 data URL 内联为可执行 SVG。
→ 收紧为栅格格式白名单 `png|jpe?g|gif|bmp|webp`（解析器自身只产出
png/jpeg/gif/bmp，见 `imageFormatMime`），SVG 不再放行。

注：本函数消费的是 DOM 属性（`getAttribute` 已解码 HTML 实体），
故 `sanitizeUrl` 里的实体/空白绕过归一化在这里不需要重复实现；控制字符检查
仍保留。

## inlineAssetRenderer 审计结论

`src/utils/rendering/inlineAssetRenderer.ts` **没有** `isSafeImageSrc`（任务描述中
提及的符号不存在），实际汇聚点审计如下：

- `renderTextboxAnchorHtml`：`shape.spid` 类型为 `number`（来自 `readUint32`），
  `anchorType` 是固定联合类型 `ShapeAnchorType`，二者无法携带属性逃逸载荷；
  `title` 由数字/固定文案/`t()` 结果拼成。
- `renderInlinePictureHtml`：`src` 用 `escapeHtmlAttribute(pic.dataUrl)`，
  `dataUrl` 由 `bytesToBase64DataUrl` 内部生成（`data:image/<raster>;base64,...`），
  非外部可控 scheme；`style` 由 `Math.min(number, ...)` 拼装。

未发现可达漏洞，故不改动该函数（避免无谓 golden 变化）。若未来允许外部调用方
直接传入 `dataUrl`，应比照本条补一层栅格白名单。

## 证据

- `tests/markdownExport.test.ts` 新增 3 项：`tel:`/`mailto:` 保留、栅格 data URL
  保留而 `svg+xml` 被拒、`data:`/`vbscript:`/`file:` 链接被拒。全文件 37/37 通过。
- 全量门禁同上一提交：`vue-tsc` 0、`lint` 0、`npm test` 113/2030、`build` +
  `build:lib`、`scan:corpus` 27/27 均通过。
