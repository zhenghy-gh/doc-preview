# Round 129 优化记录（2026-10-11）

## 结论
否决图片扫描四字节空转合并候选。45条真实流隔离耗时降低12.2125%，但交错4×NEW/4×OLD前两组分别退化2.7568%与2.6081%，没有稳定端到端收益。生产改动精确撤回794b1a8，保留14项常驻差分护栏；保持0.7.58，不升号、不发布。按协议否决例外计入轮次，下一轮130，目标208。

## 门禁、剖析与覆盖率
- 开始completedRounds128/currentRound129/inFlight=false，HEAD794b1a8；实际package/lock与官方双包latest均0.7.58，用户给出的0.7.52已过时，采纳时才会升0.7.59。
- 上轮状态/记忆回写及outputs历史报告有意保留，未清除他人工作；根目录无.prof*/.bench*/.e2e-*。
- 本轮60轮CPU profile共4162采样，extractImagesFromStream自耗270/4162=6.4873%；positionTicks查表行3757为144/4162=3.4599%。函数与行比例均以全部采样为分母，不视为可直接兑现的端到端收益。
- 27份DOC/DOT共45条Data/WordDocument流、6,455,182字节、125图；原始4字节对齐窗口1,613,782个，无签名首字节窗口1,526,219个=94.5741%。这是原始流窗口密度，不含实际图片end跳跃，不能当真实扫描动态命中率。

## 候选与等价性
extractImagesFromStream主循环前检查i+3<len且连续两个PAIR_HAS_LEAD项均0，则i+=4、continue；否则仍执行原两字节/逐字节分派。四字节均非首字节时合并两次无副作用推进，所有真实匹配处理/末端跳跃/尾字节保持不变。新增7行生产代码已全部撤回；src/package/lock对本轮基线无差异。

## 隔离基准与常驻护栏
- 同轮逐字旧实现副本（仅binaryReader导入路径重定位）与候选独立构建。45真实流先完整ExtractedImage数组deepEqual，预热10遍，6组正反交错每组150遍，消费图片数checksum均18750；上中位OLD669.811750/NEW588.010708ms，改善12.2125421%。仅图片扫描，不含完整解析。
- tests/imageExtractor.test.ts新增313行、14项Round129护栏：45真实流完整图片字节及非空125图，4格式前缀0..7/奇偶尾/奇数byteOffset，短buffer/截断/失效长度，全部65536字节对×第一/第二对×4格式=524288组合，输入不变、产物视图身份、载荷内嵌图排除及紧邻图保留。
- 6个oracle函数（bytesEqual、PNG/BMP/GIF末端、push分派、两字节主循环）与794b1a8基线归一化机器对照全相等，仅重命名/空白/注释/参数尾逗号变化；独立重建固定签名/两查表。JPEG复用Round125已验证旧逐字节oracle，因此JPEG部分不是当前HEAD逐行副本，固定签名为语义共享边界。expected不来自候选。
- 三错误负控：遗漏第二对检查、错跳5字节、忽略图片end跳跃，分别11/10/1项语义失败且退出1；慢等价读取单字节slice副本14项通过且退出0。控制脚本finally逐字恢复候选。不能用删除末字节调用作为错误负控：当前签名至少2字节，在现有语义下可能实际等价。

## 全量验证与端到端
候选先串行npm test、vue-tsc --noEmit、lint、build、build:lib，76文件/1519项及其它门禁全通过，test与lint不并行。之后实际git stash仅候选src/utils/imageExtractor.ts，构建OLD生产库并复制独立bundle，pop后构建NEW；计时前双bundle均完成，stash a4727c85已正常Dropped，无计时中重建。
8独立进程各100轮，顺序NEW/OLD、OLD/NEW、NEW/OLD、OLD/NEW：

|组|NEW中位ms|OLD中位ms|耗时降低|
|---|---:|---:|---:|
|1|99.186|96.525|-2.7568%|
|2|101.345|98.769|-2.6081%|
|3|94.880|96.541|1.7205%|
|4|94.028|95.196|1.2269%|

保留全部times，不挑后两组胜出。数据支持保守否决，不宣称统计显著或唯一微架构原因。隔离赢不能外推端到端；额外分支/重复查表及JIT/GC作用仅为待测解释。
撤回后再次串行全量76/1519、类型/lint/双构建通过；候选和最终生产构建各27份完整parseWithFormat JSON对OLD共54次系统cmp通过。bench129/128除cycle/timestamp外全部字段深相等，27/27解析成功，textutil历史差异不变。

## 包体、提交与状态
候选ESM原始361440字节/gzip95011，比OLD361311/gzip94984增加129/27字节；应用/ESM/UMD gzip109.96/95.01/83.16kB。撤回最终109.94/94.98/83.14kB，与基线不变。未执行npm version/release，官方双包latest均0.7.58。
本轮只提交护栏与否决记录（不含生产优化），状态完成后completedRounds129/currentRound130/inFlight=false、lastVersion0.7.58、lastCommit实际提交。后台general-purpose独立只读监督唯一写入例外为optimization-loop.json.audit。
历史账本缺号、Round123/124/127/128流程偏差不补造；当前状态/记忆提交后自然收尾脏及历史未提交报告保留，不能称整个工作区干净。工作分支与origin/main有103/13提交分叉，未擅自pull/push。

## 下一方向与证据
下一轮130：优先找不同真实热点并量覆盖率，避免继续扩大扫描unroll而忽略全解析表现；不重复否决候选。
全部本轮证据在.workbuddy-ai/perf-harness/round129-*及prof/round129.cpuprofile常驻保留；包括isolated/density/profile-summary/oracle-check/controls/timing/size、候选与最终门禁日志及三套27份JSON。交付outputs/round129-report.md，监督最终结论以audit为准。
