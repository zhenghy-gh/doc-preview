# Round 124 优化记录（2026-10-10）

## 结论
否决图表流扫描「第二字节锚点」候选：语义等价，隔离基准中位耗时约改善 2.16%，但交错端到端第4组退化 1.16%，收益不稳定。已逐处撤回生产代码，保留4项新增常驻测试；版本保持 0.7.57，不升号、不发布。下一轮为 Round 125。

## 门禁与基线
- 状态 completedRounds=123、currentRound=124、inFlight=false；未达到208轮上限，允许开启本轮。
- HEAD 为 2240f0e（Round123记录），package.json 实际为0.7.57；用户文字中的0.7.52/0.7.53已过时。采纳才应升至0.7.58，本轮否决不升号。
- 初始工作区仅有 optimization-loop.json 修改，保留已有轮次状态；其 lastCommit 仍指向Round122，收尾更新为本轮实际提交。

## 剖析与真实隔离基准
- 27份预加载样本，CPU profile 30轮、2239采样点。占比以总采样点为分母：createParagraphsWithRealFormats 12.24%、GC 9.07%、applyStructuralFormats 8.89%、extractImagesFromStream 6.07%、bytesToBase64 4.73%、extractChartsFromWordDocumentStream 3.35%。
- 图表扫描行级热点：zipAt刷新1.61%、oleAt刷新0.80%，初始搜索0.63%与0.22%。
- 真实27条WordDocument流共5,767,130字节：0xD0=6610、0xCF=6362、0x50=30439、0x4B=27297。首字节候选合计37049，第二字节33659，减少约9.15%。
- 候选使用 indexOf(0xCF, from+1)-1 / indexOf(0x4B, from+1)-1 定位签名起点，显式校验首字节；保留耗尽哨兵、limit、chartSize>500、成功后endOffset+5语义。
- 基线与候选同时预构建，隔离真实流6组正反交错、每次200轮。OLD(ms)=644.731/664.579/656.768/675.673/647.990/683.707；NEW(ms)=666.181/650.256/652.493/632.016/647.715/644.930。按脚手架上中位取值 OLD=664.579、NEW=650.256，耗时改善2.16%。
- 真实流图表产出为0，不能只靠空结果判等价；真实流逐项差分以外另用确定产出、500个合成随机输入和边界护栏。

## 常驻护栏及鉴别力
扩展 tests/chartParser.streamScan.test.ts，原5项增加为9项：
1. 27份真实WordDocument流与历史逐字节oracle逐项一致。
2. 流头第二字节假锚点不产出、offset0真签名正确产出。
3. endOffset+4的第二对象被跳过，endOffset+5被保留。
4. chartSize=500不产出、501才产出。

候选负控实际注入源码运行：漏校验OLE首字节、跳过位置+5改+4、阈值>500改>=500各触发1项失败（其余7项通过）；8次data.slice()慢但等价对照8/8通过。注入全部撤回。新增真实流测试后正确实现9/9通过；最终基线实现亦通过全量测试。历史oracle未随候选修改。

## 交错端到端与逐字节核验
双bundle预构建，不在测量中途切源码或重建；独立进程每次40轮，执行 NEW/OLD、OLD/NEW、NEW/OLD、OLD/NEW：

|组|NEW中位ms|OLD中位ms|NEW耗时变化|
|---|---:|---:|---:|
|1|103.677|110.595|-6.255%|
|2|101.843|102.120|-0.271%|
|3|100.656|101.950|-1.269%|
|4|102.224|101.052|+1.160%|

第1组存在明显会话内噪声，第2组几乎无收益，第4组退化；按硬纪律否决，不使用前三组胜出推断稳定优化。
27份完整parseWithFormat结果逐文件通过系统cmp。候选撤回后最终构建另与旧bundle逐文件cmp，防止测试负控残留。

## 全量验证与包体
- npm test：76文件/1452项全通过（比基线增加4项）。
- vue-tsc --noEmit、lint、build、build:lib均通过；test与lint严格串行。
- bench-diff 124：27/27解析成功，与cycle-123所有字段深相等，排除cycle/timestamp；相似度中位0.950、p25 0.915、p10 0.897、min 0.812。
- 主包JS gzip 109.91kB、库ESM 94.95kB、UMD 83.12kB，与Round123一致，生产代码无变化、gzip增量0。

## 提交、发布与风险
本轮仅提交常驻护栏、changelog、progress、每日memory及执行状态；无版本变更，无发布。监督审计独立核对最近122–124轮账本、git提交、两个registry latest与最终工作区；结论回写optimization-loop.json.audit。历史账本缺号作为遗留缺口，不补造历史数据。
常驻perf-harness保留，仓库根没有.prof*、.bench*、.e2e-*临时产物。基准原始记录保留于忽略的perf-harness/round124-timing.json。

## 下一方向
Round125重新剖析，寻找实际减少整流遍历/字符串复制/段落对象分配的调用点级候选；不再重复此第二字节锚点方案。终止目标仍为Round208。
