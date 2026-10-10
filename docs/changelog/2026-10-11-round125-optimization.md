# Round 125 优化记录（2026-10-11）

## 结论
采纳 JPEG 熵编码段原生 indexOf 跳跃搜索：45条真实流图片提取隔离中位耗时降低8.80%，交错4×NEW/4×OLD端到端四组均改善0.36%–1.21%。27份完整解析结果逐字节一致，新增15项护栏及三个错误负控鉴别力验证通过。版本从0.7.57递增为0.7.58，提交后按协议双包发布与registry核验；实际完成状态以 optimization-loop.json 及其 audit 为准。下一轮Round126，终止目标Round208。

## 门禁与剖析
- 初始 completedRounds=124、currentRound=125、inFlight=false，HEAD=4331b8c；仅状态收尾回写未提交，没有根目录临时产物，允许本轮。
- 用户描述0.7.52/0.7.53已过时，以package.json真实0.7.57递增到0.7.58。
- CPU profile：预加载27份DOC/DOT，40轮，2873采样点。以全部采样点为分母：createParagraphsWithRealFormats 11.87%、GC 10.51%、applyStructuralFormats合计8.84%、extractImagesFromStream 5.67%、bytesToBase64 4.59%、findJpegEnd 1.46%。
- JPEG熵扫描行级：逐字节FF判断0.52%、while边界0.35%、FF00推进0.24%、找到标记break 0.21%、跳SOS载荷0.10%。候选定位于真实热点，不重复Round124图表第二字节方案。

## 改动与等价性
src/utils/imageExtractor.ts：只在SOS后熵编码段用 data.indexOf(0xFF,offset) 跳过非FF字节，后续FF填充、FF00转义、真实标记、RST/TEM、SOS长度字段及截断回退保持旧代码。
非FF区间在旧循环中只有 offset++，没有副作用；找到的FF仍由原有分支处理。无FF或只有末尾单FF时，旧循环停在末字节；候选将offset设为length-1后退出。Uint8Array.indexOf严格限定当前视图，不涉及Buffer、宿主端序或对齐要求。

## 真实隔离基准
- 27份文件读取Data/WordDocument，共45流、6,455,182字节，旧实现实际提取125图、其中7JPEG；所有流完整图片数组新旧deepEqual。
- 双bundle预构建；6组正反交错、每次150轮，校验和均18750。
- OLD ms：725.002/730.217/729.645/739.574/729.848/733.953。
- NEW ms：662.082/663.705/665.243/666.794/668.397/665.942。
- 脚手架上中位OLD=730.217、NEW=665.942，耗时降低8.802%。分母是整条流的图片提取，不是仅JPEG函数。

## 常驻护栏及负控
扩展tests/imageExtractor.test.ts，原32项增至47项（新增15项）：
- 真实27份文件的45流，明确断言提取7JPEG，并与旧末端oracle对照。
- 穷尽全部65536种两字节熵数据，每种明确断言1JPEG并逐字节对照。
- 11类确定产出边界：FF填充、FF00、末尾单/双FF、截断、无熵区、多SOS、RST/TEM、长非FF区等。
- SOS长度字段截断/过小/越界回退，非零byteOffset与非零JPEG起点。
旧findJpegEnd从4331b8c逐行转写，去注释空白后机器对照完全相同，仅函数重命名与JPEG_SOI.length固定为2；该常量共享边界已注明，不与候选indexOf逻辑共享。
源码注入负控：搜索from改offset+1、markerOffset改+1、截断回退条件反转均导致定向护栏退出1；data.slice().indexOf慢但等价对照退出0。全部恢复，最终全量测试通过，防止负控残留。

## 交错端到端与逐字节核验
本轮实际执行git stash只暂存候选源码→切回基线构建→stash pop恢复；两版bundle在计时前构建，计时中不重建或并发跑其它基准。独立进程每次50轮，顺序NEW/OLD、OLD/NEW、NEW/OLD、OLD/NEW：

|组|NEW中位ms|OLD中位ms|耗时降低|
|---|---:|---:|---:|
|1|95.572|95.919|0.362%|
|2|97.306|98.467|1.179%|
|3|97.419|98.405|1.002%|
|4|96.855|98.039|1.208%|

四组均改善但增益很小，不能外推到所有文档或浏览器。采纳依据为同会话交错实测与隔离的稳定收益，不使用跨会话绝对值。
27份候选完整parseWithFormat落盘后系统cmp全部通过；全量验证后的dist-lib生产构建另与基线27份cmp全通过。

## 验证与包体
- npm test：76文件/1467项全通过，较上轮增加15项。
- vue-tsc --noEmit、lint、build、build:lib全部通过；test/lint严格串行。
- bench-diff125：27/27解析成功，与cycle124除cycle/timestamp外全部字段深相等；中位0.950、p25 0.915、p10 0.897、min 0.812。与textutil的历史差异未变化。
- 主包JS gzip109.94kB（+0.03）、库ESM94.98kB（+0.03）、UMD83.14kB（+0.02）；微量增长有实测运行收益支持。
- 常驻脚手架原始证据：.workbuddy-ai/perf-harness/round125-{isolated,timing,controls}.json、round125-test.log、round125-{old,new,final}-dump；保持gitignore，不清理常驻目录。根目录无.prof*、.bench*、.e2e-*。

## 提交、发布、监督与风险
按一轮一提交包含源码、护栏、package/lock、changelog、progress、每日memory及当时执行状态；双包用npm run release强制官方registry。提交哈希、双包latest和独立监督结论收尾写入optimization-loop.json，状态/audit自然回写可能未提交。
历史账本缺号与Round123不提交措辞不一致保留为遗留，不补造历史结论。下一轮重新剖析调用点扫描/分配热点；不重复已否决候选。
