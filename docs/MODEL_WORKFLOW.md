# DOC 解析协作工作流

这个文档是给后续参与本项目的模型看的接力说明。目标是把 `.doc` 预览能力逐步补到更完整、更稳定、可回归验证的状态。

## 1. 项目目标

当前项目是一个纯前端的 `.doc` 在线预览工具，基于 Vue 3 + TypeScript + Vite。

最终目标不是“能打开一点点文本”，而是做到：

- 稳定解析旧版 Word `.doc` / `.dot`
- 尽可能还原正文、表格、列表、页眉页脚、脚注尾注等结构
- 输出可读的 HTML 预览
- 保持纯前端、无服务端依赖
- 所有解析规则都要有样本和测试支撑

## 2. 当前进度

已经完成的部分：

- OLE2 / CFBF 容器识别
- FAT / DIFAT / Directory 读取
- `WordDocument` 流定位
- `MiniFAT` / mini-stream 读取
- FIB 解析
- CLX / piece table 解析
- 基础文本抽取
- 编码启发式判断
- 基础格式启发式推断
- Worker 后台解析
- 表格风格的 tab 行识别与 HTML 渲染
- Word 表格识别（0x07 单元格终结符）与 HTML `<table>` 渲染
- 列表编号识别（阿拉伯/中文/罗马/圈号 + 多级缩进嵌套）
- 嵌入式图片提取（PNG/JPEG/BMP/GIF 魔数扫描 + data URL 渲染）
- `fWhichTblStm` 选择 0Table / 1Table（含回退）
- `FibRgLw` 的 `rgCcp` 全字段提取
- Story 分流：主文档 / 脚注 / 页眉页脚 / 尾注 / 批注 / 文本框 按 cp 边界拆分
- 页眉页脚 / 脚注 / 尾注 / 批注的 UI 折叠面板展示
- 基础单测和构建通过（231 个测试）
- CHP 表基础解析（PlcfBteChpx + 常用 SPRM 解码：加粗、斜体、下划线、删除线、上标、下标、字号、颜色、高亮）
- PAP 表基础解析（PlcfBtePapx + 常用 SPRM 解码：对齐、左缩进、首行缩进、行距、段前/段后间距）
- CHP/PAP 格式集成到 parseWithFormat 主流程
- 样式表规范解析（STD 结构解析 + CHP/PAP grpprl 提取 + 样式继承 + 50+ 内置样式映射，标题样式生成大纲和 h1-h6）
- CHP/PAP 与段落精确匹配（原始段落索引 + 文本位置 cp 估计，替换粗略平均长度估计）
- 字体表解析（STTB Ffn + sprmCFFont，获取真实字体名称）
- prm 字段解析（piece 级别 CHPX 关联）：已实现 fChp + chpxIndex 提取，应用于 piece 范围内的字符
- 列表表解析（LST/LVLF）：已实现 sprmPIlvl/ilst/ilfo 提取 + getListFormat 格式映射，替换启发式列表检测
- DOP（Document Properties）解析：已实现 fcDop/lcbDop 定位（FIB 索引 62/63）+ DOP 位域解析（fFacingPages/fTitlePage/fPMHMain/fRMW/fFtnRestart/fFtnEnd/fFtnAtEnd），UI 折叠面板展示页眉页脚变体与修订模式标志

仍待完成的部分（全量）：

### 容器层 / OLE2 / CFBF

- 目录树的完整遍历与红黑树逻辑
- 更严格的目录对象解析与命名匹配
- v4 CFBF / 4KB 扇区兼容
- 更完整的 root storage / mini-stream / stream 链异常处理

### FIB / WordDocument 头部

- ✅ `fWhichTblStm` 解析与 `0Table` / `1Table` 精确选择（已实现，含回退）
- ✅ `FibRgLw` 的 `rgCcp` 全字段提取（ccpText/Ftn/Hdd/Mcr/Atn/Edn/Txbx/HdrTxbx）
- ✅ `fcPlcfBteChpx` / `fcPlcfBtePapx` 定位（已实现，用于 CHP/PAP 格式解析）
- ✅ `fcStshf` / `lcbStshf` 样式表定位（已实现，用于样式表解析）
- 其余 `rgFcLcb` 字段的系统性读取
- `fComplex` 的稳健判定与容错

### CLX / Pcdt / PlcPcd

