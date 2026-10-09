# Round 105 — `guessCharFormat` / `detectAlignment` 的两次全串扫描合并成一趟

Round 104 把热点从 OLE 层挪到了段落 / 格式装配层。本轮在 `guessCharFormat`
（段落级最大单函数，51.2 ms/轮）与 `detectAlignment` 里，把**两次独立的全串扫描**
（`countChineseChars` + `countWhitespaceChars`）合并成**一趟** `countChineseAndWhitespace`，
结果逐字相同，端到端解析 **1.05x**。改动是纯计数、零语义风险。

---

## 起因：段落级热函数范围测定

Round 104 之后，对语料全部 33 819 个段落压测导出的热函数：

```
guessCharFormat:          51.22 ms / 全语料一轮
detectCharacterStyles:    34.79 ms / 全语料一轮
guessCharFormat / detectCharacterStyles = 1.47x
```

`guessCharFormat` 内部对每段文本做了**多次整串遍历**：`countChineseChars(text)`、
`countWhitespaceChars(text)`、`text.trim()`、以及若干 `RegExp.test/match`。其中
`countChineseChars` 与 `countWhitespaceChars` 是**两条独立的 O(n) 扫描**，仅用于拿
「中文字数」与「空白字数」两个标量——完全可以一趟合并。

`detectAlignment` 里也有同一对调用（`countChineseChars(trimmed)` +
`countWhitespaceChars(trimmed)`），同样可合并。

---

# 改动（`src/utils/docparser/heuristics/textHeuristics.ts`）

新增一趟合并计数器（导出，供两处调用点共用）：

```ts
export function countChineseAndWhitespace(text: string): [number, number] {
  let chinese = 0
  let whitespace = 0
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    if (code >= 0x4e00 && code <= 0x9fff) chinese++
    else if (isWhitespaceCode(code)) whitespace++
  }
  return [chinese, whitespace]
}
```

两处调用点改写：

- `guessCharFormat`：
  ```ts
  // 旧：const chineseCount = countChineseChars(text); ...; const strippedLength = totalLength - countWhitespaceChars(text)
  const [chineseCount, whitespaceCount] = countChineseAndWhitespace(text)
  const strippedLength = totalLength - whitespaceCount
  ```
- `detectAlignment`：
  ```ts
  // 旧：const strippedLen = totalLen - countWhitespaceChars(trimmed); const chineseCount = countChineseChars(trimmed)
  const [chineseCount, whitespaceCount] = countChineseAndWhitespace(trimmed)
  const strippedLen = totalLen - whitespaceCount
  ```

清理：删除不再被引用的本地 `countWhitespaceChars` 与 `import { countChineseChars }`
（`encodingDetector` 内部的 `countChineseChars` 不受影响，仍在使用）。

**等价性**：中文字符判定恒为 `[0x4e00,0x9fff]`，空白判定与 `isWhitespaceCode` 完全一致
（即 JS `\s` 的 Unicode 码点集合），合并只是把两趟循环并在一趟，计数结果逐字相同。

---

# 隔离基准（语料 33 819 段落，平均长度 43.1）

微基准先做了**等价性自检**（合并实现 vs 两个独立函数逐项）：`mismatch = 0`。

| 变体 | 耗时 |
|---|---|
| separate（2 passes） | 14.187 ms |
| merged（1 pass） | 12.508 ms |
| **merged / separate** | **1.13x** |

---

# 端到端验证（真实收益）

27 份样本 / 7.6 MB 语料，独立进程，120 轮取最小，`git stash` 切换源码分别打包对比：

```
OLD（0.7.48 源码）   min 137.10 ms
NEW（本轮）          min 130.97 ms
→ 端到端 1.05x
```

隔离的 1.13x 折算到端到端是 1.05x——符合预期：`guessCharFormat` 的 51 ms 里两趟计数只是
其中一部分（其余是 `RegExp` 判定与 `detectCharacterStyles`），而 `detectAlignment` 也贡献
一份。这是真实可测的 ~5 % 解析提速，且零语义风险。

