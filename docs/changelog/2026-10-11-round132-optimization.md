# Round 132 优化记录（2026-10-11）

## 结论
否决“FKP相邻有序检测后跳过稳定sort”候选。原轮4×NEW/4×OLD前两组退化0.3766%/0.8411%；19:00接续独立四组虽改善0.1454%–1.0512%，不能选择性丢弃原轮退化证据，未证明跨测量稳定收益。src/utils/formatParser.ts精确恢复d3605aa；保留tests/formatParser.test.ts的179行、21项常驻护栏。版本保持0.7.59，不升号、不发布，否决轮按协议计入132，下一轮133。

## 接续门禁与剖析
现场10:59:43Z状态completedRounds131/currentRound132/inFlight=true，updatedAt08:42:07Z已超过90分钟（约138分钟）；进程快照未见测试/构建/计时/发布活动，只接续原132，不新开133。HEAD d3605aa；源码/package/lock原无差异，既有132测试与状态、记忆、131发布记录/账本及outputs保留。根.prof*/.bench*/.e2e-*零，stash空，不清理常驻脚手架或护栏。
继承本轮原CPU profile4145采样，CHPX函数汇总62/PAPX54，sort行positionTicks9/10，合计19/4145约0.4584%，只作行级定位而非收益预测。接续独立核验原profile及候选源码；候选仅两个sort块变化。最初恢复遗漏两段注释被完整源码断言阻止，补回后逐字等于保存候选；失败未进入计时/测试，未影响生产。
原round132-*文件证据复制保存在.workbuddy-ai/perf-harness/round132-original-evidence/，未删除原计时。接续重跑日志使用round132-resume-*，共用脚手架新JSON与原保存件分开。

## 候选与等价边界
原实现始终按cpStart、cpEnd稳定排序；候选扫描相邻run，比较器结果>0才回退原完整sort，全部有序则直接返回。保留生成过程、键序、格式引用共享、SPRM与公开签名。
独立旧oracle从e09fa49逐行转写，四函数机器逐字核对通过；共用字节读取与SPRM解码是明确依赖边界。真实与正常数值pieces的排序等价由护栏验证，不声称对带副作用getter或被篡改内建的环境不可观察。候选最终否决，生产仍无条件sort。

## 真实完整隔离与护栏
重新从基线完整DocParser捕获27真实DOC/DOT的49次调用，CHPX22/PAPX27，共66308run；49次原输出全部相邻有序。捕获输入与原轮inputs.bin逐字相同，SHA256 b64b78f6034d8504f07ceff0903aa8d954dea324d3e52956d2eab6d8c57d85a7。
完整FKP隔离含SPRM/FC→CP/最终排序，不仅sort。预热10遍、6组正反交错各150遍，OLD上中位1108.869209ms、NEW947.210917ms，降低14.5786618%，六组全部胜出，checksum119354400。原隔离5.5127%仍保留，绝对时间不跨会话比较。
21项护栏覆盖27真实入口完整非空产出（CHPX26698/PAPX39657，直接入口比DocParser捕获多47条CHPX，计数边界不同）、正序/反序/末尾逆序/跨bin、cpEnd次关键字、主键优先级、稳定tie与format引用、冻结及跨调用输入、NaN/±Infinity。三错误内存负控no-sort/start-only/reverse-sort分别16/2/16项语义断言失败、退出1；候选21通过、额外重复sort慢等价21通过，退出0。全部控制不改落盘源码或测试。

## 全量门禁、stash与端到端
候选先串行npm test 76文件/1592项、vue-tsc --noEmit、lint、build、build:lib五项status0；test/lint不并发。
接续实际stash仅formatParser.ts（3360056590169ab04de255145b776f3394cd7bd6），构建复制OLD后pop构建NEW；11:08:17.973Z双生产bundle已建成，计时期间不stash或重建。OLD/NEW产物与原轮预建SHA一致。
8个独立进程，各100轮×27文件，读文件预加载，NEW/OLD、OLD/NEW、NEW/OLD、OLD/NEW顺序：

|组|NEW中位ms|OLD中位ms|耗时降低|
|---|---:|---:|---:|
|1|92.012|92.146|0.1454214%|
|2|92.154|93.133|1.0511849%|
|3|92.136|93.006|0.9354235%|
|4|92.522|92.957|0.4679583%|

原轮四组耗时降低-0.3766278%/-0.8410739%/+1.3122498%/+1.4851797%。新复测不抹除原退化；硬纪律否决，不宣称统计显著或整机空载。接续计时内仅轻量读取与状态说明，无并行测试/构建/隔离/bench。

## 撤回、cmp、bench与包体
候选/基线各27份重新parseWithFormat落盘系统cmp通过；撤回后最终构建另27份与基线cmp通过，两对54份比较均一致（候选对因bench核验另重复一次，不当作额外独立语料）。最终src/package/lock相对HEAD无差异，dist-lib/doc-preview.js SHA与OLD完全相同。
候选及撤回后最终分别完整串行五门禁均status0，76文件/1592项测试；bench132两次生成，均与131除cycle/timestamp外全部字段深等、27/27成功、baseline缺0。与textutil中位相似度0.9502433994不是新旧等价标准，既有相似度差距不冒充已修复。
候选ESM361846/gzip95087字节，OLD及最终361522/gzip95034，候选原始+324/gzip+53全部撤回；最终包体无变化。

## 提交、版本与缺口
本轮仅提交护栏与否决记录，不含生产源码/package/lock；同时保留并纳入上一轮131已实际双包发布闭环的未提交记录更新，非第二次131生产提交。官方默认TLS元数据确认@zhenghy/doc-preview与doc-preview latest均0.7.59、gitHead均d3605aa9b2e652e47c5a02e09cc9972490f908b4；本轮不执行npm version/release。
状态完成计数与lastCommit在记录提交后回写，监督只读审计唯一写入例外audit。工作区源码版本干净不等于整个工作区干净：状态/记忆自然收尾及历史outputs未跟踪保留，不强制清空个人产物。
历史progress/changelog缺号与Round67重复、123/124/127/128顺序边界不补造。继承原轮CPU剖析，不冒称接续重新运行CPU采样；本次重新捕获真实输入、实际stash预建、独立计时、控制、全量与cmp。后台监督最终结论以实际audit落盘为准。
下一轮133，目标208；下一方向优先实际分布与高占比分配热点，避开已否决sort/trim/cache/unroll重复试验。
