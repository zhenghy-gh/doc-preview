# Round 138：列表匹配后惰性计算缩进层级

## 结论与候选

采纳detectListInfo入口缩进扫描移入12个匹配返回的候选。完整真实列表函数隔离耗时降低7.645981%，但隔离不替代交错端到端。拟从现场0.7.60升至0.7.61；实际发布结果以收尾状态、官方metadata及交付报告为准。

候选仅将入口const listLevel删除，将12处对象最后一键替换为listLevel: Math.floor(leadingIndentWidth(text) / 2)，原trim、14个正则、匹配优先级、返回属性键序不变。无匹配时省掉前导扫描。使用不可变primitive typed string与私有无g正则，无外部getter/Proxy输入，不承诺覆写String.prototype/Math或传入非string对象。

## 剖析与完整真实隔离

本轮重新CPU剖析27份DOC/DOT、80遍，5319总采样；detectListInfo 96/5319=1.804851%。该节点包含内联leadingIndentWidth两行各2 tick，合计4/5319=0.075202%；采样只指方向，不据此预测收益。原profile bundle和cpuprofile保存。

独立OLD源码插桩重新捕获33702次输入/1519227码元：215次非空列表、33487次不匹配、列表缩进>0为0。全部调用deepEqual且JSON键序一致；真实输入持久化v8。命中列表缩进靠明确合成/穷尽覆盖，不虚称真实有缩进覆盖。

预热后6组正反交错、每组120遍完整detectListInfo，OLD上中位498.148958ms、NEW460.060584ms，降低7.645981%；checksum全部4070040，包含trim/全部识别/缩进/输出对象，不是完整parse收益。

## 常驻护栏与鉴别力

tests/listDetection.test.ts新增5项：216明确组合覆盖12返回/罗马优先级/25种trim空白/键序；65536码元作为a. item前导（25个非空、2个双宽level1）；15字符表长度0..3共3616串；27真实文档全部success且document.paragraphs非空、33702调用及215列表严格产出断言；长前导/全空白/末尾trim分隔符边界。旧oracle仅改名逐字与父758b142函数相同，2个helper与14正则亦逐字机器核验；不复用待测缩进函数。

控制在内存替换生产源并运行同5护栏：wrong-level 2通过/3失败；lose-square-style 3通过/2失败；lose-roman-priority 3通过/2失败；slow-equivalent 5通过/0失败。3错误控制失败均为AssertionError语义失败，慢但等价控制全部通过。首次prepare把12return误断为11，在生产改写前失败，已修正并重新执行完整prepare；不把初始化错误作鉴别力证据。定向护栏由子代理执行，主会话实际读取完成输出后才开始控制与全量，未与lint并发。

## 全门禁与端到端

候选及最终两次npm test全量76文件1620项、vue-tsc、lint、app/lib双构建全部通过，test/lint串行，candidate/final回执独立保存。实际git stash只切本轮textHeuristics.ts，OLD源码逐字等于父758b142，stash pop精确恢复candidate。计时前预建OLD/NEW生产库并保存hash，8独立进程正反交错4NEW/4OLD各100遍：

|组|NEW ms|OLD ms|耗时降低（负数为退化）|
|---|---:|---:|---:|
|1|90.188|90.298|0.121819%|
|2|90.029|90.297|0.296798%|
|3|90.048|90.835|0.866406%|
|4|90.512|91.325|0.890227%|

四组均改善，满足本轮采纳判据。少量静态读取/轻量文件记录非严格整机空载，无统计显著性/所有DOC性能承诺，不跨轮比较绝对ms。

候选/最终两对27份完整parseWithFormat JSON系统cmp均一致，共54次。两次bench-diff138与137除cycle/timestamp全部字段deepEqual，非要求相似度为1。ESM OLD361540/gzip95026，NEW361753/gzip95036，最终361753/gzip95036字节。发布重建另需27cmp及线上双包核验才计完成。

## 记录、缺口及下一轮

本轮changelog/progress/memory记录齐全；计划单提交包括生产/护栏/版本与账本，官方双包release闭环后前移。根.prof*/.bench*/.e2e-*零，stash空；常驻证据.workbuddy-ai/perf-harness/round138-*保留。不能把源码干净冒称整个工作区干净：既有状态自然修改与历史outputs保留，本地memory由既有gitignore保护。

- 历史progress/changelog缺号及Round67重复不补造。
- 仅27现有样本；215列表全无缩进，合成穷尽补覆盖，隔离7.65%不能当端到端收益。
- 状态/audit自然收尾、outputs未跟踪和忽略memory为非阻断交付边界。
- 独立后台监督general-purpose只读，唯一允许改optimization-loop.json.audit四字段；最终落盘结果记交付报告。
- 完成后下一轮139，目标208。
