# 2026-11-21 · 任务 B：属性 / 分节解析边界审查

## 审查范围与结论

对 `src/utils/propertyParser.ts` 与 `src/utils/sectionParser.ts` 的五个边界面逐项审查：

| 边界面 | 结论 |
|---|---|
| 非法 PID / 类型 | 无 bug。`mapSummaryProperty`/`mapDocSummaryProperty` 每个 case 都有 `typeof` 守卫；未知 PID 经 switch default 安全忽略；未知类型在 `parsePropertyValue` 走 size=4 跳过。 |
| **CODEPAGE** | **发现真实 bug（已修复）**：LPSTR 字符串固定用 `TextDecoder('latin1')` 解码，完全忽略 MS-OLEPS §2.13 规定的「每节 PID=1 / VT_I4 = CodePage」。以 GBK / Shift-JIS 写入的 ANSI 元数据（标题/作者等）被解成乱码。 |
| BigInt 时间戳 | 无阻断 bug。`readUint64` 返回 bigint，`Number()` 转换后为有限数；现有测试已钉死典型 FILETIME 的精确值。VT_I8 按无符号读取属极边缘情形（元数据几乎不出现负值），记录为非阻断观察，不改以免触发 golden 刷新。 |
| 空节表 | 无 bug。`sectionCount===0`/`>10`、`propertyCount===0`/`>100` 均提前返回 null；`lcb` 不足一节时 `parsePlcfSed` 返回 []。 |
| 畸形 SEPX | 无 bug。`cb` 越界、grpprl 越界、操作数越界、spra=6 变长长度越界均有 break/return 防御，且已有测试覆盖。 |

## CODEPAGE 修复（负控先行）

`tests/propertyCodepage.test.ts` 3 项：用合成 SummaryInformation 流构造
CodePage=936(GBK) 的「中文」标题与 CodePage=932(Shift-JIS) 的「日本」标题。
修复前 2 项失败（分别解成 `ÖÐÎÄ` / `“ú–{`），1 项 windows-1252 兼容用例前后均通过。

改动：
- 新增 `CODEPAGE_LABELS`（874/932/936/949/950/125x/65001 → WHATWG TextDecoder 标签）与
  `getSectionDecoder`，表外代码页回退 `windows-1252` —— 与旧 `latin1` 行为逐字节等价
  （WHATWG 中 latin1 即 windows-1252 别名）。
- `parsePropertySetSection` 改两遍扫描：先收集有效条目并读取 PID=1 的 CodePage
  （仅当类型是 VT_I4 才采信），再按该节的 decoder 解码 LPSTR。
- `readAnsiString` 返回解码后的字节长度（`byteLen`），使 LPSTR 的 size 计算对多字节
  代码页仍正确（size 字段当前未被节解析器消费，但保持语义正确）。

## 补充边界测试

`tests/propertySectionAudit.test.ts` 2 项（不改行为，仅钉边界）：
- PID=1 类型非法（非 VT_I4）时忽略 CodePage、回退 windows-1252。
- 多节 PlcfSed 中夹带畸形 SEPX：坏节走默认值，相邻好节的 CP 范围与页面属性不受影响。

## 验证

- 负控：修复前 2/3 失败，修复后 3/3 通过；新增 2 项边界测试通过。
- 真实语料：27 份 .doc 的属性字符串均为 ASCII / LPWSTR，无 LPSTR 非 ASCII 数据，
  故 CODEPAGE 改动对语料输出零影响（`scan:corpus` 27/27）。
- 全量门禁：`vue-tsc --noEmit` 0；`npm test` 122 文件 / 2077 项（+2 文件 / +5 项）；
  `lint` 0；app/lib 双构建通过；`scan:corpus` 27/27；`printPageAudit --check` OK。
