# Round 128 优化记录（2026-10-11）

## 结论
否决「解析内缓存样式格式非空标记」候选。修正身份键后真实判空隔离耗时降低84.2923%，但交错4×NEW/4×OLD第2组退化0.0717%，未证明稳定端到端收益。生产源码完全撤回，保留22项样式存在性差分护栏；不升号、不发布，版本保持0.7.58。按否决例外计入本轮，下一轮129，目标208。

## 门禁与剖析
- 开始completedRounds=127/currentRound=128/inFlight=false，HEAD4c3501a；实际版本0.7.58，用户给出的0.7.52已过时。如采纳应升0.7.59，本轮否决不升号。
- 原有state/memory收尾改动和outputs历史报告保留；根目录无.prof*/.bench*/.e2e-*，未删除他人工作。占用更新为06:55:09+08:00后开始。
- 本轮--cpu-prof预加载27份真实DOC/DOT、60轮，4249采样点；以全采样点为分母：createParagraphsWithRealFormats12.50%，GC10.31%，applyStructuralFormats合计8.85%。行级resolved.charFormat判空7802行0.21%；其它大头spread已在近轮否决，不重复。

## 候选与等价性
createParagraphsWithRealFormats调用内resolvedParagraphStyles值从resolved改为{resolved,hasParaFormat,hasCharFormat}，cache miss时按旧表达式Object.keys计算一次存在性，段落读布尔值。resolved只读、spread仍按原顺序、缓存仍按istd且每调用重新构建；不缓存公开resolveStyleFormat的可变入参，不跨调用共享。所有候选/负控生产改动已撤回；src/package/lock对HEAD无差异。

## 真实隔离基准
本轮基线bundle在样式应用点插桩，重新解析27份文档，捕获33702次样式应用、94个resolved对象；hasPara1792次、hasChar32693次。保存round128-pairs.json。按完整resolved对象身份缓存，逐调用断言para/char对象及存在性布尔值均与原始pair相同；旧基准独立直接遍历原始pairs，不从候选映射读取。计时6组正反交错，每组500遍。上中位OLD101.382542/NEW15.924834ms，减少84.2923311%。仅量重复判空，不含miss创建和spread成本，不能当作完整函数或端到端收益。
监督发现首版隔离脚本错误用pair[0]段落格式对象身份归并缓存，undefined键串联不同字符样式，66是错误归并组数而非resolved数；首版两条路径共用污染后的inputs导致计数一致也不能证明正确。旧首版84.6310%不能代表原始输入，应废弃；invalid脚本/结果保留追溯。已按完整resolved身份修复、以原始pairs逐项断言并重测，端到端/生产源码/护栏与否决结论不受影响。

## 常驻护栏与负控
tests/docParser.test.ts新增156行、22项Round128测试。受控普通对象独立旧oracle保留Object.keys判空与spread顺序，16种undefined/空/非空/undefined枚举键组合，加上多istd交错、直接PAPX/CHPX覆盖、继承、跨调用样式变化、冻结对象。断言指定非空段落文本/数量/CP、JSON及键序、false/0/undefined覆盖及样式不变。oracle继承链仅覆盖受控无环输入，不宣称任意StyleDefinition穷尽。
三个错误负控关闭段落标记/关闭字符标记/常数缓存键分别14/14/5项失败，退出1；慢等价重新执行两种Object.keys判空22项通过、退出0。控制脚本finally恢复候选，再手动精确撤回生产候选。

## 端到端与逐字节核验
实际git stash仅切候选src/utils/docParser.ts构建OLD，再pop恢复构建NEW，全部在计时前完成；预构建双bundle，不在计时中stash或重建。8独立进程每进程100轮，顺序NEW/OLD、OLD/NEW、NEW/OLD、OLD/NEW：

|组|NEW中位ms|OLD中位ms|耗时降低|
|---|---:|---:|---:|
|1|93.203|95.109|2.0040%|
|2|94.960|94.892|-0.0717%|
|3|95.771|97.533|1.8066%|
|4|96.799|97.927|1.1519%|

微退不宣称统计显著，但按保守纪律不能采纳未证明稳定收益的候选，不挑三组胜出结果。round128-timing.json保留完整times。候选及最终生产dist-lib各27份完整parseWithFormat JSON与OLD系统cmp，54次全部通过。

## 全量验证、包体与发布
撤回后串行npm test、vue-tsc --noEmit、lint、build、build:lib、bench-diff128全部退出0；全量76文件/1505项通过。test和lint不并行，端到端结束后开始全量验证。
bench128/127除cycle/timestamp外全部字段深相等，27/27解析成功；textutil历史差异不变。
最终应用/ESM/UMD gzip109.94/94.98/83.14kB，与127不变。未执行npm version/release。实际curl官方双包latest均0.7.58且对应版本元数据存在。
根目录无临时产物；常驻.workbuddy-ai/perf-harness证据按约定保留。

## 提交、状态与监督
本轮仅护栏/否决记录提交，不包含生产优化。提交后回写lastCommit/completedRounds128/currentRound129/inFlight=false及监督audit。监督general-purpose后台只读审计，唯一写入例外为optimization-loop.json.audit。历史账本缺号及Round123/124记录偏差保留供独立审计，不补造。
outputs/round128-report.md为有意未提交交付物，旧报告保留；状态/memory提交后的自然收尾改动应披露，不能宣称整个工作区干净。
