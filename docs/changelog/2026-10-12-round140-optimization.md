# Round 140：否决英文标题检测惰性求值

## 结论

候选语义等价且真实完整函数隔离改善2.0693%，但交错4×NEW/4×OLD第1、3组端到端分别退化2.0546%、1.1925%，无稳定收益，按硬纪律完全撤回生产源码。保留4项常驻护栏。版本保持现场0.7.62，不升号、不发布，否决轮计入完成轮次；下一轮141，目标208。用户任务文本中的0.7.52/0.7.53已落后于现场，采纳轮应按实际版本递增而不是降级。

## 剖析、候选与等价性

独立CPU剖析27份DOC/DOT各80遍，总6367采样；guessCharFormat聚合183/6367=2.8742%，行级原英文检测6/6367=0.0942%，只是定位线索，不作端到端收益预测。

候选仅改src/utils/docparser/heuristics/textHeuristics.ts的guessCharFormat：取消提前计算isEnglishTitle，改在全大写分支之后、原text.length<40时才检测EN_TITLE_START_RE与HAS_LATIN_RE，并省略重复SENTENCE_PUNCT_RE.test(trimmed)。外层已确认原文不含该类标点，trim只删首尾空白，不会新增标点；三个私有正则无g/y，在正常typed string上无可观察状态，前置不满足时结果原本不消费。保留全大写优先级、中文pureName和原串长度边界，未改其它逻辑。

真实输入由HEAD ac61466独立插桩捕获：33702调用/1519227码元，3335段原串长度>=40、323段bold。外层标题候选30154次，提前长度/全大写门控省422次英文起始检测（407长段+15全大写），另省425次重复标点检测。完整OLD和NEW逐调用deepEqual及JSON键序完全相同。六组正反交错、每组120遍完整函数：OLD上中位1106.899208ms，NEW1083.994000ms，降低2.069313%；不把隔离收益当完整parse收益。

## 护栏与鉴别力

新增tests/textHeuristics.round140.test.ts共4项：

- 锁定0/19/20/21/22/39/40/41原串长度、全大写28号优先、中文pureName、25种trim空白、冒号与中英标点；完整对象及JSON键序。
- 全部65536码元分别插入5种位置/标题，327680串。
- 9字符字母表长度0–4短串穷尽，共7381串。
- 拦截DocParser私有guessCharFormat重新解析27份真实文档，33702调用逐项差分，断言每文件解析成功、非空段落及33702非空样式产出。

旧oracle函数体与ac61466逐字一致（仅改函数名），正则独立复制；共享未改的countChineseAndWhitespace/detectCharacterStyles，边界明确，不宣称覆盖共享helper内部。

内存注入候选源码并运行相同4项测试：<40改<=40为2失败/2通过；英文&&改||为4失败；全大写字号28改22为4失败，全部只含断言语义失败。慢但等价trim().split('').join('')为4通过。单独删HAS_LATIN实际等价（EN_TITLE_START已蕴含Latin），不作为错误负控；初版源级结构测试已在全量前删除，避免等价旧实现被错误拒绝。

## 验证与真实端到端

候选全量78文件1638项、vue-tsc --noEmit、lint、app/lib双构建均通过，test/lint串行。实际git stash仅候选textHeuristics.ts，stash后源码逐字断言HEAD，pop后逐字断言候选；OLD/NEW生产bundle预建完成后才开始计时，期间无stash/构建。8独立进程各100遍、组内正反交错：

| 组 | NEW ms | OLD ms | 耗时降低（负值为退化） |
|---|---:|---:|---:|
| 1 | 87.919 | 86.149 | -2.054580% |
| 2 | 87.336 | 89.356 | 2.260620% |
| 3 | 87.745 | 86.711 | -1.192467% |
| 4 | 87.472 | 87.671 | 0.226985% |

候选27份完整parseWithFormat JSON系统cmp一致；bench140/139除cycle/timestamp所有字段相同。候选ESM362895B/gzip95640，OLD362917B/gzip95657；候选省17gzip不足以抵消实测退化，全部撤回。最终源码与HEAD逐字一致，最终全量78文件1638项/类型/lint/双构建及第二对27cmp、bench字段复核全部通过，candidate与final共54次cmp。最终库与OLD逐字一致，gzip95657不变，回执分别为round140-candidate-pipeline.json与round140-final-pipeline.json。

## 收尾与边界

证据常驻.workbuddy-ai/perf-harness/round140-*，candidate/final日志及回执独立保存，不覆盖。提交只包括4项护栏/changelog/progress，不包含生产修改、版本更改或发布；提交及监督实际结果以状态、memory和outputs/round140-report.md收尾记录为准。

根.prof*/.bench*/.e2e-*零，stash空。既有状态自然修改、outputs未跟踪、本地memory受gitignore保护均保留，不冒称整个工作区干净。历史progress缺号及Round67重复、changelog缺号不补造。全量测试有既有Vue source缺失prop警告，但所有测试通过；不承诺整机空载或统计显著性，仅27现有语料。下一轮141可优先测量Data重复readStream的作用域缓存，但必须先证明公开可变流/进度回调语义不变，禁止直接全局身份缓存。
