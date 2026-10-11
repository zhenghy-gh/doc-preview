# Round 134 优化记录（2026-10-12）

## 结论
否决 `mergeCharFormatForParagraph` 首个颜色/高亮条件短路顺序交换。真实33,702次调用隔离耗时增加2.3387%；交错4×NEW/4×OLD各100轮，第1、4组退化0.1763%/0.5487%，未证明稳定收益。独立确认getter输入异常语义不等价，构成另一个否决理由。生产源码精确恢复4c87ebe，保留12项常驻护栏；版本保持0.7.59，不升号、不发布。按协议否决例外计入134，下一轮135，目标208。

## 门禁与接续边界
2026-10-11T16:04:49Z（北京时间10月12日00:04:49）现场状态133/134/inFlight=true、updatedAt13:47:05.831Z，超过90分钟；git HEAD4c87ebe，无活动round134/基准/测试/构建/发布进程，stash为空。只接续同一134，不新开135。既有当日memory/state/outputs和候选、护栏不是垃圾，保留；原始证据备份到常驻 `round134-inherited/`，不删脚手架。更新占用后本会话独立重跑控制、真实捕获和技术门禁。

候选由上一执行遗留，已继承CPU剖析而非在本会话重新做候选选择前剖析。原80轮×27文档CPU有5,364采样，merge自耗175/5364=3.2625%；颜色/高亮行positionTicks约0.17%/0.26%（分母全部样本），不视作可兑现收益。原始cpuprofile、未混淆OLD bundle及行级日志保留，独立重算merge采样。此次完整隔离旧函数由4c87ebe TypeScript经esbuild转写后与旧bundle函数逐字核对一致。

## 候选、真实分布与等价性
原 `if (format.color && !firstColor)` 改为 `if (!firstColor && format.color)`，highlight同理，只改两行。原意在首值确定后省重复读取；未修改其他格式权重、样式覆盖、字体和结果键序。

本会话从旧bundle实际解析27 DOC/DOT捕获33,702次真实调用（32,690次输出非空），逐调用deepEqual与JSON键序比较通过。56,491次overlap里颜色已选后的读取9,264次、高亮103次；不能误写成所有run都命中短路。数据用v8序列化保留undefined与Map。六组正反交错各100遍预热完整合并函数，上中位OLD567.242417ms/NEW580.508500ms，耗时增加2.3386973%；原遗留隔离亦退化0.9119807%，不丢弃旧不利证据。

普通数据对象输出等价不等于所有公开调用等价：先取得颜色后，旧实现仍读后续color getter/Proxy；新实现跳过，可吞掉本应抛出的原异常。本会话独立构造sentinel反例确认旧版抛出、新版不抛。生产最终撤回并以严格读取次数和异常护栏防止重采纳。

## 护栏纠错与鉴别力
首轮复核发现遗留真实FKP用例参数误排为 `(table, word, pieces, fc, lcb)`，返回0而非26,698条；修正为实际签名 `(table, word, fc, lcb, pieces)`，没有放宽断言。遗留控制脚本计为11项，而实际为12项；修正计数，完整12项运行通过。

`tests/formatParser.test.ts` 保留逐字HEAD旧oracle及12项：完整字段/JSON键序、first-truthy、空/undefined、半开CP边界、直接格式覆盖样式、512组字段组合×两范围、30%/50%阈值、冻结/引用不变、跨调用变化、27份真实FKP非空产出、getter/Proxy读取与异常、非有限范围/非法format。真实FKP单run取每文档前100条，与实际33,702段落调用隔离不是同一覆盖口径。

候选普通对象控制12通过，last-color/wrong-precedence/lose-highlight三错误负控4/2/11项语义失败，slow-equivalent12通过。撤回后进一步把getter边界从宽松声明改为严格护栏；增加short-circuit负控，必须捕获已否决候选。控制在Vite内存变换，不改磁盘生产代码。最终控制中三错控4/2/11项语义失败，额外short-circuit1项失败，旧版与慢等价各12项通过。结果见 `round134-controls.json`，候选控制保留 `round134-candidate-controls.json`。

## 五门禁、预建与端到端
候选先串行npm test、vue-tsc --noEmit、lint、build、build:lib，76文件/1606项及其他门禁全部通过，不并行test/lint。实际git stash仅formatParser.ts → 构建OLD → stash pop → 构建NEW，保存回执与双bundle SHA256；计时前全部构建完毕，中途不stash、不重建。

|组|NEW中位ms|OLD中位ms|耗时变化|
|---|---:|---:|---:|
|1|93.210|93.046|增加0.1762569%|
|2|93.473|93.505|降低0.0342228%|
|3|93.592|93.725|降低0.1419045%|
|4|94.004|93.491|增加0.5487159%|

8独立进程各100轮×27预加载文件，顺序NEW/OLD、OLD/NEW、NEW/OLD、OLD/NEW。计时期间本会话仅读少量证据/任务状态并准备比较脚本，没有并行测试/构建/其他计时/bench；不声称整机空载或统计显著。无稳定收益保守否决，不挑有利组。

## 撤回、cmp、bench、包体
候选与OLD各27份完整parseWithFormat JSON系统cmp通过，bench134/133除cycle/timestamp逐字段相同；撤回最终另27份比较和五门禁结果保存在final记录。比较脚本初次把URL.pathname当中文路径导致bench启动MODULE_NOT_FOUND；改fileURLToPath后整步重新执行成功，不将失败回执冒称通过。

OLD ESM361,522字节/gzip95,034；候选原长不变但gzip95,036，+2字节，没有收益支撑，全部撤回。最终五门禁全部通过（76文件/1606项），另27次系统cmp及bench字段比较通过，最终库实测与OLD逐字相同；官方双包latest均0.7.59，根临时产物零，stash空。

## 提交、状态、发布与缺口
只提交护栏与否决记录，一轮一提交，不升号、不运行release；官方两包latest需复核仍为0.7.59，生产gitHead仍d3605aa，否决记录lastCommit不同不是漏发。状态完成134/下一轮135/inFlight=false仅在最终门禁与记录提交成功后更新。实际提交、最终验证及监督结果以状态、持久证据与交付报告为准。

历史progress/changelog缺号与Round67重复不补造。状态/memory提交后收尾自然未提交、历史outputs保留，不宣称整个工作区干净。监督general-purpose后台只读，唯一写入例外audit；派发不等于审计通过。下一方向优先寻找可削减热点分配且无公开getter语义改变的候选，不重复采纳本短路交换。