- ✅ `prm` 字段解析（piece 级别 CHPX 关联，fChp + chpxIndex 已提取并应用）
- ✅ piece/story 元数据恢复（`parseClxPieces` 返回 Piece[] 元数据）
- ✅ story 边界与多流内容的严格分流（`splitPiecesByStory` 按 rgCcp 切片）

### 真实格式恢复

- ✅ CHP 结构级解析（基础实现：常用 SPRM 解码）
- ✅ PAP 结构级解析（基础实现：常用 SPRM 解码）
- ✅ STSH / 样式表解析（规范实现：STD 结构解析 + CHP/PAP grpprl 提取 + 样式继承）
- ✅ CHP/PAP 与段落精确匹配（原始段落索引 + 文本位置 cp 估计）
- ✅ 字体表（STTB Ffn）解析 + sprmCFFont 字体名称
- ✅ prm 字段解析（piece 级别 CHPX 关联）
- ✅ 列表编号增强（LST/LVLF 规范解析 + sprmPIlvl/ilst/ilfo）
- ✅ 字符边框/阴影（sprmCFOutline/sprmCFShadow + text-shadow 渲染）
- ✅ 字符间距（sprmKern/sprmDxaSpace + letter-spacing 渲染）
- ✅ 段落底纹（sprmPShd + background-color 渲染）
- ✅ 制表位（sprmPDxaTab/sprmPChgTabs 基础解析）
- ✅ 段落边框（sprmPBrc）
- ✅ 目录（TOC 域解析）
- ✅ 扩展文档属性（DocumentSummaryInformation 流解析：类别/公司/经理/行数等）

### 结构内容恢复

- ✅ 列表和编号还原（LST/LVLF/PlcfLfo 完整解析 + sprmPIlvl/ilst/ilfo + getListFormat 格式映射；启发式降为备用方案）
- ✅ 超链接解析（PlcfFld + HYPERLINK 域提取已实现 + 集成到渲染，输出可点击 `<a>` 标签）
- ✅ 文档属性（SummaryInformation + DocumentSummaryInformation 双流解析 + UI 展示全部属性）
- ✅ 表格结构识别（基础：0x07 单元格终结符 + 连续行拼接为 HTML `<table>`，暂不支持 TAP 合并/边框）
- ✅ 页眉 / 页脚（基础：ccpHdd 已分流到 `stories.headers`，UI 折叠面板展示）
- ✅ 脚注 / 尾注（基础：ccpFtn / ccpEdn 已分流到 `stories.footnotes` / `stories.endnotes`）
- ✅ 批注（基础：ccpAtn 已分流到 `stories.comments`）
- ✅ 目录（TOC 域解析 + 层级渲染）
- 修订痕迹（基础：已解析 DOP 的 fRMW 开关标志，UI 展示修订模式状态；未解析具体修订内容/作者/时间）
- ✅ Section 级布局差异（已实现：DOP 的 fFacingPages 奇偶页不同 + fTitlePage 首页不同 标志解析，UI 展示）

### 资源与对象

- ✅ 图片提取与渲染（启发式：Data 流魔数扫描 PNG/JPEG/BMP/GIF + UI 折叠面板）
- 嵌入式 OLE 对象
- 形状 / 文本框 / 浮动对象

### 文档元数据

- `SummaryInformation`
- `DocumentSummaryInformation`
- 标题、作者、主题、关键词、编辑统计等属性展示

### 预览层补完

- 页眉页脚的展示策略
- 脚注尾注的展示策略
- 批注 / 修订的 UI 入口
- 表格、列表、图片、对象的统一渲染策略
- 更接近 Word 的段落层级与样式还原

## 3. 推荐阅读顺序

后续模型接手前，建议先看这些文件：

1. [`docs/specs/README.md`](/Users/zhenghaiyang/02个人项目/doc-preview/docs/specs/README.md)
1. [`docs/specs/implementation-plan.md`](/Users/zhenghaiyang/02个人项目/doc-preview/docs/specs/implementation-plan.md)
1. [`docs/specs/MS-CFB-SUMMARY.md`](/Users/zhenghaiyang/02个人项目/doc-preview/docs/specs/MS-CFB-SUMMARY.md)
1. [`src/utils/oleParser.ts`](/Users/zhenghaiyang/02个人项目/doc-preview/src/utils/oleParser.ts)
1. [`src/utils/docParser.ts`](/Users/zhenghaiyang/02个人项目/doc-preview/src/utils/docParser.ts)
1. [`src/components/DocPreview.vue`](/Users/zhenghaiyang/02个人项目/doc-preview/src/components/DocPreview.vue)

