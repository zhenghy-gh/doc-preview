# Round 127 优化记录（2026-10-11）

## 结论
否决段落真实格式清洗调用点移除重复 trim 的候选。语义等价，真实隔离复测降低耗时15.1223%，但独立交错4×NEW/4×OLD复测第2组退化1.5477%，无稳定端到端收益。生产源码精确撤回至d541539，保留9项常驻清洗差分护栏。不升号、不发布，版本保持0.7.58；依协议否决例外计入本轮，下一轮128，目标208。

## 门禁、接续与剖析
- 启动时completedRounds126/currentRound127/inFlight=true，updatedAt为03:32:15+08:00，当前05:40，超过90分钟。发现tests/docParser.test.ts有197行Round127遗留测试，以及完整候选bundle、profile、验证证据；无活动round127/基准/测试进程，无新增提交和根目录临时产物。
- 接续同一Round127而非另开轮：保留遗留护栏与既有outputs/round125-report.md、round126-report.md，独立复建双bundle、重跑负控/真实隔离/端到端/全量验证，不仅沿用前次结论。占用时间更新后操作；未删除他人工作。
- 实际版本0.7.58，用户描述0.7.52已过时；如采纳应0.7.59，本轮否决不升号。
- 遗留CPU profile共4719采样点，全样本分母：createParagraphsWithRealFormats自耗12.50%、GC9.92%、applyStructuralFormats合计8.94%、图片扫描6.27%。行级清洗调用round127-old.mjs:7743占0.28%，仅作候选定位，不推断端到端收益。

## 候选与等价性
src/utils/docParser.ts:1159将this.cleanParagraph(textToClean.trim())改为this.cleanParagraph(textToClean)。cleanParagraph内先trim，再删垃圾前缀，必要时再trim；字符串trim幂等，移除调用点trim不改变值。分页firstPart/remaining选择及原始CP不变。本轮复建OLD/NEW bundle分别与遗留bundle系统cmp一致，二者仅上述一行不同；最终src git diff为空。

## 真实隔离基准
从27份DOC/DOT基线实际调用位置插桩捕获34,348段、1,604,640码元，10,645段首尾trim会改变值。旧算法副本独立逐句实现；每个输入新旧直接比较，计时预加载、每次100遍，6组正反交错。
复测OLD/NEW上中位142.010625/120.535333ms，耗时降低15.1223136%。原运行隔离结果17.6593%仅作历史参照，不与本会话绝对值混用。当前原始复测证据round127-isolated.json/round127-inputs.json。

## 常驻护栏与负控
tests/docParser.test.ts新增9项Round127测试，oracle固定旧清洗/skip实现与垃圾常量，独立split计算CP，不复用被测切分实现。覆盖25种JS whitespace、垃圾前缀后再次trim、非whitespace边界/孤立代理项/大小写、纯白/纯垃圾skip、首尾及多重分页、CP与表格行边界、真实DOC非空三段正文、全部65536首尾码元×3输入（196608组合）。集成路径明确断言指定非空文本/段数/CP/pageBreakBefore。
重新注入源码三个错误负控：丢全部清洗、丢垃圾前缀清洗、强制小写，分别9/6/9项失败、退出1；恢复旧重复trim的慢等价对照9项通过、退出0。finally恢复候选，随后精确撤回生产候选。

## 交错端到端与逐字节比较
实际git stash仅切候选src/utils/docParser.ts构建OLD，再pop恢复并构建NEW；与既有被计时bundle逐字节相同。计时中不stash、不重建。复测8个独立进程、每进程80轮，NEW/OLD、OLD/NEW、NEW/OLD、OLD/NEW：

|组|NEW中位ms|OLD中位ms|耗时降低|
|---|---:|---:|---:|
|1|93.193|94.468|1.3497%|
|2|96.580|95.108|-1.5477%|
|3|96.074|96.568|0.5116%|
|4|96.515|97.320|0.8272%|

原运行第4组也退化0.1967%（round127-timing.json）；本会话完整重测保存round127-timing-recheck.json，不挑有利组。微量差异不宣称统计显著，但两次均未证明稳定收益，依硬纪律保守否决。
候选及最终dist-lib构建各27份完整parseWithFormat JSON与OLD系统cmp，54次全通过；复建双bundle另2次cmp通过。

## 全量验证与包体
- 本会话重新串行npm test、vue-tsc --noEmit、lint、build、build:lib，全部退出0；全量76文件/1483项通过（新增9项）。test与lint不并行，端到端结束后才跑验证。
- bench-diff127解析27/27成功，cycle127/126除cycle/timestamp外全部字段深相等。textutil历史差异不变，中位相似度约0.950243。
- 最终应用/ESM/UMD gzip109.94/94.98/83.14kB，与126相同；生产源码不变，无生产性能收益落地。
- 官方curl核验scoped/unscoped dist-tags.latest均0.7.58，未执行npm version/release，无新发布。
- 根目录.prof*/.bench*/.e2e-*为空；常驻.workbuddy-ai/perf-harness证据保留。

## 提交、状态与监督
一轮一个护栏/否决记录提交，包含changelog/progress/当日memory及当时执行状态。lastCommit、完成计数和audit提交后回写。后台general-purpose独立只读审计，唯一写入例外为optimization-loop.json.audit四字段，不改源码/测试/其它状态。
既有历史账本缺号、Round123不提交措辞和Round124计时路径/stash偏差交监督重新统计，不补造历史。报告outputs/round127-report.md有意未提交；状态/memory提交后收尾自然未提交应披露。下一轮Round128，不重复本候选。
