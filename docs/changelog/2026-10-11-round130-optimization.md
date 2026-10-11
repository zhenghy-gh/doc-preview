# Round 130 优化记录（2026-10-11）

## 结论
否决图表扫描签名核验与游标消费分支合并候选。真实隔离上中位耗时降低1.3631%，但4×NEW/4×OLD端到端四组全部退化0.6905%–1.1932%。生产源码精确撤回59e0c5e；保留30项常驻差分护栏，版本保持0.7.58，不升号、不发布。按协议否决例外计入轮次，下一轮131，目标208。

## 门禁、剖析与真实覆盖率
- 开始completedRounds129/currentRound130/inFlight=false，HEAD59e0c5e；实际package版本0.7.58，若采纳才升0.7.59，不使用用户过时的0.7.52/53基线。
- 已有state/memory收尾改动及outputs历史报告保留；根目录无.prof*/.bench*/.e2e-*。本轮开始及变更前复读git log/status/state，没有并发开启新轮。
- 本轮80遍CPU profile共5501采样，图表扫描自耗172/5501=3.1267%；主要行3946 ZIP indexOf 77/5501=1.3997%、3942 OLE indexOf 41/5501=0.7453%，均以全profile采样为分母。候选减少外围判断，不宣称消除了原生搜索成本。
- 27条真实WordDocument流5,767,130字节，D0=6610、50=30439。当前真实图表产出为0，真实差分不能替代非空产出护栏，因此另有明确完整对象合成断言。

## 候选与等价性
合法offset为两个游标最小值；签名首字节D0/50互异，二者不可能同时等于合法offset；共同耗尽哨兵在offset>=limit处先break。候选在if(offset===oleAt)/else中同时完成相应签名核验和游标indexOf消费，删除重复来源判断，保留签名字段、消费次序、from=endOffset+5、四零终结及10000限制。src改动已全撤回，package/lock不变。

## 隔离基准、护栏及负控
- 旧模块在候选编辑前构建，另保存HEAD逐字副本，仅import路径重定位；副本bundle与old bundle仅来源注释路径不同。两实现独立导入、真实27流完整数组deepEqual、预热20遍，6组正反交错各300遍。上中位OLD969.771125/NEW956.552292ms，改善1.3630879%；第5组微退0.1762%，不隐藏波动。真实checksum=0明确披露，计时覆盖整个图表扫描，不代表完整解析。
- tests/chartParser.test.ts新增261行/30项Round130：完整旧函数逐字转写（仅去export/重命名），oracle机器对照SHA256一致；27真实流、两个明确非空产出、100/101尾界限、500严格阈值、密集不完整首字节、单/双耗尽、交错游标、end+4/+5/+6、嵌套签名、10000上限、截断零及输入不变。
- OLE/ZIP签名末两字节各256×256组合共131072组，预期从固定签名独立产生，各仅1有效对象。穷尽范围仅末两字节，不宣称所有字节流穷尽。
- Vite pre-load内存控制，不覆盖生产源码/已有测试：OLE错误消费ZIP、ZIP省第四字节检查、from=end+6，分别5/1/7项语义断言失败且退出1；慢等价用排序两游标取最小值（真实分配和排序开销）30项全通过且退出0；candidate也30全通过。控制日志保留完整失败断言。

## 全量门禁、交错端到端与结果比对
候选先完整串行npm test、vue-tsc --noEmit、lint、build、build:lib：76文件/1549项及所有门禁通过，test不与lint并行。实际git stash仅src/utils/chartParser.ts，OLD生产库构建/复制后pop，再构建NEW/复制；stash f98e792已Dropped，双bundle计时前完成，不在计时中重建。

8独立进程各100轮，顺序NEW/OLD、OLD/NEW、NEW/OLD、OLD/NEW：

|组|NEW中位ms|OLD中位ms|耗时降低|
|---|---:|---:|---:|
|1|95.942|94.826|-1.1769%|
|2|95.495|94.746|-0.7905%|
|3|95.362|94.708|-0.6905%|
|4|96.088|94.955|-1.1932%|

四组全部慢，按纪律否决，不宣称统计显著或具体JIT原因。端到端期间主会话运行过bench-diff及小规模日志核查，因此不宣称整机完全无竞争负载；计时进程仍逐一串行、无并行全量测试或构建。该偏差保守支持撤回，不用其数据采纳代码。

撤回后重新完整串行全量76/1549、types/lint/双构建通过；候选和最终各27份完整parseWithFormat JSON与OLD共54份系统cmp一致。bench130/129（候选和最终均核验）除cycle/timestamp外逐字段深等，27/27解析成功，历史textutil差异不变。

## 包体、提交、状态与风险
候选ESM361280字节/gzip94981，旧361311/gzip94984，即原始-31/gzip-3字节；包体略小不抵消端到端退化。最终应用/ESM/UMD gzip109.94/94.98/83.14kB恢复基线。未执行npm version/release，实际curl官方scoped/unscoped latest均0.7.58且版本元数据存在。
仅提交常驻护栏与否决记录，无生产优化；完成状态completedRounds130/currentRound131/inFlight=false、lastVersion0.7.58、lastCommit实际提交。后台general-purpose独立监督只读，唯一写入例外为optimization-loop.json.audit。
历史账本缺号、123/124/127/128流程偏差不补造；state/memory提交后自然回写及有意未提交历史报告如实保留，不声称整个工作区干净。分支与origin/main104/13分叉，未pull/push。

## 下一方向及证据
Round131优先探索格式SPRM解码或段落查找的真实命中分布，不重复此分支合并或已否决的unroll/cache/rest/trim候选。
证据常驻.workbuddy-ai/perf-harness/round130-*及prof/round130.cpuprofile：独立旧源/双生产bundle、isolated/profile-summary/oracle-check/controls/timing/size、候选/最终验证日志、三套27JSON及registry原响应。交付outputs/round130-report.md，监督结论以audit为准。
