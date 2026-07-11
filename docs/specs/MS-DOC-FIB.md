# [MS-DOC] FIB (File Information Block) 结构详解

> 规范章节: MS-DOC §2.5.1
> 规范版本: v12.5 (2026-02-17)
> 官方 PDF: https://officeprotocoldocs-f5hpbjgea6b8gneq.b02.azurefd.net/files/MS-DOC/%5bMS-DOC%5d.pdf

本文档详细说明 Word 二进制文档中 FIB（File Information Block）的结构。

---

## 1. FIB 概述

FIB 是 WordDocument 流开头的一个可变长度结构，可以理解为 Word 文档的"目录"。它包含：
- 文档基本信息（版本、标志位）
- 指向其他表格流中数据的偏移量（fc）和大小（lcb）
- 各种格式选项和状态标志

### 结构特点

- FIB 的总长度是**可变**的，取决于多个字段的值
- FIB 分为多个部分：FibBase, FibRgW97, FibRgFcLcb97 等
- 偏移量（fc）通常指向 **0Table** 或 **1Table** 流，而不是 WordDocument 流

---

## 2. FIB 结构分解

### 2.1 FibBase (基础部分)

**偏移 0，大小 32 字节**

| 偏移 | 大小 | 字段名 | 说明 |
|------|------|--------|------|
| 0 | 2 | `wIdent` | 魔数 = 0xA5EC |
| 2 | 2 | `nFib` | FIB 版本号 |
| 4 | 2 | `unused` | 未使用 |
| 6 | 2 | `lid` | 语言 ID |
| 8 | 2 | `pnNext` | 未使用 |
| 10 | 2 | `fFlags` | 标志位 (低字节 = byte 10, 高字节 = byte 11) |
| 12 | 2 | `nFibBack` | 后向兼容版本号 |
| 14 | 4 | `lKey` | 加密密钥 (0 = 未加密) |
| 18 | 1 | `envr` | 环境 |
| 19 | 1 | `reserved` | 保留 |
| 20 | 4 | `fMac` | Macintosh 标志 |
| 24 | 4 | `fExtChar` | 扩展字符标志 |
| 28 | 4 | `fObfuscation` | 混淆标志 (0 = 无混淆) |

### fFlags 标志位 (byte 10-11)

| 位 | 字段名 | 说明 |
|----|--------|------|
| 0 (bit 0 of byte 10) | `fExtChar` | 扩展字符 (详见 fExtChar 字段) |
| 1 (bit 1 of byte 10) | `fRfs` | 格式化保存标志 |
| ... | ... | ... |

> **注意**：byte 12 的 bit 0 是 `fComplex`（在 nFibBack 字段中），决定文本编码：
> - fComplex = 1：文本是 8-bit 压缩格式
> - fComplex = 0：文本是 UTF-16LE 格式

---

### 2.2 FibRgW97 (16-bit 值数组)

紧跟在 FibBase 之后，包含一组 16-bit 值。

**偏移 32 开始**

| 偏移 | 字段 | 说明 |
|------|------|------|
| 32 | `csw` | 2 字节：FibRgW 中 16-bit 值的数量 |
| 34 | `rgw[csw]` | 2×csw 字节：16-bit 值数组 |

**csw 的值决定了后续结构的偏移**：
```
FibRgW 结束位置 = 32 + 2 + csw * 2 = 34 + csw*2
下一部分从这个位置开始
```

---

### 2.3 FibRgLw97 (32-bit 值数组)

紧跟在 FibRgW97 之后，包含一组 32-bit 值。

```
FibRgLw 起始偏移 = 34 + csw*2
```

| 相对偏移 | 字段 | 说明 |
|----------|------|------|
| 0 | `cslw` | 2 字节：FibRgLw 中 32-bit 值的数量 |
| 2 | `reserved` | 2 字节：保留 |
| 4 | `rglw[cslw]` | 4×cslw 字节：32-bit 值数组 |

**cslw 的值决定了后续结构的偏移**：
```
FibRgLw 结束位置 = (34 + csw*2) + 4 + cslw*4 = 38 + csw*2 + cslw*4
下一部分从这个位置开始
```

> **重要**：cslw 本身是 2 字节，但在 32-bit 值数组之前有 2 字节保留字段，所以总共是 4 字节头 + cslw×4 字节数据。

---

### 2.4 FibRgFcLcb97 (偏移/大小对数组)

这是 FIB 中**最重要**的部分，包含指向表格流中各种数据结构的偏移量和大小。

```
FibRgFcLcb 起始偏移 = 38 + csw*2 + cslw*4
```

| 相对偏移 | 字段 | 说明 |
|----------|------|------|
| 0 | `cbRgFcLcb` | 2 字节：rgFcLcb 数据的总字节数 |
| 2 | `reserved` | 2 字节：保留 |
| 4 | `rgFcLcb[...]` | cbRgFcLcb 字节：fc/lcb 对数组 |

#### rgFcLcb 数组结构

rgFcLcb 是一个按固定顺序排列的 (fc, lcb) 对数组，每对 8 字节（4 字节偏移 + 4 字节大小）。

**已知索引和对应字段**（部分）：

