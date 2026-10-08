# DOC-POLISH 完工变更摘要 · vue-dev-6 · 2026-08-26

## 任务
DOC-POLISH：DocPreview.vue 文档性收尾（注释/命名/JSDoc，纯 polish）。红线：build+test 全绿、快照零漂移、不 commit。

## 改了什么（src/components/DocPreview.vue，净增量=纯注释块，零逻辑行）
1. **脚本区架构总览块**（imports 之后）：组件角色定位 + 端到端数据流（source→Worker/主线程解析→ParserOutput→applyFormattedPages→renderDocumentToPages→虚拟滚动窗口挂载）+ 子系统分区索引（与文内区块横幅对应）+ i18n 消费现状（t() 单例、useI18n 收敛方向）。明文约定"只述现状契约、不含行号"——本文件历史已三次大改（T3-W3/FIX-VUEW/PERF-T1），行号注释是漂移源。
2. **29 个函数补 JSDoc**：此前 51 个函数中 28 个零文档（另 downloadMarkdown 原仅横幅注释）。全部基于本轮函数体实读撰写（非模板套话），重点覆盖：
   - 分页簇：goToPage 越界 no-op 契约、scrollToPage 的"先扩窗再滚动+占位回退"、updateTotalPages 不依赖 DOM 渲染数
   - 加载簇：loadFromUrl 全链路（fetch 非 2xx 抛错→WORKER_THRESHOLD 分派→进度回写→finally 收尾）
   - 搜索簇：三级降级复制（copyText）、环形轮转匹配、clearHighlights 委托边界
   - 键盘簇：handleKeydown 快捷键全表 + 输入框聚焦守卫的覆盖范围说明
   - 已知未修事项如实入档：formatSizePt 单位文案未 i18n（标注为审计 A5 备忘项，不在 polish 内偷偷改行为）
3. **命名盘点结论（未动刀）**：51 个函数逐一核对均为动宾结构、语义与行为一致（如 scrollToPage/measureVisiblePageHeights/updateTotalPages）；无"名不副实"达到值得在红线任务内改名的程度——重命名收益<diff 噪声成本，判定不动。语义易混处（updatePageHeight 实为"同步基准高度"）以 JSDoc 澄清代替改名。

## 为什么这样修
- 文档性任务的验收物是"下一个接手者的上手成本"：架构总览解决"从哪读起"，函数 JSDoc 解决"这段契约是什么"，两者都刻意避开行号引用（本项目三轮重构证明行号必漂移）。
- 纯注释插入由确定性脚本完成（按函数名定位、前置已有 */ 自动跳过），构造上排除逻辑变更。

## 影响面与验证（零运行时差异的三重证据）
- 构造性：29 处插入均为 /** */ 注释块 + 1 处字符笔误修正，无任何代码行增删改。
- 产物级：dist main.js 字节数逐字节持平（317,982B/gzip105.55），注释文本在产物中 0 命中（grep 验证）——哈希微变仅为压缩器内容寻址位移。
- 测试级：npm run build ✅ vue-tsc 0 错误；npm test ✅ 55 文件/1266 用例全绿；renderGolden 8/8 零漂移（含于全量套件）。

## 遗留备忘
- formatStoryText 内 [分页]/│ 提示 span 与 onErrorCaptured 等处用户可见中文文案属审计 A5 清单，归后续 i18n 波，polish 未越界处理。
- DocStatsPanel 相关注释掉的导入属 ui-kit-dev "去留裁决"议题（其 v0 报告 P2），未清理。
