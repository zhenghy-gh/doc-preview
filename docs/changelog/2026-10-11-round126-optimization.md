# Round 126 优化记录（2026-10-11）

## 结论
否决「真实字符格式先排除 styles 再合并」候选。27份解析结果逐字节等价，但32,690组真实输入隔离中位耗时略增0.048%，交错4×NEW/4×OLD第2组退化0.041%，无稳定收益。生产代码精确撤回至8cbb057，保留7项常驻差分护栏；不升号、不发布，版本保持0.7.58，依协议否决例外计入本轮。下一轮Round127，目标Round208。

## 门禁与剖析
- 动手前重读协议、状态、长期memory及当日日志，并核对git status/log。completedRounds=125/currentRound=126/inFlight=false，HEAD=8cbb057；仅上一轮状态与当日memory收尾未提交，无根目录临时产物，保留并纳入本轮记录提交。
- 用户描述0.7.52已过时，实际0.7.58；若采纳才会递增0.7.59，本轮否决不执行版本与发布步骤。
- 对预加载27份DOC/DOT独立运行60轮CPU profile，共4143采样点。以全部采样点为分母：createParagraphsWithRealFormats 11.80%、GC 9.97%、applyStructuralFormats合计8.98%、图片提取6.59%、bytesToBase64 4.63%。
- 行级归因：真实字符格式最终合并rest行0.84%、基格式spread行0.80%、merged spread行0.36%；对应常驻bundle round126-old.mjs:7894-7896。采样占比只用于定位，不作为可获得收益预测。

## 候选及等价性
原代码 `const { styles, ...result } = { ...base, ...merged }`，候选在merged不含styles时先从base取rest，再展开merged；含styles时保留旧路径。普通数据对象属性集合、值、顺序不变，覆盖false/0/显式undefined，仍排除styles。生产内部对象由解析器构造，不外推到副作用getter任意对象。候选仅修改src/utils/docParser.ts，最终完全撤回，无生产代码落地。

## 真实隔离基准
从基线bundle最终合并位置捕获27文件全部32,690组base/merged，merged含styles为0；捕获数据预加载，计时不含文件IO。每组逐JSON对照旧实现一致。6组正反交错，每次80遍；旧oracle直接逐句采用HEAD原表达式。
- OLD ms：221.102/227.011/237.769/234.910/233.641/232.546。
- NEW ms：235.084/230.540/234.439/221.133/221.907/233.754。
- 上中位OLD233.641、NEW233.754ms，耗时增加0.048%；3/6组较慢，不能宣称收益。
- 保存round126-pairs.json、round126-isolated.json及插桩副本于常驻目录，插桩不落生产。

## 护栏及鉴别力
tests/docParser.test.ts新增7项Round126集成差分护栏，通过私有createParagraphsWithRealFormats走实际piece级CHPX路径；每次明确断言1段、非空指定文本及charFormatFromReal=true，避免空结果伪等价。
覆盖styles不同键位置、真实styles数组/undefined、false/0/undefined覆盖、JSON键序、未知字符串/数字/symbol可枚举键、冻结对象不变异、四字段子集256组合。oracle使用旧先展开再rest表达式，不复用候选。
源码注入三个错误负控（保留styles、反转合并优先级、丢失基格式键）均退出1；额外复制一次的慢但等价对照退出0。控制脚本finally恢复候选，随后主会话精确撤回候选，最终源码git diff为空；7项护栏保留。

## 交错端到端与cmp
实际git stash仅暂存候选src/utils/docParser.ts→切回基线构建→stash pop恢复；两个bundle计时前预构建，计时中不重建、不并发测试或其它基准。8个独立进程，每次60轮，顺序NEW/OLD、OLD/NEW、NEW/OLD、OLD/NEW：

|组|NEW中位ms|OLD中位ms|耗时降低（负值为退化）|
|---|---:|---:|---:|
|1|93.761|94.808|1.1043%|
|2|94.863|94.824|-0.0411%|
|3|96.383|96.666|0.2928%|
|4|95.891|96.767|0.9053%|

第2组微量差异可能属于噪声；但隔离同样无稳定改善，因此保守否决，不将其它3组优势包装为采纳依据。
候选及撤回后dist-lib生产构建各27份完整parseWithFormat JSON落盘，分别与基线实际系统cmp，54次均通过。

## 全量验证与包体
- npm test：76文件/1474项全部通过，新增7项。类型检查、lint、build、build:lib全部通过；全部串行，test/lint没有并发。
- bench-diff126：27/27成功，和125除cycle/timestamp外所有字段深相等，中位相似度0.9502433994；历史textutil差异不变。
- 最终主包JS/ESM/UMD gzip109.94/94.98/83.14kB，与Round125相同。
- 官方registry两包latest均0.7.58；本轮未发布且无需制造新版本。
- 原始证据在.workbuddy-ai/perf-harness/round126-*及prof/round126.cpuprofile；根目录.prof*/.bench*/.e2e-*为空，常驻gitignore脚手架保留。

## 提交、监督与缺口
一轮一个记录/护栏提交，包含changelog/progress/每日memory及当时执行状态；完成计数、lastCommit和监督audit在提交后回写，可能存在状态与memory自然收尾脏。后台general-purpose监督仅只读检查，唯一写入例外为optimization-loop.json.audit，不修改源码和其它状态字段。
历史progress/changelog缺号、Round123不提交表述、Round124路径/stash偏差未补造记录；交由监督重新统计。下一轮重新剖析其它可证明等价热点，不重复本候选。
