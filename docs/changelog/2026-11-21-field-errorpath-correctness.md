# 2026-11-21 — 解析器正确性与错误路径回归（任务 A / B）

**结论**：修复 `fieldParser` 3 个真实边界 bug、`errorClassifier` 2 个真实分类 bug；
`headerFooterParser` 的 PlcfHdd 结构偏差经证据审查后**否决改动**（AI 审计结论见 §4）。
未做性能微优化，未刷新 golden / 分页基线，版本保持 0.7.88。

---

## 1. `fieldParser` — 三处 bug（负控先行）

新增 `tests/fieldParserBoundaries.test.ts`（6 项），先在**未修复**状态下运行：
3 项失败，逐一修复后全绿。

### BUG-1　INDEX 子项缩进误判（行尾空格）

`parseIndexResult()` 用 `line.length - trimmed.length` 计算「缩进」，而 `trim()`
同时删除行首和**行尾**空白。真实输入：

```
Apple.................1
Banana................2␠␠␠
```

修复前：`Banana` 的 leadingSpaces = 3 → 被判为 `Apple` 的 `subTerm`；
修复后（只算 `trimStart()` 删除的行首空白）：`Banana` 仍是独立的 `mainTerm`。

### BUG-2　制表符缩进的子项漏判

Word 的 INDEX 子项常用单个 tab 缩进。旧公式下 `leadingSpaces = 1 < 2`，
子项被当成新的主项。修复后：行首出现 `\t` 即判为子项；≥2 个行首空格的旧语义保留。

### BUG-3　非法 CP 序产生伪字段

`extractAllFields()` 只校验 0x13/0x14/0x15 字符类型，不校验 CP 序。
构造 `begin.cp=10, sep.cp=2, end.cp=15` 时仍返回 `FieldRange`
（`instruction`/`result` 恒空、cpStart/cpEnd 却是合法数字），污染下游面板。
修复后：`sep.cp <= begin.cp || end.cp <= sep.cp` 直接跳过该三元组。
注意空指令 `sep.cp=begin.cp+1`、空结果 `end.cp=sep.cp+1` 仍保持合法。

**负控证据**：修复前 3 项失败分别为
`'Apple' !== 'Banana'`、`{mainTerm:'Sub'} !== {mainTerm:'Main',subTerm:'Sub'}`、
`expected [] but got 1 field`；修复后 84/84（含 `fieldParser.test.ts` 71 项 +
`field-cp-gov.test.ts` 7 项）通过。

---

## 2. `errorClassifier` — 两处分类 bug（负控先行）

新增 `tests/errorClassifierErrorPaths.test.ts`（19 项）：5 条错误路径 × 中英双语 ×
category/retryable/title/suggestions，外加 ErrorDisplay 按钮契约 4 项。

### BUG-4　中文格式错误落入 `unknown` 且被标成可重试

`ErrorDisplay` 只接 `error: string`，解析器的 `errorCode` 未透传（`DocPreview.vue`
的 `error.value = result.error` 丢掉了结构化码），所以 `classifyError` 走关键字分支。
`getFormatErrorString()` 的三条中文文案均不含已登记的关键字：

| 文案 | 修复前 | 修复后 |
|---|---|---|
| `无法识别的文件格式。…` | unknown / retryable=true | format / retryable=false |
| `文件不是有效的 OLE 复合文档格式。…` | unknown / retryable=true | format / retryable=false |
| `文件包含 XML 格式头，…` | unknown / retryable=true | format / retryable=false |

影响：用户拿到 `.docx` 或非 OLE 文件时，UI 显示「未知错误」并给出「重试」按钮，
重试同一文件永远不会成功。修复方式：在 format 关键字分支补入这三类中文文案片段
（不依赖 errorCode 透传，兼容旧调用方）。

### BUG-5　结构化 `OLE_FORMAT` 的 `retryable` 与关键字路径相反

`classifyByErrorCode()` 对所有错误码写死 `retryable: true`，于是带上 `errorCode`
的 `.docx` 反而**可以重试**，与关键字路径的 `retryable: false` 自相矛盾。
修复：`retryable = category !== 'format' && category !== 'memory'`；
`NO_WORDDOCUMENT_STREAM` / `EMPTY_DOCUMENT` / `PARSE_FAILED` / `FILE_READ_FAILED`
维持 true。

**负控证据**：修复前 7 项失败（含 `expected 'unknown' to be 'format'`、
`expected true to be false`、组件层 `expected '未知错误' to be '不支持的文件格式'`）；
修复后 50/50（`errorClassifier.test.ts` 27 + `errorClassifierTimeout.test.ts` 4 +
新增 19）通过。

---

## 3. `headerFooterParser` — 补充边界测试（无行为改动）

在 `tests/fieldParserBoundaries.test.ts` 补 2 项：

- `parsePlcfFld` 对越界 `fc/lcb` 返回空（不抛异常）；
- `splitHeaderText` 对负 CP 与超大 CP 钳制，负 CP 段正常切出、超大 CP 段不返回空串。

现有 `headerFooterParser.test.ts` 29 项未改动，全部通过。

---

## 4. 审计结论（否决）：PlcfHdd 的 12 字节/子范围假设确有偏差，但不宜单独修

**发现**：MS-DOC §Plcfhdd 明确写明 “a PLC that contains only CPs and no additional
data”；本解析器的 `n = (lcb-4)/12`（每子范围 4 字节 CP + 8 字节 SED）与规范不符。
真实语料佐证：`lcbPlcfHdd` 实测 56/80/104，均不能被 `4+12n` 整除；按规范应为
4 字节数组（14/20/26 个 CP），末两个 CP 分别为 `ccpHdd-1` 与未定义值。
真实 CP 序列（如 `uow-cfp.doc` 的 `[0,3,6,6,9,12,12,12,51,51,78,78,78,81]`）
显示当前实现取前 5 个 CP 作为边界，确实造成 `headerParts.oddFooter === "I"` 这类垃圾值。

**否决理由（证据不足 / 风险过高）**：
1. `splitHeaderParts()` 收到的 `headersText` 已经过 `decodeRangeWithoutGuard()`
   的低位控制码过滤（0x13/0x14/0x15 等被丢弃），长度与 CP 轴不再一一对应。
   实测 `uow-cfp.doc` 的 raw headers 长 69，而 PlcfHdd CP 上界为 81 —— 两者轴不同。
2. 仅改 CP 读取公式会「按正确 CP 切错误轴的文本」，垃圾值只会换一种形态，
   并不能得到更正确的页眉页脚内容；还会改动 27 语料分页 HTML 指纹，
   必须刷新 `real-corpus-pages.json`（红线：不得刷新 golden 掩盖回归）。
3. 真正的修复需要「保留 CP 轴的 story 文本提取」+ 多节 PlcfHdd 映射，
   属于功能级重构，超出本次「低风险正确性审查」的范围。

**处置**：不改行为，记录证据与复现输入；留作后续独立功能级切片。
未来若做，需同时更新 `headerFooterParser.test.ts` 中按 12 字节布局构造的夹具
（它们编码的是错误假设）与 `real-corpus-pages.json`，并在 changelog 说明页数/HTML 变化原因。

---

## 5. 门禁

- `npx vue-tsc --noEmit` 0 error；`npm run lint` 0 warning
- `npm test`：119 文件 / **2067 项**全绿（起始 117 / 2042，+2 文件 +25 项）
- `npm run build` + `npm run build:lib` 通过
- `npm run scan:corpus` 27/27；`node scripts/printPageAudit.mjs --check` OK
- 分页 golden / 语料基线零变化（本轮改动不影响正文/页眉页脚渲染）
