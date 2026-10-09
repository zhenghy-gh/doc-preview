# Round 112 — 2026-10-09

## 结论

采纳 1 项优化：`guessCharFormat` 与 `detectAlignment` 在**无 CJK 时跳过 O(n) 的 `countChineseAndWhitespace`**。端到端 **1.084x（中位数）/ 1.108x（最小值）**，约 +9 %。

## 目标

Round 111 之后重新剖析，`guessCharFormat`（7.17 %）与 `detectAlignment`（5.12 %）成为新的次热点，两者**各自**对同一段文本跑一次 O(n) 的 `countChineseAndWhitespace` 只为拿 `chineseCount`。

## 关键量化

先用探针实测（27 份 / 33 819 段 / 1 456 460 字符，每段按调用两次计）：

```
countChineseAndWhitespace ×2/段 : 824.8 / 842.4 / 825.1 / 845.2 ms  min=824.8
HAS_CJK_RE.test ×2/段           :  39.4 /  40.4 /  46.0 /  40.5 ms  min= 39.4
=> 正则探测 / 逐字符计数 = 20.93x
```

真实语料里 **99.98 % 的段落一个 CJK 都没有**（Round 111 已插桩实测），所以绝大多数调用都白跑一趟。

## 等价性论证

无 CJK ⇒ `chineseCount` 必为 0。两个函数里对 `chineseCount` 的判断**全部是 `>= 2`**：

- `guessCharFormat` 三处：字体选择 `chineseCount >= 2`；`pureName` 的 `chineseCount >= 2`（`&&` 链最左）；`isShortChineseTitle` 的 `chineseCount >= 2`（`&&` 链最右，但 `chineseRatio > 0.5` 在左，`0 > 0.5` 亦为假）。
- `detectAlignment` 两处：`onlyName` 的 `chineseCount >= 2`；居中标题的 `chineseCount >= 2`。

因此 `chineseRatio`、`strippedLength` / `strippedLen`（唯一依赖计数结果的三个量）**都不会被读取**，整次逐字符计数可以省掉。空串时原实现算出的 `chineseRatio` 是 `NaN`，新实现取 0；两者在 `> 0.7` / `> 0.5` 上同为假，且那两处本身都在 `chineseCount >= 2` 之内。

## 改动

`src/utils/docparser/heuristics/textHeuristics.ts`（+36 / −6）：

- 新增 `HAS_CJK_RE = /[\u4e00-\u9fff]/`（判定域与 `countChineseAndWhitespace` 里的中文判定完全一致）；
- `guessCharFormat`：把 `const [chineseCount, whitespaceCount] = countChineseAndWhitespace(text)` 改为「先 `HAS_CJK_RE.test(text)`，命中才算」，未命中时 `chineseCount = 0`、`chineseRatio = 0`、`strippedLength = 0`；`totalLength` 提到最前；
- `detectAlignment`：同样处理，未命中时 `chineseCount = 0`、`strippedLen = 0`；
- `countChineseAndWhitespace` 本身**一行未改**（其穷尽护栏 `tests/textHeuristics.counts.test.ts` 继续有效）。

## 端到端（27 份 / 7.6 MB，独立进程，交错 5×NEW/5×OLD 再反向 5 对 = 20 进程 × 20 轮；对照 = Round 111 后的状态）

- 中位数之中位数：NEW **104.64 ms** vs OLD **113.44 ms** → **1.0840x**
- 最小值之中位数：NEW **97.99 ms** vs OLD **108.54 ms** → **1.1077x**

## 等价性证据

1. **端到端逐字节一致（最强）**：27 份 `parseWithFormat()` 的**完整结果**序列化后 `cmp` —— **27 文件 / 16 247 039 字符，0 处差异**。
2. **常驻差分护栏** `tests/textHeuristics.cjkGuard.test.ts`（**6 项**）：参照实现是改动前两个函数的逐行转写（无条件计数），只借用生产模块导出的 `countChineseAndWhitespace` 与 `detectCharacterStyles`，其余小工具与全部正则在本文件内复刻（作用域边界已在文件头注明）。① 穷举混合字母表（含 CJK / 数字 / 全角空白 / 标点）长度 ≤ 3；② 同一批串对 `detectAlignment` 用 4 组 `(index, totalParagraphs)`；③ **穷尽全部 65 536 个 BMP 单字符**（两个函数各跑一遍）；④ 随机 4 000 串（长度 ≤ 60），**断言 `cjkSeen > 1000`、`boldSeen > 10`、`alignSeen > 10` 防空转**；⑤ 标题/对齐的确定性用例，**断言 `bold > 0`、`align > 0`**；⑥ `chineseCount` 的 2 / 4 边界（1、2、3、4、5 个 CJK）。
3. **鉴别力（负控 4 组）**：① 无 CJK 分支把 `chineseCount` 写成 2 → **5 failed / 1 passed** ✓；② 守卫取反（只有无 CJK 时才计数）→ **5 failed / 1 passed** ✓；③ 探测正则改成 `/[a-z]/` → **5 failed / 1 passed** ✓；④ **更慢但等价**（守卫重复求值两次）→ **6 passed**（正确地零差异）✓。
4. **全量测试 / 类型 / lint / 构建 / bench-diff 全绿。**

## 验证

- `npx vue-tsc --noEmit`：0 错误。
- `npm run lint`：0 问题。
- `npm run build` / `npm run build:lib`：通过。
- `npm test`：**75 文件 / 1446 项**通过（较 Round 111 的 74/1440 **+1 文件 +6 项**）。
- `node bench-diff.mjs 1120` 与 `cycle-1110`：全部统计字段逐位相同，13 个失败样本与 `topIssues` 完全一致，**零新增回归**。

## 指标与包体

- **端到端 1.084x（约 +9 %）**。
- 库 `dist-lib/doc-preview.js` raw 352.75 → **352.93 kB**、gzip 94.86 → **94.91 kB**（**+0.05 kB gzip**）；
- 库 UMD raw 263.50 → **263.59 kB**、gzip 83.05 → **83.10 kB**（+0.05 kB）。
- **+0.05 kB gzip 换 9 % 端到端**，收益明确、增长已论证。

## 下一轮方向

- `createParagraphsWithRealFormats`（9.91 %，热点在 L7842 的 `mergeCharFormatForParagraph` 调用点 2.23 % 与 L7845–7847 的 spread+rest 1.86 %）；
- `applyStructuralFormats`（7.27 %，需先做调用点级归因）；
- `extractImagesFromStream`（5.07 %）；`bytesToBase64`（3.40 %，Node 22 无原生 `Uint8Array.prototype.toBase64`，已排除）；
- **同源思路的延伸**：`detectParagraphFormat` 内部 `detectListInfo` 仍对每段做 `text.trim()`（分配）；`detectAlignment` 也做 `text.trim()`。可考察「无 CJK 段落是否还需要 `trim()`」——注意 `ALL_CAPS_LINE_RE` 带 `$`，直接在 `text` 上测**不等价**，需谨慎。

**已被证伪、不要动**：Round 111 已记录的全部条目（`detectCharacterStyles` 键比较去分配、Round 110 pieceMap 临时数组、`Uint16Array` 视图 + 奇偶守卫、越界读取代替守卫、图片扫描「范围守卫 + 表」、`imageExtractor` 四锚点游标、段落格式共享文本上下文、`countChineseAndWhitespace` 合并（两个调用点输入不同）、OLE 层 `readRegularStream`、Round 103 七条、`DATE_TIME_RE`）。