---

# 等价性证据（四重）

1. **常驻护栏** `tests/textHeuristics.counts.test.ts`（**4 项**）：穷举长度 ≤ 4 全串
   （类别代表字母表）与两个参照一致并交叉验证 `countChineseChars`；随机串 4000 组；
   空串 / 全空白 / 全中文边界；NBSP/ZWNBSP/全角空格等 `\s` 等价空白全部计入。
2. **端到端逐位一致**：`node bench-diff.mjs 1050` 对 27 份样本解析，与 `cycle-1040`
   **除 `cycle`/`timestamp` 外全部字段逐位相同**（median 0.9502433994244857、min
   0.8115474418758475，`topIssues`/`failures` 完整列表也逐条相同）——**13 个失败样本
   两个轮次完全一致，零新增回归**。
3. **定向测试**：护栏 4/4 通过；`npm test` **67 文件 / 1403 项**通过（较 Round 104 的
   66/1399 **+1 文件 +4 项**）。
4. **类型与 lint**：`npx vue-tsc --noEmit` 0 错误；`npm run lint` 0 错误。

---

# 护栏 bug（测试自身的坑，已修）

第一版「NBSP / ZWNBSP / 全角空格」用例用手写字面量构造字符串，其中一个字符并非
`isWhitespaceCode` 集合成员，导致 `count === s.length` 断言 8 vs 7 失败。改法：用
`String.fromCharCode(...[0xa0,0x3000,0x1680,0x2028,0x2029,0x202f,0x205f,0xfeff])`
从显式码点构造，断言改为比对参照谓词，4/4 全绿。

---

# 验证清单

- `npx vitest run tests/textHeuristics.counts.test.ts` → **4 passed**
- `npm test` → **67 文件 / 1403 项**通过
- `npx vue-tsc --noEmit` → 0 错误
- `npm run lint` → 0 错误（注意：esbuild 产物 `.bench105*.run.mjs` 会被 `eslint .` 扫到
  并报 34 个 error —— 它们是临时 bundle，删掉后即干净；**临时 `.run.mjs` 不应留在工作区**）
- `npm run build` / `npm run build:lib` → 通过
- `node bench-diff.mjs 1050` → 27/27 解析成功，0 失败，与 `cycle-1040` 零新增回归
- 端到端解析：OLD 137.10 ms → NEW 130.97 ms（**1.05x**）

# 指标

- 隔离基准：`countChineseAndWhitespace` **1.13x**（14.19 → 12.51 ms）
- 端到端解析：**1.05x**（137.10 → 130.97 ms）
- 类型/体积：删 17 行 + 增合并函数约 16 行，bundle 体积基本持平（主包 raw 317.61 →
  317.65 kB、gzip 109.42 → 109.46 kB；库 UMD 262.20 → 262.24 kB，均在噪声内）。

# 清理的临时产物

`.bench105.ts`、`.bench105b.ts`、`.bench105.run.mjs`、`.bench105b.run.mjs`、`.e2e105.mjs`（5 项）。

# 发布

版本 `0.7.48 → 0.7.49`，双包已发布。

# 下一轮候选（沿用本轮剖析）

`createParagraphsWithRealFormats`（12.03%）/ `applyStructuralFormats`（7.81%）/
`extractImagesFromStream`（7.81%）/ `detectParagraphFormat`（5.06%）/ `parseFormatRuns`
（5.36%）。**已被证伪、不要动**：OLE 层 `readRegularStream`（1.16%）；Round 103 的七条证伪项；
`DATE_TIME_RE` 已删；Round 104/105 的计数扫描合并已完成。**注意**：Round 105 再次确认
`eslint .` 会扫到 esbuild 的 `.run.mjs` 临时 bundle 并报错——临时基准产物必须删净再 lint。
