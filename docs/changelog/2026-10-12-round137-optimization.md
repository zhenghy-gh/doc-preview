# Round 137：短中文标题标点探测惰性求值

## 结论与实现

采纳 `detectAlignment` 末尾标点/域标记扫描惰性求值：仅在 `totalLen < 18 && chineseCount >= 2 && chineseCount / strippedLen > 0.5` 时执行原标点正则及四次 includes。其余提前返回分支、扫描顺序及最终 null 不变。完整真实函数隔离耗时降低39.6133%，交错端到端四组改善1.8480%–2.4839%。现场版本0.7.59（用户提示0.7.52已过期），本轮拟升0.7.60；发布闭环以状态与实际registry证据为准，不能把拟发布写成已成功。

## 剖析与真实分布

独立预加载27份DOC/DOT，CPU剖析80遍，5371总采样：段落创建659/5371=12.2696%，detectAlignment105/5371=1.95494%。该函数节点positionTicks标记includes行56/5371=1.04264%、标点正则行5/5371=0.09309%；同一行多操作不能精确拆分，采样比例不等于预测收益。

用独立OLD源码内存打包插桩捕获33702次对齐调用、1519227码元，含至少2个CJK仅8次；短中文多数标题前置条件0次，原对齐非空16次（全center）。因此省掉的是原本无效的标点探测，不是只优化零覆盖分支。捕获全部入参及OLD/NEW逐调用输出一致，v8输入持久化。

真实完整detectAlignment六组正反交错，各120遍，预热后上中位OLD531.189167ms、NEW320.767750ms，降低39.613273%，checksum均4046160。包含trim/空白计数/早返回/标点及结果，非完整解析收益。

## 等价性与护栏

字符串输入为不可变primitive，私有无g正则和includes无输出副作用；前置条件为假时原条件最终不可能center，其计算结果未被使用。移入守卫不影响任何输出。不同于Round134外部getter/Proxy，本函数针对typed string内部读取；不承诺人为覆写String.prototype或传入非string对象的旁路行为。

`tests/textHeuristics.cjkGuard.test.ts`新增4项：17/18长度、2个CJK与比例严格大于一半、全部9标点/域标记及早返回确定性；65536码元插入中文标题；400短串×4文档位置=1600组合；27真实文档重解析、33702入参逐调用差分及16非空产出断言。旧oracle逐行转写原HEAD，去注释/空白机器核对一致；小工具与正则复用独立Round112定义、未变countChineseAndWhitespace作为共同边界。已有6项Round112保留。

三内存错误负控omit-question/length-18/half-ratio被语义断言捕获，慢等价trim后split/join通过。首版真实测试误读parsed.paragraphs导致TypeError，已修正为真实parsed.document.paragraphs并重跑，未降低产出断言；此初始化错误不作鉴别力证据。随后标点固定用例加强为4CJK+ASCII+标点，避免因比例恰好一半而掩盖漏标点。

## 全门禁、端到端与逐字节

候选全量76文件1615测试、vue-tsc、lint、app/lib双构建全部通过，test与lint串行。强化固定用例后最终再次完整串行五门禁；独立candidate/final回执保留，不覆盖。

实际git stash仅切textHeuristics.ts，旧源码逐字等于HEAD0737775；预建OLD，再stash pop精确复原候选并预建NEW。计时前两库均构建完毕，八独立进程正反交错4×NEW/4×OLD，每进程100遍27文档，上中位如下：

|组|NEW ms|OLD ms|耗时降低|
|---|---:|---:|---:|
|1|91.027|93.183|2.313727%|
|2|91.640|93.390|1.873862%|
|3|91.120|93.441|2.483920%|
|4|91.461|93.183|1.847977%|

四组均改善，没有反复挑选有利重跑。计时期间少量静态只读研究/文件读取与轻量证据写入，不声称整机严格空载或统计显著性；不跨会话比较绝对ms。

候选及最终与OLD两对27份parseWithFormat完整JSON系统cmp一致，共54次；bench-diff137两次与136除cycle/timestamp全部字段相同。最终与候选生产bundle逐字一致，ESM OLD361522/gzip95034，NEW361540/gzip95026（gzip减8字节）。最终版号后release重建也需重新27cmp，核验真实发布产物一致。

## 记录、版本与边界

本轮记录changelog/progress/当天memory；计划单提交包含生产候选、4护栏与账本及0.7.60包版本。双包通过npm run release显式官方registry，默认TLS核验两包latest/版本/gitHead/shasum，实际结果由收尾状态与交付报告记录，不预先承诺。

根.prof*/.bench*/.e2e-*零，stash空；既有状态自然修改和历史outputs保留，本地memory按既有gitignore保护。不能声称整个工作区干净，也不为消除状态审计递归修改而重复提交。常驻证据位于.workbuddy-ai/perf-harness/round137-*。

## 缺口及下一轮

- 仅27份现有真实语料，中文标题分支需依靠明确非空合成及穷尽护栏补覆盖；不推广为所有DOC性能收益。
- 历史progress/changelog缺号及Round67重复不补造。
- 工作区状态/audit自然收尾与历史/本轮outputs未跟踪、本地memory忽略仍存在。
- 本轮采纳须发布核验闭环才前移completedRounds；失败则继续137，不能跳开138。
- 完成后派后台general-purpose独立只读监督，唯一可写optimization-loop.json.audit四字段；下一轮138，目标208。
