# [MS-CFB] Compound File Binary File Format — 摘要

> 规范版本: v12.0 (2024-04-23)
> 官方 PDF: https://winprotocoldocs-bhdugrdyduf5h2e4.b02.azurefd.net/MS-CFB/%5bMS-CFB%5d.pdf
> 在线文档: https://learn.microsoft.com/en-us/openspecs/windows_protocols/ms-cfb

本文件是 MS-CFB 规范的**精简摘要**，用于快速参考。实现细节以官方 PDF 为准。

---

## 1. 概述

复合文件二进制格式（Compound File Binary Format, CFBF），也称 OLE2 复合文档，是一种在单个文件内组织多个数据流的容器格式。它本质上是一个"文件中的文件系统"。

### 核心概念

| 概念 | 类比 | 说明 |
|------|------|------|
| 扇区 (Sector) | 文件系统块 | 复合文件内的最小分配单元，通常 512 字节 |
| 流 (Stream) | 文件 | 存储实际数据的字节序列 |
| 存储 (Storage) | 目录 | 组织流和其他存储的容器 |
| FAT | 文件分配表 | 跟踪扇区的使用和链接关系 |
| 目录条目 (Directory Entry) | inode/目录项 | 描述每个流或存储的元信息 |
| DIFAT | FAT 的 FAT | 跟踪 FAT 扇区自身的位置 |

---

## 2. 复合文件头 (Compound File Header)

**偏移 0x0000，大小 512 字节**（占 1 个扇区）

### 关键字段

| 偏移 | 大小 | 字段名 | 说明 |
|------|------|--------|------|
| 0 | 8 | `abSig` | 魔数签名：`D0 CF 11 E0 A1 B1 1A E1` |
| 24 | 2 | `uMinorVersion` | 次要版本号 (0x003E = 62) |
| 26 | 2 | `uMajorVersion` | 主要版本号：0x0003 (v3) 或 0x0004 (v4) |
| 28 | 2 | `uByteOrder` | 字节序：0xFFFE = 小端 (LE) |
| 30 | 2 | `uSectorShift` | 扇区大小 = 2^uSectorShift，v3=9 (512B), v4=12 (4096B) |
| 32 | 2 | `uMiniSectorShift` | 迷你扇区大小 = 2^uMiniSectorShift，通常=6 (64B) |
| 40 | 4 | `cDirSectors` | 目录扇区数 (v3 中为 0，v4 中为实际数) |
| 44 | 4 | `cFatSectors` | FAT 扇区数 |
| 48 | 4 | `dirStart` | 第一个目录扇区的扇区号 (SID) |
| 68 | 4 | `cMiniFatSectors` | 迷你 FAT 扇区数 |
| 72 | 4 | `miniFatStart` | 第一个迷你 FAT 扇区的扇区号 |
| 76 | 4 | `cDifatSectors` | DIFAT 扇区数 |
| 80 | 4 | `difatStart` | 第一个 DIFAT 扇区的扇区号 |
| 76 | 436 | `headerDifat` | 文件头内置的 DIFAT 数组（109 个 FAT 扇区入口） |

### 特殊扇区号 (SID)

| 值 | 名称 | 含义 |
|----|------|------|
| -0x00000000 | 普通扇区 | 实际数据扇区 |
| -0xFFFFFFFE | ENDOFCHAIN | 链的最后一个扇区 |
| -0xFFFFFFFD | FATSECTOR | FAT 扇区 |
| -0xFFFFFFFC | DIFSECTOR | DIFAT 扇区 |
| -0xFFFFFFFB | FATSECTORS | 预留 |
| -0xFFFFFFFA | 预留 | 预留 |
| -0xFFFFFFF9 | 预留 | 预留 |
| -0xFFFFFFF8 | FREESECT | 未使用/空闲扇区 |
| -0xFFFFFFF7 | MAXREGSECT | 最大值标记 |

---

## 3. FAT (File Allocation Table)

文件分配表，跟踪每个扇区的下一个扇区号。

### 结构

- FAT 由多个 FAT 扇区组成
- 每个 FAT 扇区包含 `sectorSize / 4` 个 32 位条目
- FAT 数组按扇区号索引：`fat[sectorNumber] = nextSector`
- 链的最后一个扇区的值为 `ENDOFCHAIN (0xFFFFFFFE)`

### 扇区数计算

```
entriesPerSector = sectorSize / 4   // 512/4 = 128 for v3
```

---

## 4. DIFAT (Double Indirect FAT)

DIFAT 是"FAT 的 FAT"，用来跟踪 FAT 扇区自身的位置。

### 结构

- 文件头中的 `headerDifat` 数组包含前 109 个 FAT 扇区位置
- 如果 FAT 扇区多于 109 个，使用 DIFAT 扇区链表
- DIFAT 扇区中，前 `entriesPerSector - 1` 个条目是 FAT 扇区号，最后一个条目是下一个 DIFAT 扇区号

### 解析步骤

1. 从文件头读取 `headerDifat[109]`，获取前 109 个 FAT 扇区
2. 读取 `cDifatSectors`（DIFAT 扇区数）和 `difatStart`（第一个 DIFAT 扇区）
3. 遍历 DIFAT 扇区链，收集更多 FAT 扇区
4. 读取所有 FAT 扇区，构建完整的 FAT 数组