## 4. 总体实现流程

后续所有 `.doc` 相关工作，尽量按下面顺序推进：

1. 容器层
1. `WordDocument` / FIB
1. CLX / piece table
1. 文本抽取
1. 格式恢复
1. 结构内容恢复
1. 预览渲染
1. 样本回归和测试

不要跳过前面的底层步骤直接做渲染，否则很容易把启发式结果当成规范结果。

## 5. 任务拆分建议

如果多个模型并行工作，推荐这样分工：

### 任务 A: 容器与流

负责范围：

- OLE2 / CFBF 规范核对
- Header / FAT / DIFAT / Directory 完整性
- `MiniFAT` 和 mini-stream 回归
- 目录树遍历与 root storage 关系
- v4 扇区兼容与异常样本

优先文件：

- [`src/utils/oleParser.ts`](/Users/zhenghaiyang/02个人项目/doc-preview/src/utils/oleParser.ts)
- [`tests/oleParser.test.ts`](/Users/zhenghaiyang/02个人项目/doc-preview/tests/oleParser.test.ts)

### 任务 B: 文本与 piece table

负责范围：

- FIB 偏移链复核
- CLX / PCDT / PlcPcd / PCD piece table
- `prm` 字段解析
- 文本范围抽取
- 编码判断与 paragraph 边界
- story 分流与 piece 拼接策略

优先文件：

- [`src/utils/docParser.ts`](/Users/zhenghaiyang/02个人项目/doc-preview/src/utils/docParser.ts)
- [`tests/fibParser.test.ts`](/Users/zhenghaiyang/02个人项目/doc-preview/tests/fibParser.test.ts)
- [`tests/clxParser.test.ts`](/Users/zhenghaiyang/02个人项目/doc-preview/tests/clxParser.test.ts)
- [`tests/docParser.test.ts`](/Users/zhenghaiyang/02个人项目/doc-preview/tests/docParser.test.ts)

### 任务 C: 结构化预览

负责范围：

- 真实 CHP / PAP 恢复后的 HTML 映射
- 表格块渲染与单元格结构重建
- 列表和编号的结构化输出
- 页眉页脚、脚注尾注的展示策略
- 批注、修订、超链接、TOC 的 UI 展示
- 预览层降级与可访问性

优先文件：

- [`src/components/DocPreview.vue`](/Users/zhenghaiyang/02个人项目/doc-preview/src/components/DocPreview.vue)
- [`src/utils/docFormat.ts`](/Users/zhenghaiyang/02个人项目/doc-preview/src/utils/docFormat.ts)

### 任务 D: 测试与样本

负责范围：

- 为新行为补单测
- 为真实样本建立回归
- 对比 Word / LibreOffice / 现有启发式结果

优先文件：

- [`tests/`](/Users/zhenghaiyang/02个人项目/doc-preview/tests)
- [`docs/`](/Users/zhenghaiyang/02个人项目/doc-preview/docs)

## 6. 每次改动的标准流程

每个模型都尽量按这个流程做事：

1. 先读现有实现和测试
1. 找到当前层的缺口
1. 只改当前层相关代码
1. 补最小可验证测试
1. 运行 `npm test`
1. 运行 `npm run build`
1. 只在测试和构建都通过后继续下一层

## 7. 代码约束

- 保持纯前端，不引入后端依赖
- 不要把启发式结果描述成规范级实现
- 不要移除现有 fallback，除非新的实现已经覆盖得更完整
- 不要在没有测试的情况下大改解析规则
- 优先保留已有用户可用功能，再逐步增强
- 如果要改格式推断，尽量保持向后兼容

## 8. 当前已知的关键行为

这些行为已经在项目里稳定存在，后续修改时要小心：

- `DocParser` 是主解析入口
- `OleParser` 负责容器和流
- `parseFib()` 负责 FIB 关键偏移
- `parseWithWorker()` 负责大文件后台解析
- `DocPreview.vue` 负责最终 HTML 渲染
- tab 行会被当作表格候选处理
- 连续 piece 会被拼接
- mini-stream 支持已经接上

## 9. 全量未完成项总表

下面这份是给后续模型直接认领任务用的“总账”。如果只看这一段，也能知道当前到底还缺什么。

