# md5 验证 oracle 使用说明 · vue-dev-6 · 2026-08-26 18:50

## 一、核心 oracle（失落原件判定）

```
目标: docParser.ts 绿A完整态（3398 行，最后写入 2026-08-26 15:19:30）
md5 : bdf33e642605ccd026fb71d124650307
```

### 判定法
```bash
# macOS
md5 -q <候选文件>
# Linux
md5sum <候选文件> | awk '{print $1}'
# 输出 = bdf33e642605ccd026fb71d124650307 ⇒ 逐字节等同失落原件
```

### 三种用途
1. **意外副本鉴定**：任何渠道浮现疑似历史副本（备份盘/Time Machine/其他工作机/编辑器本地历史/云盘版本），一 hash 定真伪。
2. **终止字节级搜索的凭据**：语义重建产物**不可能**命中此哈希（注释/空白/顺序差异即破坏）——命中失败不构成重建质量证据，勿据此迭代。
3. **归档完整性**：若未来从任何介质恢复出原件，先验哈希再入库。

## 二、零漂移锚点清单（绿A 时点录制，18:49 复验仍吻合）

| 文件 | 行数 | md5 | 现盘状态 |
|---|---|---|---|
| src/utils/docparser/clxReader.ts | 279 | ec88e61e8f1bc64c36b942c4cdf64a97 | ✅ 仍一致 |
| src/utils/docparser/pieceTable.ts | 134 | 23474e4329fac0b3067fd8eae865da62 | ✅ 仍一致 |
| src/utils/docparser/storySplitter.ts | 278 | 241ca073386e2644bda0cf1b1c8990c7 | ✅ 仍一致 |
| tests/docParser.test.ts | — | f6c6412fbf2e8dc555b3e874669b8ef4 | ✅ 仍一致 |

⇒ 语义重建的**漂移面仅 docParser.ts 单文件**；四锚文件可直接作为"绿A 时点切片"参照，无需重修。

## 三、随包底本自身指纹

```
dp_head_3990.ts (HEAD@9670a30, 3990 行) md5 = dfa92aac873a2fe94909dc7879913385
```
复制自 /tmp/dp_head.ts（git show HEAD 产物），复制前后哈希一致。

## 四、环境备注

oracle 录制环境：macOS `md5 -q`；跨平台比对用 `md5sum` 输出第一列。哈希为内容全序指纹，与行尾符(CRLF/LF)敏感——跨机器取回的历史副本若经编辑器转换行尾，将失配，属正常现象需先还原行尾再验。