| 索引 | 字段名 | 说明 |
|------|--------|------|
| 0 | `fcMin` / `lcbMin` | 已弃用 |
| 1 | `fcMac` / `lcbMac` | 已弃用 |
| 2 | ... | ... |
| ... | ... | ... |
| 10 | `fcStshf` / `lcbStshf` | 样式表 (STTBF) 的偏移和大小 |
| ... | ... | ... |
| 14 | `fcClx` / `lcbClx` | Clx 结构的偏移和大小 |
| 15 | ... | ... |
| ... | ... | ... |

> **关键**：`fcClx` 指向 0Table/1Table 流中的 Clx 结构，`lcbClx` 是其大小。这是文本提取的关键入口。

#### 偏移量的计算

每个 (fc, lcb) 对占 8 字节，所以：
```
第 i 个 fc 偏移 = FibRgFcLcb起始 + 4 + i*8
第 i 个 lcb 偏移 = FibRgFcLcb起始 + 4 + i*8 + 4
```

---

### 2.5 后续部分

FIB 还有更多部分（FibRgCswNew, FibRgLw97 扩展等），但对于基本的文本提取，前四部分已经足够。

---

## 3. 关键字段详解

### 3.1 fcMin / fcMac

这两个字段在现代 Word 文档中**已弃用**，但有些旧实现仍使用它们。

- `fcMin`：文本起始位置（在 WordDocument 流中）
- `fcMac`：文本结束位置

> **注意**：这些是 Word 6.0/95 遗留字段。对于 Word 97+ 文档，应该使用 Clx/Pcdt/PlcPcd 来定位文本。

### 3.2 fcClx / lcbClx

- `fcClx`：Clx 结构在 0Table/1Table 流中的偏移
- `lcbClx`：Clx 结构的字节大小

这是现代 Word 文档中文本提取的**主入口**。

### 3.3 fWhichTblStm 标志

决定使用哪个表格流：
- 0 = 使用 `0Table` 流
- 1 = 使用 `1Table` 流

这个标志位在 fFlags 或 FibRgW 中的某个位置。

---

## 4. 解析算法

```
function parseFib(wordDocumentData):
    # 1. 验证魔数
    if readUint16(0) != 0xA5EC:
        error "不是有效的 Word 文档"

    # 2. 读取 csw (FibRgW 中 16-bit 值的数量)
    csw = readUint16(32)

    # 3. 计算 FibRgLw 的起始位置
    fibRgLwOffset = 34 + csw * 2

    # 4. 读取 cslw (FibRgLw 中 32-bit 值的数量)
    cslw = readUint16(fibRgLwOffset)

    # 5. 计算 FibRgFcLcb 的起始位置
    fibRgFcLcbOffset = fibRgLwOffset + 4 + cslw * 4

    # 6. 读取 cbRgFcLcb (rgFcLcb 数据的总字节数)
    cbRgFcLcb = readUint16(fibRgFcLcbOffset)

    # 7. 从 rgFcLcb 中提取需要的字段
    #    例如 fcClx 在索引 14
    fcClx = readUint32(fibRgFcLcbOffset + 4 + 14 * 8)
    lcbClx = readUint32(fibRgFcLcbOffset + 4 + 14 * 8 + 4)

    return { fcClx, lcbClx, ... }
```

---

## 5. 常见陷阱

### 5.1 偏移量计算错误

FIB 是可变长度的，必须通过 csw → cslw → cbRgFcLcb 逐层计算偏移。
**不要假设固定偏移**，不同版本的 Word 文档可能有不同的 csw/cslw 值。

### 5.2 fcMin/fcMac 不可靠

现代 Word 文档（Word 97+）中 fcMin/fcMac 可能是 0 或无效值。
应该优先使用 Clx/Pcdt/PlcPcd 来定位文本。

### 5.3 fComplex 的位置

fComplex 标志在 **byte 12**（nFibBack 字段的 bit 0），不是在 fFlags 中。
但某些版本的文档中这个标志可能不可靠（如 macOS textutil 生成的文档）。

### 5.4 0Table vs 1Table

Clx 等数据在 0Table 或 1Table 流中，具体取决于 `fWhichTblStm` 标志。
不是在 WordDocument 流中！

---

## 6. 项目实现状态

### fibParser.ts 实现

| 功能 | 状态 | 说明 |
|------|------|------|
| 魔数验证 | ✅ | 检查 0xA5EC |
| csw 读取 | ✅ | |
| cslw 读取 | ✅ | |
| cbRgFcLcb 读取 | ✅ | |
| fcClx/lcbClx 提取 | ✅ | 索引 14 |
| fcMin/fcMac 提取 | ✅ | 索引 0, 1 |
| fWhichTblStm | ❌ | 未实现，默认用 0Table？ |
| fComplex 标志 | ⚠️ | 从 byte 12 读取，但有已知问题 |
| 其他字段 | ❌ | 大部分未提取 |

### docParser.ts 中的使用

- `parseFib()` 在 `fibParser.ts` 中实现
- 解析成功后使用 `fcClx`/`lcbClx` 定位 Clx 结构
- 如果 Clx 解析失败，回退到 `extractTextSimple`

---

## 7. 参考资料

- 官方规范: [MS-DOC.pdf](https://officeprotocoldocs-f5hpbjgea6b8gneq.b02.azurefd.net/files/MS-DOC/%5bMS-DOC%5d.pdf) §2.5.1
- 项目实现: [src/utils/fibParser.ts](../../src/utils/fibParser.ts)
- 测试文件: [tests/fibParser.test.ts](../../tests/fibParser.test.ts)
- Clx 结构: [MS-DOC-CLX.md](./MS-DOC-CLX.md)
