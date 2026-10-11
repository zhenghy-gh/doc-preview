# Round 131 优化记录（2026-10-11）

## 实测结论与闭环状态
采纳 FKP 格式run直接输出候选：真实完整FKP隔离耗时降低14.2670%，交错4×NEW/4×OLD各100轮四组均改善1.0385%–1.9909%。生产改动为src/utils/formatParser.ts两个调用点内联FC→CP转换，省去中间数组及range对象。新增22项常驻护栏，全部全量门禁通过。计划版本0.7.59（实际起点0.7.58，不使用过时0.7.52）。提交/发布完成情况以后续状态及audit为准，尚不可计入completedRounds。

## 门禁、剖析与真实输入
开始HEAD e09fa49、completedRounds130/currentRound131/inFlight=false；重读协议、状态、项目长期及当日记忆、git log/status。无源码遗留改动，已有状态/记忆自然收尾及outputs报告保留；根目录.prof*/.bench*/.e2e-*为空。占用第131轮，未并发开新轮。
本轮60遍CPU剖析共4081采样，createParagraphs507/4081=12.42%、GC386/4081=9.46%；CHPX58/PAPX55，临时range push5/4081、pieceFcEnd8/4081。行级采样只归因，不预言收益。
基线未混淆完整DocParser bundle两个FKP入口插入参数记录，真实27文件产生49次调用（CHPX22/PAPX27），piece数1–33。保存原始table/word bytes、fc/lcb、完整pieces于round131-inputs.bin。旧实现由候选编辑前baseline bundle直接追加export，不导入当前候选当作旧实现。完整真实结果CHPX26651/PAPX39657，共66308条，两实现deepEqual及JSON逐字一致、明确非空。隔离含SPRM解析及最终sort，不仅是range转换。

## 改动与等价边界
删除私有fcRangeToCpRanges，在CHPX/PAPX输出点原样内联逐piece循环：bytesPerChar、pieceFcEnd、max/min、e<=s、floor/ceil、cpE>cpS均保留。最终对象字段插入顺序和optional判断、format/revision/table引用共享、piece顺序及稳定sort不变，不缓存公开可变输入，不改SPRM解析或公开签名。普通数据输入可证明等价；理论原型hook观察临时分配顺序不属真实文件路径，不声称对被篡改内建环境不可观察。

## 隔离、护栏与负控
预热10遍，6组正反交错每组100遍完整49调用，上中位OLD863.058083/NEW739.925542ms，改善14.2670051%，6组全部胜出，checksum79569600。证据inputs SHA256 b64b78f6034d8504f07ceff0903aa8d954dea324d3e52956d2eab6d8c57d85a7。
tests/formatParser.test.ts追加22项：四个独立旧oracle与e09fa49逐行机器一致（仅去export/函数及内部调用重命名），共用边界仅未修改的字节读取/两grpprl解码；27真实样本完整对象/JSON键序/共享引用拓扑，合成乱序重叠piece、floor/ceil奇数字节、optional自有undefined/零值、稳定排序、坏bin/FKP、输入不变与跨调用变更。FC起止0..16×两种编码×CHPX/PAPX共1156组合仅该范围穷尽，不外推全部字节流。
内存替换三个错控ceil→floor、只保留首overlap、丢optional，分别13/10/4项语义断言失败、退出1；候选22项和增加三次重复稳定sort的慢等价22项通过、退出0。控制不落盘生产源码/常驻测试。

## 全量门禁、stash、端到端与cmp
候选先串行全量npm test 76文件/1571项、vue-tsc --noEmit、lint、build、build:lib，五项status0，test不与lint并发。实际stash仅候选formatParser.ts（3392a471），OLD库构建复制后pop，NEW库构建复制；stash已Dropped，两个生产bundle均计时前建成，不在中间重建。
8独立进程各100轮，顺序NEW/OLD、OLD/NEW、NEW/OLD、OLD/NEW：

|组|NEW中位ms|OLD中位ms|耗时降低|
|---|---:|---:|---:|
|1|92.332|93.513|1.2629%|
|2|92.812|93.786|1.0385%|
|3|92.427|93.766|1.4280%|
|4|93.142|95.034|1.9909%|

四组均改善，不宣称统计显著或整机完全空载；本会话未并行全量测试/构建/bench。前三组后读取一次超出行数日志及运行两次npm config get为小规模检查，不能倒述完全无任何主会话操作。
候选未压缩bundle27份cmp及双生产库27份cmp共54次全部一致，bench131/130除cycle/timestamp外全部字段深等。bench在全量之前已预查，端到端后再次字段核验；此预查顺序如实披露。
OLD ESM361311/gzip94984字节，NEW361522/gzip95034，原始+211/gzip+50，明确运行时收益支持微增。

## 发布、风险与下一方向
拟npm version 0.7.59 --no-git-tag-version、单提交后npm run release双包。官方registry正常curl、显式系统CA及Managed Node信任链均失败自签证书，curl -k仅只读公开元数据返回HTTP403/空体；未改变全局strict-ssl或发送凭据绕过校验，不用上一轮0.7.58响应冒充本轮核验。若release失败，保持本轮未闭环（completedRounds130/currentRound131/inFlight=true），不新开132，先完成131发布核验。
历史progress/changelog缺号与Round123/124/127/128偏差不补造；状态/记忆提交后自然回写、历史交付报告保留，不宣称整个工作区干净。证据在.workbuddy-ai/perf-harness/round131-*。下一候选Round132仅在131闭环后开启，优先FKP排序实际分布，避免重复已否决cache/trim/unroll。
