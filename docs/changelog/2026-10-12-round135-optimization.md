# Round 135：否决段中分页定位后切片候选

## 结论

候选将 `createParagraphsWithRealFormats` 内 `includes('\f') + split('\f')[0]` 改为 `indexOf('\f') + slice(0,index)`，只消费首分页位置，不创建全部尾部切片。真实端到端第2/3/4组退化，未证明稳定收益，**完全撤回生产代码**，不升号、不发布。版本保持 **0.7.59**，下一轮136，目标208。

## 剖析与覆盖率

本会话重新构建保留名称解析器，预加载27份真实DOC，以 `--cpu-prof` 跑80遍，共5325采样。段落创建684/5325=12.8451%，行级 `textToClean.includes` 26/5325=0.4883%；百分比分母均为总采样，非函数内部耗时。

重新截获27次完整段落创建调用，34348个raw段落、1604662字符，22个前导分页符，剥离首分页后含分页符为 **0**。候选实际split分支在真实语料中未覆盖，不能用合成多分页胜出代替实际收益。真实隔离测量整个分页预处理（前导处理、探测、分支、对象产出），不含清洗及完整段落创建。

六组正反交错，各120遍，上中位 OLD **97.416125ms**，NEW **96.977875ms**，改善 **0.449874%**；原始六组和checksum留在常驻脚手架，逐raw段完整对象与旧实现deepEqual。低覆盖与微小收益不足以支持采纳。

## 护栏与等价性

在 `tests/docParser.test.ts` 的既有Round127旧split oracle中新增两项：多分页长尾只消费首位置；穷尽65534个非LF/表格标记码元前缀，直接调用真实段落创建路径，与独立旧oracle比较text、原CP和pageBreakBefore。复用9项，共11项。旧分页分支与HEAD 148690d逐句归一化比对一致；清洗常量在测试内固定，未共用候选实现。

三内存源码错误控制均产生语义断言失败：last-delimiter **4**、skip-one-extra **3**、lose-page-flag **4**；慢但等价额外split对照 **11通过**。负控没有改源码文件或测试文件。初次打包测试的URL被运行环境转成非file，失败不作为护栏鉴别证据；仅对控制打包中的doc-100kb路径改为绝对路径后全部重跑，最终原始JSON核验无URL/ENOENT初始化失败。141为该测试文件全部测试数，实际选择11项，其他130跳过，不能写成141项护栏。

## 全门禁与交错端到端

候选先执行全量测试、类型、lint、app构建、lib构建，均退出0，**76文件/1608测试**。test/lint串行。

实际git stash仅候选 `src/utils/docParser.ts`，旧源码与HEAD逐字断言；构建OLD，stash pop复原候选，构建NEW；两库在计时开始前全部完成，不在八次独立进程中途重构建。4组正反交错，各进程100遍27文件，取上中位：

| 组 | NEW ms | OLD ms | 改善（负值为退化） |
|---|---:|---:|---:|
| 1 | 93.629 | 93.957 | +0.349096% |
| 2 | 93.932 | 93.729 | -0.216582% |
| 3 | 93.827 | 93.406 | -0.450721% |
| 4 | 93.796 | 93.697 | -0.105660% |

三组退化故否决，不挑第一组。计时期间仅少量主会话读取/脚手架记录，没有并发构建/测试/bench；不声称整机空载或统计显著性。

撤回后再次全量 **76/1608**、types/lint/双构建全部退出0，最终源码等于HEAD、最终lib等于OLD。候选/OLD与最终/OLD各27个parseWithFormat JSON系统cmp，合计 **54次一致**。bench-diff135运行通过，与134报告除cycle/timestamp全字段一致；相似度不是被宣称为1。

## 包体、提交与发布

OLD/最终ESM **361522字节，gzip95034字节**；候选361546字节、gzip95023（-11）已撤回。双包官方默认TLS curl `dist-tags.latest` 均 **0.7.59**，gitHead均d3605aa9b2e652e47c5a02e09cc9972490f908b4。否决例外不执行version/release，没有新发布。

仅提交两项新增护栏、本changelog和progress。状态、被忽略memory与outputs自然收尾保留，不声称整个工作区干净；根.prof*/.bench*/.e2e-*零，stash已pop。lastCommit由收尾状态记录真实单提交。

## 证据与缺口

证据统一保存在已忽略常驻 `.workbuddy-ai/perf-harness/round135-*`：cpu profile/line归因、原始真实inputs与distribution、隔离、控制原JSON、预建双库/源码、八进程timing、54cmp产出、门禁日志、bench比较、结果与官方metadata。

- final阶段最初共用pipeline JSON并覆盖候选回执；候选验证/预建时间从主会话已经读取的原JSON转写到 `round135-candidate-receipts.json`，明确标注来源，**不是伪称原始回执**。原分步日志、timing原JSON与bundle哈希保留。脚手架已修正后续final读取旧记录，但不能倒称本次未覆盖。
- 历史progress/changelog缺号与Round67重复沿用既有审计，不补造历史。
- 工作区state自然改动、历史outputs未跟踪、memory受gitignore影响不等于生产源码脏。
- 真实内部分页分支零覆盖是本轮核心局限；下一轮应按真实可观覆盖热点选候选，优先探测私有PAPX查找成本，不以0覆盖分支凑收益。

收尾派后台general-purpose监督：只读代码与证据，仅允许修改状态audit四字段。最终监督结论以实际落盘audit为准。
