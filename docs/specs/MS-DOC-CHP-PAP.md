# [MS-DOC] CHPX / PAPX 字符与段落属性结构详解

> 规范章节: MS-DOC §2.6 (Binary Properties)、§2.8 (PLCs)
> 规范版本: v12.5 (2026-02-17)
> 官方 PDF: https://officeprotocoldocs-f5hpbjgea6b8gneq.b02.azurefd.net/files/MS-DOC/%5bMS-DOC%5d.pdf
> 在线文档: https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-doc

本文档详细说明 Word 二进制文档中 **CHPX（字符属性）** 和 **PAPX（段落属性）** 的数据结构，以及 SPRM（单属性修饰符）操作码的解析方法。

---

## 目录

1. [概述](#1-概述)
2. [PlcfBteChpx 结构（字符属性位置表）](#2-plcfbtechpx-结构字符属性位置表)
3. [CHPX 结构详情](#3-chpx-结构详情)
4. [PlcfBtePapx 结构（段落属性位置表）](#4-plcfbtepapx-结构段落属性位置表)
5. [PAPX 结构详情](#5-papx-结构详情)
6. [Sprm / Prl 结构详解](#6-sprm--prl-结构详解)
7. [常用 SPRM 操作码列表](#7-常用-sprm-操作码列表)
8. [格式信息提取方法](#8-格式信息提取方法)

---

## 1. 概述

Word 二进制文档中的格式信息通过 **属性修饰符（Property Modifier）** 机制存储。核心概念：

| 概念 | 说明 |
|------|------|
| **Sprm** | Single Property Modifier，单属性修饰符，2字节，指定要修改的属性 |
| **Prl** | Sprm + 操作数，指定属性的新值 |
| **grpprl** | 一组 Prl 的数组 |
| **CHPX** | CHaracter Property eXception，字符属性异常，存储字符级格式变更 |
| **PAPX** | PArgraph Property eXception，段落属性异常，存储段落级格式变更 |
| **PlcfBteChpx** | PLC of BTE CHPX，字符属性位置表，映射字符位置到 CHPX |
| **PlcfBtePapx** | PLC of BTE PAPX，段落属性位置表，映射段落位置到 PAPX |

### 存储位置

CHPX 和 PAPX 数据存储在 **0Table 或 1Table 流**中，由 FIB 的 `FibRgFcLcb97` 字段中的以下条目定位：

| FIB 字段 | 说明 |
|----------|------|
| `fcPlcfBteChpx` | PlcfBteChpx 在表格流中的偏移 |
| `lcbPlcfBteChpx` | PlcfBteChpx 的字节数 |
| `fcPlcfBtePapx` | PlcfBtePapx 在表格流中的偏移 |
| `lcbPlcfBtePapx` | PlcfBtePapx 的字节数 |

> **注意**：使用 `fWhichTblStm` 标志决定使用 0Table 还是 1Table 流。

---

## 2. PlcfBteChpx 结构（字符属性位置表）

PlcfBteChpx 是一个 **PLC（Position-Location Count）** 结构，用于将字符位置映射到对应的 CHPX 数据。

### 2.1 PLC 通用结构

PLC 结构由两部分组成：
- **aCP 数组**：字符位置数组（n+1 个 32 位无符号整数）
- **aData 数组**：数据元素数组（n 个，每个大小相同）

```
+---------------------------+
| aCP (variable)            |  字符位置数组 (n+1 个 DWORD)
+---------------------------+
| aData (variable)          |  数据元素数组 (n 个)
+---------------------------+
```

**数量关系**：
- n = 数据元素个数
- aCP 有 n+1 个元素（n 个区间有 n+1 个边界）
- aData 有 n 个元素

**计算公式**：如果已知 PLC 总大小 `cbPlc` 和单个数据元素大小 `cbData`，则：
```
n = (cbPlc - 4) / (cbData + 4)
```

### 2.2 PlcfBteChpx 特殊结构

PlcfBteChpx 是一个特殊的 PLC，其 `aData` 不是固定大小的元素，而是一个**字节数组（aPcb）**，其中存储了可变大小的 CHPX。

```
+---------------------------+
| aCP (variable)            |  字符位置数组 (n+1 个 DWORD)
+---------------------------+
| aPcb (variable)           |  CHPX 字节数组 (连续的 CHPX 数据)
+---------------------------+
```

**字段说明**：

| 部分 | 大小 | 说明 |
|------|------|------|
| `aCP` | (n+1) × 4 字节 | 字符位置数组，升序排列 |
| `aPcb` | 可变 | CHPX 数据的字节数组，每个 CHPX 长度可变 |

### 2.3 aCP 数组

- 每个元素是 **CP（Character Position）**，32 位无符号整数
- `aCP[i]` = 第 i 个字符区间的起始字符位置
- `aCP[i+1]` = 第 i 个字符区间的结束字符位置
- 第 i 个区间的字符数 = `aCP[i+1] - aCP[i]`
- 第 i 个区间对应的 CHPX 数据存储在 aPcb 中

### 2.4 aPcb 字节数组与 CHPX 定位

aPcb 是一个连续的字节数组，其中依次存储了 n 个 CHPX 结构。每个 CHPX 的长度是可变的。

**如何定位第 i 个 CHPX**：

CHPX 的第一个字段是 `cbOffset`（2字节），它指向**下一个** CHPX 的起始位置（相对于当前 CHPX 的起始位置）。因此，遍历 CHPX 需要按链表方式顺序读取：

```
offset = 0  // aPcb 起始位置
for i = 0 to n-1:
    chpx_start = offset
    cbOffset = readUint16(aPcb, chpx_start)
    chpx_end = chpx_start + cbOffset
    // 当前 CHPX 数据在 [chpx_start, chpx_end) 范围内
    // 解析 CHPX...
    offset = chpx_end  // 移动到下一个 CHPX
```

> **重要**：`cbOffset` 是从当前 CHPX 起始位置到**下一个** CHPX 起始位置的偏移量，即当前 CHPX 的总大小。

---

## 3. CHPX 结构详情

CHPX（CHaracter Property eXception）描述了字符级别的格式属性异常。

### 3.1 CHPX 结构

```
+---------------------------+
| cbOffset (2 bytes)        |  到下一个 CHPX 的偏移量
+---------------------------+
| grpprl (variable)         |  字符属性修饰符列表
+---------------------------+
```

**字段说明**：

| 偏移 | 大小 | 字段名 | 说明 |
|------|------|--------|------|
| 0 | 2 | `cbOffset` | 从当前 CHPX 起始到下一个 CHPX 起始的字节偏移 |
| 2 | 可变 | `grpprl` | 一组 Prl（Sprm + 操作数），定义字符属性 |

### 3.2 grpprl 数组

grpprl 是 **group of PRLs** 的缩写，是一个 Prl 结构的数组。每个 Prl 修改一个字符属性。

grpprl 的大小 = `cbOffset - 2`（因为 cbOffset 包含了自身的 2 字节）。

### 3.3 CHPX 解析算法

```typescript
function parseCHPX(data: Uint8Array, offset: number): {
  cbOffset: number;
  grpprl: Prl[];
} {
  const cbOffset = readUint16(data, offset);
  const grpprlSize = cbOffset - 2;
  const grpprl = parseGrpprl(data, offset + 2, grpprlSize);
  return { cbOffset, grpprl };
}

function parseGrpprl(data: Uint8Array, offset: number, size: number): Prl[] {
  const prls: Prl[] = [];
  let pos = 0;
  
  while (pos < size) {
    const prl = parsePrl(data, offset + pos);
    prls.push(prl);
    pos += 2 + getOperandSize(prl.sprm);
  }
  
  return prls;
}
```

---

## 4. PlcfBtePapx 结构（段落属性位置表）

PlcfBtePapx 是段落属性的位置表，结构与 PlcfBteChpx 类似。

### 4.1 整体结构

```
+---------------------------+
| aCP (variable)            |  段落位置数组 (n+1 个 DWORD)
+---------------------------+
| aPcb (variable)           |  PAPX 字节数组 (连续的 PAPX 数据)
+---------------------------+
```

**字段说明**：

| 部分 | 大小 | 说明 |
|------|------|------|
| `aCP` | (n+1) × 4 字节 | 段落起始字符位置数组，升序排列 |
| `aPcb` | 可变 | PAPX 数据的字节数组，每个 PAPX 长度可变 |

### 4.2 aCP 数组

- `aCP[i]` = 第 i 个段落的起始字符位置
- 每个段落以段落标记（0x0D）结尾
- 第 i 个段落对应的 PAPX 存储在 aPcb 中

### 4.3 aPcb 字节数组与 PAPX 定位

与 CHPX 类似，PAPX 也通过 `cbOffset` 字段链式定位。但 PAPX 的结构比 CHPX 更复杂，因为它包含一个对样式表的引用。

---

## 5. PAPX 结构详情

PAPX（PArgraph Property eXception）描述了段落级别的格式属性异常。

### 5.1 PAPX 结构

```
+---------------------------+
| cbOffset (2 bytes)        |  到下一个 PAPX 的偏移量
+---------------------------+
| istd (2 bytes)            |  基础样式索引 (Style ID)
+---------------------------+
| grpprl (variable)         |  段落属性修饰符列表
+---------------------------+
```

**字段说明**：

| 偏移 | 大小 | 字段名 | 说明 |
|------|------|--------|------|
| 0 | 2 | `cbOffset` | 从当前 PAPX 起始到下一个 PAPX 起始的字节偏移 |
| 2 | 2 | `istd` | 基础样式索引，指向样式表 (STSH) 中的样式 |
| 4 | 可变 | `grpprl` | 一组 Prl（Sprm + 操作数），定义段落属性的增量修改 |

### 5.2 样式继承机制

段落属性的计算遵循**样式继承 + 增量修改**的模式：

1. **基础样式**：由 `istd` 指定，从样式表 (STSH) 中获取该样式的段落属性
2. **增量修改**：`grpprl` 中的 Prl 列表对基础样式的属性进行修改
3. **最终属性** = 基础样式属性 + grpprl 修改

### 5.3 grpprl 数组

grpprl 的大小 = `cbOffset - 4`（cbOffset 2字节 + istd 2字节）。

### 5.4 PAPX 解析算法

```typescript
function parsePAPX(data: Uint8Array, offset: number): {
  cbOffset: number;
  istd: number;
  grpprl: Prl[];
} {
  const cbOffset = readUint16(data, offset);
  const istd = readUint16(data, offset + 2);
  const grpprlSize = cbOffset - 4;
  const grpprl = parseGrpprl(data, offset + 4, grpprlSize);
  return { cbOffset, istd, grpprl };
}
```

---

## 6. Sprm / Prl 结构详解

### 6.1 Sprm 结构

Sprm（Single Property Modifier）是一个 2 字节的结构，指定要修改的属性。

```
  0                   1
  0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5
 +-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
 |    ispmd    |A|   sgc   | spra|
 +-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
```

**位字段分解**：

| 位 | 大小 | 字段名 | 说明 |
|----|------|--------|------|
| 0-8 | 9 bits | `ispmd` | 属性修饰符索引，与 fSpec 组合确定具体属性 |
| 9 | 1 bit | `fSpec` (A) | 特殊标志，与 ispmd 组合确定具体属性 |
| 10-12 | 3 bits | `sgc` | 属性类别，指定修改的是字符/段落/表格等属性 |
| 13-15 | 3 bits | `spra` | 操作数大小类型 |

### 6.2 sgc - 属性类别

| sgc 值 | 含义 |
|--------|------|
| 1 | 段落属性 (Paragraph) |
| 2 | 字符属性 (Character) |
| 3 | 图片属性 (Picture) |
| 4 | 节属性 (Section) |
| 5 | 表格属性 (Table) |

### 6.3 spra - 操作数大小类型

| spra 值 | 操作数类型 | 大小 |
|---------|-----------|------|
| 0 | ToggleOperand | 1 字节 |
| 1 | 1字节无符号整数 | 1 字节 |
| 2 | 2字节无符号整数 | 2 字节 |
| 3 | 4字节无符号整数 | 4 字节 |
| 4 | 2字节有符号整数 | 2 字节 |
| 5 | 2字节无符号整数 | 2 字节 |
| 6 | 可变长度 | 首字节表示后续长度 |
| 7 | 3字节 | 3 字节 |

> **注意**：spra = 6 的可变长度操作数，第一个字节指定后续操作数的大小（不包括首字节本身）。但 `sprmTDefTable` 和 `sprmPChgTabs` 例外。

### 6.4 Prl 结构

Prl = Sprm + Operand

```
+---------------------------+
| sprm (2 bytes)            |  属性修饰符
+---------------------------+
| operand (variable)        |  操作数，大小由 sprm.spra 决定
+---------------------------+
```

### 6.5 ToggleOperand

当 spra = 0 时，操作数是 ToggleOperand（1字节）：

| 值 | 含义 |
|----|------|
| 0x00 | 清除属性（关闭） |
| 0x01 | 设置属性（打开） |
| 0x02 | 切换属性 |

---

## 7. 常用 SPRM 操作码列表

### 7.1 字符属性 SPRM (sgc = 2)

#### 基础字符格式

| 操作码 (hex) | 名称 | 说明 | spra |
|-------------|------|------|------|
| 0x0801 | `sprmCFBold` | 加粗 | 0 (Toggle) |
| 0x0802 | `sprmCFItalic` | 斜体 | 0 (Toggle) |
| 0x0803 | `sprmCFStrike` | 删除线 | 0 (Toggle) |
| 0x0804 | `sprmCFOutline` | 外框 | 0 (Toggle) |
| 0x0805 | `sprmCFShadow` | 阴影 | 0 (Toggle) |
| 0x0806 | `sprmCFSmallCaps` | 小型大写字母 | 0 (Toggle) |
| 0x0807 | `sprmCFCaps` | 全部大写字母 | 0 (Toggle) |
| 0x0808 | `sprmCFVanish` | 隐藏文字 | 0 (Toggle) |
| 0x0809 | `sprmCFRMark` | 修订标记 | 0 (Toggle) |
| 0x080A | `sprmCFSpec` | 特殊格式 | 0 (Toggle) |
| 0x080B | `sprmCFStrikeBiDi` | 双删除线 | 0 (Toggle) |
| 0x080C | `sprmCFImprint` | 印记 | 0 (Toggle) |
| 0x080D | `sprmCFEmboss` | 阳文 | 0 (Toggle) |
| 0x0810 | `sprmCFSemiBold` | 半粗体 | 0 (Toggle) |
| 0x0811 | `sprmCFUndoc1` | 未记录1 | 0 (Toggle) |
| 0x0812 | `sprmCFUndoc2` | 未记录2 | 0 (Toggle) |

#### 下划线

| 操作码 (hex) | 名称 | 说明 | spra |
|-------------|------|------|------|
| 0x0815 | `sprmCFUnderline` | 下划线类型 | 1 (1字节) |

下划线类型值：
- 0x00 = 无下划线
- 0x01 = 单下划线
- 0x02 = 字下加线（仅单词）
- 0x03 = 双下划线
- 0x04 = 点式下划线
- 0x05 = 粗下划线
- 0x06 = 短下划线
- 0x07 = 点式短下划线
- 0x08 = 长下划线
- 0x09 = 字下加线（仅单词）长
- 0x0A = 波浪线
- 0x0B = 粗波浪线
- 0x0C = 双波浪线
- 0x0D = 点式波浪线
- 0x0E = 点式粗下划线
- 0x0F = 粗短下划线
- 0x10 = 点式粗短下划线
- 0x11 = 长点式下划线
- 0x12 = 字下加线（仅单词）点式
- 0x13 = 粗字下加线（仅单词）
- 0x14 = 双线字下加线（仅单词）
- 0x15 = 波浪线字下加线（仅单词）

#### 字体与字号

| 操作码 (hex) | 名称 | 说明 | spra |
|-------------|------|------|------|
| 0x0816 | `sprmHps` | 字号（半磅） | 2 (2字节) |
| 0x0817 | `sprmHpsPos` | 位置（上标/下标偏移） | 4 (2字节有符号) |
| 0x0818 | `sprmFtcAscii` | ASCII 字体索引 | 2 (2字节) |
| 0x0819 | `sprmFtcFE` | 东亚字体索引 | 2 (2字节) |
| 0x081A | `sprmFtcOther` | 其他字体索引 | 2 (2字节) |
| 0x4A30 | `sprmFtcBidi` | 双向字体索引 | 2 (2字节) |

> **字号说明**：`sprmHps` 的值是**半磅（half-points）**，所以实际磅数 = hps / 2。

#### 颜色

| 操作码 (hex) | 名称 | 说明 | spra |
|-------------|------|------|------|
| 0x081B | `sprmCv` | 字体颜色 | 3 (4字节) |
| 0x081C | `sprmChHighlight` | 高亮颜色 | 1 (1字节) |
| 0x081D | `sprmCvUnderline` | 下划线颜色 | 3 (4字节) |

颜色值格式（4字节）：
- Bit 0-7: 蓝色分量
- Bit 8-15: 绿色分量
- Bit 16-23: 红色分量
- Bit 24-30: 未使用（应为0）
- Bit 31: 自动颜色标志（1 = 自动，0 = 自定义）

高亮颜色值（1字节）：
- 0x00 = 无
- 0x01 = 黄色
- 0x02 = 亮绿
- 0x03 = 青绿
- 0x04 = 粉色
- 0x05 = 蓝色
- 0x06 = 红色
- 0x07 = 深蓝
- 0x08 = 深青
- 0x09 = 深绿
- 0x0A = 深紫红
- 0x0B = 深红
- 0x0C = 深黄
- 0x0D = 深灰
- 0x0E = 浅灰
- 0x0F = 黑色

#### 字符间距

| 操作码 (hex) | 名称 | 说明 | spra |
|-------------|------|------|------|
| 0x081E | `sprmKern` | 字间距调整（半磅） | 2 (2字节) |
| 0x081F | `sprmDxaSpace` | 字符间距（缇） | 4 (2字节有符号) |
| 0x0820 | `sprmFDiacolor` | 变音符号颜色 | 3 (4字节) |

#### 上标/下标

| 操作码 (hex) | 名称 | 说明 | spra |
|-------------|------|------|------|
| 0x0821 | `sprmIss` | 上标/下标 | 1 (1字节) |

值：
- 0x00 = 正常
- 0x01 = 上标
- 0x02 = 下标

#### 其他字符属性

| 操作码 (hex) | 名称 | 说明 | spra |
|-------------|------|------|------|
| 0x0822 | `sprmObjOffset` | 对象偏移 | 4 (2字节有符号) |
| 0x0823 | `sprmCFData` | 字符格式数据 | 6 (可变) |
| 0x0824 | `sprmChYsrFcid` | 字体格式 ID | 2 (2字节) |
| 0x4825 | `sprmFChsShape` | 字符形状 | 1 (1字节) |
| 0x4826 | `sprmIdsl` | 样式链接 | 2 (2字节) |
| 0x4827 | `sprmCFSpecVanish` | 特殊隐藏 | 0 (Toggle) |
| 0x4828 | `sprmCmcFontCharSet` | 字体字符集 | 1 (1字节) |
| 0x6829 | `sprmCgText` | 文本标记 | 1 (1字节) |
| 0x082A | `sprmCExtended` | 扩展字符格式 | 6 (可变) |
| 0x082B | `sprmCMath` | 数学文本 | 0 (Toggle) |
| 0x082C | `sprmCvFontSignature` | 字体签名 | 6 (可变) |
| 0x082D | `sprmCFBiDi` | 双向字符 | 0 (Toggle) |
| 0x082E | `sprmCFCompose` | 组合字符 | 0 (Toggle) |
| 0x082F | `sprmCFEndComp` | 结束组合 | 0 (Toggle) |

### 7.2 段落属性 SPRM (sgc = 1)

#### 对齐方式

| 操作码 (hex) | 名称 | 说明 | spra |
|-------------|------|------|------|
| 0x2401 | `sprmPJc` | 段落对齐方式 | 1 (1字节) |

对齐方式值：
- 0x00 = 左对齐
- 0x01 = 居中
- 0x02 = 右对齐
- 0x03 = 两端对齐
- 0x04 = 分散对齐

#### 缩进

| 操作码 (hex) | 名称 | 说明 | spra |
|-------------|------|------|------|
| 0x2402 | `sprmPDxaLeft` | 左缩进（缇） | 4 (2字节有符号) |
| 0x2403 | `sprmPDxaRight` | 右缩进（缇） | 4 (2字节有符号) |
| 0x2404 | `sprmPDxaIndent` | 首行缩进（缇） | 4 (2字节有符号) |
| 0x2405 | `sprmPDxaLeft1` | 左缩进（首行除外） | 4 (2字节有符号) |
| 0x840F | `sprmPIncLvl` | 缩进级别 | 1 (1字节) |

> **缇（Twips）**：1 英寸 = 1440 缇，1 磅 = 20 缇。

#### 间距

| 操作码 (hex) | 名称 | 说明 | spra |
|-------------|------|------|------|
| 0x2406 | `sprmPDyaBefore` | 段前间距（缇） | 4 (2字节有符号) |
| 0x2407 | `sprmPDyaAfter` | 段后间距（缇） | 4 (2字节有符号) |
| 0x2408 | `sprmPAnimateHeight` | 动画高度 | 4 (2字节有符号) |
| 0x2409 | `sprmPLine` | 行距（缇） | 4 (2字节有符号) |
| 0x240A | `sprmPFLineAuto` | 自动行距 | 0 (Toggle) |
| 0x240B | `sprmPFNoLnHeight` | 忽略最小行高 | 0 (Toggle) |

行距规则：
- 如果 `sprmPLine` = 0 且 `sprmPFLineAuto` = 1：单倍行距（自动）
- 如果 `sprmPLine` > 0：
  - 正值 = 固定行距（缇）
  - 负值 = 百分比行距（取绝对值 / 240 = 百分比，如 240 = 1x, 360 = 1.5x, 480 = 2x）

#### 分页控制

| 操作码 (hex) | 名称 | 说明 | spra |
|-------------|------|------|------|
| 0x240C | `sprmPFPageBreakBefore` | 段前分页 | 0 (Toggle) |
| 0x240D | `sprmPFKeep` | 段中不分页 | 0 (Toggle) |
| 0x240E | `sprmPFKeepFollow` | 与下段同页 | 0 (Toggle) |

#### 边框与底纹

| 操作码 (hex) | 名称 | 说明 | spra |
|-------------|------|------|------|
| 0x2410 | `sprmPBrcTop` | 上边框 | 6 (可变) |
| 0x2411 | `sprmPBrcLeft` | 左边框 | 6 (可变) |
| 0x2412 | `sprmPBrcBottom` | 下边框 | 6 (可变) |
| 0x2413 | `sprmPBrcRight` | 右边框 | 6 (可变) |
| 0x2414 | `sprmPShd` | 底纹 | 6 (可变) |
| 0x2415 | `sprmPBrcBetween` | 段落间边框 | 6 (可变) |
| 0x2416 | `sprmPBrcBar` | 段落边框线 | 6 (可变) |

#### 制表位

| 操作码 (hex) | 名称 | 说明 | spra |
|-------------|------|------|------|
| 0x2417 | `sprmPDxaTab` | 制表位位置 | 6 (可变) |
| 0x2418 | `sprmPChgTabs` | 修改制表位 | 6 (可变) |
| 0x2419 | `sprmPNoAutoHyph` | 不自动断字 | 0 (Toggle) |

#### 其他段落属性

| 操作码 (hex) | 名称 | 说明 | spra |
|-------------|------|------|------|
| 0x241A | `sprmPWidowControl` | 孤行控制 | 0 (Toggle) |
| 0x241B | `sprmPKinsoku` | 中文换行 | 0 (Toggle) |
| 0x241C | `sprmPWordWrap` | 单词换行 | 0 (Toggle) |
| 0x241D | `sprmPOverflowPunc` | 溢出标点 | 0 (Toggle) |
| 0x241E | `sprmPTopLinePunc` | 顶行标点 | 0 (Toggle) |
| 0x241F | `sprmPBiDi` | 双向段落 | 0 (Toggle) |
| 0x2420 | `sprmPOutlineLvl` | 大纲级别 | 1 (1字节) |
| 0x2421 | `sprmPCharScale` | 字符缩放 | 2 (2字节) |
| 0x2422 | `sprmPCrMrp` | 自动换行字符 | 2 (2字节) |
| 0x2423 | `sprmPAdjustRight` | 右对齐调整 | 0 (Toggle) |
| 0x2424 | `sprmPSnapToGrid` | 对齐网格 | 0 (Toggle) |
| 0x2425 | `sprmPDyaLine` | 行间距 | 4 (2字节有符号) |
| 0x2426 | `sprmPDxaAbs` | 绝对位置水平 | 4 (2字节有符号) |
| 0x2427 | `sprmPDyaAbs` | 绝对位置垂直 | 4 (2字节有符号) |
| 0x2428 | `sprmPDxaWidth` | 宽度 | 4 (2字节有符号) |
| 0x2429 | `sprmPFHeight` | 高度规则 | 1 (1字节) |
| 0x242A | `sprmPDyaHeight` | 高度 | 4 (2字节有符号) |
| 0x242B | `sprmPFMinHeight` | 最小高度 | 0 (Toggle) |
| 0x242C | `sprmPVMerge` | 垂直合并 | 1 (1字节) |
| 0x242D | `sprmPVAlign` | 垂直对齐 | 1 (1字节) |
| 0x242E | `sprmPFrmDir` | 文字方向 | 1 (1字节) |
| 0x242F | `sprmPBrcTopColor` | 上边框颜色 | 3 (4字节) |
| 0x2430 | `sprmPBrcLeftColor` | 左边框颜色 | 3 (4字节) |
| 0x2431 | `sprmPBrcBottomColor` | 下边框颜色 | 3 (4字节) |
| 0x2432 | `sprmPBrcRightColor` | 右边框颜色 | 3 (4字节) |
| 0x2433 | `sprmPBrcBetweenColor` | 段落间边框颜色 | 3 (4字节) |
| 0x2434 | `sprmPBrcBarColor` | 边框线颜色 | 3 (4字节) |
| 0x2435 | `sprmPFEqbOrder` | 等宽顺序 | 0 (Toggle) |
| 0x2436 | `sprmPFNumInLine` | 行内编号 | 0 (Toggle) |
| 0x8437 | `sprmPIstdNum` | 编号样式索引 | 2 (2字节) |
| 0x8438 | `sprmPNFCNstart` | 编号起始值 | 2 (2字节) |
| 0x8439 | `sprmPFLvl` | 编号级别 | 1 (1字节) |
| 0x843A | `sprmPFInnerMerge` | 内部合并 | 0 (Toggle) |
| 0x843B | `sprmPFCellMarTop` | 单元格上边距 | 0 (Toggle) |
| 0x843C | `sprmPFCellMarLeft` | 单元格左边距 | 0 (Toggle) |
| 0x843D | `sprmPFCellMarBottom` | 单元格下边距 | 0 (Toggle) |
| 0x843E | `sprmPFCellMarRight` | 单元格右边距 | 0 (Toggle) |
| 0x843F | `sprmPDxaCellTop` | 单元格顶部间距 | 4 (2字节有符号) |
| 0x8440 | `sprmPDxaCellLeft` | 单元格左侧间距 | 4 (2字节有符号) |
| 0x8441 | `sprmPDxaCellBottom` | 单元格底部间距 | 4 (2字节有符号) |
| 0x8442 | `sprmPDxaCellRight` | 单元格右侧间距 | 4 (2字节有符号) |
| 0x8443 | `sprmPFTableWrap` | 表格环绕 | 0 (Toggle) |
| 0x8444 | `sprmPChgTabsPapx` | 修改段落制表位 | 6 (可变) |
| 0x8445 | `sprmPDxaTableLeft` | 表格左缩进 | 4 (2字节有符号) |
| 0x8446 | `sprmPDxaTableWidth` | 表格宽度 | 4 (2字节有符号) |
| 0x8447 | `sprmPFTableRow` | 表格行 | 0 (Toggle) |
| 0x8448 | `sprmPFTableCell` | 表格单元格 | 0 (Toggle) |
| 0x8449 | `sprmPFTblHeader` | 表格标题行 | 0 (Toggle) |
| 0x844A | `sprmPFTblOverlap` | 表格重叠 | 0 (Toggle) |
| 0x844B | `sprmPTblCellSpacing` | 单元格间距 | 6 (可变) |
| 0x844C | `sprmPTblCellPadding` | 单元格内边距 | 6 (可变) |
| 0x844D | `sprmPShdAuto` | 自动底纹 | 0 (Toggle) |
| 0x844E | `sprmPBrcTopAuto` | 自动上边框 | 0 (Toggle) |
| 0x844F | `sprmPBrcLeftAuto` | 自动左边框 | 0 (Toggle) |
| 0x8450 | `sprmPBrcBottomAuto` | 自动下边框 | 0 (Toggle) |
| 0x8451 | `sprmPBrcRightAuto` | 自动右边框 | 0 (Toggle) |
| 0x8452 | `sprmPBrcBetweenAuto` | 自动段落间边框 | 0 (Toggle) |
| 0x8453 | `sprmPBrcBarAuto` | 自动边框线 | 0 (Toggle) |

### 7.3 修订标记相关 SPRM

| 操作码 (hex) | 名称 | 说明 | spra |
|-------------|------|------|------|
| 0x0830 | `sprmCFMark` | 修订标记作者 | 2 (2字节) |
| 0x0831 | `sprmRMarkDate` | 修订日期 | 6 (可变) |
| 0x0832 | `sprmRMarkDMM` | 修订作者 | 2 (2字节) |
| 0x0833 | `sprmCFMarkFormat` | 格式修订 | 3 (4字节) |

---

## 8. 格式信息提取方法

### 8.1 获取字符属性的完整流程

```
1. 从 FIB 获取 fcPlcfBteChpx 和 lcbPlcfBteChpx
2. 从表格流读取 PlcfBteChpx 数据
3. 解析 aCP 数组，获取字符位置边界
4. 遍历 aPcb 字节数组，解析每个 CHPX
5. 对每个 CHPX，解析 grpprl 中的 Prl 列表
6. 根据 Sprm 操作码和操作数，提取字符格式信息
```

### 8.2 获取段落属性的完整流程

```
1. 从 FIB 获取 fcPlcfBtePapx 和 lcbPlcfBtePapx
2. 从表格流读取 PlcfBtePapx 数据
3. 解析 aCP 数组，获取段落位置边界
4. 遍历 aPcb 字节数组，解析每个 PAPX
5. 获取 istd（基础样式索引）
6. 从样式表 (STSH) 获取基础样式的段落属性
7. 解析 PAPX 的 grpprl，对基础样式进行增量修改
8. 得到最终的段落格式信息
```

### 8.3 常用属性提取示例

#### 8.3.1 提取字体信息

```typescript
function extractFontInfo(chpxGrpprl: Prl[], fontTable: FontTable[]): FontInfo {
  let ftcAscii = 0;  // 默认字体索引
  let ftcFE = 0;
  let hps = 20;      // 默认 10pt (20 half-points)
  let bold = false;
  let italic = false;
  let underline = 0;
  let color = 0x000000;  // 默认黑色

  for (const prl of chpxGrpprl) {
    switch (prl.sprm.opcode) {
      case 0x0801:  // sprmCFBold
        bold = prl.operand === 0x01;
        break;
      case 0x0802:  // sprmCFItalic
        italic = prl.operand === 0x01;
        break;
      case 0x0815:  // sprmCFUnderline
        underline = prl.operand;
        break;
      case 0x0816:  // sprmHps (字号，半磅)
        hps = prl.operand;
        break;
      case 0x0818:  // sprmFtcAscii
        ftcAscii = prl.operand;
        break;
      case 0x0819:  // sprmFtcFE
        ftcFE = prl.operand;
        break;
      case 0x081B:  // sprmCv (颜色)
        color = prl.operand;
        break;
    }
  }

  return {
    fontNameAscii: fontTable[ftcAscii]?.name || 'Times New Roman',
    fontNameFE: fontTable[ftcFE]?.name || 'SimSun',
    fontSizePt: hps / 2,  // 半磅转磅
    bold,
    italic,
    underline: underline > 0,
    underlineType: underline,
    color: rgbToHex(color),
  };
}
```

#### 8.3.2 提取段落对齐和缩进

```typescript
function extractParagraphInfo(papxGrpprl: Prl[]): ParagraphInfo {
  let alignment = 0;  // 0 = 左对齐
  let leftIndent = 0;
  let rightIndent = 0;
  let firstLineIndent = 0;
  let spaceBefore = 0;
  let spaceAfter = 0;
  let lineSpacing = 0;
  let lineSpacingAuto = true;
  let outlineLevel = 9;  // 9 = 正文文本

  for (const prl of papxGrpprl) {
    switch (prl.sprm.opcode) {
      case 0x2401:  // sprmPJc
        alignment = prl.operand;
        break;
      case 0x2402:  // sprmPDxaLeft
        leftIndent = prl.operand;
        break;
      case 0x2403:  // sprmPDxaRight
        rightIndent = prl.operand;
        break;
      case 0x2404:  // sprmPDxaIndent (首行缩进)
        firstLineIndent = prl.operand;
        break;
      case 0x2406:  // sprmPDyaBefore
        spaceBefore = prl.operand;
        break;
      case 0x2407:  // sprmPDyaAfter
        spaceAfter = prl.operand;
        break;
      case 0x2409:  // sprmPLine
        lineSpacing = prl.operand;
        break;
      case 0x240A:  // sprmPFLineAuto
        lineSpacingAuto = prl.operand === 0x01;
        break;
      case 0x2420:  // sprmPOutlineLvl
        outlineLevel = prl.operand;
        break;
    }
  }

  // 计算行距
  let lineSpacingValue = 1.0;
  if (!lineSpacingAuto && lineSpacing !== 0) {
    if (lineSpacing > 0) {
      // 固定行距（缇）
      lineSpacingValue = lineSpacing / 20;  // 转为磅
    } else {
      // 倍数行距（负值表示百分比）
      lineSpacingValue = Math.abs(lineSpacing) / 240;
    }
  }

  return {
    alignment: ['left', 'center', 'right', 'justify', 'distribute'][alignment],
    leftIndentTwips: leftIndent,
    leftIndentPt: leftIndent / 20,
    rightIndentTwips: rightIndent,
    rightIndentPt: rightIndent / 20,
    firstLineIndentTwips: firstLineIndent,
    firstLineIndentPt: firstLineIndent / 20,
    spaceBeforeTwips: spaceBefore,
    spaceBeforePt: spaceBefore / 20,
    spaceAfterTwips: spaceAfter,
    spaceAfterPt: spaceAfter / 20,
    lineSpacingAuto,
    lineSpacingValue,
    outlineLevel,
  };
}
```

### 8.4 单位换算

| 单位 | 换算关系 |
|------|---------|
| 缇 (Twip) | 1 英寸 = 1440 缇，1 磅 = 20 缇 |
| 半磅 (Half-point) | 1 磅 = 2 半磅 |
| 磅 (Point, pt) | 1 英寸 = 72 磅 |
| 像素 (px) | 取决于 DPI，默认 96 DPI 时 1pt = 1.333px |

常用换算：
- 字号：`pt = hps / 2`
- 缩进：`pt = dxa / 20`
- 行距倍数：`倍数 = abs(line) / 240`

### 8.5 颜色解析

4字节颜色值的解析：

```typescript
function parseColor(cv: number): { r: number; g: number; b: number; auto: boolean } {
  const b = cv & 0xFF;
  const g = (cv >> 8) & 0xFF;
  const r = (cv >> 16) & 0xFF;
  const auto = (cv & 0x80000000) !== 0;
  return { r, g, b, auto };
}
```

---

## 参考资料

- [MS-DOC 官方规范](https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-doc)
- [MS-DOC §2.6 Single Property Modifiers](https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-doc/4fae38be-4993-47d2-b82c-8f32e4ab9ff0)
- [MS-DOC §2.2.5.1 Sprm](https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-doc/099eb99c-a927-4caf-a80c-66254ea83d6a)
- [MS-DOC §2.2.5.2 Prl](https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-doc/4eabffa2-b8b6-444c-9a92-3291ab5035ef)
- [MS-DOC §2.2.2 PLC](https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-doc/a649fcc5-7868-4245-be12-04eea89d916b)
- [MS-DOC §2.5.6 FibRgFcLcb97](https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-doc/0c9df81f-98d0-454e-ad84-b612cd05b1a4)