### 9.1 仍未完成，但属于核心实现范围

- 目录树完整遍历
- ✅ CHP 真实字符格式解析（规范级：常用 SPRM + 字体名称 + 小型大写/全部大写/双删除线）
- ✅ PAP 真实段落格式解析（规范级：对齐含分散对齐 + 左/右/首行缩进 + 大纲级别 + 列表格式）
- ✅ STSH / 样式表解析（规范实现：STD 结构解析 + CHP/PAP grpprl 提取 + 样式继承）
- ✅ prm 字段解析（piece 级别 CHPX 关联已实现）
- ✅ 真实列表和编号恢复（已实现：LST/LVLF 解析、sprmPIlvl/ilst/ilfo 提取、getListFormat 格式映射，替换启发式列表检测）
- 真实表格结构恢复
- 修订痕迹（基础：DOP fRMW 标志已解析，UI 展示修订模式开关；不解析具体修订内容）
- 超链接
- TOC / 域结构
- 图片和嵌入对象
- 形状 / 文本框
- 文档属性
- ✅ section 级布局差异（DOP fFacingPages / fTitlePage 已解析 + UI 展示）

### 9.2 已知"部分可用，但还不算完成"

- FIB：关键字段能读，覆盖了大部分表偏移（CHPX/PAPX/STSH/LST/LFO/Font/Clx 等）
- CLX：可解析，支持多 piece 拼接，story 级分流已落地（按 rgCcp 切片），prm/fChp/chpxIndex 已实现
- 文本抽取：可用，但仍依赖启发式编码判断和噪声清理（textutil 生成的文件 byte 12 不可靠）
- 格式推断：已实现规范级 CHP/PAP/STSH 解析 + 样式继承；启发式降为备用方案
- 表格：能识别 tab 风格块和 0x07 单元格终结符，但还未恢复真实 TAP 单元格结构
- 列表：已实现 LST/LVLF/PlcfLfo 完整解析 + ilfo > ilst 优先链；启发式降为备用方案
- 页眉页脚 / 脚注 / 尾注 / 批注：已分流出文本，但还未做 section 区分、引用编号等精细化处理

### 9.3 明确不支持，按当前目标可保持排除

- `.docx` / Open XML
- VBA 宏
- 加密文档

这三类不是“没做完”，而是当前项目目标外或安全上不计划支持。

## 10. 推荐的下一批任务

如果后续模型要继续推进，优先级建议如下：

1. ✅ story 分流（已完成：`splitPiecesByStory` + `parseClxWithStories`）
1. ✅ 脚注 / 尾注（已完成：ccpFtn / ccpEdn 已分流到 `stories`）
1. ✅ 页眉 / 页脚（已完成：ccpHdd 已分流到 `stories.headers`，UI 折叠面板）
1. ✅ 表格结构化增强（已完成：0x07 单元格终结符识别 + HTML `<table>` 渲染）
1. ✅ 列表编号增强（已完成：LST/LVLF 规范解析 + sprmPIlvl/ilst/ilfo → getListFormat，支持 decimal/lower-alpha/lower-roman/cjk-ideographic/disc 等格式）
1. ✅ 图片与嵌入对象（已完成：Data 流魔数扫描 PNG/JPEG/BMP/GIF + UI 折叠面板）
1. ✅ DOP 文档属性标志（已完成：fcDop/lcbDop 定位 + DOP 位域解析 + UI 展示页眉页脚变体与修订模式标志）
1. 更严格的 CHP / PAP 结构恢复 ← **当前任务**
1. 样本覆盖补齐

## 11. 验收标准

每做完一批任务，至少满足下面几项：

- `npm test` 通过
- `npm run build` 通过
- 新增行为有测试覆盖
- 没有破坏已有样本解析
- 预览输出可读，不出现明显退化

## 12. 不建议的做法

- 不要直接把整个解析器重写成“大一统扫描器”
- 不要为了“看起来更像 Word”而删除已有 fallback
- 不要只改 UI 不改解析底层
- 不要在没有样本验证的情况下盲加复杂规则

## 13. 交接备注

如果你是后续模型，建议先回答这三个问题：

1. 当前任务属于容器层、文本层、结构层还是测试层
1. 这次改动能否用一个最小样本验证
1. 是否会影响已有 `npm test` / `npm run build` 结果

只要这三点清楚，后续协作会顺很多。
