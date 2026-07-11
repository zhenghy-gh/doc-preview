# `.doc` 规范资料索引

这个目录用来集中放置 `.doc` 解析相关的规范、参考资料和实施清单。

## 官方来源

下面这些是优先级最高的参考来源，后续实现都尽量对照它们：

| 资料 | 用途 | 链接 |
| --- | --- | --- |
| Open Specification Promise | 确认 Word 二进制格式被公开覆盖，作为规范入口 | https://learn.microsoft.com/en-us/openspecs/dev_center/ms-devcentlp/1c24c7c8-28b0-4ce1-a47d-95fe1ff504bc |
| Open Specifications | Microsoft Open Specs 总入口 | https://learn.microsoft.com/en-us/openspecs/main/ms-openspeclp/3589baea-5b22-48f2-9d43-f5bea4960ddb |
| MS-CFB 摘要 | 仓库内现成的 CFBF 速查资料，可直接作为容器层实现参考 | [docs/specs/MS-CFB-SUMMARY.md](./MS-CFB-SUMMARY.md) |
| MS-DOC 总览 | Word 二进制格式总览摘要 | [docs/specs/MS-DOC-SUMMARY.md](./MS-DOC-SUMMARY.md) |
| MS-DOC FIB 结构 | File Information Block 详解 | [docs/specs/MS-DOC-FIB.md](./MS-DOC-FIB.md) |
| MS-DOC Clx/Pcdt/PlcPcd | 文本片段表详解 | [docs/specs/MS-DOC-CLX.md](./MS-DOC-CLX.md) |
| MS-DOC CHPX/PAPX 结构 | 字符与段落属性、SPRM 操作码详解 | [docs/specs/MS-DOC-CHP-PAP.md](./MS-DOC-CHP-PAP.md) |
| Word 97-2007 Binary File Format (.doc) Specification | `.doc` 文件格式主规范入口 | https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-doc |
| Compound File Binary File Format (MS-CFB) | OLE2/CFBF 容器规范，优先用于 Header/FAT/DIFAT/Directory | https://docs.microsoft.com/en-us/openspecs/windows_protocols/ms-cfb/53989ce4-7b05-4f8d-829b-d08d6148375c |

## 当前项目状态

现有实现已经覆盖了：

- OLE2 容器识别与基本遍历
- WordDocument 流定位
- FIB 解析
- 文本扫描与编码启发式检测
- 解析器 worker 化
- 基础格式推断

但距离“完整 `.doc` 解析”还差很多，主要缺口是：

- 更严格的 `WordDocument` 流读取与 mini-stream 处理
- CLX / piece table 的完整解析
- 段落、字符、列表、表格、域、脚注、尾注、图片等结构化内容
- 基于规范的字段偏移验证和回归测试

## 实施顺序

建议按下面的顺序逐条推进：

1. `MS-CFB` 容器层
2. `WordDocument` / `FIB`
3. `CLX` / piece table
4. 文本抽取与段落切分
5. 段落/字符格式恢复
6. 列表、表格、脚注、尾注
7. 媒体与嵌入对象
8. 兼容性回归和样本覆盖

## 本地样本

仓库里已经有一批 `.doc` 样本文件，可用于回归验证：

- `docs/*.doc`
- `docs/_archived/*.doc`

## 协作工作流

给后续模型的完整接力说明在这里：

- [`docs/MODEL_WORKFLOW.md`](../MODEL_WORKFLOW.md)

## 下一步建议

如果继续往下做，下一步最值得先补的是：

1. 把 `WordDocument` 的 CLX / piece table 真正接上
2. 为 `parseFib()` 和 `OleParser` 增加规范驱动的单测
3. 把当前启发式文本抽取结果和样本文件结果对照起来，建立回归基线
