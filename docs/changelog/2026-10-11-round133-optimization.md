# Round 133 优化记录（2026-10-11）

## 结论
否决真实字符格式「spread后delete styles，省第二次rest复制」候选。真实32690输入隔离耗时增加64.7503%；实际stash预建双库后4×NEW/4×OLD各100轮四组耗时增加3.2197%/3.5323%/3.3920%/3.2816%。src/utils/docParser.ts精确恢复016dc15，不升号、不发布，版本保持0.7.59；按协议否决例外计入133，下一轮134。

## 门禁与剖析
12:25:21Z读取状态132/133/inFlight=false、HEAD016dc15，未达208且无占用。开启133并及时更新占用；初始未提交仅state、当日memory、outputs，保留自然收尾与历史报告，不当作临时垃圾。根.prof*/.bench*/.e2e-*在收尾核验，不删除常驻脚手架。
本轮重新构建未混淆keep-names解析器、80轮×27真实DOC/DOT预加载CPU剖析，共5407样本。createParagraphsWithRealFormats自耗671/5407=12.4098%；字符格式末次合并的rest/spread行L7897/7898/7899归因约1.11%/1.00%/0.33%，仅作热点方向，不将positionTicks当作独立收益预测。

## 候选与等价性
旧路径`const { styles, ...result } = { ...base, ...merged }`；候选`const result = { ...base, ...merged }; delete result.styles`。合并优先级、剩余自身可枚举字符串/数值/symbol键顺序及输入不变性不改，删除仅发生于新建普通可配置属性对象，不操作输入。生产构造的普通对象上，结果及JSON键序等价；不声称篡改Object.prototype内建/副作用环境不可观察。候选完整源码保存在常驻round133-candidate.ts，生产只改这一处。
真实输入从本轮旧bundle的实际合并点捕获32690组base/merged，以v8二进制保留undefined等值，逐调用deepEqual及JSON相等。merged自身styles为0；旧实现逐字独立表达式同轮驻留，计时不import当前生产路径冒充旧路径。预热、六组正反交错各100遍，OLD上中位256.162667ms/NEW422.028708ms，耗时增加64.7502788%，checksum463289400，所有组均退化。隔离衡量对象合并，不含其他解析流程。

## 常驻护栏与鉴别力
复用tests/docParser.test.ts的Round126七项直接生产调用护栏，扩展两项Round133用例：名为styles的symbol和自身__proto__数据键不丢失；继承/不可枚举styles与不可配置输入描述符保持。共9项，覆盖真实生产调用、非空产出、键序/覆盖false/0/undefined、256字段组合、冻结/扩展字段及不变性。新增两项随否决保留。
Vite pre-load仅内存注入，不落盘改源码或测试：keep-styles负控8项失败、wrong-precedence9项失败、lose-properties8项失败，均退出1且为AssertionError；候选9通过、额外双spread慢等价9通过，退出0。旧oracle表达式直接与HEAD末次合并表达式一致。

## 五门禁、预建与端到端
候选先串行npm test、vue-tsc --noEmit、lint、build、build:lib全部status0，76文件/1594项通过；test与lint不并发。
实际git stash仅src/utils/docParser.ts，基线build:lib复制OLD→stash pop→候选build:lib复制NEW，时间及回执保存round133-prebuild.json；双库构建完成后才计时，中途不切源码或重建。
8独立进程、每进程100轮×27文件预加载，顺序NEW/OLD、OLD/NEW、NEW/OLD、OLD/NEW：

|组|NEW中位ms|OLD中位ms|耗时增加|
|---|---:|---:|---:|
|1|96.048|93.052|3.2197051%|
|2|96.373|93.085|3.5322555%|
|3|96.350|93.189|3.3920312%|
|4|96.653|93.582|3.2816140%|

计时期间未同时运行测试、构建、隔离或bench；不宣称整机空载或统计显著。任何组退化均不采纳，本轮四组均退化，结论不依赖选择性重测。

## 撤回、cmp、bench与包体
候选与OLD各27份parseWithFormat完整JSON落盘，系统cmp全部通过；撤回后最终构建另27份与OLD cmp通过，共两对54比较。候选五门禁及最终五门禁均通过，最终dist-lib/doc-preview.js与OLD逐字相同。
bench-diff133与132除cycle/timestamp之外全部字段深等；27/27成功，不把对textutil既有相似度当作新旧等价标准。
OLD及最终ESM361522字节/gzip95034；候选361487/gzip95029，减35字节/gzip减5字节不能抵消运行时退化，完整撤回，最终包体不变。

## 版本、提交与风险
保持package/lock0.7.59，无npm version/release；官方两包latest核验及后台独立监督以收尾实际证据为准。用户输入0.7.52/0.7.53已过时，以真实package及状态0.7.59为准，采纳轮下一版本0.7.60，但本轮否决不升号。
仅提交两项新增常驻护栏、changelog/progress/项目memory及状态轮次记录；提交后lastCommit/updatedAt/audit与记忆自然回写可未提交，outputs历史报告保留，源码版本干净不等于整个工作区干净。
历史账本缺号、Round67重复和123/124/127/128测量顺序偏差不补造。监督只读唯一写入例外audit，不把派发等同已审计通过。下一轮134，目标208；下一方向优先减少热点分配，但delete会使对象形态退化，本候选不得重复采纳。
