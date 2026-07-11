# `.doc` 解析实施清单

这个清单按“从容器到底层文本”的顺序拆解，适合逐条推进。

## 1. 容器层

- [ ] 验证 OLE2 签名
- [ ] 解析 Header
- [ ] 读取 FAT / DIFAT
- [ ] 读取 Directory
- [ ] 定位 `WordDocument` 流
- [ ] 支持 mini-stream / mini FAT
- [ ] 支持更稳健的流链读取

## 2. FIB 层

- [ ] 复核 `FibBase` 偏移
- [ ] 复核 `csw -> FibRgW -> cslw -> FibRgLw -> cbRgFcLcb` 偏移链
- [ ] 精确定位 `fcMin / fcMac / fcClx / lcbClx`
- [ ] 为异常 FIB 建立降级策略

## 3. CLX / Piece Table

- [ ] 解析 `Clx`
- [ ] 解析 `Pcdt`
- [ ] 建立字符位置到文档流的映射
- [ ] 识别 Unicode / 8-bit piece
- [ ] 用 piece table 替代纯扫描抽取

## 4. 文本抽取

- [ ] 段落边界识别
- [ ] 编码自动判断
- [ ] 前缀噪声清理
- [ ] 域代码、控制符、无效字符过滤

## 5. 格式恢复

- [ ] 字符级属性
- [ ] 段落级属性
- [ ] 对齐、缩进、行距
- [ ] 列表类型与编号样式
- [ ] 标题/正文识别

## 6. 复杂结构

- [ ] 表格
- [ ] 图片 / OLE 嵌入对象
- [ ] 脚注 / 尾注
- [ ] 批注 / 修订痕迹
- [ ] 页眉 / 页脚

## 7. 验证

- [ ] 每类样本至少 1 个回归文件
- [ ] 为每个解析阶段增加失败样例
- [ ] 记录与 Word / LibreOffice 的差异
- [ ] 生成一份“已支持能力矩阵”