---

## 5. 目录 (Directory)

目录是一个流，包含所有存储和流的条目。

### 目录扇区

- 目录起始扇区：`dirStart`
- 目录大小 = 目录扇区数 × 扇区大小
- 每个目录条目大小：128 字节
- 目录条目组成一个**红黑树**结构

### 目录条目结构 (128 字节)

| 偏移 | 大小 | 字段名 | 说明 |
|------|------|--------|------|
| 0 | 64 | `ab[64]` | 名称（UTF-16LE，含终止符） |
| 64 | 2 | `cb` | 名称的字节数（含终止符） |
| 66 | 1 | `bObjType` | 对象类型：0x00=空, 0x01=存储, 0x02=流, 0x05=根存储 |
| 67 | 1 | `bColor` | 颜色：0=红色, 1=黑色 |
| 68 | 4 | `uLeftSib` | 左兄弟节点的 DID |
| 72 | 4 | `uRightSib` | 右兄弟节点的 DID |
| 76 | 4 | `uChild` | 子节点的 DID（仅存储对象有） |
| 80 | 16 | `clsid[16]` | CLSID（类 ID） |
| 96 | 4 | `uStateBits` | 状态位 |
| 100 | 8 | `time[2]` | 创建时间 + 修改时间（FILETIME） |
| 108 | 4 | `sectStart` | 起始扇区号（SID） |
| 112 | 4 | `uSizeLow` | 流大小低 32 位 |
| 116 | 4 | `uSizeHigh` | 流大小高 32 位（v3 中为 0） |

### 目录条目 ID (DID)

- 每个目录条目的索引 = DID
- 第一个条目（DID 0）是**根存储** (Root Entry)
- 根存储的起始扇区指向迷你流 (Mini Stream)

### 遍历目录树

1. 从根存储（DID 0）开始
2. 对于存储对象，遍历其子节点（红黑树）
3. 对于每个子节点，递归访问其左兄弟、右兄弟
4. 按名称查找时，从子节点开始二分查找

---

## 6. 迷你流 (Mini Stream)

小流（默认小于 4096 字节）存储在迷你流中，而不是直接占用完整扇区。

### 迷你 FAT (Mini FAT)

- 结构与 FAT 类似，但用于迷你扇区
- 迷你扇区大小：`2^uMiniSectorShift`，通常 64 字节
- 迷你 FAT 本身存储在常规扇区中
- 迷你流的数据存储在**根存储**的流数据中

### 迷你流位置

- 迷你流的起始扇区 = 根存储的 `sectStart`
- 迷你流的大小 = 根存储的 `uSizeLow` (v3)

---

## 7. 流读取算法

### 常规流（≥ 4096 字节）

```
1. 从目录条目获取起始扇区 sectStart 和大小 size
2. 建立扇区链：
   currentSector = sectStart
   while currentSector != ENDOFCHAIN:
     读取 sectorSize 字节
     currentSector = fat[currentSector]
3. 取前 size 字节
```

### 迷你流（< 4096 字节）

```
1. 从目录条目获取起始迷你扇区和大小
2. 从迷你 FAT 建立迷你扇区链
3. 从根存储的数据流中读取迷你扇区
   每个迷你扇区的偏移 = miniSectorNumber * miniSectorSize
```

---

## 8. 版本差异

### v3 vs v4

| 特性 | v3 | v4 |
|------|----|----|
| 扇区大小 | 512 字节 (shift=9) | 4096 字节 (shift=12) |
| 迷你扇区大小 | 64 字节 (shift=6) | 64 字节 (shift=6) |
| 头部大小 | 512 字节 | 512 字节 |
| cDirSectors | 必须为 0 | 目录扇区数 |
| 最大文件大小 | ~2GB | ~更大 |

---

## 9. 与项目实现的对照

### oleParser.ts 实现状态

| 功能 | 状态 | 说明 |
|------|------|------|
| OLE 签名验证 | ✅ | 检查 D0 CF 11 E0 A1 B1 1A E1 |
| 文件头解析 | ✅ | 扇区大小、FAT/DIFAT 位置等 |
| FAT 表解析 | ✅ | 构建扇区分配表 |
| DIFAT 表解析 | ✅ | 支持 headerDifat + DIFAT 扇区链 |
| 目录表解析 | ✅ | 查找 WordDocument 流 |
| 流数据读取 | ✅ | 支持链式扇区读取 |
| 迷你流支持 | ⚠️ | 可能不完整 |
| 目录树遍历 | ⚠️ | 简单名称匹配，未完整遍历红黑树 |
| v4 格式支持 | ❌ | 只测试过 v3 (512 字节扇区) |

### 已知实现细节

- FAT 初始化：`fat = new Array(totalSectors).fill(-2)`
- DIFAT 中每个条目对应 `d * entriesPerSector` 个扇区
- 流读取使用 `sectorToOffset(currentSector)` 计算物理偏移

---

## 10. 参考资料

- 官方规范 PDF: [MS-CFB.pdf](https://winprotocoldocs-bhdugrdyduf5h2e4.b02.azurefd.net/MS-CFB/%5bMS-CFB%5d.pdf)
- 项目实现: [src/utils/oleParser.ts](../../src/utils/oleParser.ts)
- 测试文件: [tests/oleParser.test.ts](../../tests/oleParser.test.ts)
