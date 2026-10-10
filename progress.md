# Continuous Optimization Progress

## Round 1/100 — 2026-09-29
- 目标：降低长文档格式恢复与渲染路径中的重复扫描/分配，同时保持 CP、资源消费和样式覆盖契约。
- 改动：
  - 缓存 PAPX 样式 `istd` 的继承解析结果，避免每个段落重复解析同一继承链。
  - 在文档渲染入口一次归一化 `pictures`/`images`，复用到占位符、列表和尾部兜底路径。
  - 文本框与内联图片 CP 区间在单调段落序列上使用游标；CP 回退时安全回退到二分查找。
  - 增加非单调 CP 资源回归测试。
- 验证：
  - `npm test`：59 个测试文件、1323 个测试通过。
  - `npm run lint`：通过。
  - `npm run build`：通过，主包 gzip 约 109.22 kB。
  - `npm run dev -- --host 127.0.0.1`：首页 HTTP 入口可达，返回 Vite 重定向响应。
- 指标：目标渲染回归 52 项通过；真实文档与性能回归通过。
- 风险：当前工作区已有大量未提交改动；本轮提交严格限定在本轮代码、测试、日志和记录文件。
- 下一轮：审计渲染器中剩余的重复字符串处理与解析边界分支，优先选择可证明等价且有回归覆盖的单点优化。

## Round 2/100 — 2026-09-29
- 目标：减少制表位渲染在常见升序输入上的重复复制和排序。
- 改动：`applyTabStops` 先线性检测输入是否已经升序；升序数组直接复用，只有乱序数组才复制并排序，保留重复制表位和乱序输入语义。
- 验证：目标回归 53 项通过；`npm test` 59 个测试文件、1323 个测试通过；`npm run lint` 和 `npm run build` 通过。
- 指标：生产主包 gzip 约 109.27 kB；真实文档与性能测试通过。
- 风险：只读检测不修改调用方数组；现有工作区仍有大量既有未提交改动，本轮未触碰。
- 下一轮：继续审计文本格式化中的重复转义/分支分配，优先处理能以回归测试锁定输出的路径。

## Round 3/100 — 2026-09-29
- 目标：减少纯文本推断渲染中对每个段落的重复 `trim()`。
- 改动：构建段落数组时一次完成 `trim` 和空段过滤；表格检测与普通段落渲染直接复用已清理文本。
- 验证：目标回归 53 项通过；`npm test` 59 个测试文件、1323 个测试通过；`npm run lint` 和 `npm run build` 通过。
- 指标：生产主包 gzip 约 109.27 kB；真实文档与性能测试通过。
- 风险：只影响推断渲染的内部段落数组，既有空段过滤、表格分组和 HTML 输出均由回归测试覆盖。
- 下一轮：检查解析器和渲染器中的重复 `Object.keys`/数组遍历，继续选择有明确净收益的单点优化。

## Round 4/100 — 2026-09-29
- 目标：减少无预览图表卡片渲染中的重复 HTML 转义。
- 改动：`renderChartHtml` 对图表名称只调用一次 `escapeHtml`，复用到无障碍标签和可见名称，保持 XSS 防护和字节输出不变。
- 验证：目标回归 57 项通过；`npm test` 59 个测试文件、1323 个测试通过；`npm run lint` 和 `npm run build` 通过。
- 指标：生产主包 gzip 约 109.27 kB；真实文档与性能测试通过。
- 风险：仅减少纯函数内部重复转义，不改变图表标签生成或 HTML 结构。
- 下一轮：检查解析器和渲染器中的重复 `Object.keys`/数组遍历，继续选择有明确净收益的单点优化。

## Round 5/100 — 2026-09-29
- 目标：修复图表内嵌预览 URL 拼入 HTML 属性时的边界转义风险。
- 改动：`renderChartHtml` 对 `chart.dataUrl` 使用 `escapeHtmlAttribute` 后再写入 `<img src>`；新增带引号和 SVG 标签输入的安全回归测试，确认原有文字卡和图片预览输出保持不变。
- 验证：目标回归 58 项通过；`npm test` 通过，59 个测试文件、1324 个测试通过；`npm run lint` 和 `npm run build` 通过；真实文档与解析性能回归通过。
- 指标：生产主包 gzip 约 109.26 kB；新增属性转义断言覆盖 `<`、`>`、引号和恶意事件属性边界。
- 风险：仅改变预览 URL 的 HTML 属性编码，不改变合法 data URL 的资源语义；既有测试仍有 `tests/fixVuew.test.ts` 的缺失 `source` prop Vue 警告，但不影响通过。
- 下一轮：继续审计渲染器和解析器中剩余的重复遍历，优先选择有明确输出契约和性能证据的低风险单点优化。

## Round 11/100 — 2026-09-29
- 目标：减少通用段落过滤链中相邻去重后的冗余长度过滤。
- 改动：移除相邻重复段落过滤后、文本清理前的第二次 `length >= 2` 过滤；该阶段没有会缩短文本的操作，首轮过滤已保证普通段落长度，图片占位符仍由后续路径保留。
- 验证：列表检测、段落去重、文档、真实文档和性能目标回归 147 项通过；`npm test` 通过，59 个测试文件、1324 个测试通过；`npm run lint` 和 `npm run build` 通过。
- 指标：生产主包 gzip 约 109.28 kB；每个过滤调用减少一次完整段落遍历。
- 风险：仅移除可证明无效的重复筛选，不改变相邻去重、字段清理或异常字符阈值；全量测试仍有既有 `tests/fixVuew.test.ts` 缺失 `source` prop 警告。
- 下一轮：继续审计段落清理和候选组统计，优先处理仍有平方级风险或重复数组分配的路径。

## Round 12/100 — 2026-09-29
- 目标：减少图表目录过滤过程中重复创建固定模式键数组和重复转换小写名称。
- 改动：缓存 `CHART_NAME_PATTERNS` 的键列表；每个目录项只执行一次 `toLowerCase()`，复用结果完成关键词识别。
- 验证：图表、解析器、真实文档与性能目标回归 142 项通过；`npm test` 通过，59 个测试文件、1324 项通过；`npm run lint` 和 `npm run build` 通过。
- 指标：生产主包 gzip 约 109.30 kB；减少每个目录项的字符串归一化调用，并避免反复枚举固定键。
- 风险：过滤顺序和识别条件保持不变；全量测试仍有既有的 `tests/fixVuew.test.ts` 缺失 `source` prop 警告。
- 下一轮：继续检查解析器和渲染器中固定键枚举、重复规范化及临时数组分配，只采纳有明确收益且可由现有契约验证的改动。

## Round 13/100 — 2026-09-29
- 目标：减少 WordArt 目录扫描中反复枚举固定名称模式键造成的临时数组分配。
- 改动：将 `WORDART_NAME_PATTERNS` 的键列表缓存为模块级常量，在目录过滤中复用，保持匹配顺序和规则不变。
- 验证：WordArt、解析器、真实文档与性能目标回归 132 项通过；`npm run lint` 和 `npm run build` 通过。
- 指标：生产主包 gzip 约 109.30 kB；避免每个候选目录项重新枚举模式键。
- 风险：仅复用不可变模式列表，不改变目录筛选或 WordArt 识别语义。
- 下一轮：继续审计无既有混合改动的解析/渲染模块，寻找能由测试覆盖的重复遍历或分配。

## Round 14/100 — 2026-09-29
- 目标：减少公式转 LaTeX 中对已有 LaTeX 命令执行原样替换所产生的重复全文扫描。
- 改动：移除希腊字母、积分/求和符号、三角函数、运算符和箭头等命令的无效果正则替换；保留分数、根号、上下标、范围格式、度数/弧度及空白归一化转换。
- 验证：公式、解析器、真实文档与性能目标回归 136 项通过；`npm test` 通过，59 个测试文件、1324 项通过；`npm run lint` 和 `npm run build` 通过。
- 指标：生产主包 gzip 约 108.77 kB；公式转换减少多次无效全文扫描。
- 风险：保留的转换规则及执行顺序未变；全量测试仍有既有的 `tests/fixVuew.test.ts` 缺失 `source` prop 警告。
- 下一轮：继续审查清洁文件中的循环扫描与临时分配，只有行为等价可证明且回归覆盖充分时才落地。

## Round 15/100 — 2026-09-29
- 目标：减少书签起始位置解析中构建并随后消费 CP 临时数组的分配和遍历。
- 改动：在读取每个 BKF 结构时直接从输入缓冲区读取对应 CP，移除中间 `cpStarts` 数组及其独立扫描，保留 CP 与 BKF 索引的原有关联。
- 验证：书签、解析器、真实文档与性能目标回归 120 项通过；`npm test` 通过，59 个测试文件、1324 项通过；`npm run lint` 和 `npm run build` 通过。
- 指标：生产主包 gzip 约 108.80 kB；书签起始表解析少一次完整遍历和一个临时数字数组。
- 风险：CP 读取偏移保持与原 aFC 顺序一致；全量测试仍有既有的 `tests/fixVuew.test.ts` 缺失 `source` prop 警告。
- 下一轮：继续审计其他干净解析模块的临时数组与重复扫描，只做有回归覆盖的局部等价优化。

## Round 16/100 — 2026-09-29
- 目标：减少 PlcfSed 分节解析中 CP 临时数组及额外遍历。
- 改动：分节条目组装时直接从原始缓冲区读取相邻 CP 起止值，移除独立收集 `cpStarts` 的一轮扫描。
- 验证：分节、解析器、真实文档与性能目标回归 134 项通过；`npm test` 通过，59 个测试文件、1324 项通过；`npm run lint` 和 `npm run build` 通过。
- 指标：生产主包 gzip 约 108.78 kB；每个 section 直接读取两个 CP，避免临时数组与单独遍历。
- 风险：CP 的 `i`/`i+1` 配对及 SED 顺序保持不变；全量测试仍有既有的 `tests/fixVuew.test.ts` 缺失 `source` prop 警告。
- 下一轮：继续在清洁且有测试覆盖的模块中寻找同类重复扫描，审慎验证边界和字节顺序。

## Round 17/100 — 2026-09-29
- 目标：减少页眉页脚启发式拆分对段落文本两次遍历和中间数组的依赖。
- 改动：将 `split` 后的 trim 与空段过滤合并为单次循环，按原顺序收集非空段落。
- 验证：页眉页脚、解析器、真实文档与性能目标回归 141 项通过；`npm test` 通过，59 个测试文件、1324 项通过；`npm run lint` 和 `npm run build` 通过。
- 指标：生产主包 gzip 约 108.78 kB；每次启发式拆分避免 map/filter 两个中间数组及额外遍历。
- 风险：trim 规则、空行过滤和段落顺序不变；全量测试仍有既有的 `tests/fixVuew.test.ts` 缺失 `source` prop 警告。
- 下一轮：继续检查干净文本处理模块的分配和重复扫描，确保所有输出兼容既有回归契约。

## Round 18/100 — 2026-09-29
- 目标：减少 HTML 转 Markdown 时汇总页面根节点造成的临时数组和展开复制。
- 改动：按 `.page-content` 顺序直接遍历并转换子节点；不存在分页容器时仍回退遍历根容器直接子节点。
- 验证：Markdown 导出及边界测试 44 项通过；`npm test` 通过，59 个测试文件、1324 项通过；`npm run lint` 和 `npm run build` 通过。
- 指标：生产主包 gzip 约 108.77 kB；导出过程不再创建汇总所有根节点的临时数组。
- 风险：分页优先级、子节点顺序与无分页回退逻辑保持不变；全量测试仍有既有的 `tests/fixVuew.test.ts` 缺失 `source` prop 警告。
- 下一轮：继续查找清洁导出/解析代码中可移除的重复临时集合，避免超出行为等价的小范围调整。

## Round 19/100 — 2026-09-29
- 目标：减少 UTF-16 字体名称解码时逐字符创建字符串及中间字符串数组的分配。
- 改动：直接收集 UTF-16 code unit 并一次性调用 `String.fromCharCode` 构造名称；保留空终止符、边界检查及代理项语义。新增补充平面 Unicode 与空终止符回归测试。
- 验证：字体解析定向测试 9 项通过；`npm test` 通过，59 个测试文件、1325 项通过；`npm run lint` 和 `npm run build` 通过。
- 指标：每个字体名称避免逐字符创建单字符字符串及随后拼接字符串数组；生产主包 gzip 约 108.78 kB。
- 风险：`String.fromCharCode` 使用展开参数，但名称长度由 FFN 条目字节长度限制；边界与 Unicode 回归通过。
- 下一轮：继续审计清洁解析/渲染模块，优先选择有明确分配或重复扫描收益且输出等价可验证的局部优化。

## Round 20/100 — 2026-09-29
- 目标：避免搜索 DOM 递归遍历为每个节点复制 `childNodes` 集合。
- 改动：`collectTextNodes` 改为按索引读取实时 `childNodes`，保留文档顺序及跳过已有高亮元素的行为；搜索完成收集后才修改 DOM。
- 验证：搜索工具定向测试 20 项通过；`npm test` 通过，59 个测试文件、1325 项通过；`npm run lint` 和 `npm run build` 通过。
- 指标：DOM 树遍历不再为每个访问节点创建 `Array.from` 快照数组；生产主包 gzip 约 108.79 kB。
- 风险：遍历期间必须维持不修改 DOM 的约束；当前高亮包装在收集完成后执行，且顺序与高亮回归通过。
- 下一轮：继续检查清洁解析/渲染模块；若未发现有明确收益且足以证明等价的优化点，则记录停止依据。

## Round 21/100 — 2026-09-29
- 目标：避免图表解析对每个候选重复扫描目录来检测和读取同一个 Picture 流。
- 改动：单次查找 `parentName + NUL + Picture` 条目，并复用其判断 `hasPicture`、计算预览及大小字段；保持对象类型匹配、首个匹配条目、最小流长度和异常处理语义。
- 验证：图表解析定向测试 33 项通过；`npm test` 通过，59 个测试文件、1325 项通过；`npm run lint` 和 `npm run build` 通过。
- 指标：每个候选图表少一次对完整目录的 Picture 条目扫描；生产主包 gzip 约 108.77 kB。
- 风险：需继续保留 `objectType === 2` 精确条件与 Picture stream 读取保护；图表预览和异常分支测试通过。
- 下一轮：继续审计清洁模块中的重复目录/数组扫描；若找不到明确净收益的等价优化，停止而不引入纯理论性改动。

## Round 22/100 — 2026-09-29
- 目标：避免 WordArt 绘图扫描为每个候选对象复制最多 5,000 字节的数据片段。
- 改动：将 `data.slice(startOffset, endOffset)` 改为只读 `data.subarray(...)` 视图；下游效果、文本和颜色提取均只读该视图，偏移、长度和扫描逻辑不变。
- 验证：WordArt 定向测试 23 项通过；`npm test` 通过，59 个测试文件、1325 项通过；`npm run lint` 和 `npm run build` 通过。
- 指标：每个候选对象不再分配并复制对应二进制片段；生产主包 gzip 约 108.77 kB。
- 风险：子数组与输入共享缓冲区；当前三个消费者仅读取数据，测试通过。未来若增加写入逻辑，需重新评估该视图语义。
- 下一轮：继续审计干净且有测试覆盖的代码；若候选仅属微小或理论收益则不落地并记录停止理由。

## Round 23/100 — 2026-09-29
- 目标：消除每个图表候选对 OLE 目录重复查找 Picture 和 Data 流的线性扫描。
- 改动：在目录单次遍历中收集候选图表并建立流名索引，图表处理时通过键查询 Picture/Data；索引只保留同名流的首项，匹配旧 `find` 语义。新增重复流名回归测试。
- 验证：图表解析定向测试 34 项通过；`npm test` 通过，59 个测试文件、1326 项通过；`npm run lint` 和 `npm run build` 通过。
- 指标：目录遍历由候选筛选加每图表最多两次线性查找改为一次索引遍历；gzip 约 108.83 kB（较上一轮约增加 0.06 kB）。收益主要针对条目/图表较多的目录。
- 风险：索引带来少量 Map 分配；通过维持首项匹配、流对象类型筛选与重复名测试，确保结果兼容。
- 下一轮：优先审查确有足够规模收益的优化候选；谨慎权衡小目录下新增索引成本与大目录的扫描收益。

## Round 24/100 — 2026-09-29
- 目标：避免公式目录解析为每个公式重复线性查找 EquationText 与 Picture 流。
- 改动：建立 type-2 流名索引后按精确复合名称读取所需流；重复名称保留首项以兼容旧 `find`，新增首项语义回归测试。
- 验证：公式解析定向测试 28 项通过；`npm test` 通过，59 个测试文件、1327 项通过；`npm run lint` 和 `npm run build` 通过。
- 指标：公式文本与图片流查询由每个公式最多两次完整目录扫描改为单次建索引及常数时间查找；生产主包 gzip 约 108.82 kB。
- 风险：索引增加 Map 初始化/内存开销；保留 type-2 筛选和精确名称语义，且首项重复项有测试覆盖。
- 下一轮：继续审查干净模块的重复目录扫描和大输入分配，若规模收益不明确则跳过。

## Round 25/100 — 2026-09-29
- 目标：降低 WordArt 颜色提取中对已发现颜色反复线性查重的成本。
- 改动：使用 `Set` 做颜色去重成员判断，仍按首次发现顺序写入数组并保留最多八种颜色的输出限制；新增重复色、多于八色及顺序回归测试。
- 验证：WordArt 定向测试 24 项通过；`npm test` 通过，59 个测试文件、1328 项通过；`npm run lint` 和 `npm run build` 通过。
- 指标：去重查询从每种候选颜色线性扫描结果数组改为平均常数时间成员查询；生产主包 gzip 约 108.82 kB。
- 风险：必须保留 alpha 筛选、每四字节取色步进、首次出现顺序及八色截断；新回归测试已覆盖核心输出契约。
- 下一轮：继续审查干净、测试覆盖充分且输入规模可带来可测收益的路径；仅属理论性微优化则停止。

## Round 26/100 — 2026-09-29 (skipped)
- 审查：发现 `docParser.ts` 中样式继承结果可缓存复用，但该源码在工作区已有未提交修改，按保护现有工作的规则排除。
- 替代候选：列表项 LFO 查找可能重复线性扫描，但其测试文件为未跟踪状态，无法按当前审查约束确认相关契约，因此不落地。
- 结论：未找到同时满足源码干净、测试可核验且收益足够明确的候选；未修改代码，未运行本轮测试，未创建提交。
- 下一轮：继续在干净源码和干净跟踪测试范围内审查；测试依据不可用时优先跳过，避免影响既有工作。

## Round 28/100 — 2026-09-29 (skipped)
- 审查：列表 LFO 到 LST 的 `lsid` 查找本身是线性扫描，但要摊销多次查找需在调用方复用索引；当前主要调用方 `docParser.ts` 有未提交修改。
- 结论：只在单次查找函数内建索引会新增每次调用的 Map 分配，无法形成净优化；不触碰脏调用方，因此跳过，不运行测试且不创建提交。
- 下一轮：继续检查可在干净模块内部完整实现且有干净测试契约的候选；若找不到则继续记录跳过。

- 下一轮：继续在干净源码和干净跟踪测试范围内审查；测试依据不可用时优先跳过，避免影响既有工作。

## Round 29/100 — 2026-09-29 (skipped)
- 审查：`src/utils/tableText.ts` 的 `renderTableHtml` 对 `rowsTableInfo` 多次扫描是候选优化；但 `tests/tableText.test.ts` 当前有未提交修改，不能将其作为干净契约依据。
- 结论：未修改业务代码，未运行本轮测试，未创建提交；避免与现有测试改动冲突。
- 下一轮：继续审查干净源码和干净测试文件；契约无法独立核验时跳过候选。

## Round 30/100 — 2026-09-29
- 目标：避免每次图表类型检测都为固定名称模式创建 `Object.entries` 临时数组及键值对数组。
- 改动：`detectChartType` 复用模块级 `CHART_NAME_PATTERNS_KEYS`，按原键顺序查找并从原对象返回匹配值；匹配大小写、优先顺序及回退分支不变。
- 验证：图表解析定向测试 34 项通过；`npm test` 通过，59 个测试文件、1328 项通过；`npm run lint` 和 `npm run build` 通过。
- 指标：固定名称模式循环不再为每次检测创建 `Object.entries` 数组及其键值对数组；生产主包 gzip 约 108.80 kB。
- 风险：模式顺序决定重叠匹配结果；使用既有键数组保持插入顺序，图表类型识别回归全部通过。
- 下一轮：继续审查干净模块中的可证明重复工作；若候选缺少干净测试契约则记录跳过。

## Round 31/100 — 2026-09-29
- 目标：减少 HTML 转 Markdown 的递归 DOM 子节点转换中间数组分配。
- 改动：在内联、表格单元格、引用块和通用块转换中直接遍历 `childNodes` 并构造输出数组；保留节点次序、空结果过滤、分隔符和最终字符串拼接语义。
- 验证：Markdown 导出定向测试 34 项通过；`npm test` 通过，59 个测试文件、1328 项通过；`npm run lint` 和 `npm run build` 通过。
- 指标：不再为 DOM 子节点转换创建 `Array.from` 快照、`map` 结果及 `filter` 结果数组；生产主包 gzip 约 108.82 kB。
- 风险：引用块与 div 对空转换值仍按原规则过滤，inline 转换仍保留空字符串位置但最终拼接不变；导出及边界回归全部通过。
- 下一轮：继续筛查干净源码与测试中的可证明优化候选；无明确收益时跳过。

- 下一轮：继续筛查干净源码与测试中的可证明优化候选；无明确收益时跳过。

- 下一轮：继续筛查干净源码与测试中的可证明优化候选；无明确收益时跳过。

## Round 34/100 — 2026-09-29 (skipped)
- 审查：Markdown 内联转换每个元素创建结果数组的候选可用字符串累加替代，但这会在多子节点输入上增加反复字符串拼接，缺少基准证明净收益。
- 结论：保留当前数组收集与一次 join 的实现；未修改业务代码、未运行本轮测试、未创建提交。
- 下一轮：继续寻找有明确净收益且能保持输出契约的低风险候选。

## Round 35/100 — 2026-09-29
- 目标：减少 WordArt 目录解析中的重复遍历和候选数组分配。
- 改动：将目录过滤与 WordArt 条目处理合并为一次循环；保留 `objectType === 1`、trim 后名称匹配、原始名称输出、目录顺序及逐条异常隔离。
- 验证：WordArt 定向测试 24 项通过；`npm test` 通过，59 个测试文件、1328 项通过；`npm run lint` 和 `npm run build` 通过。
- 指标：移除 `filter` 创建的 `wordArtEntries` 临时数组及随后的第二次遍历；生产主包 gzip 约 108.80 kB。
- 风险：每个符合项仍独立捕获流读取或解码异常，错误项之后的目录项继续处理；过滤、提取、异常回归通过。
- 下一轮：继续检查干净代码范围内的重复工作；候选收益或契约依据不足时跳过。

## Round 36/100 — 2026-09-29
- 目标：减少公式目录解析中筛选公式存储和建立流索引的重复遍历及临时数组。
- 改动：单次遍历同时收集 `objectType === 1` 的公式条目并建立 `objectType === 2` 流索引；重复流名仍保留首项，公式处理仍在索引完整建立后执行。
- 验证：公式定向测试 28 项通过；`npm test` 通过，59 个测试文件、1328 项通过；`npm run lint` 和 `npm run build` 通过。
- 指标：移除一次完整目录遍历、`filter` 回调及过滤数组分配；生产主包 gzip 约 108.79 kB。
- 风险：保留公式存储顺序、首项流匹配、对象类型过滤及后续流读取异常语义；公式回归和真实文档测试通过。
- 下一轮：继续审查干净模块中的重复工作；若无法证明净收益则跳过。

## Round 37/100 — 2026-09-29 (skipped)
- 审查：`src/utils/tableText.ts` 的表头非空单元格计数可移除 `filter` 临时数组；但 `tests/tableText.test.ts` 当前有未提交修改，无法将其作为干净测试契约依据。
- 结论：未修改业务代码，未运行本轮测试，未创建提交；避免与现有表格测试改动冲突。
- 下一轮：继续审查源码和测试均干净的模块；测试契约不独立时跳过候选。

## Round 38/100 — 2026-09-29
- 目标：避免图表目录预筛选与类型检测重复扫描固定名称模式。
- 改动：目录预筛选缓存首个匹配模式，并由内部类型检测复用；公共 `detectChartType` API、特殊类型优先级、关键词回退、目录顺序和首项匹配语义保持不变。
- 验证：图表定向测试 34 项通过；`npm test` 通过，59 个测试文件、1328 个测试通过；`npm run lint` 和 `npm run build` 通过。
- 指标：已识别固定模式的目录项不再重复扫描模式键；生产主包 gzip 约 108.85 kB。
- 风险：缓存仅来自同一目录项的 trim 名称，未改变原始名称分类；其余特殊分支仍在缓存命中前执行。全量测试仍有既有 `tests/fixVuew.test.ts` 的缺失 `source` prop 警告。
- 下一轮：继续审查干净源码和测试中的重复扫描；若收益不足或契约不独立则跳过。

## Round 39/100 — 2026-09-30
- 目标：减少 Markdown 表格导出中列数计算与单元格渲染的重复 DOM 遍历。
- 改动：`convertTableToMd` 在一次行/单元格遍历中同时收集展开后的单元格文本、表头标志和最大列数；保留公开 `getTableColCount` API，并在内存行数据上完成补齐和分隔线生成。
- 验证：Markdown 导出定向测试 44 项通过；`npm test` 通过，59 个测试文件、1328 个测试通过；`npm run lint` 和 `npm run build` 通过。
- 下一轮：继续审查干净源码和测试中的重复扫描；若收益不足或契约不独立则跳过。

## Round 40/100 — 2026-09-30 (skipped)
- 审查：`src/utils/listParser.ts` 的 LVLF 解析先读取 number text 长度计算结构大小，随后 `parseLvlf` 再读取文本。
- 结论：融合只能移除一次长度读取，却会提前构造字符串并引入字符数组或额外参数，净收益不足且增加分配；已撤回代码改动，未运行本轮专门验证，未创建提交。
- 下一轮：继续审查有明确规模收益且可由干净测试契约验证的候选。

## Round 41/100 — 2026-09-30
- 目标：减少分节属性解析中固定节中断类型映射的重复数组分配。
- 改动：将 `parseSepx` 内的 `breakMap` 提升为模块级 `SECTION_BREAK_TYPES` 常量复用；节中断类型映射和未知值回退语义不变。
- 验证：分节定向测试 25 项通过；`npm test` 通过，59 个测试文件、1328 个测试通过；`npm run lint` 和 `npm run build` 通过。
- 指标：每次命中节中断 SPRM 避免一次固定四项数组创建；生产主包 gzip 约 108.87 kB。
- 风险：仅复用只读固定映射，不改变解析顺序、索引映射或默认 `nextPage` 回退；全量测试仍有既有 `tests/fixVuew.test.ts` 的缺失 `source` prop 警告。
- 下一轮：继续审查干净源码和测试中的固定集合分配或重复扫描；若收益不足则跳过。

## Round 42/100 — 2026-09-30
- 目标：减少页眉页脚 PlcfHdd 解析中与后续节数量成正比的无用 CP 扫描和临时数组。
- 改动：`parsePlcfHdd` 先确定第一节的有效页眉页脚类型，仅读取第一节所需的 `partsPerSection + 1` 个 CP；首节范围提取、空范围跳过、短数据回退和 CP 边界语义保持不变。
- 验证：页眉页脚定向测试 32 项通过；`npm test` 通过，59 个测试文件、1328 个测试通过；`npm run lint` 和 `npm run build` 通过。
- 指标：多节文档不再为未使用的后续节构造 CP 数组或执行读取循环；生产主包 gzip 约 108.88 kB。
- 风险：只影响第一节拆分前的 CP 收集范围，`n` 计算和 `cps.length` 防御仍保留；全量测试仍有既有 `tests/fixVuew.test.ts` 的缺失 `source` prop 警告。
- 下一轮：继续审查干净源码和测试中的固定集合分配或重复扫描；若收益不足则跳过。

## Round 43/100 — 2026-09-30
- 目标：减少 WordArt 数据块效果识别中渐变、阴影和 3D 模式的重复线性扫描。
- 改动：`detectWordArtEffects` 通过一次遍历同时检测三个二进制模式，使用位掩码按原顺序追加效果；原有模式边界、名称关键词识别和 `fill` 回退语义不变。
- 验证：WordArt 定向测试 24 项通过；`npm test` 通过，59 个测试文件、1328 个测试通过；`npm run lint` 和 `npm run build` 通过。
- 指标：每个包含数据的 WordArt 最多由三次完整扫描降为一次扫描；生产主包 gzip 约 108.89 kB。
- 风险：仅合并只读模式检测，保留渐变的更严格尾部边界及阴影/3D 的原始边界；全量测试仍有既有 `tests/fixVuew.test.ts` 的缺失 `source` prop 警告。
- 下一轮：继续审查干净源码和测试中的固定集合分配或重复扫描；若收益不足则跳过。

## Round 44/100 (skipped) — 2026-09-30
- 审查：修订作者表和书签名称解析中的逐字符字符串构造属于低频、边界敏感路径；公式流和形状扫描没有同时满足明确规模收益与独立契约的低风险候选。
- 结论：未修改业务代码，未运行本轮专门测试，未创建提交；避免为理论性微优化增加分配或抽象复杂度。
- 下一轮：继续审查源码和测试均干净的模块；只在能证明净收益且保持损坏输入回退语义时落地。

## Round 45/100 (skipped) — 2026-09-30
- 审查：FIB 的重复回退对象位于损坏/截断输入路径；字体与修订表字符串解码规模较小且边界敏感；公式流的多次扫描与终止符校验耦合，融合会增加临时存储。
- 结论：未修改业务代码，未运行本轮专门测试，未创建提交；避免为理论性微优化增加复杂度或改变损坏输入回退语义。
- 下一轮：继续审查源码和测试均干净的模块；只在能证明净收益且保持边界语义时落地。

## Round 46/100 — 2026-09-30
- 目标：减少 PlcfSed 分节解析中相邻 section 重复读取的 CP。
- 改动：循环中将上一项的 `cpEnd` 作为下一项 `cpStart` 复用；节顺序、CP 范围和 SEPX 配对语义不变。
- 验证：分节定向测试 25 项通过；`npm test` 通过，59 个测试文件、1328 项通过；`npm run lint` 和 `npm run build` 通过。
- 指标：除首尾 CP 外，每个 section 边界只读取一次；生产主包 gzip 约 108.89 kB。
- 风险：优化不假设 CP 单调，原值直接传递并用于相邻节，因此非单调及重复 CP 语义保持不变。
- 下一轮：继续审查源码和测试均干净的解析/渲染路径；若收益仅属理论微优化则跳过。

## Round 47/100 (skipped) — 2026-09-30
- 审查：图表、内联资源、分页渲染的实现与对应测试均为工作区 untracked 文件；OLE 属性解析器处于已修改状态；其余干净候选未呈现明确可测的重复工作收益。
- 结论：未修改业务代码，未运行本轮专门测试，未创建提交；保护现有未提交及未跟踪工作。
- 停止依据：当前剩余候选均无法在源码与测试边界干净、契约可独立核验的条件下安全落地；待工作区整理后再继续优化。

## Round 48/100 — 2026-09-30
- 目标：减少 WordDocument 流中对每个偏移重复遍历两个图表魔数的开销。
- 改动：按首字节分派 OLE/ZIP 签名并直接比较其余字节；保留扫描边界、零串终止、对象大小阈值、类型与偏移跳跃语义，新增大段无效及近似签名回归。
- 验证：图表定向测试 35 项、真实文档性能护栏 9 项通过；`npm test` 通过，59 个测试文件、1329 项通过；`npm run lint` 和 `npm run build` 通过，主包 gzip 约 108.87 kB。
- 风险：普通流字节仍需一次首字节判断；签名命中后解析逻辑未变。工作区其余既有改动保持不动。
- 下一轮：继续审查源码和测试均干净、能证明规模收益的候选；证据不足时跳过而不做理论微优化。

## Round 52/100 (skipped) — 2026-10-01
- 审查：工作区包含大量已修改和未跟踪的源代码、测试与文档；可能的复用索引优化依赖已修改的解析器调用方，其他独立候选目前仅体现为边界敏感或有条件的微优化，缺少足够收益证据。
- 验证：`npm test` 通过（59 个测试文件、1332 项）；`npm run lint` 通过；`npm run build` 通过（vue-tsc + Vite，主包 gzip 108.93 kB）。
- 结论：未修改业务代码，也未创建提交；仅追加本轮进度和审计日志，避免混入或覆盖已有工作区改动。
- 风险：当前进度记录显示第 48 轮，与新增的第 49–51 轮 changelog 不一致；本轮按 changelog 核对后推进至第 52 轮。
- 下一轮：再次核对 progress 与 changelog 状态，在现有未提交更改范围外寻找能独立验证的优化；没有可靠收益时继续记录跳过。

## Round 53/100 — 2026-10-01
- 目标：核查生产依赖已知高危及严重安全漏洞，不触碰当前混合改动的代码和锁文件。
- 改动：无依赖变更；只读执行 `npm audit --omit=dev --audit-level=high`。
- 验证：npm audit 报告 `found 0 vulnerabilities`；此前本轮基线的全量测试、lint 与 build 均通过（59 个测试文件、1332 项；主包 gzip 108.93 kB）。
- 风险：该命令只覆盖生产依赖，不代表开发依赖或未披露漏洞不存在；未升级依赖以避免改变锁文件及引入范围外变更。
- 下一轮：继续进行不改动代码的独立质量检查，重点验证打包库入口/导出配置与现有产物是否一致。

## Round 54/100 — 2026-10-01
- 目标：验证 npm 包导出声明与库构建产物一致，避免发布后入口缺失。
- 改动：无源码改动；运行 `npm run build:lib`，并逐一检查 `main`、`module`、`types`、ESM/UMD 与 CSS 导出目标存在。
- 验证：库构建（vue-tsc + Vite）通过，生成 ESM/UMD/CSS/类型声明；所有 7 个导出路径均存在；`npm pack --dry-run --json` 成功，产物 13 个文件、883835 bytes。
- 风险：dry-run 验证不等同真实发布或下游安装；未发布包，也未改动发布版本和文件。
- 下一轮：继续检查打包边界与运行时导出，确保开发资产不会进入包且 ESM 主入口可加载。

## Round 56/100 — 2026-10-01
- 目标：核验 package 公开 API 与生成的 TypeScript 声明保持一致。
- 改动：无源码改动；比较 `src/index.ts` 与 `dist-lib/index.d.ts` 的具名导出，并由 TypeScript parser 校验声明语法。
- 验证：源码/声明导出一致；生成声明语法有效，18 个具名导出包含组件、解析 API、类型及 WorkerParseResult。
- 风险：以本地刚构建的 dist-lib 为准；下游不同 TS 版本未单独测试。
- 下一轮：检查 ESM/UMD 包内 Worker URL 与独立 worker 资源相对位置，验证发布工件引用闭合。

## Round 57/100 — 2026-10-01
- 目标：验证库包 ESM/UMD 对 Worker 脚本的引用能够解析到随包发布的资源。
- 改动：无源码改动；检查两个 bundle 中的 worker 文件名、`dist-lib/assets` 资源及相对引用一致性。
- 验证：ESM、UMD 均解析到 `assets/docParser.worker-Z8MzZQpe.js`；Worker 定向测试 14 项通过；`npm run lint` 通过。
- 风险：静态引用闭合和 mock 测试不等价于各浏览器/打包器运行验证；没有修改 Worker URL 方案。
- 下一轮：检查 Vue peer dependency 与库 bundle 外置策略是否一致。

## Round 58/100 — 2026-10-01
- 目标：验证 Vue peer dependency 范围、库 bundle external 配置与实际产物一致。
- 改动：无依赖改动；检查 `package.json`、构建产物及 `npm ls vue --depth=0`。
- 验证：ESM bundle 保留 `from "vue"`，UMD bundle 调用 `require("vue")`；安装版本 Vue 3.5.40 符合 peer 范围 `^3.0.0`。
- 风险：仅检查当前安装版本及静态产物，不覆盖消费者的 Vue 版本组合。
- 下一轮：检查当前 npm 依赖树的缺失/无效依赖状态，不修改锁文件。

## Round 59/100 — 2026-10-01
- 目标：确认当前完整依赖树不存在无效安装或必需依赖缺失。
- 改动：无依赖改动；只读运行 `npm ls --all`。
- 验证：命令退出成功；未见 `invalid` 或必需依赖缺失。输出中标记的缺项均为 npm 标注的 optional dependency。
- 风险：仅验证当前平台安装树；平台专用 optional packages 在其他系统上的安装状态不同属正常。
- 下一轮：检查 npm 包文件白名单与 dry-run 实际清单的一致性。

## Round 60/100 — 2026-10-01
- 目标：核对包内必需文档/API 文件与 `files` 白名单实际清单。
- 改动：无源码/配置改动；对 `npm pack --dry-run --json` 清单断言 README 双语版、LICENSE、package.json、声明入口和 CSS 存在，并排除开发目录。
- 验证：断言通过，包清单 13 个文件；`npm run build:lib` 通过（vue-tsc + Vite）。
- 风险：dry-run 不会实际发布；不修改发布配置。
- 下一轮：审查生成文件忽略规则和工作区产物状态，不恢复或覆盖现有生成文件。

## Round 61/100 — 2026-10-01
- 目标：核对构建产物与覆盖率报告是否被 Git 忽略，避免意外污染提交。
- 改动：无配置改动；检查 `.gitignore`、`git check-ignore` 与当前状态。
- 验证：`dist`、`dist-lib`、`coverage` 均被正确忽略；发现 `dist` 重复规则但无功能影响。`coverage2/coverage-summary.json` 处于既有删除状态，未恢复或覆盖。
- 风险：忽略规则重复属于清理项但 `.gitignore` 已有未提交变更，本轮不改。
- 下一轮：检查发布与验证脚本的声明是否完整，区分包 dry-run 与真实发布生命周期。

## Round 62/100 — 2026-10-01
- 目标：确认 `npm pack` 生命周期与真实发布构建钩子的差异，避免依赖 dry-run 自动重建产物。
- 改动：无配置改动；检查 package 生命周期脚本、运行 `npm pack --dry-run --foreground-scripts`，并以 Node 自引用导入包入口。
- 验证：当前 package 仅声明 `prepublishOnly: npm run build:lib`，pack dry-run 未运行该钩子；包清单 13 项；自引用导入成功并解析出预期 ESM API。
- 风险：dry-run 直接使用现有 `dist-lib`，本地旧产物可能被打包；真实发布执行 prepublishOnly。脚本文件处于已有未提交修改，本轮未更改。
- 下一轮：在隔离临时目录中验证 pack dry-run 对包文件白名单和产物缺失的行为，不触碰项目源码/构建输出。

## Round 63/100 — 2026-10-01
- 目标：验证发布包关键文件及目录在当前环境中可读/可遍历。
- 改动：无源码改动；对 package.json、ESM/UMD、类型、CSS、dist-lib 和 changelog 目录执行只读访问检查。
- 验证：关键文件均可读，构建和日志目录均可遍历；git 状态识别出 progress 与上一轮日志变更。
- 风险：本检查只覆盖当前文件系统权限，不模拟 npm registry 或其他消费者环境。
- 下一轮：验证 package self-reference 的 CommonJS `require` 入口能否加载，覆盖 exports 的 require 条件。

## Round 64/100 — 2026-10-01
- 目标：验证 npm 包 `exports.require` 对应的 CommonJS UMD 入口能被 Node 正常加载。
- 改动：无源码改动；使用 `require('@zhenghy/doc-preview')` 自引用导入并检查组件与 parser API。
- 验证：CommonJS 导入成功，包含 DocPreview、解析器与 Worker API。
- 风险：Node 加载不等价于浏览器 UMD 脚本及 worker 实际解析测试；未发布包。
- 下一轮：检查 lockfile 项目根依赖与 package.json 声明是否一致。

## Round 65/100 — 2026-10-01
- 目标：验证依赖锁文件根元数据和 registry 来源与项目声明一致且使用安全传输。
- 改动：无 lockfile 改动；比对 package.json 与 lockfile 根身份/依赖规格，并检查 resolved URL scheme。
- 验证：名称、版本与所有根级依赖规格一致；382 个 lockfile 条目没有非 HTTPS resolved URL；主应用 build 通过，gzip 108.93 kB。
- 风险：HTTPS 检查不验证 registry 身份/包供应链完整性；未运行升级或安装操作。
- 下一轮：核对包声明的 Node 引擎下限与当前执行环境，并跑 lint。

## Round 66/100 — 2026-10-01
- 目标：确认当前验证环境符合包的 Node.js 引擎下限，并检查静态规范。
- 改动：无源码改动；检查 `engines.node` 与 Node 运行时版本并运行 lint。
- 验证：Node 22.23.1 满足 `>=18`；`npm run lint` 通过。
- 风险：当前环境兼容不证明 Node 18 的全部构建/测试行为；未安装或切换运行时。
- 下一轮：检查 package-lock 格式和末尾换行，确认当前 npm 可以读取该锁文件。

## Round 67/100 — 2026-10-01
- 目标：验证锁文件可用于干净安装，并运行全依赖高危漏洞审计。
- 改动：无依赖变更；执行 `npm ci --ignore-scripts --dry-run` 与 Worker 定向回归。
- 验证：dry-run 安装检查完成（46 个平台可选包将按平台处理）；Worker 测试 14 项通过。全依赖 `npm audit --audit-level=high` 被执行权限策略拦截，未尝试变通或重跑。
- 风险/阻塞：全依赖漏洞审计需要用户授权；此前仅生产依赖审计报告零漏洞，不能替代全依赖结果。
- 下一轮：继续不涉及网络审计的测试/构建验证；安全审计 blocker 保留，不重复触发。
## Round 67/100 — 2026-10-01
- 目标：验证锁文件可用于干净安装，并运行全依赖高危漏洞审计。
- 改动：无依赖变更；执行 `npm ci --ignore-scripts --dry-run` 与 Worker 定向回归。
- 验证：dry-run 安装检查完成（46 个平台可选包将按平台处理）；Worker 测试 14 项通过。全依赖 `npm audit --audit-level=high` 被执行权限策略拦截，未尝试变通或重跑。
- 风险/阻塞：全依赖漏洞审计需要用户授权；此前仅生产依赖审计报告零漏洞，不能替代全依赖结果。
- 下一轮：继续不涉及网络审计的测试/构建验证；安全审计 blocker 保留，不重复触发。

## Round 68/100 — 2026-10-01
- 目标：在连续发布检查后重新确认项目测试、lint 与生产构建基线。
- 改动：无源码改动；运行全量测试、lint 与 build。
- 验证：59 个测试文件、1332 项通过；lint 和 vue-tsc/Vite build 通过；主包 gzip 108.93 kB。
- 风险：测试中仍有既有 `fixVuew.test.ts` 缺失 `source` prop 的 Vue 警告，不影响断言通过。
- 下一轮：检查包元数据完整性，并使用真实浏览器运行文件预览主流程。

## Round 69/100 — 2026-10-01
- 目标：以真实浏览器验证首页启动与本地 `.doc` 文件上传/预览主流程。
- 改动：无业务代码改动；启动 Vite dev server，使用 Playwright + 已缓存 Chromium 上传 `file-sample_100kB.doc`。
- 验证：页面标题正确，文档显示“解析成功”、895 字/33 段落/6219 字符、4 页并渲染正文与表格；截图已检查；浏览器 pageerror/console error 均为 0。
- 风险：底部折叠面板按钮未应用预期样式，确认父组件 scoped CSS 未穿透子组件；本轮观测后于第 70 轮修复。
- 下一轮：检查真实浏览器中折叠面板按钮样式和开合交互，并运行回归门禁。

## Round 70/100 — 2026-10-01
- 目标：修复浏览器实测发现的折叠面板按钮无样式问题。
- 改动：在 `DocPreview.vue` 的 scoped CSS 中，将 `.stories-toggle`、hover、icon、summary 选择器改用 `:deep()`，使父组件样式应用于 `CollapsiblePanel` 子组件节点。
- 验证：真实 Chromium 重新上传样本成功；按钮 computed style 为 flex、padding 10px 16px；展开/收起 aria 状态通过；无浏览器错误。全量测试 59 文件/1332 项通过，lint/build 通过，gzip 108.93 kB。
- 指标：主 CSS gzip 从约 7.90 kB 到 7.91 kB，主 JS gzip 108.93 kB 不变。
- 风险：样式作用范围限定于三个现存面板子节点选择器；没有改动面板逻辑。
- 下一轮：在真实浏览器检查折叠面板内容显示/隐藏及无摘要场景的语义与可访问状态。
- 目标：确认 npm 包不包含开发期文档、测试、样本文档或 source maps，并检查 ESM 入口运行时导出。
- 改动：无源码改动；对 `npm pack --dry-run --json` 清单执行开发文件排除断言，并直接导入构建的 ESM 入口检查 `DocPreview` 导出。
- 验证：打包清单 13 项、解包 883835 bytes；排除规则通过；ESM 导出包含 `DocPreview`、`parseDocFileWithFormat`、worker 等预期入口。
- 风险：验证覆盖本地构建产物与包清单，不覆盖消费者环境差异；没有发布或生成 tarball 文件。
- 下一轮：继续进行只读发布质量检查，核验声明文件公开 API 与源码导出是否一致。

## Round 71/100 — 2026-10-01
- 目标：验证折叠面板折叠/展开语义、ARIA 状态和属性面板交互。
- 改动：无业务代码改动；真实 Chromium 检查内容节点在折叠时缺席、展开时出现，且 aria-expanded 同步。
- 验证：故事面板默认折叠，点击后 region 显示；属性面板展开成功。
- 风险：验证样本文档已有的面板实例，不覆盖无任何面板的空文档。
- 下一轮：检查 390px 移动端文档预览是否存在水平溢出。

## Round 72/100 — 2026-10-01
- 目标：检查移动端宽度下文档预览是否横向溢出。
- 改动：无源码改动；真实 Chromium 以 390px 视口载入 `.doc` 样本。
- 验证：文档宽 366px、页面 350px、document scrollWidth 等于 viewport 390px；无横向溢出，移动截图生成。
- 风险：仅覆盖 390px 和当前样本。
- 下一轮：在窄屏检查面板深度样式与展开行为。

## Round 73/100 — 2026-10-01
- 目标：验证深度样式修复在移动视口仍生效，且面板展开不引入横向溢出。
- 改动：无源码改动；在 390px 视口检查按钮 computed style、ARIA 状态和页面宽度。
- 验证：按钮为 flex / 10px 16px padding，展开状态正确，scrollWidth 仍为 390px。
- 风险：未覆盖更窄视口及所有国际化摘要长度。
- 下一轮：检查生产 CSS 深度选择器编译结果及键盘操作。

## Round 74/100 — 2026-10-01
- 目标：核验生产构建中跨组件 scoped CSS 规则，并验证折叠控件键盘交互。
- 改动：无新增业务代码；检查编译后的 `[data-v-*] .stories-toggle` 规则，并在 Chromium 中用 Enter/Space 切换。
- 验证：stories-toggle、hover、icon、summary 规则均编译到 CSS；Enter 和 Space 切换正确，焦点保持在按钮。
- 风险：键盘验证基于样本文档的面板；未做辅助技术端到端测试。
- 下一轮：继续检查移动端键盘导航与多个可折叠面板的焦点顺序。

## Round 75/100 — 2026-10-01
- 目标：验证多个折叠面板之间的 Tab 焦点顺序。
- 改动：无代码改动；在窄屏 Chromium 中聚焦故事面板并按 Tab。
- 验证：焦点移动到下一个文档属性面板按钮；页面无脚本错误。
- 风险：仅覆盖样本文档和当前面板排序。
- 下一轮：复查样本文档分页、正文和表格结构，兼顾虚拟滚动占位页面。

## Round 76/100 — 2026-10-01
- 目标：确认样本 DOC 的页面总数、正文与表格内容在 UI 样式调整后保持正确。
- 改动：无代码改动；真实 Chromium 检查虚拟滚动页面容器、正文及表格。
- 验证：总逻辑页数 4（2 个 page-host + 2 个占位页）；导航 1/4；正文包含 Lorem ipsum，共见 5 个表格。
- 风险：初次断言误把已挂载页数当作总页数，已更正；不构成产品故障。
- 下一轮：验证翻页导航状态变更及首页/末页按钮边界。

## Round 77/100 — 2026-10-01
- 目标：验证分页导航首页/末页禁用边界。
- 改动：无代码改动；真实 Chromium 检查起始按钮状态并逐页前进至末页。
- 验证：首页“上一页”禁用；导航到 4/4 后“下一页”禁用。
- 风险：覆盖 4 页样本文档的分页控件，不等价于大量页面连续滚动负载测试。
- 下一轮：再次运行 UI 改动后的 lint/build，并检查窄屏 DOM 无布局溢出回归。

## Round 78/100 — 2026-10-01
- 目标：检查窄屏、手机和 tablet 宽度下文档预览无横向溢出，并复核样式修改的 lint/build。
- 改动：无源码改动；在 320/360/768px Chromium 视口打开样本文件。
- 验证：三个视口的 document scrollWidth 分别等于 320/360/768；lint、vue-tsc 与生产 build 均通过，主包 gzip 108.93 kB。
- 风险：只覆盖样本文档和三个宽度。
- 下一轮：移动端检查搜索控件的打开/关闭可交互性。

## Round 79/100 — 2026-10-01 (blocked)
- 目标：修复移动端打开搜索栏时文档页面横向溢出。
- 改动：无业务代码改动；确认搜索栏子项总宽度超过容器，`.toolbar` 的横向滚动内容可撑大文档 scrollWidth。
- 验证：`npm run lint` 通过；`npm run build`（含 vue-tsc）通过，主 JS gzip 108.93 kB。浏览器 CSS 修复验证被自动模式以 `[Safety Bypass Flag]` 拒绝；遵照策略未通过其他方式重试。
- 指标：复现值为 390px viewport / 434px document scrollWidth；问题仍未修复。
- 风险：工作区含大量既有混合未提交改动，不宜贸然编辑共享的 DocPreview.vue；本轮未提交任何内容。
- 下一轮：在不绕过命令限制的前提下，继续做只读审计或选择边界清晰的低风险优化；若继续此 UI 问题，需先获得允许浏览器验证的安全执行方式。

## Round 80/100 — 2026-10-02
- 目标：减少公式转换对已是 LaTeX 的分数与根式执行的无效果正则扫描。
- 改动：移除 `eqnToLatex` 中原样替换 `\\frac{…}{…}` 与 `\\sqrt{…}` 的两次正则；保留后续真实转换规则和输出语义。
- 验证：公式解析定向测试 28 项通过；`npm run lint` 通过；`npm run build`（含 vue-tsc）通过。
- 指标：主 JS gzip 从 108.93 kB 降至 108.91 kB。
- 风险：改动局限于无效果替换；测试覆盖分数、根式与嵌套表达式。共享工作区仍有大量既有改动，未提交。
- 下一轮：继续在未改动模块及相邻干净测试中审计重复扫描，优先采取输出等价、可独立验证的单点优化。

## Round 81/100 — 2026-10-02
- 目标：减少书签名解码循环中逐字符字符串前缀拼接带来的重复复制。
- 改动：UTF-16LE 与 8-bit 名称解码改为收集字符后一次 `join`；保留长度/边界条件和终止符偏移处理。
- 验证：书签解析定向测试 11 项通过；`npm run lint` 通过；`npm run build`（含 vue-tsc）通过。
- 指标：每个书签名称不再在逐字符循环中反复复制已解码前缀；主 JS gzip 108.91 kB。
- 风险：输入游标推进及截断数据行为保持原逻辑；两种编码路径由既有测试覆盖。共享工作区存在他会话未提交改动，未提交本轮修改。
- 下一轮：复查仍干净的独立解析模块，避免在共享的大型未提交文件中叠加更改。

## Round 82/100 — 2026-10-02
- 目标：消除形状解析两个公开入口之间重复的 OfficeArt 字节扫描和 SPID 去重实现。
- 改动：抽取私有 `extractShapes` 扫描函数，由 Data 流和 WordDocument 流入口共用，保留扫描边界、结构解析及首次 SPID 去重顺序。
- 验证：形状解析定向测试 31 项通过；`npm run lint` 通过；`npm run build`（含 vue-tsc）通过。
- 指标：两份重复扫描实现合并为一份；主 JS gzip 108.90 kB。
- 风险：两个公开 API 仍独立保留并委托相同解析逻辑；形状构造、损坏记录和去重测试通过。共享工作区仍有大量其他未提交改动，本轮未提交。
- 下一轮：继续检查未修改解析模块中可测试、边界独立的重复工作；避开另一会话正在处理的共享文件。

## Round 83/100 — 2026-10-02
- 目标：减少列表编号模板 UTF-16LE 解码过程中逐字符拼接字符串造成的重复前缀复制。
- 改动：`parseLvlf` 改为将解码字符收集到数组并一次 `join`；保持长度边界、NUL 截止和输出内容不变。
- 验证：列表解析定向测试 44 项通过；`npm run lint` 通过；`npm run build`（含 vue-tsc）通过。
- 指标：主 JS gzip 108.91 kB。
- 风险：仅更改编号模板字符串构造方式，测试覆盖模板解码及列表解析；共享工作区有大量既有改动，本轮未提交。
- 下一轮：检查未改动且边界独立的解析模块，确认工作区状态后再选优化点。

## Round 84/100 — 2026-10-02
- 目标：减少修订文本 HTML 转义对每个片段进行五次完整正则扫描。
- 改动：`escapeHtmlSimple` 改为单次匹配五种 HTML 特殊字符并查表替换；转义实体和顺序语义不变。
- 验证：修订渲染定向测试 29 项通过；`npm run lint` 通过；`npm run build`（含 vue-tsc）通过。
- 指标：主 JS gzip 108.95 kB（较构建基线 108.91 kB 增加 0.04 kB）；替换由五次全扫描降为一次。
- 风险：转义字符映射新增少量包体，选择以扫描减少换取 0.04 kB；共享工作区含大量其他未提交改动，本轮未提交。
- 下一轮：检查干净且测试边界独立的模块；在功能收益有限时优先避免包体增长。

## Round 85/100 — 2026-10-02 (audit blocker)
- 目标：审查未改动且测试边界独立的解析模块，寻找低风险高 ROI 优化。
- 改动：无代码改动；只读审计 DOP 解析器及其测试。解析器仅读取两个位域字节，已为常量时间；移除异常捕获的收益不足以覆盖改变异常语义的风险。其他候选模块已有未提交改动。
- 验证：确认 `dopParser.ts` 与 `dopParser.test.ts` 均无既有工作区修改；本轮未运行测试/build，因为没有代码变化。
- 风险：共享工作区仍含大量跨模块未提交改动；未编辑或提交他人内容。
- 下一轮：重新检查工作区与进度，继续寻找具有明确收益且文件边界干净的优化；若无合适候选，保持只读并记录 blocker。

## Round 86/100 — 2026-10-08
- 目标：消除表格渲染中对 `rowsTableInfo` 的五次重复扫描，并减少仅用于计数的临时数组分配。
- 改动：
  - `renderTableHtml` 将 2 次 `some` + 3 次 `find` 合并为单次索引遍历，全部命中后提前退出；三个表格级属性（borders / justification / indent）仍各自独立取首个匹配行，语义完全等价。
  - 新增私有 `countNonEmptyCells`，替换 `collectTableBlock` 中 4 处 `filter(...).length`（多行合并段、表头启发式、表头行渲染）。
- 验证：
  - `tests/tableText.test.ts` 61 项通过（59 → 61，新增 2 项钉住“字段可来自不同行 / 首个匹配生效”的契约）。
  - `npm test`：59 个测试文件、**1334 项**通过。
  - `npm run lint` 通过；`npm run build`（vue-tsc + Vite）通过；主包 gzip 108.98 kB。
- 风险：仅合并只读选择与移除计数用中间数组；`hasCellInfo` 由 `boolean | undefined` 收窄为 `boolean`，其所有使用点均为布尔上下文。
- 附带（同一会话）：
  - 双包发布脚本接入 `package.json`（`npm run release` / `release:dry`）：构建一次后以 `--ignore-scripts` 同时发布 `@zhenghy/doc-preview` 与 `doc-preview`，新增 `--tag` 与信号量恢复；`.package.json.bak` 已加入 `.gitignore`。dry-run 验证通过且 `package.json` 自动还原。
  - 重写 `README.md` / `README.en.md` 为精简实用版；修正两处真实文档错误：CDN 路径应为发布白名单内的 `dist-lib/...`（原 `dist/...` 会 404），以及 `parseDocFileWithFormat(file, debug?)` 第二参数并非 `onProgress` 选项。
  - **已发布 0.7.4**：`@zhenghy/doc-preview@0.7.4` 与 `doc-preview@0.7.4` 均已上线官方 registry（`doc-preview` 由 0.5.0 直接对齐到 0.7.4）。发布脚本强制指定 `https://registry.npmjs.org`，规避本机 `~/.npmrc` 指向的只读镜像 `registry.npmmirror.com`；`package.json` 新增 `publishConfig`。版本用 `npm version patch --no-git-tag-version` 升号，未创建 git commit/tag。
- 下一轮：继续审计干净且有测试覆盖的渲染/解析路径；优先选择规模收益明确、可用现有契约验证的候选。

## Round 87/100 — 2026-10-08
- 目标：消除段落过滤热路径上的逐次正则构造与临时数组分配。
- 改动（`src/utils/docparser/heuristics/paragraphFilter.ts`）：
  - `cleanParagraph` 原先每次调用都 `new RegExp('^[junk]+')`（重新编译），与 `hasTooManyJunkChars` 的 `g` 模式一并提升为模块级 `JUNK_PREFIX_RE` / `JUNK_ANY_RE`。
  - `hasSignificantContent`：5 个正则字面量提升为模块常量；中文计数改为直接扫描 UTF-16 码元（不再 `match(/…/g)` 分配整个匹配数组）；英文单词计数去掉 `.filter()` 数组。
  - `filterParagraphsWithGenericLogic`：15 项 `skip` 关键词数组提升为 `SKIP_KEYWORDS`（原先每个短段落重建一次）；“怪字符”正则提升为 `WEIRD_CHAR_RE`。
  - `applyStructuralFormats`：HYPERLINK 两条域码正则、`EMBED|LIBREOFFICE|…` 正则、`\u0001` 占位符正则提升为模块常量。
- 等价性要点：
  - 共享的 `g` 正则仅用于 `String.match/replace`（二者都会重置并忽略 `lastIndex`），未用于 `.exec()`/`.test()`，不存在跨调用状态泄漏。
  - `LIBREOFFICE` 按原文逐字保留（草稿曾误拼 `LIBEROFFICE`，会改变域码剥离行为）；HYPERLINK 等正则刻意不带 `u` 标志，避免改变转义与代理项处理。
- 验证：定向 `perf-t3-dedup` / `enc-def-err` / `field-cp-gov` 26 项通过；`npm test` 59 文件 / **1334 项**通过；`npm run lint` 与 `npm run build` 通过。
- 指标：主包 gzip 108.98 → **109.14 kB（+0.16 kB）**，worker 块 127.10 → 127.23 kB。体积增长来自把紧凑的 `match().length`/`filter().length` 换成显式计数循环；净收益是消除每段落的 `new RegExp` 编译，并减少 CJK 文档下每段落两次数组分配，故接受该权衡。
- 发布：版本 `0.7.4 → 0.7.31`，双包（`@zhenghy/doc-preview`、`doc-preview`）已发布。
- 流程变更：本轮起工作流为「优化 → 全量验证 → 提交 → 发布」，版本号按 `0.7.3N` 递增（本轮 0.7.31，下轮 0.7.32）。
- 下一轮：继续在热路径（`docparser/`、`rendering/`）中寻找可证明等价的分配/重复扫描优化。

## Round 88/100 — 2026-10-08
- 目标：消除 `formatStoryText` 行循环内逐行构造正则的开销。
- 改动（`src/components/DocPreview.vue`）：
  - `formatStoryText` 由模板直接调用（`v-html="formatStoryText(section.text)"`），每个 story 每次重渲染都会重跑；其行循环内原先每行执行 3 次 `new RegExp(SOFT_BR|PAGE_BR|CELL_MARK, 'g')`，另有每行 `/\s+$/` 字面量。
  - 4 个正则提升到循环外的 setup 作用域（`STORY_TRAILING_WS_RE` / `STORY_SOFT_BR_RE` / `STORY_PAGE_BR_RE` / `STORY_CELL_MARK_RE`）。
  - 两段较长的内联替换 HTML 提升为常量（`STORY_PAGE_BR_HTML` / `STORY_CELL_MARK_HTML`），不再逐行重建。
  - 循环体其余部分逐字不变（三次替换顺序、`<p style="margin:0 0 6px 0">` 包裹、连续空段压缩）。
- 等价性要点：三个模式均为单字面控制字符，原先经 `new RegExp(str,'g')` 每次重新编译；`g` 正则仅用于 `String.replace`（会重置并忽略 `lastIndex`），跨行共享安全；局部常量 `SOFT_BR/PAGE_BR/CELL_MARK` 无其他使用者，已随提升移除。
- 验证：`npm test` 59 文件 / **1334 项**通过；`npm run lint` 与 `npm run build` 通过。
- 指标：主包 gzip 109.14 → **109.16 kB（+0.02 kB）**，基本持平。
- 发布：版本 `0.7.31 → 0.7.32`，双包已发布。
- 下一轮：继续在 `rendering/` 与 `docparser/` 热路径中寻找可证明等价的优化。

## Round 89/100 — 2026-10-08
- 目标：消除列表渲染中每个列表项的逐次正则字面量构造。
- 改动（`src/utils/rendering/listRenderer.ts`）：
  - `extractListItemText` 原先以字面量形式链式调用 9 条有序标记正则 + 2 条无序标记正则（正则字面量每次求值都新建 RegExp 对象，单个列表项最多分配 11 个）；现收敛为模块级 `ORDERED_MARKER_RES` / `UNORDERED_MARKER_RES` 两张表，按原顺序循环应用。
  - `renderNestedList` 每项剥壳用的 `/^<p[^>]*>/`、`/<\/p>$/` 提升为 `P_OPEN_RE` / `P_CLOSE_RE`。
- 等价性要点：有序标记**不能提前返回**——剥掉一个标记后后续模式仍可能命中（如 `"1) a. foo"` → `"a. foo"` → `"foo"`），循环完整保留原顺序与全链路（已加代码注释，避免日后被“优化”掉）；提升的正则均为 `^` 锚定且非全局，仅用于 `String.replace`，共享安全。
- 验证：定向 `listRenderer`(13) + `documentRenderer`(29) + `renderGolden`(11) 共 53 项通过（含字节级 golden 渲染）；`npm test` 59 文件 / **1334 项**通过；lint 与 build 通过。
- 指标：主包 gzip 109.16 → **109.22 kB（+0.06 kB）**；收益为每个列表项省下最多 11 次正则对象分配。
- 发布：版本 `0.7.32 → 0.7.33`，双包已发布。
- 下一轮：包体已连续三轮微增（108.98 → 109.22 kB），下一轮优先寻找**不增长甚至缩小包体**的优化（死代码/重复实现/可复用的既有工具函数）。

## Round 90/100 — 2026-10-08
- 目标：消除重复常量与逐段落计数数组（顺带兑现上一轮"去重/缩小包体"的方向）。
- 改动：
  - **去重**：15 项伪正文关键词表原先在 `docparser/encodingDetector.ts` 与 `docparser/heuristics/paragraphFilter.ts` 各存一份（round 87 只提升了后者，前者仍在**每个段落**重建数组）。现由 `encodingDetector.ts` 统一导出 `SKIP_KEYWORDS`，`paragraphFilter.ts` 改为 import（两者本就有 `paragraphFilter → encodingDetector` 的依赖方向，无新增边、无环）。
  - **免分配计数**：`filterRawParagraphs` 原用 `(cp.match(/…/g) || []).length` 统计中文字符与垃圾字符，每段落分配一个完整匹配数组；改为 `charCodeAt` 单趟扫描（`countChineseChars` / `countJunkChars`）。
  - `JUNK_CODE_SET` 刻意存**码点**（`Set<number>`）而非字符：`Set<string>` + `text[i]` 会在每轮迭代新建单字符字符串再哈希，实测无收益，已弃用该写法。
- 指标（微基准，2.4M 次调用，10–1000 字符的中文/中英混排/垃圾字符样本）：旧实现 11786.1 ms → 新实现 4527.5 ms，**0.384x（快 2.6 倍）**，且所有样本新旧结果完全一致。
- 附带修复（非本轮引入）：`tests/realDocs.test.ts` 在**单个用例**内解析 28 个真实样本（含 1.35MB），使用 vitest 默认 5000ms 超时；隔离运行约 1s，但 59 文件并行时环境争用会超时假失败（本轮实测套件 `environment` 时间由约 380s 升至约 1250s）。已给该用例单独放宽为 30000ms，**断言未改动**。
- 验证：定向 26 项通过；`npm test` 59 文件 / **1334 项**通过（修复超时后复跑确认）；lint 与 build 通过。
- 指标：主包 gzip 109.22 → **109.27 kB（+0.05 kB）**（去重收益部分抵消了新增计数函数）。
- 发布：版本 `0.7.33 → 0.7.34`，双包已发布。
- 下一轮：继续寻找**去重/删减**类优化（重复实现、死代码），目标是让包体回落；同时继续审计热路径分配。

## Round 91/100 — 2026-10-08
- 目标：兑现上一轮的"去重让包体回落"方向 —— 收敛跨模块重复的二进制读取原语。
- 发现（全仓同名函数扫描）：`readUint16` **10 份**、`readUint32` **9 份**、`readInt16` 2 份、`readInt32` 2 份，共 **23 份**本地定义，散落在 11 个解析器里。
- 改动：
  - 新增 `src/utils/binaryReader.ts`，唯一实现 4 个函数，并在文件头固化边界契约（越界含负偏移一律返回 0，不抛异常）。
  - 11 个文件改为 import：`revisionParser` / `equationParser` / `formatParser` / `fontParser` / `propertyParser` / `styleParser` / `listParser` / `shapeParser` / `pictureParser` / `fieldParser` / `docparser/clxReader`。
  - `docparser/clxReader.ts` 保留 `readUint16`/`readUint32` 的**再导出**，使 `docParser.ts` 既有的 `readUint16 as clxReadUint16` 导入契约零改动。
- 等价性要点（为何可合并）：23 份里只有 2 份与"规范版"不同 —— `equationParser` 缺 `offset < 0` 检查且 `readUint32` 没有 `>>> 0`（返回有符号值）；`propertyParser` 完全无边界检查。差异**仅在不可达分支**：
  - 正偏移越界时，`Uint8Array` 读出 `undefined`，`undefined` 在位运算下转 0，故无守卫版与有守卫版同样返回 0；
  - 唯一会分叉的是**负偏移**，而所有调用点传入的偏移均 ≥ 0（循环下标、已校验的表偏移、字面量 0/24/44）；
  - `equationParser.readUint32(data, 0)` 的结果只用于 `length > 0 && length < data.length`：当 `data[3] >= 0x80` 时有符号值为负（第一个条件失败）、无符号值 ≥ 2^31（第二个条件失败，`Uint8Array` 长度不可能那么大），两个分支行为一致。
  - `clxReader.readUint16` 里的 `& 0xFFFF` 是冗余的（两个字节项上限即 0xFFFF）。
- 明确**未动**的东西（避免误判为遗漏）：
  - `src/utils/docparser/formatRecovery.ts`（991 行）—— 全仓无 `src` 引用，`BENCH.md` 标注"未接线 WIP"，`docs/wip-parking/` 存有快照；属**被刻意停放的半成品**，非优化目标，且不可达故已被 tree-shake，删除不会减小包体。
  - `src/components/DocStatsPanel.vue` —— `docs/ui-kit/` 记为"死组件，待裁决：恢复挂载 or 移除"，属产品裁决，同样不影响包体。
  - `imageExtractor.ts` 与 `pictureParser.ts` 的 `bytesEqual`/`findPngEnd`/`findJpegEnd`/`findGifEnd`/`findBmpEnd` **仅同名**：后者带 `maxLen` 钳制、其 `findJpegEnd` 无 SOS/熵编码段处理，合并会改变行为，故保留。
- 验证：`npm test` 59 文件 / **1334 项**通过；`npm run lint` 通过；`npm run build` 与 `npm run build:lib` 均通过。
- 指标：**口径修正** —— 本项目历史记录的"主包 gzip"取自**应用形态 `npm run build` 的 `dist/assets/main-*.js`**（见 `docs/ACCEPTANCE_BASELINE.md`），而非库形态 `build:lib`。本轮按正确口径：主包 gzip 109.27 → **109.08 kB（−0.19 kB）**，连续多轮微增后**首次回落**。库形态 `doc-preview.js` 原始体积 360.8 → 350.72 kB。
- 发布：版本 `0.7.34 → 0.7.35`，双包已发布。
- 下一轮：继续去重/删减（`readDwordAt`、`twipsToPt`、`readUtf16leString` 各 2–3 份；以及 `escapeHtml` 两份），并复核是否存在可安全合并的同名实现。

## Round 92/100 — 2026-10-08
- 目标：把去重从"同名函数"扩展到"重复**逻辑块**"（跨文件 ≥6 行归一化后相同的代码）。
- 方法：对 `src/` 做空白/注释归一化后的 ≥6 行滑窗比对，按文件聚合。**排除 `docparser/formatRecovery.ts`** —— 它是 round 91 已确认的停放 WIP 模块，其"重复"多数是 `docParser.ts` 的陈旧镜像。
- 改动（5 处，均为**活代码**）：
  1. **`scorePlainText` 逐行重复**：`encodingDetector.ts:191`（已导出）与 `DocParser.prototype.scorePlainText`（`docParser.ts:1765`）完全相同。`docParser.ts` 本就有 `enc*` 前缀委托模式，改为 `return encScorePlainText(text)`；方法保持 public（`tests/docParser.test.ts` 直接调用它）。
  2. **`formatRevisionTime` 跨 UI/解析器重复**：`revisionRender.ts:47`（已导出）与 `DocPreview.vue:455`（本地）相同。`DocPreview.vue` 原先只导入其**类型** `RevisionMode`，现同时导入函数并删除本地副本。`revisionRender` 已被 `rendering/documentRenderer.ts` 引入，**不新增模块**。
  3. **`bytesEqual` 在两个图片模块各一份**：`pictureParser.ts` 本就 import 自 `imageExtractor`，改为由后者导出、前者导入。
  4. **`readWordAt`/`readDwordAt` 是 `readUint16`/`readUint32` 的无守卫孪生**：`sectionParser.ts` 有 `readWordAt`+`readDwordAt`，`fibParser.ts` 另有一份 `readDwordAt`。三者与 `binaryReader` 的版本只差边界守卫，而守卫**只在负偏移**时产生差异（正偏移越界两侧都得 0）。已证明所有调用点偏移非负：
     - `fibParser`：字面量 24/28、`fibRgLwStart + 12…40`、`blobStart + pair*8`（pair ≥ 0）。链路推导 `csw = data[32] | (data[33]<<8)` ∈ [0,65535] ⇒ `fibRgWEnd = 34 + csw*2 ≥ 34` ⇒ `fibRgLwStart ≥ 36` ⇒ `fibRgLwEnd ≥ fibRgLwStart+4` ⇒ `blobStart ≥ 42`。
     - `sectionParser`：`parsePlcfSed` 开头即 `fc < 0 → return []`；其余为 `fc + (i+1)*4`（i ≥ 0）、`offset + 2`（`offset = fc + (n+1)*4`，n > 0）、`fcSepx`（本身来自**无符号**读取）。
  5. **`ChartType`/`ChartSubtype`/`ChartInfo` 在 `chartParser.ts` 与 `docFormat.ts` 各声明一份**（结构逐字相同，仅 JSDoc 不同）。`docFormat.ts` 不 import `chartParser`，无环；`chartParser.ts` 改为 `import type ... from './docFormat'` + `export type { ... }` 再导出，使 `docParser.ts` 的 `import type { ChartInfo } from './chartParser'` 契约不变。
- **刻意未动**（看着像重复但语义不同，已逐一核实）：
  - `escapeHtml`（`textRender.ts` 走 DOM `div.innerHTML`，只转义 `&<>`；`tableText.ts` 走字符串替换，**额外转义引号**，因为用于属性值）—— 合并会改变输出。
  - `findPngEnd`/`findJpegEnd`/`findGifEnd`/`findBmpEnd`（`pictureParser` 版带 `maxLen` 钳制，且其 `findJpegEnd` 无 SOS/熵编码段处理）。
  - `readUtf16leString` ×3：第三参数在两个文件里是**字符数**、在 `styleParser` 里是**字节长度**。
  - `twipsToPt` ×2：`Math.round((twips/20)*100)/100` vs 直接 `twips/20`。
- 验证：`npm run lint` 通过；`npm run build`（vue-tsc + Vite）通过；`npm test` 59 文件 / **1334 项**通过。
- 指标：主包 gzip 109.08 → **108.76 kB（−0.32 kB）**，连续第二轮回落。
- 发布：版本 `0.7.35 → 0.7.36`，双包已发布。
- 下一轮：继续找可安全合并的重复；剩余同名重复已全部判定为"语义不同"，后续可转向**重复字面量/常量表**与**未使用的导出**两类目标。

## Round 93/100 — 2026-10-08
- 目标：按上一轮方向转向**重复常量表**，并补全上一轮只看前 16 条的重复块清单。
- 方法：新增两个扫描器 ——（a）按**值**（而非名字）分组模块级 `const NAME = <数组|对象字面量>`，可捕获改过名的副本；（b）全量列出 ≥8 行的跨文件重复块。**踩坑**：扫描器初版未剥离行尾 `//` 注释，导致所有带注释的常量（`GIF_SIGNATURE_87`、`BMP_SIG` 等）被静默漏掉，修正后重扫。
- 改动（3 组，均为**运行时**代码）：
  1. **Word 16 色索引调色板有 3 份**：`formatParser.SHD_COLOR_MAP`（对象字面量，段落底纹）、`rendering/paragraphStyleRenderer.BORDER_COLOR_MAP`（对象字面量，表格边框）、`tableText.colorIndexToCss()`（16 个 `case` 的 switch）。三者取值与顺序逐项一致。新建 `src/utils/wordPalette.ts` 导出 `WORD_COLOR_PALETTE`，三处共用；`colorIndexToCss` 改为 `(idx !== undefined && WORD_COLOR_PALETTE[idx]) || '#000000'`（`undefined`/越界仍回落黑色，语义不变）。
     - **刻意未并**：`formatParser.highlightColor()`（`sprmCHighlight` 高亮色）是**另一张表**，索引顺序完全不同（1=黄、2=亮绿…15=黑，默认黄）。已在新模块注释中写明，防止后续轮次"顺手"合并。
  2. **`sectionParser.getSectionSprmOperandSize` 复制了 `getSprmOperandSize` 的 spra switch**（18 行，其注释自述"与 formatParser.getSprmOperandSize 一致"）。它**少了** `sprmTDefTable`(0xD608) 与 `sprmPTableDepth`(0x4410) 两个特例；这两个码虽不在 section 的 SPRM 域内，但畸形 `grpprl` 可含任意两字节（0xD608 的 spra=6、0x4410 的 spra=2），**盲目委托会改变畸形文件行为**。故不做函数级合并，而是把纯 spra 分支**搬移**为 `formatParser.getSprmOperandSizeBySpra`：`getSprmOperandSize` 保留特例后委托它，`sectionParser` 直接调它 —— 逐分支等价的搬移，两侧各自原有语义不变。
  3. **图片魔数签名各写一份**：`PNG_SIGNATURE`/`JPEG_SOI`/`GIF_SIGNATURE_87`/`GIF_SIGNATURE_89` 在 `imageExtractor.ts` 与 `pictureParser.ts` 各存一份（后者命名为 `GIF87`/`GIF89`）。现由 `imageExtractor.ts` 统一导出（并新增 `BMP_SIGNATURE`），`pictureParser.ts` 导入。`imageExtractor` 里内联的 BMP 判断 `data[i] === 0x42 && data[i+1] === 0x4D` 改为 `bytesEqual(data, i, BMP_SIGNATURE)` —— 含越界情形在内均等价。
- **刻意未动**：round 92 已判定的 4 组语义不同重复（`escapeHtml`、`findXxxEnd`、`readUtf16leString`、`twipsToPt`）；以及剩余**纯类型**重复（`shapeParser` vs `docFormat` 的 `ShapeType`/`ShapeAnchorType`、`docParser` vs `pieceTable` 的 `Piece`、`docParser` vs `storySplitter` 的 `DocumentStories`、`fieldParser` vs `docFormat` 的 `PageFieldInfo`/`CrossReferenceInfo`/`DocumentProperties` 字段块）—— 类型在构建期即被擦除，**不可能影响包体**，留待专门的类型整理轮次。
- 验证：`npm run lint` 通过；`npm run build`（vue-tsc + Vite）通过；`npm test` 59 文件 / **1334 项**通过。
- 指标：主包 gzip 108.76 → **108.56 kB（−0.20 kB）**，连续第三轮回落。
- 发布：版本 `0.7.36 → 0.7.37`，双包已发布。
- 下一轮：运行时层面的"重复实现"已基本收敛干净；建议转向**热路径分配审计**（回到项目最初的优化主线）或**类型重复的专项整理**。

## Round 94/100 — 2026-10-08
- 目标：回到项目最初的优化主线 —— **热路径分配审计**。`docparser/heuristics/textHeuristics.ts` 是逐段落调用，其中 `detectCharacterStyles` 更是**逐字符**遍历每个段落。
- 改动（`textHeuristics.ts`，5 处）：
  1. **逐字符循环内的正则字面量**：`const isWhitespace = /\s/.test(text[i])` —— 正则字面量每次求值都新建 RegExp（每字符一次），且 `text[i]` 还要分配单字符字符串。改为 `isWhitespaceCode(code)`（用循环里**本就算好**的 `charCodeAt` 结果），两项分配同时消除。该函数逐项复刻 ECMAScript `\s` 集合：`09–0D`、`20`、`A0`、`FEFF`、`1680`、`2000–200A`、`202F`、`205F`、`3000`、`2028`、`2029`。
  2. **冒号扫描** `text[i] === '：' || text[i] === ':'` —— 该循环必然扫完整段文本，每字符分配一个单字符字符串；改为 `charCodeAt(i)` 与 `0xFF1A`/`0x003A` 比较。
  3. **每段落一个 `text.length` 长的布尔数组**（有冒号时）：原实现把冒号区间展开成 `new Array(text.length).fill(false)` 再逐位置回查。因冒号位置升序且各标记区间**互不重叠且有序**（`start_ci = colon[ci]+1`，`end_ci = colon[ci+1]-4 < start_{ci+1}`），改为逐段与区间求交集长度 `max(0, min(segEnd,rEnd) - max(segStart,rStart))`，省掉 O(n) 分配 + 填充，计数复杂度也从"段长"降为"区间个数"（通常 1–2）。
  4. **`shouldHaveUnderline`**（每个数字字符调用）：`text[index]` + `/[0-9]/` 改为 `charCodeAt` 区间判断；函数体内三个正则字面量提升为模块常量（均非全局，跨调用共享安全）。
  5. **冗余的 `isSameStyle` 调用**：原为 `if (currentStyle && isSame(...)) continue` + `if (currentStyle && !isSame(...))` 连调两次；`isSameStyle` 是纯函数，合并为一次求值。
- **等价性证据（双重）**：
  - **解析输出逐位一致**：用 `bench-diff.mjs`（解析 27 个样本 `.doc`，与 `textutil` 基线比对文本相似度）在改动前后各跑一次，`total/parseSuccess/parseFail/median/p10/p25/min/max` 及 `topIssues` 聚类**全部完全相同**（median 0.9502433994244857、min 0.8115474418758475）。
  - **函数输出一致**：独立微基准把新旧 `detectCharacterStyles` 并排跑 10 个样本（中文/英文/中英混排/冒号密集/含制表符·全角空格·NBSP·ZWNBSP/500 字长串/列表标记），`JSON.stringify` 结果 **10/10 完全一致**。
- 微基准（20 000 轮 × 10 样本 = 200 000 次调用）：旧 1627.3 ms → 新 **904.2 ms，0.556x（快 1.8 倍）**。
- 验证：`npm run lint` 通过；`npm run build` 与 `npm run build:lib` 通过；`npm test` 59 文件 / **1334 项**通过。
- 指标：主包 gzip 108.56 → **108.62 kB（+0.06 kB）**。区间列表与 `isWhitespaceCode` 的体积略大于被删掉的数组填充 —— 与 round 87–89 相同的"以小体积换分配"取舍。
- 发布：版本 `0.7.37 → 0.7.38`，双包已发布。
- 下一轮：`textHeuristics.ts` 仍有**逐段落**级别的冗余分配可清（`guessCharFormat` 的 `match(/…/g)` + `replace(/\s/g,'')` + `trim()`；`detectAlignment` 一次调用就要 `trim()`/`trimStart()`/`trimEnd()`/`replace()` 四次字符串分配；`detectListInfo` 的 `match` + 两次 `replace`），以及把这些函数体内的正则字面量提升到模块级。

## Round 95/100 — 2026-10-08
- 目标：承接 Round 94（逐**字符**级分配），清掉 `textHeuristics.ts` 的**逐段落**级分配。`guessCharFormat` / `detectListInfo` / `detectAlignment` 每个段落各调一次，却为了读一个长度或计数而反复分配整串临时值。
- 改动（`textHeuristics.ts` + `encodingDetector.ts`）：
  1. **新增 4 个零分配计数函数**，全部复用 Round 94 引入的 `isWhitespaceCode`（精确复刻 ECMAScript `\s` 码点集）：`countWhitespaceChars`（≡ `replace(/\s/g,'').length`）、`leadingWhitespaceCount`（≡ `length - trimStart().length`）、`trailingWhitespaceCount`（以 `leading` 为上限，保证前后两段扫描不重叠；全空白串得 0，与 `trimEnd()` 口径一致）、`leadingIndentWidth`（TAB/全角空格各计 2、其余空白计 1，等价于原 `match` + 两次 `replace`）。
  2. **`guessCharFormat`**：`replace(/\s/g,'')` → `totalLength - countWhitespaceChars(text)`；`match(/[\u4e00-\u9fff]/g)` → 复用 `encodingDetector.countChineseChars`。
  3. **`detectAlignment`**：原先一次调用就有 `trim()` + `trimStart()` + `trimEnd()`×2 + `replace(/\s/g,'')` + `match(/[一-鿿]/g)` **共 6 次整串分配**；现只保留一次 `trim()`，其余全改为计数。
  4. **`detectListInfo`**：`match(/^[\s\u3000\t]*/)` + 两次 `replace` → `leadingIndentWidth`；CJK 数字那处 `match()` 其结果只用于真值判断，改 `test()`（不再产出数组）。
  5. **22 个函数体内的正则字面量提升到模块级**（按消费者分组注释）。其中 `CAPITAL_WORD_RE` / `WORD_RE` 带 `g`，但只喂给 `String.match`（会重置并忽略 `lastIndex`），跨调用共享安全 —— 已在源码注明。**明确保留两处"看似重复"**：`SENTENCE_PUNCT_RE`（含 ASCII `.!?`）与 `ALIGN_SENTENCE_PUNCT_RE`（仅中文标点）语义不同，合并会改行为。
  6. **`encodingDetector.countChineseChars` 由私有改为导出**，避免 `textHeuristics` 再写第四份 `0x4e00–0x9fff` 扫描；依赖方向 `heuristics → encodingDetector` 本就存在，无环。
- **等价性证据（三重）**：
  - **全函数差分**：`git show HEAD:…` 抽出 Round 94 版并排导入，对 **~60 000 条种子化模糊串 + ~150 条定向用例**逐函数比对 `JSON.stringify` —— `guessCharFormat` / `detectListInfo` / `detectAlignment`（每组 7 种 `index/total`）/ `detectCharacterStyles` / `shouldHaveUnderline` / `detectParagraphFormat` / `isSameStyle` **差异均为 0**。另做**阴性对照**（人为把 `listLevel` +1）确认该测试确实能捕获差异（6 个样本中命中 5 个）。
  - **端到端逐位一致**：`bench-diff.mjs` 改动前后各跑一次，报告里除 `cycle`/`timestamp` 外**全部字段逐位相同**，含 13 个 `failures` 样本各自的相似度（median 0.9502433994244857、p10 0.8968160758834334、p25 0.9154504595379104、min 0.8115474418758475、max 0.9999259480622746、`topIssues` 聚类一致）。
  - **微基准**：200 000 轮 × 15 段（中文正文/多级列表/日期/居中标题/ASCII 项目符号/空白），旧 236.4 ms → 新 **134.6 ms，0.569x（快 1.76 倍）**；同时累计的返回值校验和两边完全相同（2 226 684），证明加速不是靠改结果换来的。
- 验证：`npx vue-tsc -p tsconfig.json --noEmit` 0 错误；`npm run lint` 通过；`npm run build` 与 `npm run build:lib` 通过；`npm test` 59 文件 / **1334 项**通过。
- 指标：主包 gzip 108.62 → **108.75 kB（+0.13 kB）**。4 个计数函数 + 22 个提升常量比被删掉的字符串操作略大 —— 与 round 87–89、94 相同的"以小体积换分配"取舍；收益落在逐段落路径上（1 万段的文档，仅 `detectAlignment` 就省掉 6 万次整串分配）。
- 踩坑：`leadingIndentWidth` 的 JSDoc 里我写了原正则 `/^[\s\u3000\t]*/`，其中的 `*/` **提前终止了块注释**，导致后续注释文本被当代码解析、`vue-tsc` 报 47 个 `TS1127/TS1160`。块注释内不要出现 `*/`（改用 `//` 行注释或改写措辞）。
- 发布：版本 `0.7.38 → 0.7.39`，双包已发布。
- 下一轮：`paragraphFilter.ts`（逐段落正则字面量与 `trim()` 临时值）、`detectParagraphFormat`（函数体内仍有一次 `trim()` 与多个 `.test()` 字面量）、以及 `docParser.ts` 编排层是否有段落级结果被重复计算而非缓存。

## Round 96/100 — 2026-10-08
- 目标：收尾 Round 87 开头的 `paragraphFilter.ts` 正则提升工作 —— 该轮只处理了文件顶部的常量，漏掉了三处**逐段落**执行位置；顺带消掉三处"只想要计数却分配了整个匹配数组"的 `match()`。
- 改动（`paragraphFilter.ts`）：
  1. **补全正则提升**：`cleanWordFieldCodes` 里的 `pagePattern`（1 个）+ `fieldPatterns`（**30 个 `gi` 正则的数组**）、`applyStructuralFormats` 里的 `/\u0001/g` 与 `/^[A-Z][a-z].*[.!?]?$/`、`splitMultiRowTables` 里的三个 `\u0007` 字面量 —— 全部提到模块作用域。`applyStructuralFormats` 那处直接复用已有的 `PIC_PLACEHOLDER_RE`。均带 `g`/`gi` 且只喂 `String.replace`（会在开始时重置 `lastIndex`），共享安全；已注明 `HYPERLINK_QUOTED_PIC_RE`（`\s*` 尾、替换为 `\u0001`）与既有 `HYPERLINK_QUOTED_RE`（`[\s\u0001]*` 尾、替换为 `''`）**不可合并**。
  2. **新增 `countMatches(re, text, limit)`**：`RegExp.prototype.test` 在带 `g` 时只推进 `lastIndex`、**不分配匹配数组**（`exec` 每次分配一个，`match` 分配整张数组）。用于 `hasTooManyJunkChars`（`match(JUNK_ANY_RE) || []` → 上限 3，因为 `> 2` 是第一个短路条件）与 `filterParagraphsWithGenericLogic`（`match(WEIRD_CHAR_RE)` 计数；此处**保持精确计数不提前退出**，因为结果要参与 `weird/len < 0.5` 的浮点比较）。
  3. **`hasSignificantContent` 流式扫描英文单词**：判定只是"含元音的词 ≥ 2"，原实现却先 `match(ENGLISH_WORD_RE)` 收集**全部**单词再遍历。改为 `exec` 循环，找到第 2 个即返回。**这是本轮主要收益点**，且该函数几乎每段落都调用、在 `filterAndEnhanceParagraphs` 里每段落调用**两次**。
  4. **`cleanParagraph` 去掉一次 `trim()`**：`stripped === t` 时（绝大多数段落）第二次 `trim()` 结果必然等于第一次（trim 幂等），直接返回 `t`。
- **等价性证据（三重）**：
  - **全函数差分**：`git show HEAD:…` 抽出旧版并排导入，**40 000 条种子化模糊串 + ~100 条定向用例**（junk 前缀、全部域代码关键字、页码模式、HYPERLINK 带引号/裸形式、图片占位符与 CamelCase 类名、`\u0007` 单元格标记串、二/三段重复、超长病态串）+ **400 份伪随机 `ParserParagraph[]` 文档**；`cleanParagraph`/`hasSignificantContent`/`shouldSkipParagraph`/`hasTooManyJunkChars`/`removeInternalDuplicates`/`collapseWholeBlockRepeats`/`cleanWordFieldCodes`/`splitMultiRowTables`/`filterParagraphsWithGenericLogic`/`filterAndEnhanceParagraphs`/`applyStructuralFormats`（原地变更后整数组深比对）/`normalizeParagraphCpAxis`/`replacePageFieldsInText` **差异全 0**。
  - **阴性对照 3 项**（每类改动各一）：① 给 `DUP_PERIOD_RE` 漏写 `g` → 捕获；② 英文单词阈值从 2 改成 3 → 捕获；③ `cleanParagraph` 快路径跳过 junk 前缀剥离 → 捕获。**对照 ① 是真事**：本轮首次编辑时确实漏写了 `g`，类型检查与 lint 都没报，是我复查常量块时发现的。
  - **端到端逐位一致**：`bench-diff.mjs` 报告除 `cycle`/`timestamp` 外全部字段逐位相同（median 0.9502433994244857、min 0.8115474418758475，含 13 个 failures 样本各自相似度）。
- **微基准（稳健法：每函数隔离 + 4 轮预热 + 7 轮交替取中位数，N=300 000）**：
  ```
  hasSignificantContent            OLD   94.2 ms | NEW   48.3 ms | 1.950x
  hasTooManyJunkChars              OLD   13.3 ms | NEW   10.9 ms | 1.214x
  filterParagraphsWithGenericLogic OLD 1295.1 ms | NEW 1201.7 ms | 1.078x
  cleanWordFieldCodes              OLD  411.6 ms | NEW  386.1 ms | 1.066x
  splitMultiRowTables              OLD   19.1 ms | NEW   18.5 ms | 1.032x
  cleanParagraph                   OLD   10.4 ms | NEW   10.3 ms | 1.015x
  removeInternalDuplicates         OLD  967.0 ms | NEW  970.4 ms | 0.997x（代码未改动 = 噪声底）
  ```
- **重要发现（已写入记忆，避免后续轮次重复踩）**：**在 V8 里把正则字面量从函数体提升到模块级几乎不带来性能收益**。`cleanWordFieldCodes` 每次调用构造 30 个正则、基准里累计 2160 万次分配，提升后也只有 **1.066x** —— 因为该数组不逃逸出函数，V8 的逃逸分析直接消除了它，正则字面量本身还会复用已编译的模式。Round 87–89 的"体积涨了、耗时几乎没动"就是这个原因。**结论：正则提升是"可读性 + 跨引擎"收益，不是 V8 收益**；V8 上的收益来自（a）不再分配 `match()` 结果数组、（b）用计数替代整串临时值 —— 这正是 Round 94–96 在做的事。
- 验证：`npx vue-tsc -p tsconfig.json --noEmit` 0 错误；`npm run lint` 通过；`npm run build` 与 `npm run build:lib` 通过；`npm test` 59 文件 / **1334 项**通过（见下方测试稳定性修复）。
- 指标：主包 gzip 108.75 → **108.91 kB（+0.16 kB）**。体积大于 Round 87–89（+0.16/+0.02/+0.06），代价在于命名常量与 `hasSignificantContent` 的 exec 循环比原 `match` + `for` 更长；换来该函数 1.95x。
- **测试稳定性修复（两次提交 `8f895e1` → `9a55955`）**：本轮全量测试**连续三次各失败在不同文件**（`locale.test.ts` → `useI18n.test.ts` → `chartRenderer.test.ts`），但都是各自文件里**第一个执行动态 `import()` 的用例**、都是 5000ms 超时、单跑分别只需 0.7–1.2s。套件 `environment` 阶段实测 1704–1914s（Round 95 为 1474s），属并行争用。
  - 第一次修复只针对 4 个用 `vi.resetModules()` 的文件，结果第三次失败落在 **`chartRenderer.test.ts`** —— 它根本没用 `resetModules`，只是在第 177 行 `await import('../src/utils/locale')`。说明真正的触发条件是**"文件里第一次按需 `import()` 要现场转换并求值整张模块图"**，全仓恰好 5 个测试文件如此。
  - 最终把预算放回它该在的地方：`vitest.config.ts` 设 `testTimeout: 30000`，并撤掉第一次的 5 处逐文件 `vi.setConfig`。断言与用例语义均未改动。`locale.ts` 只 import `vue` 与 `./safeStorage`，与 `paragraphFilter` 无依赖路径。
- 发布：版本 `0.7.39 → 0.7.40`，双包已发布。
- 下一轮：`detectParagraphFormat`（函数体内仍有一次 `trim()` 与多个 `.test()` 字面量）、`docParser.ts` 编排层是否有段落级结果被重复计算而非缓存；另 `removeInternalDuplicates` 现在是 `filterParagraphsWithGenericLogic` 里最大的单项开销（短段落约 3.2 µs/次），值得 profile 看外层 `len` 扫描的起点能否收紧。

## Round 97/100 — 2026-10-08
- **方法升级（本轮最重要的产出）**：Round 87–96 都是「读代码挑嫌疑人」，Round 96 已经证明这条路不可靠（正则提升在 V8 上几乎无收益，与预期相反）。本轮改为**用 V8 CPU profile 定目标**：`node --cpu-prof` × 10 轮 × 27 份样本 `.doc`（270 次解析 / 7.65 MB）。`dist-lib` 是压缩过的，函数名不可读，因此另建一份**未压缩**产物（`vite build --mode lib --minify false --outDir .prof-lib`，用完即删）。
  - **沙箱噪声必须先剔除**：`tryBrokerFileTokenSync @ node-brokered-fs-shim.cjs` 占 **33%** 采样，是 Node 文件系统 shim，不是库代码。剔除后的真实分布：`extractImagesFromStream` **10.69%** > `(garbage collector)` 7.00% > `createParagraphsWithRealFormats` 5.75% > `detectCharacterStyles` 3.92% > `extractShapes` 3.38% > `guessCharFormat` 3.02% > `extractFormattedText` 2.73% > `extractWordArtFromDrawingData` 2.52% > `bytesToBase64DataUrl` 1.80%。
- 目标：`extractImagesFromStream` —— profile 里除沙箱噪声外**最大的单项**，且是唯一一个「纯叶级扫描」。
- **问题**：原实现逐字节 `i++`，在**每个偏移**最多调用 **4 次 `bytesEqual`**（PNG / JPEG / GIF / BMP），而 98% 的偏移不可能匹配任何签名。7.65 MB 样本上合计约 **3060 万次 `bytesEqual` 调用**。
- 改动（`src/utils/imageExtractor.ts`）：四个签名的**首字节互不相同**（`0x89` / `0xFF` / `0x47` / `0x42`），任一偏移至多命中一个 → 改为**按首字节 `switch` 分流**，只有首字节命中才调 `bytesEqual`。新增 4 个模块级常量 `PNG_LEAD / JPEG_LEAD / GIF_LEAD / BMP_LEAD`，从签名数组派生（`PNG_LEAD = PNG_SIGNATURE[0]`），两者不可能漂移。每个分支末尾 `continue`，让 `for` 的 `i++` 等价于原显式 `i++`；命中时 `i = end - 1` 使 `i++` 落在 `end`，与原 `i = end; continue` 一致。
- **被否决的方案（重要，别再试）**：第一版用 `TypedArray#indexOf` 在候选偏移之间跳跃。教科书技巧，**在这份数据上是错的**。实测首字节密度：`0x89` 1/895、`0xFF` **1/70**、`0x47` 1/816、`0x42` 1/310，四个候选合计占 **2.0%**。2% 密度下原生搜索在候选之间扫过的字节数与逐字节扫描相当，还多付原生调用开销 → 实测 **0.97x**，等于没有收益。
- **该版本还藏着一个更严重的缺陷（已写进记忆）**：候选缓存用 `if (x < i) x = data.indexOf(lead, i)` 刷新，而 `-1 < i` **恒真** —— 某首字节**完全缺席**时，每轮都对整个剩余缓冲区重搜 → **O(n²)**。1 MB 输入跑 **6 分钟仍未完成**（最终版 ~5 ms）。**关键教训：差分测试在这个版本上全部通过** —— 它是性能悬崖而非正确性 bug，且当时语料全是小缓冲区。因此本轮**新增复杂度护栏测试**，并实测确认它对那版 O(n²) 实现会捕获（>6 分钟 vs 5000 ms 上限）。
- **等价性证据（四重）**：
  1. **差分测试**：`git show HEAD:…` 抽出旧版并排导入，比对全部导出符号。覆盖：手工构造的四格式合法**与**畸形图像（PNG 载荷 0/1/13/100/5000 字节、截断 JPEG、带/不带 `0x3B` 尾的 GIF、54 字节下限及以下的 BMP）；拼接 + 噪声填充 + **3000 条种子化模糊串**（签名随机注入偏移）；退化填充（`0x00`/`0xFF`/`0x89`/`0x47`/`0x42`/交错首字节，即暴露悬崖的那些输入）；**80 份真实样本变体**（27 份 `.doc` + 其 4KB/64KB/256KB 前缀，对齐调用点的有界扫描窗口）—— **245 张图逐字节比对**。差异 **0**（含 `bytesToBase64DataUrl` / `imagesToDataUrls` / `imageFormatMime` 在 300 个 ≤200 KB 随机缓冲区上的结果）。
  2. **阴性对照 ×2**：① 跳跃起点偏移一位；② 只考虑 PNG/JPEG 首字节（漏掉 GIF/BMP）。**两者都在真实样本上被捕获** —— 证明测试有牙齿，不是空转通过。（第一版对照组选错了样本：挑了体积最大的 `.doc`，但它不含图片，`truth.slice(1)` 与 `truth` 都是 `[]`，`sameImages` 返回 `true`。换成上面两个更贴近真实失误的破坏版才有效。）
  3. **端到端逐位一致**：`bench-diff.mjs` 改动前后除 `cycle`/`timestamp` 外全部字段逐位相同，含 13 个 `failures` 样本各自相似度（median 0.9502433994244857、p10 0.8968160758834334、min 0.8115474418758475、max 0.9999259480622746）。
  4. **稳健微基准**（esbuild 打包成独立 Node 脚本，避开 vitest 的 runner 开销与 `onTaskUpdate` 超时；4 轮预热 + 5 轮交替取中位数）：真实样本 27 份 / 7.65 MB `40.0 → 11.5 ms`（**3.49x**）、1 MB 稀疏（无候选）`6.3 → 1.7 ms`（3.77x）、256 KB 全 `0xFF` 病态 `1.7 → 0.7 ms`（2.32x）、512 KB 交错首字节 `3.6 → 1.8 ms`（2.04x）。**无任何场景退化**，含退化输入。
- **新增常驻测试** `tests/imageExtractor.golden.test.ts`（+ `tests/fixtures/imageExtractor-golden.json`，8762 字节）：同目录已有的 `imageExtractor.test.ts`（34 个用例，覆盖四格式合成边界）与它互补，这里守住两件合成样本守不住的事 —— ① **真实样本 golden 快照**：15 份含图样本 / **126 张图**的 `{format, len, hash}`（FNV-1a，`h = 0x811c9dc5`、`Math.imul(h, 0x01000193) >>> 0`），快照由**改动前**的实现生成（差分测试已证明与新版逐字节一致），并断言 `files > 10 && images > 100` 防止样本缺失时静默退化成"空测试"；② **复杂度护栏**：1 MB 全 `0xFF`/`0x89`/`0x47`/`0x42`/`0x00` 与交错首字节，均须在 5000 ms 内完成（实测 14/5/1 ms，约三个数量级余量，不会因并行争用误报）。
- 验证：`npx vue-tsc -p tsconfig.json --noEmit` 0 错误；`npm run lint` 通过；`npm run build`（主包 gzip **108.93 kB**）与 `npm run build:lib` 通过；`npm test` **60 文件 / 1338 项**通过（较 Round 96 的 59/1334 +1 文件 +4 项，即新增的 golden 文件）；差分等价测试与阴性对照跑通后**已删除**，O(n²) 对照脚本已终止并清理。
- 指标：主包 gzip 108.91 → **108.93 kB（+0.02 kB，基本中性）** —— `switch` 是 4 个 `if` 的直接替代，4 个新常量压缩后各 3 字节。
- 清理的临时产物：`tests/round97equiv.test.ts`、`tests/round97ctl.test.ts`、`tests/round97bench.test.ts`、`src/utils/_oldImageExtractor.ts`、`.bench97.ts`、`.analyze97.ts`、`.gen-golden97.ts`、`.prof-lib/`、`/tmp/broken97.*`。
- 发布：版本 `0.7.40 → 0.7.41`，双包已发布。
- 下一轮（按 profile 排序）：`extractShapes`（3.38%）与 `extractWordArtFromDrawingData`（2.52%）是与本轮**同族**的叶级扫描，最值得先查是否重复了「逐偏移多次签名比较」的模式；其次是 `createParagraphsWithRealFormats`（5.75%）与 `bytesToBase64DataUrl`（1.80%，分块 `String.fromCharCode.apply` 的 `+=` 会形成 rope，可收集 chunk 后一次 join）。`(garbage collector)` 7.00% 是**症状**，应先定位喂给它的分配者。

## Round 98/100 — 2026-10-08
- 目标：`extractShapes`（profile 里剔除沙箱噪声后 **6.56%**，是 Round 97 之后最大的「叶级扫描」）。重跑 CPU profile 确认 Round 97 的修复生效：`extractImagesFromStream` 从 10.69% 降到 **3.28%**。顺带做了**采样堆剖析**（`--heap-prof --heap-prof-interval=2048`）去查 `(garbage collector)` 12.76% 的成因，但模块加载噪声占绝对多数（`readFileSync` 18.7% / `decode` 13.1% / `wrapSafe` 6.4%），库内最大分配者是 `parsePapxGrpprl` 182 KB、`parseFdg` 166 KB、`parseFormatRuns` 90 KB，不足以单独成一轮，故仍选 `extractShapes`。
- **实测筛子数据（8.0 MB，Data 流 + WordDocument 流）**：`(readUint16 & 0xC000) === 0xC000` 放行 **678 221** 个偏移（8.457%）；`recType === 0xF000` 只放行 **751** 个（0.0094%）；两者同时满足 **49** 个。也就是说**为了拿到 49 个真候选，要付 678 221 次完整记录头解析**。
- 改动（`src/utils/shapeParser.ts`）：`recType` 取 `data[o+2] | (data[o+3] << 8)`，故 `recType === OFFICE_ART_FDG`（0xF000）与 `data[o+2] === 0x00 && data[o+3] === 0xF0` **完全等价**；而后者是既有 `header.recType === OFFICE_ART_FDG` 的**必要条件**。把它作为前置筛加在 16 位掩码**之前**（先查通过率 0.0094% 的，再查 8.457% 的），等价性一行可证 —— 新增谓词被既有谓词蕴含，被接受的偏移集合不变。新增 `FDG_TYPE_LO / FDG_TYPE_HI` 两个模块级常量，从 `OFFICE_ART_FDG` 派生而非写死，两者不会漂移。
- **关键发现（本轮最重要的产出）**：那个 `0xC000` 掩码约束的是 **recInstance 低字节的高 2 位**，而 MS-ODRAW 规定 OfficeArtFDG 的 `recInstance = 0` —— **所以这个掩码会拒掉所有规范形态的 FDG 记录**。27 份真实样本产出的 shapes **全部为 0**，这个函数每次扫描 8 MB 却永远返回空数组。测试夹具其实一直知道这件事：`tests/shapeParser.test.ts` 的 builder 注释写着「recInstance bit 6-7 set (0x00C0) so the little-endian magic scan matches」。**修复它是行为变更，不是等价优化，本轮明确不做**，改为把它钉进常驻测试（见下）。因此本轮是**加**前置筛而不是**替换**掩码。
- **被否决的方案（与 Round 97 同一条教训，隔一轮复现）**：`Uint8Array#indexOf(0x00, …)` 候选跳跃。`0x00` 在语料里密度 0.39%，远低于 Round 97 判定「跳跃会输」的 2% 阈值，看起来很有希望。实测：**真实语料 0.61x（比原版还慢）**、1 MB 密集 FDG 头 0.34x；只在人工均匀填充上虚高到 22x（那里一个原生调用就能跳完整个缓冲区）。**跳跃式扫描的头条数字来自它最不擅长的输入。** 否决。
- **等价性证据（四重）**：
  1. **差分测试**：`git show HEAD:…` 抽出旧版并排导入，比对两个导出。覆盖：合成 `FDG → DG → SP` 链的**参数矩阵**（5 spid × 3 grfSp × 2 ClientData × 2 pictures × 6 spRecLen = 360 个缓冲区，含 `spRecLen < 72` 的不产出路径）；**FDG 形态但被掩码拒绝**的样本（recInstance 低字节 `0x00/0x3F/0x7F/0x80`）—— 这些正是新前置筛**新放行**的偏移，是承重用例；`recVer`/`recType`/`recLen`（含 `0xffffffff`）变形；拼接链 + 重复 spid 去重；**3000 条种子化模糊串**（64–4096 字节随机内容 + 随机注入 0–3 个 FDG 头、recInstance 随机）；退化填充（`0x00/0x0F/0x3F/0xC0/0xF0/0xFF/0x89/0x47/0x42`）、每 4 字节一个 FDG 头、FDG 头贴缓冲区末尾；**80 份真实样本变体**（27 份 `.doc` + 4KB/64KB/256KB 前缀）。差异 **0**。
  2. **阴性对照 ×4**（整份复制旧模块、只把谓词改错：字节位置写反 / 多加一个必要条件 / 删掉 16 位掩码）—— 前两个在合成链上被捕获。**第三个（删掉掩码）在真实语料上与正确实现输出完全相同**，因为语料无论谓词怎么改都返回 `[]`。**这是本轮最重要的方法论结论：真实语料对 `extractShapes` 的任何谓词改动都没有鉴别力**，等价性证据必须由合成链承担。对照文件把这一点本身也钉成了断言。
  3. **端到端逐位一致**：`bench-diff.mjs` cycle-980 与 cycle-970 除 `cycle`/`timestamp` 外**全部字段逐位相同**（median 0.9502433994244857、p10 0.8968160758834334、min 0.8115474418758475、max 0.9999259480622746）。
  4. **稳健微基准**（esbuild 独立脚本、4 轮预热 + 5 轮交替取中位数）：真实语料 27 份 / 7.65 MB `18.6 → 13.9 ms`（**1.34x**，多次运行 1.34–1.59x）、前缀组 1.27x、1 MB 均匀填充 ~3.1x、密集 FDG 头 1.19x、256KB 超密集 1.54x。**无任何场景退化**；合成链那一项 1.00x 是构造使然（由本轮未改动的 `parseFdg` 主导）。
- **新增常驻测试** `tests/shapeParser.fdgScan.test.ts`（7 项）：① 钉住前置筛的**既有契约** —— recInstance 低字节高 2 位为 11 时提取到形状、规范形态 `recInstance = 0` **不**提取（注释写明这是记录「当前行为」而非「期望行为」，日后修正时该用例会失败，提醒维护者显式确认）；② **复杂度护栏** —— 1 MB 均匀填充、每 16 字节一个 FDG 头的 1 MB、每 4 字节一个 FDG 头的 256 KB 均须在 5000 ms 内完成（实测 2–3 ms，约三个数量级余量）。
- 验证：`npx vue-tsc -p tsconfig.json --noEmit` 0 错误；`npm run lint` 通过；`npm run build`（主包 gzip **108.94 kB**）与 `npm run build:lib` 通过；`npm test` **61 文件 / 1345 项**通过（较 Round 97 的 60/1338 +1 文件 +7 项）。
- 指标：主包 gzip 108.93 → **108.94 kB（+0.01 kB，基本中性）** —— 常见路径上一个 `readUint16` 调用被两次 `data[offset + n] !== CONST` 取代，两个常量折叠成立即数。
- 清理的临时产物：`src/utils/_oldShapeParser.ts`、`src/utils/_ctlShapeParser.ts`、`src/utils/_idxShapeParser.ts`、`tests/round98equiv.test.ts`、`tests/round98ctl.test.ts`、`.bench98.ts`、`.prof98.mjs`、`.analyze98.mjs`、`.analyze98h.mjs`、`.probe98.mjs`、`.probe98b.mjs`、`.prof-lib/`、`.prof98/`、`.prof98h/`。
- **踩坑**：第一版差分测试传 `fdgRecLen: 0xffffffff`，而构造器让 recLen 参与 `new Uint8Array(8 + recLen)` → 申请 4 GB，整个 vitest worker 被 OOM 杀掉（exit 137、无任何输出）。修法：让 recLen 只影响**头部字段**，缓冲区长度由独立的 `bufSize` 控制。
- 发布：版本 `0.7.41 → 0.7.42`，双包已发布。
- 下一轮（按 profile）：`createParagraphsWithRealFormats`（9.83%）现为最大单项，但它是段落装配层、不是叶级扫描，需要另一套分析方式；`extractWordArtFromDrawingData`（5.25%）是同族里最清晰的下一个 —— 它在每个偏移跑**四轮内层循环 + `match` 标志**比对四字节标记，另有**八轮内层循环**找零串，还每次调用 `new Uint8Array` 两次，压平成直接字节比较的收益应当大于 `extractShapes`；`extractEquationsFromWordDocumentStream`（3.78%）与 `extractChartsFromWordDocumentStream`（0.48%）与 `extractShapes` **各自独立扫描同一个 WordDocument 流**，四趟全扫是结构性冗余，但合并是高风险重构，先测量再动；`bytesToBase64DataUrl`（1.73%）；`(garbage collector)` 12.76% 仍是症状，堆剖析还没指向库内某个主导分配者。

## Round 99/100 — 2026-10-08
- 目标：`extractWordArtFromDrawingData`（profile 剔除沙箱噪声后 **5.25%**，叶级扫描家族里每偏移开销最重的一个）。与 Round 98 不同，这个函数在真实语料上**确有产出**（整份 `.doc` 输入下 27 份样本产出 **27 个 WordArt**，分布在 15 份里；端到端只喂 WordDocument 流时是 5 个），所以差分测试在真实数据上有鉴别力。
- **实测字节密度（7.65 MB）**：`0xE0` **10 681 次 / 1 in 751（0.133%）**（WordArt 标记首字节）、`0x00` 3 081 729 次 / 1 in 3（**38.426%**）、`0x10` 1/331、`0x4B` 1/258、`0x4C` 1/766。
- 改动（`src/utils/wordArtParser.ts`）三处，同一个循环里：
  1. **压平标记比较**：`new Uint8Array([0xE0,0,0,0])` + 4 轮内层循环 + `match` 标志 → `data[offset] !== WORDART_MARKER_LEAD` 再加三个尾字节的直接比较。
  2. **跳过非首字节的长串**：首字节不匹配时用 `data.indexOf(WORDART_MARKER_LEAD, offset + 1)` 直接跳到下一个候选。
  3. **压平终止位置搜索**：8 轮内层循环 → `isZeroRun(data, offset)` 辅助函数，顺带消掉每次调用的两个 `new Uint8Array` 分配。
  - `for` 改成 `while`，把 `offset++` 移进各分支，好让「首字节不匹配」这一支整段跳过。覆盖的偏移集合与原 `for` 完全相同（`{0 … data.length - 101}`）；原 `offset = endOffset + 8` 之后还有 `for` 的 `offset++`，所以现在写 `endOffset + 9`。
- **关键设计：跳跃必须是条件式的**。三实现实测（左：7.65 MB 真实语料 / 右：1 MB 全 `0xE0`）：
  ```
  纯逐字节    11.9 ms /  1.8 ms
  每次都跳     2.9 ms / 10.2 ms   ← 全 0xE0 时退化 5.5x（每个字节一次原生调用）
  仅不匹配时跳  2.9 ms /  1.3 ms   ← 两边都拿到
  ```
  把跳跃限制在 `data[offset] !== WORDART_MARKER_LEAD` 这一支，退化场景根本不会进入该分支、退化为纯逐字节扫描；稀疏场景则是每 751 字节才跳一次。**这是本轮相对 Round 98 的核心进步：不是二选一，而是同时拿到两端。**
- **纠正 Round 98 的实质错误（已写进 changelog 与记忆）**：Round 98 把 `indexOf` 跳跃的失败归因于「`0x00` 密度 0.39%」，**这个数字是错的 —— 实测是 38.426%**。在那个密度下 `indexOf` 每 3 个字节就命中一次，几乎每个字节都在付原生调用开销，所以那个结果**完全不能说明低密度下跳跃会输**。本轮在密度 0.133% 的字节上重测，跳跃赢 **5.3x**。修正后的教训窄得多：**`indexOf` 跳跃在搜索字节很密时会输，密度必须实测、不能假设**。Round 98 的 changelog 已加更正说明。
- **等价性证据（四重）**：
  1. **差分测试**：`git show HEAD:…` 抽旧版并排导入。覆盖：标记放置的每一个关心位置（含最后一个合法偏移 `data.length - 101` 与第一个非法偏移 `data.length - 100`）；标记四个字节的**每一种单字节偏差**（首字节 4 种 × 尾字节各 2 种，都必须不产出）；终止距离 100/101/110/5099/5100/5101/无（无零串时 `endOffset` 停在 `offset + 5000`）；被缓冲区末尾截断的零串（tail 0–8，不得当作匹配）；跳进路径（`endOffset + 9`）与「第二个标记落在第一个候选的 artData 内部 / 之后」；每 4 字节一个标记、全零、全 `0xE0`、每个偏移都是标记；**3000 条种子化模糊串**（200–6200 字节 + 随机注入标记与零串）；退化填充（`0x00/0xE0/0xFF/0x10/0x4B/0x4C/0x20/0x89`）与长度 0–200；**80 份真实样本变体**（27 份 `.doc` + 4KB/64KB/256KB 前缀，**27 个 WordArt 逐字段比对**）。另比对了同模块未改动的 `extractWordArtFromDirectory`（含 `null` 流与抛异常的读取器）与 `getEffectLabel`。差异 **0**。
  2. **阴性对照 ×5**（整份复制旧模块、只把谓词改错：只比首字节 / 起点偏移一位 / 终止只找 4 个零）—— **三种失误都在真实语料上被捕获**，这正是 Round 98 做不到的。其中一个对照最初失败，原因很有价值：**纯 `0xE0` 填充的合成样本不能区分「只比首字节」的失误** —— 因为候选要被收录需满足 `text || effects.length > 1 || colors.length > 0`，而纯 `0xE0` 三者都不满足，错版同样返回空。改用 `0xFF` 填充 + 裸 `0xE0`（`extractColorsFromData` 会认出 `#ffffff`，假候选得以存活）才有效；并把那个无鉴别力的样本单独留成一条断言，把陷阱记录下来而不只是绕开。
  3. **端到端逐位一致**：`bench-diff.mjs` cycle-990 与 cycle-980 除 `cycle`/`timestamp` 外**全部字段逐位相同**。
  4. **稳健微基准**（esbuild 独立脚本、4 轮预热 + 5 轮交替取中位数）：真实语料 27 份 / 7.65 MB `13.9 → 2.6 ms`（**5.34x**）、前缀组 5.76x、1 MB 稀疏随机 5.29x、1 MB 全 0xFF 6.76x、**1 MB 全 0xE0 1.89x（不退化）**、1 MB 全 0x00 6.97x、1 MB 每 16B 真标记 1.03x、1 MB 每 16B 假 `0xE0` 2.46x、256 KB 每 4B 标记 1.02x。**无任何场景退化**；两个接近 1.0 的用例由本轮未改动的逐候选工作（`detectDataEffectMask` / `extractTextFromData` / `extractColorsFromData`）主导。
- **顺带发现一个既有的最坏情况（本轮不修）**：「256 KB 每 4 字节一个标记」这一用例**新旧版本都要 2.6 秒**。成因是结构性的：终止搜索从每个候选向后最多扫 5000 字节，而跳进只在候选**被收录**时才发生；因此「密集 `E0 00 00 00` 但全都不满足收录条件」的缓冲区代价是 O(n/4 × 5000)（256 KB → 3.28 亿次内层迭代），1 MB WordDocument 流约 11 秒。真实文档不会触发（标记要四个特定字节，`0xE0` 只占 0.133%，全部 7.65 MB 里只有 42 个候选偏移），但这是对公开导出函数的健壮性隐患。修法是把终止搜索做成摊还（搜索窗口关于 `offset` 单调，用一个只前进的零串指针即可），属**新的算法结构**而非局部改写，故只记录不动手。
- **新增常驻测试** `tests/wordArtParser.golden.test.ts`（5 项）：① **真实样本 golden 快照** —— `tests/fixtures/wordArtParser-golden.json` 记录 27 份样本的全部 27 个 WordArt（逐字段），由**改动前**的实现生成（差分测试已证明两版逐位一致），是防止跳跃漏掉或错位候选的常驻防线；② **复杂度护栏** —— 1 MB 均匀填充（含首字节最密的全 `0xE0`）、每 16B 真标记、每 16B 假 `0xE0`、无任何候选，均须在 5000 ms 内完成（实测 1–17 ms，两到三个数量级余量）。
- 验证：`npx vue-tsc -p tsconfig.json --noEmit` 0 错误；`npm run lint` 干净（修掉 golden 测试里两个未使用导入）；`npm run build`（主包 gzip **108.95 kB**）与 `npm run build:lib` 通过；`npm test` **62 文件 / 1350 项**通过（较 Round 98 的 61/1345 +1 文件 +5 项）。
- 指标：主包 gzip 108.94 → **108.95 kB（+0.01 kB，基本中性）**。
- 清理的临时产物：`src/utils/_oldWordArtParser.ts`、`src/utils/_ctlWordArtParser.ts`、`src/utils/_idxWordArtParser.ts`、`tests/round99equiv.test.ts`、`tests/round99ctl.test.ts`、`.bench99.ts`、`.probe99d.mjs`、`.gen-golden99.ts`。
- 发布：版本 `0.7.42 → 0.7.43`，双包已发布。
- 下一轮：`createParagraphsWithRealFormats`（9.83%）为最大单项，但属装配层、需要另一套分析方式；`extractEquationsFromWordDocumentStream`（3.78%）在 27 份样本上产出**零**个公式，与 Round 98 的 shapes 完全同类 —— **先查它的筛子是不是同样过严**，再考虑优化；`extractShapes` / `extractWordArtFromDrawingData` / `extractEquationsFromWordDocumentStream` / `extractChartsFromWordDocumentStream` **各自对同一个 WordDocument 流做一次全扫**（四趟冗余），合并能省掉三趟但属高风险重构，先测量合并成本；`bytesToBase64DataUrl`（1.73%）；GC 12.76% 仍是症状。

## Round 100/100 — 2026-10-08
- 承接 Round 99：条件式 `indexOf` 跳跃让 `extractWordArtFromDrawingData` 从 ~10.5 ms 降到 1.72 ms，但它只是四个「各自全扫同一个 WordDocument 流」的函数之一。本轮先量了四个各自的开销：`extractShapesFromWordDocumentStream` 10.60 ms（1.93 ms/MB）、`extractEquationsFromWordDocumentStream` 11.05 ms（2.01）、`extractChartsFromWordDocumentStream` 10.53 ms（1.91）、`extractWordArtFromDrawingData` 1.72 ms（0.31，Round 99 已优化）。四趟合计 33.89 ms，其中 **32.2 ms 花在三个产出恒为 0 的扫描上**。
- **锚点密度实测**（跳跃划不划算完全由它决定）：`0xEF` 0.0846%（间隔 1182 B）、`0xF0` 0.1171%（854 B）、`0xD0` 0.1146%（872 B）、`0x50` 0.5278%（190 B）、`0x00` **31.41%**（3.2 B）。`0x00` 的 31.4% 再次印证 Round 98 的更正。三个扫描在 5.77 MB 上的完整匹配次数：形状前置筛 411、图表 lead **0**、公式魔数 **0**。
- **公式魔数的真面目**：`EF BF BD EF BF BD` = UTF-8 的 U+FFFD（替换字符）重复两次，看着像从乱码里提出来的，27 份样本里一次都没出现。**本轮不碰它**（改掉它是行为变更），只让扫描它变便宜 —— 这与 Round 98 拒绝删掉那个过严掩码是同一条纪律。
- 改动一（`src/utils/equationParser.ts`）：**两处彼此独立的收益** —— ① 压平魔数比较（内层 `for` + `match` 标志 → 5 个直接常量比较），单独 **1.76x**；② 条件式跳跃（首字节非 `0xEF` 时 `indexOf`）。合计 **6.79x**。新增 `EQN_MAGIC` / `EQN_MAGIC_LEAD` / `EQN_MAGIC_LEN`，从魔数派生而非另写字面量。
- 改动二（`src/utils/shapeParser.ts`）：前置筛失败时跳到下一个 `0xF0` 并回退 3 字节（`offset = p - 3`）。落在 `[offset+1, p-3)` 的偏移其 `o+3` 处都不是 `0xF0`，前置筛必然失败 → 等价。控制流从 `for` + `continue` 改成 `while` + 嵌套判断，使非跳跃路径只有一个 `offset++`。**6.57x**。
- **图表：量了、算过、放弃（本轮最有价值的负面结论）**。图表 lead 是 `0xD0`（OLE）或 `0x50`（ZIP），要跳两个字节，第一版取 `Math.min` 的结果 —— **实测 6.72 → 940 ms（0.01x），退化 140 倍**。计数定位原因：落地 36 996 次、`indexOf` 调用 73 942 次，**但扫描量是 3690 MB 而不是 39 MB**。因为 `0xD0`（0.11%）比 `0x50`（0.53%）稀 4.6 倍，朝较密的 `0x50` 前进的每一步都在重扫「到下一个 `0xD0`」那段长距离；`oleGone` 永不触发，因为那个 `0xD0` 每次都找得到。**取两个目标的最小值是二次方行为。**「缓存两个目标位置」能拉回线性（**1.92x**），但需要 4 个状态变量，且「已耗尽」用 `-1` 表示会再次退化（`-1 <= o` 恒真 → 每次落地重扫到数组末尾，1 MB 全 `0xD0` 直接把进程跑挂，基准里 exit 137）。1.92x 换这些不划算，本轮不动图表函数。
- **形状守卫（「锚点紧邻就不跳」）是必需的**：`indexOf` 即使立刻命中也要付一次原生调用，锚点铺满时每次只前进 1 字节 → 变成「每字节一次调用」。实测 1 MB 全 `0xF0`：**无守卫 1.46 → 9.10 ms（0.16x，退化 6 倍）**，有守卫 1.28 ms（1.14x）。真实语料代价仅 6.48x → 6.40x（1.2% 相对损失）。
- **实测（真实语料 27 个 WordDocument 流 / 5.50 MB）**：公式 `10.41 → 1.53 ms`（**6.79x**）、形状 `9.88 → 1.50 ms`（**6.57x**）、图表（未改）`10.53 / 10.51`（run-to-run 1.002x，噪声底）、**三趟合计 30.81 → 13.55 ms（−56.0%）**。
- **残留退化（诚实记录）**：形状在 1 MB 全 `0xF0` 上仍 1.45 → 2.03 ms（**0.72x**）。这一档守卫不触发（`data[offset+4]` 每次都是 `0xF0`，守卫确实拦住了调用），但守卫本身的读取把每字节成本推高了。绝对值 2 ms/MB 仍是线性、远在 5000 ms 护栏之下，且真实流里 `0xF0` 密度 0.117%、不会出现。公式在 1 MB 全 `0xEF` 上 2.82 → 2.12（1.33x，是**加速**，因为跳跃只在首字节不匹配时触发，该分支根本不进）。
- **等价性证据（四重）**：① 真实语料差分（27 份 `.doc` 整文件，两函数逐字段一致，两版产出都是 0 且写进断言）；② 合成语料差分（公式 14 例、形状 13 例，逐条断言「该不该产出」）；③ 确定性模糊（mulberry32 各 400 组，一半从「可疑字节表」取字节、1/4 植入真魔数或真 FDG 链）；④ **阴性对照 ×6 + 等价对照 ×2**。
- **阴性对照表**：A 公式跳跃从 `offset+2` 起步 ✓捕获、B 形状回退 `p-2` ✓捕获、C 公式魔数少查最后一个字节 ✓捕获、F 形状守卫步长写成 `+2` ✓捕获；D 形状锚点改用 `0x00`（超集枚举，更慢但等价）✓正确地无差异、E 公式去掉内层 `offset >= limit` 守卫 ✓正确地无差异。
- **对照 E 是我判断错误、被实测纠正的一条**：原以为去掉内层守卫会让扫描越过 `limit`，实测零差异 —— 因为 `while (offset < limit)` 的条件判断立刻会兜住。把它从「改错」改标为「等价变体」，这正是阴性对照该起的作用。
- **差分测试踩的三个坑（都写进 changelog）**：① **合成语料必须真的产出** —— 公式第一版合成块把 UTF-16LE 写成了 `[0x00, charCode]`（解码是 `(data[i+1] << 8) | data[i]`，低字节在前），每个字符都被 `[^\x20-\x7E\\]` 过滤干净；**且**所有合成缓冲区都不到 100 字节，扫描上限 `data.length - 100` 让循环一次都不进。两个 bug 叠加 → 差分测试完全空转（两版都返回 `[]`，永远「一致」）。② **对照 C 需要对齐的夹具** —— 「少查一个字节」只有在错位后仍能解出可读文本时才暴露，第一版夹具错位一字节，对照与正版都产出 0，又是空转。③ **对照 F 需要能进入守卫分支的形态** —— 守卫只在扫描恰好走到某偏移时触发，而跳跃通常直接落到锚点上跳过它；造出 `00 F0 00 F0` 重叠形态（链头 `recVer=0` / `recInstance=0x00F0`）才能进入：偏移 `c-2` 前置筛通过但掩码拒绝、偏移 `c-1` 守卫触发、偏移 `c` 才是真链。
- **新增常驻护栏**：`tests/equationParser.golden.test.ts`（新建，10 项）—— 真实语料快照（断言扫描过 > 5 MB 且产出 0；**没有「扫描量」这条断言的话，「一个样本都没读到」也会让 0 通过**）、5 条合成正例（含 `eqnToLatex` 变换在产出路径上生效）、6 条被拒形态、4 条复杂度护栏（1 MB 全 `0xEF`、每 16 字节一个 `0xEF`、每 128 字节一个真块并断言产出 > 1000 条）。`tests/shapeParser.fdgScan.test.ts`（14 项，本轮新增 5 项）—— 垫满 `0xF0` 的 10 种前缀长度、垫满 `0x00` 的 6 种前缀长度、「前置筛通过但掩码拒绝」的假候选之后仍能提取、被 `0xF0` 长串隔开的两条链都被提取、真实语料快照、锚点每 4 字节与每 64 字节的复杂度护栏。
- 验证：`npx vue-tsc -p tsconfig.json --noEmit` 0 错误；`npm run lint` 干净；`npm run build`（主包 gzip **109.01 kB**）与 `npm run build:lib` 通过；`npm test` **63 文件 / 1367 项**通过（较 Round 99 的 62/1350 +1 文件 +17 项）；差分测试与阴性对照跑通后**已删除**。
- 指标：主包 gzip 108.95 → **109.01 kB（+0.06 kB）**，新增的是两个模块级常量与一层守卫分支（注释在压缩时被剥掉）。
- 清理的临时产物：`src/utils/_oldEquationParser.ts`、`src/utils/_oldShapeParser.ts`、`src/utils/_ctlEquationParser{,2,3}.ts`、`src/utils/_ctlShapeParser{,2,3}.ts`、`tests/round100equiv.test.ts`、`tests/round100ctl.test.ts`、`.bench100{,b,c}.ts`、`.probe100{,b}.ts`、`.iso100{,b}.ts`、`.cnt100{,b,c}.ts`。
- 发布：版本 `0.7.43 → 0.7.44`，双包已发布。
- 下一轮：`extractChartsFromWordDocumentStream`（10.5 ms、产出 0）本轮量过并放弃，要做必须同时解决「两目标密度不同导致二次方」与「已耗尽标记」两个问题；`createParagraphsWithRealFormats`（9.83%）是库里最大的单个函数，属装配层而非扫描，需要另一类分析；四趟合并本身省不下多少（数组是热的，重扫不额外读内存），真正收益仍来自让每一趟都能跳；`bytesToBase64DataUrl`（1.73%）的 `+=` rope 可改为收集 chunk 后一次 join；GC 12.76% 仍是症状。

## Round 101/100 — 2026-10-08
- 承接 Round 100：**重新剖析把目标换掉了**。40 轮 `node --cpu-prof`（未压缩构建）剔除沙箱噪声后，Round 97–99 的四个目标（图片 / WordArt / shapes / equations）**全部跌到 0.1% 以下**——库内真的变快了，它们不再是热点。库内最大项变成文本抽取：`extractTextFromRange` **17.18%**、`extractTextWithFib` **10.55%**、`splitPiecesByStory` **5.10%**；`(garbage collector)` **57.97%**。GC 是**症状**：`extractTextFromRange` 逐字符 `text += …`，每追加一字符产生一个 ConsString（rope），140 次真实调用要追加 161 万个字符。
- **沙箱噪声占比会随库变快而上升**：`tryBrokerFileTokenSync @ node-brokered-fs-shim.cjs` 在 Round 97/98/99 占 33–40.7%，本轮升到 **47.5%（40 轮）/ 73.4%（10 轮）**。不是 shim 变慢，是分母变小。10 轮时 shim 占 73.4%，库内任何函数都看不见——**必须跑够 40 轮才能读出真实分布**。
- **真实调用分布（插桩实测，27 份样本全部解析成功）**：140 次调用 / 2.29 MB。压缩分支 78 次 / 894 969 B（37.3%，p50 2138、p90 17408、max 439685）；非压缩分支 62 次 / 1 502 134 B（62.7%，p50 512、p90 5318、max 1215380）。**77.0% 的字节集中在 3 次 ≥64 KB 的调用里**；<256 B 只占 0.1%。两个分支都值得改。`guardBinary=true` 的真实调用数：**0 次**（所有内部调用点都传 `false`，公开默认值只被 `docParser.test.ts` 覆盖）。
- **合成基准会得出与真实负载相反的结论**：整段解码在合成基准里 64 字节小片段只 **0.95x**（`Uint16Array` 分配盖过收益），照这个数就会判「不值得改」；而真实 p50 是 2138 / 512，近八成字节在 3 次大调用里。**尺寸分布必须实测。**
- 改动（`src/utils/docparser/clxReader.ts`）：新增 `COMPRESSED_CODES`（256 项 `Int32Array`）/ `LOW_CODES`（32 项）/ `CODES_CHUNK = 0x8000` / `codesToString` / `decodeRangeWithoutGuard`；`extractTextFromRange` 增加 `if (!guardBinary) return decodeRangeWithoutGuard(...)` 早返回，**原实现一字未动**。快路径把结果先写进 `Uint16Array` 码元缓冲，再分块 `String.fromCharCode.apply` 一次转字符串，中间不产生 rope。
- **两张表由原 if 链逐项、按同样顺序推导，有两处必须小心**：① **顺序** —— `0xA0`/`0xAD`/`0x1E` 在原链里排在 `byte >= 0x80` **之前**，永远不会走到 `HIGH_BYTE_MAP` 查表；表里先写这三个，后面 `for (b=0x80..0xff)` 的循环覆盖不到它们（`HIGH_BYTE_MAP` 在 0xA0–0xFF 区间全是 `null`，落到 `else if (b >= 0xa0) t[b] = b`，值与显式赋值相同）。② **非压缩分支的低码元** —— 原链在 `0x0a`/`0x00` 上 `continue`，其余 `< 0x20` 交给 `isValidPrintableChar`，而它第一行就是 `if (charCode < 0x20) return false`，所以「< 0x20 且不在表里」等价于「跳过」，`LOW_CODES` 用 `-1` 表示即可。
- **护栏路径不能一起改**：二进制签名护栏要**按字符增量地**检查累积文本、并在命中处按最后一个换行截断，与「先攒码元、后转字符串」不相容。快路径只在 `guardBinary === false` 时启用。
- **实测（真实区间回放，独立进程）**：先把 140 次真实调用区间落盘，再用 `MODE=old|new` 在**独立进程**各自回放（Round 100 的教训：同进程跑多版本会被 JIT 污染）。旧 **17.57 / 17.09 ms**，新 **6.79 / 6.46 ms** → **2.59x**（中位）/ **2.65x**（最小）。第二次独立测量 17.75 → 6.90（**2.57x**），一致。
- **分组明细**（最小耗时）：压缩 <4 KB（48 次 / 59 135 B）0.17 → 0.16（1.06x）；压缩 ≥4 KB（30 次 / 835 834 B）4.60 → 2.82（**1.63x**）；非压缩 <4 KB（55 次 / 27 674 B）0.06 → 0.06（1.00x）；非压缩 ≥4 KB（7 次 / 1 474 460 B）10.67 → 3.14（**3.40x**）。小片段第一轮 0.94x、第二轮 1.06x，**在计时精度内** —— 合成基准的 0.95x 在真实 p50 上不复现，故**未观察到退化**，没有为它引入共享 scratch 缓冲（那是模块级可变状态，收益 0.01 ms，不值得）。
- **等价性证据（五重）**：① **穷尽比对** —— 压缩分支 256 个字节值、非压缩分支 65 536 个码元**完整枚举**（单独出现 + 顺序/逆序/三连/前垫 ASCII + 全部依次 + 后垫可打印 + 各 500 组随机子区间），比抽样差分强；② 真实语料差分（27 份整文件 + 8 等分区间，两分支各跑，断言比对字节 > 5 MB）；③ **回放差分** —— 140 次真实调用区间 / 1.61 M 字符逐字节一致（`cmp` 两份 JSON）；④ **阴性对照 ×5 + 等价对照 ×4**；⑤ **端到端逐位一致** —— 27 份样本 `parse()` 的完整文本（**1 636 452 字符**）在 HEAD 与改动后 `cmp` **逐字节相同**，覆盖从 OLE 容器、FIB、CLX/Piece Table、`extractTextWithFib`、段落装配到最终文本的整条链；`node bench-diff.mjs 1010` 与改动前 `cycle-990` 报告**除 `cycle`/`timestamp` 外全部字段逐位相同**（`median` 0.950243、`p10` 0.896816、`p25` 0.915450、`min` 0.811547、`max` 0.999926，以及 `topIssues` 与 `failures` 的完整列表；该脚本比的是与 macOS `textutil` 基准的相似度，不是字节相等）。
- **阴性对照表（对照由脚本从当前源码生成，每处只改一行，生成时断言 needle 恰好命中一次，避免「改了但没改到」的假对照）**：A 压缩表漏掉 `0x1e → 0x2011` ✓**247 处**、B 低码元表把 `0x0a` 映射成 `0x0a` ✓**77 处**、C 非压缩上界 `end-1 → end` ✓**116 处**、D 分块末块上界 `n → n-1` ✓**79 处**、F 压缩上界 `end → end-1` ✓**508 处**；E 多分配一个码元 ✓0 处、G 分块 `0x8000 → 0x4000` ✓0 处、H 两条判定合成三元式 ✓0 处、I 按位或改加法 ✓0 处。**9 个对照全部符合预期，生产实现 vs oracle 差异 0 处 —— 差分判定有鉴别力。**
- **转写的忠实性（本轮新增的一步）**：为了让穷尽护栏**常驻**而不必在 `src/` 留一份旧实现副本，测试里的参照实现 `referenceDecode` 是改动前函数的逐行转写。转写后用一次性脚本把它与 `git show HEAD:` 导出的**逐字原件**在 **67 878 次比对**上对照 → **0 处差异**，确认后才删除原件。`referenceDecode` 从生产模块借用 `HIGH_BYTE_MAP`/`isValidPrintableChar`/`containsBinarySignature`/`SIGNATURE_CHECK_INTERVAL` 四个**本轮未改动**且各有独立测试的纯函数，独立重述的是**控制流**（本轮改动的部分）；这个作用域边界写进了测试注释。
- 新增常驻护栏：`tests/clxReader.fastDecode.test.ts`（新建，**13 项**）—— 穷尽比对、`guardBinary=true` 一致性（含两处触发护栏截断的样本）、越界与空区间、`HIGH_BYTE_MAP` 每项都是单个 UTF-16 码元（快路径用 `charCodeAt(0)` 取值，多字符项会**静默丢数据**）、真实语料差分、4 MB 复杂度护栏、分块边界（`0x7ffe/0x7fff/0x8000/0x8001/0x10000/0x18000`）。
- 验证：`npx vue-tsc -p tsconfig.json --noEmit` 0 错误；`npm run lint` 干净；`npm run build` / `npm run build:lib` 通过；`npm test` **64 文件 / 1380 项**通过（较 Round 100 的 63/1367 **+1 文件 +13 项**）；`node bench-diff.mjs 1010` 除 `cycle`/`timestamp` 外全部字段与改动前逐位相同；定向测试（`clxReader.fastDecode` + `docParser` + `clxParser`）139 项通过。
- 指标：主包 gzip 109.01 → **109.31 kB（+0.30 kB，raw +0.92 kB）**。增量来自两张查表的构造（256 + 32 项 `Int32Array`）、`codesToString` 与快路径；原来的 if 链被保留在护栏路径里**没有删掉**，所以这部分是净增。这个代价是明的：+0.30 kB 换真实负载 2.59x。
- 清理的临时产物：`src/utils/docparser/_oldClxReader.ts`、`src/utils/docparser/_nc{a,b,c,d,e,f,g,h,i}.ts`、`.nc101.ts`、`.nc101.manifest.json`、`.verify101.ts`、`.cap101.ts`、`.e2e101.ts`、`.replay101.ts`、`.bench101.ts`、`.probe101.ts`、`.prof101.ts`、`.profan101.mjs`、`.prof101/`、`.prof-lib/`。
- 发布：版本 `0.7.44 → 0.7.45`，双包已发布（registry 核验两包 `latest = 0.7.45`；同时确认 Round 100 的 `0.7.44` 已传播，此前那次核验显示 `latest = 0.7.43` 是延迟）。
- 下一轮：`extractTextWithFib`（10.55%，`src/utils/docParser.ts:404`，是 `extractTextFromRange` 的调用方，本轮只让它调用的东西变快了，它自身的开销还没看）；`splitPiecesByStory`（5.10%，`src/utils/docparser/storySplitter.ts:66`）；`bytesToBase64DataUrl`（`src/utils/imageExtractor.ts:347` 的 `binary += String.fromCharCode.apply(...)` 可用同一套「收集 chunk 后一次 join」）；GC 57.97% 仍是症状，本轮拿掉一个大来源后需重新剖析；OLE 层 `readRegularStream`（2.18%）、`getFatSectors`（0.80%）、`readStream`（0.58%）。

## Round 102/100 — 2026-10-08
- 承接 Round 101：交付时列的下一轮目标是 `extractTextWithFib`（10.55%）与 `splitPiecesByStory`（5.10%），但那是**旧剖析**的读数。重新剖析（200 轮、`--cpu-prof-interval=100`、缓冲区预加载、计时只覆盖解析循环）后库内分布完全变了：`codesToString` **40.0%**、`decodeRangeWithoutGuard` **33.9%**、`readRegularStream` 9.7%、GC 5.3%、`extractTextFromRange` 5.1%、`readStream` 1.7%、`extractTextWithFib` **1.4%**、`getFatSectors` 1.0%。**Round 101 的计划被新读数推翻**——真正的大头是 Round 101 自己引入的那两步。
- **剖析口径的更正**：Round 101 报的「`extractTextFromRange` 17.18%」是占**整个进程**的比例，而进程里 39.5% 是沙箱 `tryBrokerFileTokenSync @ node-brokered-fs-shim.cjs`（12 MB 语料的文件读取）。把读取放到计时之外、轮数拉到 200 轮之后才读得出上表。**百分比的分母必须写清楚**，否则跨轮比较会误导。
- **先量清楚 `codesToString` 贵在哪**（用 Round 101 采集的真实区间 140 段 / 1.61 M 码元先跑出真实 `Uint16Array` 缓冲，再让各策略在同一批缓冲上竞争）：`apply` 分块 0x8000（现状）3.67 ms；0x4000 3.66 ms（1.00x）；0x2000 2.99 ms（**1.23x**）；0x1000 3.00 ms（1.22x）；展开运算符 `String.fromCharCode(...)` 分块 0x1000 **22.00 ms（0.17x）**；**`TextDecoder('utf-16le')` 读同一块内存的字节视图 1.22 ms（3.01x）**。调分块只能拿 1.23x；展开运算符反而慢 6 倍（要先把 typed array 摊成参数列表）。
- **整体（解码循环 + 转字符串）对比**：A 现状 `Uint16Array`+分块 `apply` 6.48 ms；**A′ `Uint16Array`+`TextDecoder` 3.89 ms（1.67x）**；B 直接写 `Uint8Array`（显式 UTF-16LE 字节）+`TextDecoder` 4.12 ms（1.57x）。选 A′：保留单次存储的解码循环，只换转换方式；B 每码元多一次存储慢 5.9%，而 A′ 用启动时算一次的 `LITTLE_ENDIAN` + 就地翻字节序（4 行）达到同样的字节序无关性，更划算。
- 改动（`src/utils/docparser/clxReader.ts`）：`const TEXT_DECODER = new TextDecoder('utf-16le', { ignoreBOM: true })`；`const LITTLE_ENDIAN = new Uint8Array(new Uint16Array([0x0100]).buffer)[0] === 0x00`；`decodeRangeWithoutGuard` 结尾改为 `if (k === 0) return ''` + `/* v8 ignore */` 大端翻字节序 + `TEXT_DECODER.decode(new Uint8Array(codes.buffer, 0, k * 2))`。**`codesToString` 与 `CODES_CHUNK`（16 行）整段删除**，本文件不再有任何 `String.fromCharCode.apply`，净行数 -12。
- **坑一（实测抓出，不是我预想到的）**：`TextDecoder` 默认会把**开头的** U+FEFF 当 BOM 吃掉。第一版直接 `new TextDecoder('utf-16le')`，穷尽测试立刻红：`AssertionError: charCode=0xfeff 不一致: ref="\uFEFF" new=""`。`"\uFEFF"` → `""`、`"\uFEFFA"` → `"A"`（只有开头那一个被吃掉，中间的原样保留）；而 `isValidPrintableChar(0xFEFF)` 返回 true（`0xFEFF & 0xFFFE` = `0xFEFE` ≠ `0xFFFE`），所以 U+FEFF 完全可能出现在真实文本里。加 `{ ignoreBOM: true }` 后逐字等价。**这是 Round 101 那条穷尽护栏第一次真正发挥作用**——抽样差分大概率抽不到 0xFEFF。
- **坑二：我自己写的第一版断言是空的**。护栏原为「整个输入空间产出的码元里没有代理项」（因为 `TextDecoder` 会把孤立代理项换成 U+FFFD）。阴性对照 D（往 `LOW_CODES` 塞 `0xD800`）结果：差分报 **82 处差异**，而**域断言一个都没触发**——因为断言从**快路径的输出**收集码元，而输出已被 `TextDecoder` 净化，代理项早变成 U+FFFD。这是 Round 100「差分测试空转陷阱」的另一种形态：**断言的对象必须是没有被待测变换处理过的值**。改法：从**参照实现**（`referenceDecode`，用 `String.fromCharCode`）收集。改完对照 G（放行 `isValidPrintableChar` 的代理项分支）报 **2330 处差异 + 2048 个代理项**，断言正常触发。
- **职责划分（顺带厘清）**：域断言覆盖两个实现**共用**的纯函数（`HIGH_BYTE_MAP` / `isValidPrintableChar`）；快路径**私有**的两张表由穷尽差分覆盖——代理项一旦进入快路径，`TextDecoder` 会把它变成 U+FFFD 而参照实现不会，必然产生差异（对照 D 实测 82 处）。两条合起来才完整。
- **实测（端到端，27 份 / 12 MB 语料，独立进程，120 轮最小耗时）**：Round 101 `8.04 / 8.22 / 8.07 ms` → Round 102 **`5.40 / 5.67 / 5.68 ms`**，**1.45x**（中位同为 1.45x）。
- **顺带量出的更重要的数字：Round 101 的真实收益是 3.03x**。用同一份语料、独立进程、`git checkout` 到上一轮源码分别打包对比：Round 100（逐字符 `+=`）中位 **25.13 ms** → Round 101（码元缓冲 + 分块 `apply`）**8.30 ms**，**3.03x**。**函数级的隔离回放（2.59x）低估了端到端收益**——旧的 `+=` 每次调用产生上万个 ConsString，GC 成本摊到整条解析链上，而隔离回放把这部分算在了「函数之外」。**隔离基准给的是函数的上界/下界，不是端到端。**
- **等价性证据（五重）**：① 穷尽差分（常驻护栏，本轮 13 → 15 项）；② 域断言 + BOM 定点断言（新增 2 项）；③ **端到端逐位一致** —— 27 份样本 `parse()` 完整文本（**1 636 452 字符**）在 `git stash` 前后逐字节相同；④ 阴性对照 ×7；⑤ 定向测试 142 项通过。
- **阴性对照表**：A 去掉 `{ ignoreBOM: true }` ✓**1 处**；B `LITTLE_ENDIAN` 强制 `false`（小端机上翻字节序）✓**64 137 处**；C 字节视图长度 `k*2 → k*2-2` ✓**64 384 处**；D 私有表塞代理项 `0xD800` ✓**82 处**；E 先建全长视图再 `subarray` ✓0 处；F 去掉 `k===0` 早返回 ✓0 处；G 共用 `isValidPrintableChar` 放行代理项 ✓**2330 处 + 2048 个代理项**。**对照 B 值得单独说：它证明字节序判定是承重的**——若 `LITTLE_ENDIAN` 写反或恒为 `false`，小端机上每个码元的两个字节会被翻过来。这条分支在真实平台上是 `/* v8 ignore */` 的，靠这条对照才有证据。
- 验证：`vue-tsc --noEmit` 0 错误；`lint` 干净；`build` / `build:lib` 通过；`npm test` **64 文件 / 1382 项**通过（较 Round 101 的 64/1380 **+2 项**）；`node bench-diff.mjs 1020` 与改动前 `cycle-1010` **除 `cycle`/`timestamp` 外全部字段逐位相同**。
- 指标：主包 gzip 109.31 → **109.32 kB**（raw 317.31 → **317.29 kB**）—— 删掉 16 行换 `TextDecoder` 构造 + `LITTLE_ENDIAN` 判定 + 一个字节视图，**基本持平**（gzip +0.01 kB 在四舍五入噪声内，raw -0.02 kB）。这一轮是纯赚。解析阶段 **1.45x**，`codesToString` 那一档（40% 的解析时间）基本消失。
- 清理的临时产物：`.prof102.ts`、`.prof102/`、`.profan102.mjs`、`.corpus102.ts`、`.bench102.ts`、`.bench102b.ts`、`.e2e102.ts`、`.nc102.ts`、`.nc102.manifest.json`、`src/utils/docparser/_nc2{a,b,c,d,e,f,g}.ts`。
- 发布：版本 `0.7.45 → 0.7.46`，双包已发布（registry 核验 `@zhenghy/doc-preview` 已到 `0.7.46`；`doc-preview` 仍在传播，与历轮同样的延迟现象）。
- 下一轮：**`decodeRangeWithoutGuard`（33.9%）** 现在是解析阶段最大单项——① 非压缩分支每码元调一次 `isValidPrintableChar`（6 个比较），能否用紧凑的「无效区间」判定替掉而不改语义；② `codes[k++] = c` 与 `data[i] | (data[i+1] << 8)` 的访存模式。**OLE 层**（`readRegularStream` 9.7% + `readStream` 1.7% + `getFatSectors` 1.0%）本轮首次进入视野。`bytesToBase64DataUrl`（`src/utils/imageExtractor.ts:347`）的 `binary += String.fromCharCode.apply(...)` 可用同一套手法。`extractTextWithFib`（1.4%）/ `splitPiecesByStory`（0.16%）**本轮量过，不值得动**。大端分支当前只有对照 B 证明它承重。

## Round 103/100 — 2026-10-08
- 本轮分两段，结论一负一正。**第一段（把 `decodeRangeWithoutGuard` 换成「原生解码 + 原生正则过滤」）在函数级赢了 1.47x，端到端却慢 7 %，被回退**；**第二段（三处重复的 base64 实现去重）端到端稳定快 2.2 %，被采纳**。第一段的失败比成功更有价值——它给出了「隔离基准会在什么情况下系统性高估收益」的一个具体反例，而且是二分实测定位的。
- **起因：重新剖析（200 轮，口径同 Round 102）**：样本总时长 2578.6 ms，其中沙箱 shim `tryBrokerFileTokenSync` 占 **49.05 %**。扣掉它、**以解析阶段为分母**：`decodeRangeWithoutGuard`（JS 循环）**47.7 %**、`decode @ (native)` **17.5 %**、`readRegularStream` 12.8 %、`decode @ encoding` 3.3 %、`readStream` 2.6 %、`extractTextWithFib` 2.5 %、GC 2.2 %、`getFatSectors` 1.7 %。解码相关合计 **65.2 %**，是绝对大头；Round 102 列为「首次进入视野」的 OLE 层合计 17.1 %。**百分比的分母必须写清楚**这条纪律再一次生效。
- **第一段第 1 轮（判定 / 分配 / 访存分开量）**：V0 现状 3.86 ms；V2 内联判定 **3.49 ms（1.11x）**；V1 复用 scratch + 分块 decode 3.86 ms（**1.00x，完全没用**——每次分配 `Uint16Array(n)` 在当前 V8 上基本免费，大对象直接进老生代）；V4 64 KB 有效性查表 3.60 ms（**比内联判定慢**，缓存代价超过省下的比较）。转向访存：`Uint16Array` 零拷贝视图 **1.02x（完全没用）**，`data[i] | (data[i+1] << 8)` 已被 V8 优化得和单次 16 位访存差不多；V5i / V5L / V7 都在 1.09x 附近、**互相在噪声内**（轮间噪声约 9 %，做了三次重复）。V7（两遍、干净则零拷贝）被数据否掉：**只有 0.5 % 的码元**（3 388 / 751 067）能走零拷贝分支——Word 文本里 CR 到处都是，而 CR 要映射成 LF，「干净区间」几乎不存在。**判定、分配、访存三条路都到头了，合计约 1.1x。**
- **第一段第 2 轮（换掉循环本身）**：非压缩分支的输入本来就是 UTF-16LE 字节，那层循环只做「丢弃 + 两处映射」，交给 `TextDecoder('utf-16le')` + 一条字符类正则（Irregexp）。丢弃集合与映射表**穷尽枚举 65536 个码元**从 `isValidPrintableChar` / `LOW_CODES` 推导，不手写。R2（`fatal: true`）**2.91 ms（1.33x）差异 0 处**；R1（非 fatal）2.96 ms 但 **5 处差异**——`TextDecoder` 默认把**孤立代理项**换成 U+FFFD 而参照实现是**丢弃**它，且源里真存在 U+FFFD 时参照会保留（`isValidPrintableChar(0xFFFD)` 为 true），所以「丢掉所有 U+FFFD」这种蒙混写法也不成立，**必须 `fatal: true`**。分支拆分：压缩 78 job 1.72 ms（未改）；非压缩 62 job 2.00 → 1.08 ms（**1.86x**）；合计 3.72 → 2.80（**1.33x**）。收尾 R2 2.69 ms（**1.47x**）。
- **第一段第 3 轮（一个被证伪的方向）**：`HIGH_BYTE_MAP` 的 0x80–0x9F 段**逐项等于 CP1252**（含 0x81/0x8D/0x8F/0x90/0x9D 五个未定义位），0xA0–0xFF 等于 Latin-1，即压缩分支的映射**就是** `TextDecoder('windows-1252')`（穷尽 256 字节验证 0 处不符，且 CP1252 是单射的：256 → 256 个互不相同码点，0 处碰撞）。**但基准把它否了**：压缩分支 1.56 → 3.47 ms（**0.45x，慢 2.2 倍**）。原因不神秘——它的循环是**一次 `Int32Array` 查表 + 一次存储**，每字节成本极低，而「单字节解码 + 三次正则扫描」每字节成本明显更高。**逐字节查表已接近最优形态。**
- **第一段顺带挖出的 `TextDecoder` 第四个陷阱：`ignoreBOM` 对单字节编码是反的**。穷尽自校验报出 1 处不符、映射表冒出一个没预料到的 `0x0→0xFF`，追下去发现 `new TextDecoder('windows-1252', { ignoreBOM: true })` **会吞掉开头的一个 0xFF 字节**：`[0xff]=""`、`[0xff,0x41]="A"`、`[0xff,0xfe,0x41,0x00]="þA\0"`；不传反而正常。而 `utf-16le` 恰恰相反（必须传 `ignoreBOM: true` 才保留开头的 U+FEFF）。**同一个标志在两种编码家族下的正确取值是相反的，Round 102 的结论不能外推。** 0xFF 在压缩分支里是合法且有意义的字节（Latin-1 回退 → U+00FF），所以那个被否掉的设计里必须用默认值。
- **第一段第 4 轮（差点写错的一条）**：`fatal: true` 保证输入里没有**孤立**代理项，于是想删掉字符类里的代理项区间（`\ud800-\udfff`，2048 个码点，占整个类的 **96 %**），删后类只剩 92 个码点且基准里**没有变慢**（1.46x vs 1.47x，噪声内）。**这个想法是错的**：参照实现对代理项是**一律丢弃**——`isValidPrintableChar` 对 0xD800–0xDFFF 返回 false，所以**合法代理对的两个码元也会被分别丢掉**；而 `TextDecoder` 会把合法代理对**合成一个星光平面字符**，删掉区间后它不在 BMP 字符类里就会原样漏出（`D83D DE00` 从 `""` 变 `"😀"`，`41 D83D DE00 42` 从 `"AB"` 变 `"A😀B"`）。保留区间后正则（**不带 `u` 标志**）会分别命中星光平面字符的两个码元、两个都丢掉，与参照一致。**这条不是被基准抓出来的**（语料里没有合法代理对，正确性检查覆盖不到星光平面字符），是被「把参照实现的语义重新想一遍」抓出来的。
- **第一段第 5 轮：端到端实测——结论反转**。27 份样本 / 7.6 MB，独立进程，150 轮取最小：**NEW min 175.82 / p50 179.76 vs OLD min 165.16 / p50 172.02**，完整文本 1 491 456 字符逐字节相同，但**端到端 −7 %**。三次重复、六个独立进程都复现（OLD 157.19/167.60/162.91，NEW 174.43/174.27/171.68）。
- **二分定位（`.bisect103.mjs`）**：先剖析按函数名聚合自耗时差——**慢的不是解码函数**（`decodeRangeWithoutGuard` −152.8 ms），而是下游 `extractFormattedText` **+433.8** 与 `createParagraphsWithRealFormats` **+308.1**（合计 +742 ms），是「数据形状变了、连带下游一起变慢」的形状。于是把新路径拆成「解码调用」与「三次正则替换」两半实测：**M2（跳过三次替换，结果错误只测代价）152.78 / M4（只解码不替换）150.95 —— 比 OLD 还快 12 ms**，说明「原生解码整段」本身是赢的；**NEW / M1（非 fatal）/ M3（`subarray` 视图）比 OLD 慢 10 ms**，加回三次 `String.replace` 就翻盘。所以**三次替换约 23 ms/轮，而它替掉的 JS 循环只值约 12 ms/轮**。M5（单趟合并正则 + 回调，只分配一次）**只是打平 OLD**（167.22 vs 165.16），M6 更差。
- **机制与可复用的结论**：`String.prototype.replace` 是「命中就复制整串」的操作，而 .doc 文本里 CR（段落标记）几乎必然存在，所以每段都要复制一份几乎同样大的新字符串；旧循环是「每码元一次判断 + 一次写」，在 11 KB 这种尺度上常数因子更小。**这是 Round 102 那条结论的镜像，而且更强**：Round 102 说「隔离基准给的是函数的上界/下界，不是端到端」；Round 103 说 **「当函数的分配量与数据规模成正比时，隔离基准会系统性高估收益」**——因为它取的是同一批热数据上的最小耗时，而端到端里每段只跑一次、产出的字符串还会被下游长期持有。
- **第一段收尾**：`git checkout -- src/utils/docparser/clxReader.ts tests/clxReader.fastDecode.test.ts`。所有基准、对照、剖析结论保留在 changelog 里作为「这条路走不通」的证据。阴性对照 **11/11 符合预期**（8 个故意改错全被抓出，3 个等价改写全判等价）——**护栏是活的，但护栏活并不等于优化值得采纳**，这是本轮最值得记的一条。
- **第二段：base64 去重（采纳）**。第一段回退后端到端剖析的自耗时榜给出下一个目标：`bytesToBase64DataUrl` **606.7 ms / 3.67 %**（Round 101 的 changelog 就点名过的候选），而且它**有三份副本**且**已经漂移**——`imageExtractor.ts:347` 与 `headerFooterParser.ts:47` 是 `binary += String.fromCharCode.apply(null, slice as number[])`，而 `pictureParser.ts:527` 多了一层 `Array.from`。
- **第二段候选对比（2 KB / 20 KB / 100 KB / 500 KB / 2 MB，合计 2.6 MB）**：现状 0x8000 `+=` 7.71 ms；**`Array.from` 0x8000 `+=`（pictureParser 现状）36.67 ms → 0.21x**；0x1000 `+=` 5.97（1.29x）；**0x2000 `+=` 6.02 ms（1.28x）**；0x4000 `+=` 8.17（0.94x）；0x2000 `join` 5.98（1.29x）；`Buffer` 0.31 ms（25.02x，浏览器不可用）。三条结论：① **分块 0x2000 是关键**，0x4000 及以上反而更慢——`Function.prototype.apply` 的实参个数有上限，超过后 V8 走慢路径（Round 102 在 `String.fromCharCode.apply` 上量到同一现象）；② **`join` 与逐步 `+=` 无差异**（6.02 vs 5.98），保留更简单的写法；③ **`Array.from(slice)` 慢 4.8 倍**，`apply` 接受类数组对象，`Uint8Array` 本身就够了。
- **第二段两个被证伪的方向**：① `TextDecoder('latin1')`——WHATWG 里 `latin1` 与 `iso-8859-1` **都是 `windows-1252` 的别名**，字节 0x80–0x9F 会解成 U+20AC 这类 > 0xFF 的码点，`btoa` 直接抛 `InvalidCharacterError`，规范里**没有**「真 Latin-1」解码器，第一版候选一跑就红；② 纯 JS base64 查表 **0.21x**，`btoa` 是原生的，不要自己写。
- **第二段改动**：新增 `src/utils/binaryReader.ts` 的 `bytesToBase64`（放进这个模块的理由与它原有的四个原语相同——那个模块的存在本身就是「11 个解析器各存一份 `readUint16`」的去重结果）：`CHUNK = 0x2000`，短输入走 `btoa(String.fromCharCode.apply(null, bytes as unknown as number[]))`，长输入按块 `parts.push(...)` 后 `btoa(parts.join(''))`。三处调用点改为调用它：`imageExtractor.bytesToBase64DataUrl`（只剩加 `data:` 前缀，10 行缩成 2 行）、`pictureParser.picturesToDataUrls`（整个循环体删掉）、`headerFooterParser.pictureToHeaderFooterImage`（删掉 `binary` 变量与 8 行循环）。**净 +17 行（−39 +56），三个副本变一个。**
- **第二段实测（端到端，27 份 / 7.6 MB，独立进程，150 轮取最小，三次重复）**：min OLD `166.98 / 167.50 / 167.18` → NEW `163.33 / 164.05 / 163.44`，**1.023x**；p50 OLD `170.15 / 171.03 / 170.29` → NEW `168.02 / 167.76 / 170.11`，1.013x。
- **第二段等价性证据**：① 新增常驻护栏 `tests/binaryReader.base64.test.ts`（**10 项**）—— 全部 256 个单字节值、全部 65 536 个双字节组合、空输入、分块边界（`0x1ffe/0x1fff/0x2000/0x2001/0x2002/0x3fff/0x4000/0x4001/0x5fff/0x6000/0x6001`）、长度 mod 3 的三种余数 × 跨块位置、**每个字节值都跨过 0x2000 分块边界**、1 MB 输入线性、mime 前缀映射；参照实现是改动前 `bytesToBase64DataUrl` 的**逐行转写**（`chunkSize = 0x8000` + `binary += apply`），另有最朴素的逐字节拼接作为第二参照。② 集成层护栏：`picturesToDataUrls` 输出与参照逐字一致；真实语料图片字节区间直接比 base64 文本，比对字节数 > 5 MB。③ **端到端逐位一致**：27 份样本完整文本 **1 491 456 字符** `cmp` 逐字节相同；另落一份**整棵解析结果**的 sha256 `bc0dfd81e52038ae7545455f71f8a67b0e27e0e5f1c62a40304aeb5fc85f2e26`（把每个图片 data URL 的完整内容都算进去——段落文本覆盖不到图片的 base64，这一层是必需的），同进程复算两遍确认确定性。
- **第二段阴性对照表（对照由脚本从当前源码生成，每处只改一行，生成时断言 needle 恰好命中一次）**：A `join` 分隔符改成逗号 ✓失败、B `push` 改成 `unshift`（块顺序反了）✓失败、C `subarray` 起点错位一个字节 ✓失败、D 循环步长多走一个字节 ✓失败、E 短输入快路径少传一个字节 ✓失败、F `data:` URL 少一个字节 ✓失败；G 阈值 `0x2000 → 0x1fff` ✓等价、H 去掉 `Math.min`（`subarray` 自己会夹取）✓等价、I `CHUNK 0x2000 → 0x8000` ✓等价。**9 个全部符合预期。** 这一轮的对照设计有个特殊之处：**分块大小只影响性能、不影响结果**（块是顺序拼接的），真正承重的只有**拼接顺序、拼接分隔符、`subarray` 边界**三处——换句话说这条护栏保护的是「边界与顺序」，**不保护「分块尺寸」**，尺寸选错只会变慢，而变慢在测试里是不可见的，只能靠基准。
- 验证：`npx vue-tsc --noEmit` 0 错误；`npm run lint` 干净；`npm run build` / `npm run build:lib` 通过；`npm test` **65 文件 / 1392 项**通过（较 Round 102 的 64/1382 **+1 文件 +10 项**）；`node bench-diff.mjs 1030` 与 `cycle-1020` **除 `cycle`/`timestamp` 外全部字段逐位相同**（`median` 0.9502433994244857、`p10` 0.8968160758834334、`p25` 0.9154504595379104、`min` 0.8115474418758475、`max` 0.9999259480622746，`topIssues` 与 `failures` 完整列表也逐条相同）。
- 指标：主包 raw 317.29 → **317.25 kB**、gzip 109.32 → **109.31 kB**（净 +17 行换来体积基本持平——重复代码本身的体积与一份带分支的实现相当）；库产物 `dist-lib/doc-preview.js` 350.55 kB / gzip 94.22 kB。运行时收益在 base64 编码那 3.67 % 上（**1.28x**）。
- 清理的临时产物：`.bench103.ts`、`.bench103b.ts`、`.bench103c.ts`、`.bench103d.ts`、`.bench103e.ts`、`.bench103f.ts`、`.bisect103.mjs`、`.e2e103.ts`、`.neg103.mjs`、`.neg103b.mjs`、`.prof103.ts`、`.prof103/`、`.profan103.mjs`、`.profdiff103.mjs`（14 项）。`.profdiff103.mjs` 的第一版把 bundle 文件名也当成聚合键，导致前 25 名全是噪声——**按函数名聚合时不要带上 url**。
- 发布：版本 `0.7.46 → 0.7.47`，双包已发布。
- 下一轮：**`extractImagesFromStream`（7.17 %）** —— 图片扫描（找 JPEG 结尾、PNG 边界），本轮只动了它下游的 base64 编码；**OLE 层**（`readRegularStream` 12.8 % + `readStream` 2.6 % + `getFatSectors` 1.7 %，合计 **17.1 %**）本轮首次拿到干净占比，是除解码外最大的一块；**段落与格式装配层**（`detectCharacterStyles` 8.53 % / `createParagraphsWithRealFormats` 10.45 % / `guessCharFormat` 6.86 % / `applyStructuralFormats` 6.85 %）本轮首次拿到端到端占比（之前的剖析口径太窄，看不到它们）。**已被证伪、不要再动**：`decodeRangeWithoutGuard` 换「原生解码 + 原生正则过滤」（函数级 1.47x，端到端 −7 %）、压缩分支换 `windows-1252`（0.45x）、去掉字符类里的代理项区间（语义错误）、`TextDecoder('latin1')`（别名是 windows-1252）、纯 JS base64 查表（0.21x）、`Array.from(slice)`（0.21x）、解码循环的判定/分配/访存三处微优化（约 1.1x）、`extractTextWithFib`（2.5 %）、`splitPiecesByStory`、`extractChartsFromWordDocumentStream`。

## Round 104/100 — 2026-10-09
- 目标**转移**：重新用真实入口 `parseWithFormat()` 剖析后，OLE 层 `readRegularStream` 只占 **1.16 %**（不值得动），真正的热点落在段落 / 格式装配层；`shouldHaveUnderline` 在**每个数字字符**上调用（真实语料 158 937 次/轮），原写法每次 2 次 `substring` + 最多 5 次正则，自耗时（正则 3.89 % + 函数 1.09 %）合计约 **5 %** 端到端。
- 三处等价化简：① `DATE_TIME_RE`（`/[0-9]{2,4}[年月日时分秒]/`）**可证明冗余** —— 匹配成功必含日期单位字符，故 `hasColonBefore || hasDatePattern || hasTimePattern` ≡ `hasColonBefore || hasDatePattern`；② 冒号判定「回扫跳过空白看落点」与 `/[：:]\s*$/` 等价（`isWhitespaceCode` 覆盖 = JS `\s`）；③ 零分配码点扫描 + 每段落一次日期单位位置表 + O(log n) 二分查询，`detectCharacterStyles` 懒加载一次透传。
- 隔离基准（77 800 次调用，`true=115` 四个变体逐字节一致）：v0 10.12 ms → v1(零分配) 6.11 → v2(删冗余正则) 5.96 → **v3 2.24 ms（4.51x）**。
- 端到端（27 份 / 7.6 MB，独立进程，120 轮最小，`git stash` 切换源码分别打包）：OLD 147.38 ms → NEW 133.79 ms（**1.10x**）。隔离 4.51x 折算端到端 1.10x，符合「shouldHaveUnderline 只占 ~5 % 端到端」的预期。
- 护栏 bug 修复（非实现 bug）：第一版穷尽枚举用 24 字符 `ALPHA` 在第四层 `stack.push(...next)` 一次性 spread ~33 万串 → `RangeError: Maximum call stack size exceeded`（3 用例挂、4 通过）。改递归生成器 `forAllStrings`（生成时内部直接断言，深度=最大长度）并把 `ALPHA` 缩为类别代表 8 字符 → **7/7 全绿**。
- 验证：`vue-tsc --noEmit` 0 错误；`lint` 0 错误；`build`/`build:lib` 通过；定向护栏 7/7；`npm test` **66 文件 / 1399 项**通过（较 103 的 65/1392 **+1 文件 +7 项**）；`node bench-diff.mjs 1040` 与 `cycle-1030` **除 `cycle`/`timestamp` 外全部字段逐位相同**（27/27 解析成功，13 失败样本完全一致，零新增回归）。
- 指标：隔离 `shouldHaveUnderline` **4.51x**、端到端解析 **1.10x**；bundle 体积基本持平（主包 raw 317.25 → 317.61 kB、gzip 109.31 → 109.42 kB，噪声内）。
- 清理的临时产物：`.bench104.ts`、`.bench104b.ts`、`.bench104.mjs`、`.bench104b.mjs`、`.prof104.ts`、`.prof104.mjs`、`.prof104/`、`.profan104.mjs`、`.e2e104.mjs`（9 项）。
- 发布：版本 `0.7.47 → 0.7.48`，双包已发布。
- 下一轮候选（来自本轮剖析）：`createParagraphsWithRealFormats`（12.03%）/ `detectCharacterStyles`（9.71%）/ `applyStructuralFormats`（7.81%）/ `extractImagesFromStream`（7.81%）/ `guessCharFormat`（7.57%）/ `parseFormatRuns`（5.36%）/ `detectParagraphFormat`（5.06%）。**已被证伪、不要动**：OLE 层 `readRegularStream`（仅 1.16%，优化 < 1% 端到端）；Round 103 的七条证伪项；`DATE_TIME_RE` 已删，其冗余证明见护栏。

## Round 105/100 — 2026-10-09
- 范围测定：段落级热函数 `guessCharFormat` 51.2 ms/轮 > `detectCharacterStyles` 34.8 ms/轮（33 819 段落）。`guessCharFormat` 与 `detectAlignment` 各自对同一段文本跑**两次独立全串扫描**（`countChineseChars` + `countWhitespaceChars`）只为了拿两个标量计数。
- 改动：新增导出 `countChineseAndWhitespace(text): [number, number]`（一趟合并扫描，中文字符判定 `[0x4e00,0x9fff]`、空白判定与 `isWhitespaceCode` 完全一致），替换两处调用点；删除不再引用的本地 `countWhitespaceChars` 与 `countChineseChars` import（encodingDetector 内部不受影响）。零语义风险。
- 隔离基准（33 819 段落）：等价性自检 `mismatch=0`；separate 14.187 ms → merged 12.508 ms（**1.13x**）。
- 端到端（27 份 / 7.6 MB，独立进程，120 轮最小，`git stash` 切换源码分别打包）：OLD 137.10 ms → NEW 130.97 ms（**1.05x**）。
- 护栏 `tests/textHeuristics.counts.test.ts`（**4 项**）：穷举长度≤4 全串 + 交叉验证 `countChineseChars`、随机 4000、边界、NBSP/ZWNBSP/全角空格等。第一版手写字面量用例混入非空白字符（8 vs 7），改 `String.fromCharCode(...)` 显式码点构造 → 4/4 全绿。
- 验证：`vue-tsc --noEmit` 0 错误；`lint` 0 错误（注意 esbuild 的 `.run.mjs` 临时 bundle 会被 `eslint .` 扫到报 34 error，删净即好）；`build`/`build:lib` 通过；定向 4/4；`npm test` **67 文件 / 1403 项**通过（较 104 的 66/1399 **+1 文件 +4 项**）；`node bench-diff.mjs 1050` 与 `cycle-1040` **零新增回归**（27/27，13 失败样本一致）。
- 指标：隔离 **1.13x**、端到端 **1.05x**；bundle 体积基本持平（主包 raw 317.61 → 317.65 kB、gzip 109.42 → 109.46 kB）。
- 清理的临时产物：`.bench105.ts`、`.bench105b.ts`、`.bench105.run.mjs`、`.bench105b.run.mjs`、`.e2e105.mjs`（5 项）。
- 发布：版本 `0.7.48 → 0.7.49`，双包已发布。
- 下一轮候选（沿用本轮剖析）：`createParagraphsWithRealFormats`（12.03%）/ `applyStructuralFormats`（7.81%）/ `extractImagesFromStream`（7.81%）/ `detectParagraphFormat`（5.06%）/ `parseFormatRuns`（5.36%）。**已被证伪、不要动**：OLE 层 `readRegularStream`（1.16%）；Round 103 七条证伪项；`DATE_TIME_RE` 已删；计数扫描合并已完成。

## Round 106/100 — 2026-10-09
- 范围测定（33 819 段落）：`guessCharFormat` 53.02 ms 最大，其中 `detectCharacterStyles` 34.79 ms 占大头；`detectParagraphFormat` 18.13 ms（≈ `detectAlignment` 13.78 + `detectListInfo` 4.23）。
- 改动：`detectCharacterStyles` 原先对每段做**两次全串遍历**（主样式遍历 + 单独一趟冒号扫描）。把冒号收集并进主遍历（放在循环体最前，早于 `continue`），删除独立循环。等价：主遍历对每个 i 恰好访问一次，冒号判定在 `continue` 前，故 `colonPositions` 内容与顺序完全一致。
- 隔离基准：`detectCharacterStyles` 34.79 → 24.89 ms（**1.40x**）；`guessCharFormat` 53.02 → 40.23 ms（**1.32x**）。
- 端到端（27 份 / 7.6 MB，独立进程，120 轮最小，交错 3×NEW / 2×OLD）：NEW 143.72/144.35/144.33 vs OLD 146.61/147.06 → **约 1.9%**。**隔离 1.40x 折算端到端预期 ~7%，实测仅 1.9%（约四分之一）**——又一次印证「隔离基准会系统性高估端到端收益」（Round 103 同源结论），已写入 changelog。
- 护栏 `tests/textHeuristics.charStyles.test.ts`（**4 项**）：把改动前实现逐行转写为参照做差分（穷举长度≤4、随机 3000、冒号密集、边界）；**注入 bug（只在偶数下标收集冒号）→ 3/4 失败**，证明护栏有鉴别力（已还原）。
- 验证：`vue-tsc` 0 错误；`lint` 0 错误；`build`/`build:lib` 通过；定向 4/4；`npm test` **68 文件 / 1407 项**通过（较 105 的 67/1403 **+1 文件 +4 项**）；`node bench-diff.mjs 1060` 与 `cycle-1050` **零新增回归**（27/27，13 失败样本一致）。
- 指标：隔离 **1.40x**（detectCharacterStyles）、端到端 **约 1.9%**；bundle 体积基本持平（主包 raw 317.65 → 317.61 kB、gzip 109.46 → 109.45 kB）。
- 清理的临时产物：`.bench106.ts`、`.bench106.run.mjs`、`.e2e106.mjs`（3 项）。
- 发布：版本 `0.7.49 → 0.7.50`，双包已发布。
- 下一轮候选：`detectAlignment`（13.78 ms）/ `detectParagraphFormat`（18.13 ms）/ `detectListInfo`（4.23 ms）；`detectParagraphFormat` 内部对同一文本先后调用 `detectAlignment` 与 `detectListInfo`（各一次 `trim()` + 前导空白扫描），存在跨函数重复遍历（需谨慎设计签名避免语义漂移）。**已被证伪、不要动**：OLE 层 `readRegularStream`（1.16%）；Round 103 七条证伪项；`DATE_TIME_RE` 已删；104/105/106 重复遍历合并已完成。

## Round 107/100 — 2026-10-09
- 本轮**先否决两个候选、再采纳四项优化**，是近十轮端到端收益最大的一轮（**1.086x / 约 +8.6%**），也是第一次「隔离收益」与「端到端收益」量级接近（多项叠加 + 最大两项在剖析里占比本就不低）。
- **起因：改用未混淆 bundle 做剖析**。`dist-lib` 是压缩产物（函数名 `df`/`Dc`/`rs`/`rh`/`pf`）无法归因，本轮用 esbuild `--minify=false --keep-names` 重打真实入口，`--cpu-prof` 60 轮 × 27 样本（8 779 samples）：`tryBrokerFileTokenSync` 12.50%（node 内部/沙箱 shim）、`createParagraphsWithRealFormats` 10.84%、`detectCharacterStyles` 8.86%、GC 8.02%、`applyStructuralFormats` 7.69%、`extractImagesFromStream` 7.48%、`parseFormatRuns` 5.35%、`detectAlignment` 4.18%、`guessCharFormat` 4.11%、`bytesToBase64` 2.61%。**按函数名聚合时不要带 url**（Round 103 教训）。再按**源码行**（`positionTicks`）深入，发现 `parseFormatRuns` 里 1.85% 落在 `extractChartsFromWordDocumentStream` 的 `data[offset+1] === 75` 上——**图表扫描藏在调用方的采样里，函数名榜上看不到它**。
- **否决 A（已落地代码后按纪律撤回）：段落格式共享文本上下文**。设想把 `detectParagraphFormat` 内部先后调用的 `detectAlignment` 与 `detectListInfo`（各做一次 `trim()` + 前导空白扫描）合并为一次 `prepareParagraphText(text)`。合成 33 819 段隔离基准看似略快（噪声内）；**真实 34 945 段 2×NEW/2×OLD 交错**：NEW `1267.8/1285.4/1303.9/1284.9/1321.0/1281.0` vs OLD `1073.1/1070.6/1060.4/1072.9` → **NEW 慢 19–23%**。原因：共享预处理要**同时**准备 trim、首尾空白、缩进宽度，让**短段落**路径更重。已 `git restore` 撤回全部生产改动 + `rm` 掉 `tests/textHeuristics.paragraphFormat.test.ts`。**合成语料与真实语料结论相反——「尺寸/分布必须插桩实测」纪律的又一例。**
- **否决 B（未落地）：`imageExtractor.extractImagesFromStream` 四锚点游标**。原实现已是「按首字节 switch 分流」（早前优化：3 060 万次 `bytesEqual` → 单次数组读取）。四锚点 `indexOf` 游标版**差分零差异**（45 流 / 125 图）但实测 **OLD 640.5/612.8 → NEW 690.9/693.5 ms = 0.90x（更慢）**。原因：`0xFF` 在真实流密度 1–2.5%，跳跃收益抵不过四游标维护开销。
- **采纳 1：`chartParser.extractChartsFromWordDocumentStream` 首字节跳跃（隔离 3.37x）**。先**量化上界再动手**——27 份真实 `WordDocument` 流（5.50 MB）锚点密度实测：`0xd0` **0.115 %**、`0x50` **0.528 %**，合计 0.643 % → **99.4 % 的偏移可被 `indexOf` 跨过**（对照：`0x00` 占 31.4 %，任何以它为锚点的方案必然退化）。实现要点（三条硬约束）：① 双游标 `oleAt`/`zipAt` **只在被消费后才 `indexOf(byte, offset+1)` 刷新**，绝不每轮取 `Math.min` 重取（否则二次方，Round 100：6.7 ms → 940 ms）；② **耗尽哨兵必须是 `data.length + 1`，不能用 `-1`**（`-1 < cursor` 恒真 → 每轮重扫到末尾）；③ 跳跃是**条件式**的（只在游标落后于 `from` 时才刷新）。产出图表后原实现是 `offset = endOffset + 4`（`for` 的 `offset++` 再前进一格 = 下一考察位 `endOffset + 5`），新实现用 `from = endOffset + 5` 并在循环开头把落后游标补齐到 `from`。差分：**333 输入（27 真实流 + 306 合成/边界）mismatch 0，产出 202 图（非空转）**；隔离 **2314.6/2204.3 → 674.4/664.7 ms = 3.37x**。
- **采纳 2：`applyStructuralFormats` 字段码清洗加存在性守卫**。隔离基准（34 945 段 × 400 轮）：`A baseline 3replace 969.4 ms` / **`B hyperlink-includes + field-test 426.5 ms`（采纳）** / `C hyperlink-includes only 235.4` / `D field-test only 305.0`。新增**非全局** `OTHER_FIELD_CODE_TEST_RE`——带 `g` 的正则用 `test()` 会推进 `lastIndex`，跨调用有状态，**必须分开**。**守卫必须落在该次 `replace` 的输入串上**：HYPERLINK 的第一个守卫看原串，第二个守卫要看「第一次 replace 之后」的串。等价性：`\bHYPERLINK` 与 `(?:EMBED|LIBREOFFICE|INCLUDEPICTURE|INCLUDETEXT)` 都要求字面量出现，字面量不存在时 `replace` 必为空操作。
- **采纳 3：`applyStructuralFormats` 图片占位符长度守卫**。原实现每段无条件 `text.replace(PIC_PLACEHOLDER_RE, '').length`；改为 `text.includes('\u0001') ? text.replace(...).length : text.length`。实测（34 945 段 × 400 轮）：**444.3 → 318.9 ms（1.39x）**。
- **采纳 4：`docParser.ts` 去掉 `delete` 造成的字典模式**。`delete newPara.charFormat.styles` 会把新建对象打成**字典模式**（剖析占 1.59%，`createParagraphsWithRealFormats` 内 self 最高的行之一）。隔离基准（34 945 对象 × 300 轮）：`spread+delete 1271.9 ms` / **`rest-destructure 674.0 ms`（采纳）** / `delete-then-spread 4395.2 ms`。新写法 `const { styles: _heuristicStyles, ...realCharFormat } = { ...newPara.charFormat, ...merged }`——键集合与顺序（除 `styles` 外）逐位一致。
- **端到端（27 份 / 7.6 MB，独立进程，`git stash` 切源码分别打包，15 轮/进程，交错 4×NEW / 4×OLD）**：NEW 中位数 `129.5/127.1/134.6/132.1`（中位数之中位数 ≈ **130.8**）vs OLD `139.9/141.1/143.7/142.9`（≈ **142.0**）→ **1.086x（约 +8.6%）**；按最小值 `124.9/123.0/122.8/125.1` vs `134.6/135.7/136.1/141.6` → **1.105x**。四组 NEW 与四组 OLD 各自紧聚且清晰分离。
- **等价性证据（四重）**：① **端到端逐字节一致（最强）**——27 份 `parseWithFormat()` **完整结果**（含段落、格式、图片 data URL）序列化后 `cmp`：**27 文件 / 16 247 039 字节，0 处差异**。② 常驻差分护栏 2 份 / 9 项：`tests/chartParser.streamScan.test.ts`（5，改动前实现逐行转写为 `referenceExtractCharts`，`buildSynthetic` 300 条随机流一半埋签名以触发真实产出，`buildBoundaryCases` 覆盖 0/8/99/100/101 字节与签名紧贴/跨越 `limit`，**断言含 `produced > 0` 防空转**）、`tests/structuralFormatCleanup.test.ts`（4，复刻 4 正则 + 参照清洗，用可见长度 150/9 两个边界驱动）。③ **鉴别力**：负控 A（游标步进 `offset + 2`）→ 1 failed/4 passed；负控 D（`includes('EMBED')` 漏掉 LIBREOFFICE/INCLUDETEXT/INCLUDEPICTURE）→ 1 failed/3 passed；负控 B（`EXHAUSTED = -1`）→ 进程被 SIGTERM（Exit 137，疑似死循环 OOM），**非形式化地被捕获**（结论靠推断，已诚实标明）；**负控 C（守卫落原串）→ 4/4 通过，且证明其为等价改写**——HYPERLINK 剥离只删除字符，不可能凭空造出紧邻字段关键字的空白，故「清洗后命中」蕴含「原串命中」，**不是护栏失灵，是那个「bug」根本不是 bug**。④ 全量测试 / 类型 / lint / 构建 / bench-diff 全绿。
- 验证：`npx vitest run tests/chartParser.streamScan.test.ts tests/structuralFormatCleanup.test.ts` → **9 passed**；`npm test` → **70 文件 / 1416 项**通过（较 106 的 68/1407 **+2 文件 +9 项**）；`npx vue-tsc --noEmit` 0 错误；`npm run lint` 0 错误；`npm run build` / `npm run build:lib` 通过；`node bench-diff.mjs 1070` 与 `cycle-1060` **除 `cycle`/`timestamp` 外全部字段逐位相同**（`median` 0.9502433994244857、`min` 0.8115474418758475、`max` 0.9999259480622746，13 个失败样本完全一致，零新增回归）。
- 指标：隔离 `chartParser` **3.37x**、字段码守卫 969.4 → 426.5 ms、占位符长度守卫 **1.39x**、去 `delete` 1271.9 → 674.0 ms；**端到端 1.086x（约 +8.6%）**。体积：主包 raw 317.61 → **318.03 kB**、gzip 109.45 → **109.62 kB**；库 `dist-lib/doc-preview.js` raw 351.11 → **351.72 kB**、gzip 94.40 → **94.58 kB**（**+0.18 kB gzip**）；库 UMD raw 262.20 → **262.62 kB**、gzip 82.62 → **82.79 kB**。**+0.18 kB gzip 换 8.6% 端到端**，收益明确、增长已论证。
- 清理的临时产物（16 项）：`.bench107-chart.mjs`、`.bench107c.mjs`、`.bench107c2.mjs`、`.bench107d.mjs`、`.bench107d2.mjs`、`.bench107del.mjs`、`.bench107i.mjs`、`.bench107p-ole.mjs`、`.bench107p-run.mjs`、`.bench107p.mjs`、`.prof107-bundle.mjs`、`.prof107b-analyze.mjs`、`.prof107b.mjs`、`.prof107b/`、`.e2e-new.mjs`、`.e2e-old.mjs`。
- 发布：版本 `0.7.50 → 0.7.51`，双包已发布。
- 下一轮候选：`createParagraphsWithRealFormats`（10.84%，最大单项但已被反复拆分）/ `extractImagesFromStream`（7.48%，大头是 `findJpegEnd` 的**数据相关**扫描，无安全跳跃方式，可考察「按首字节分流」能否细化为「按前两字节」）/ `parseFormatRuns`（5.35%）/ `detectAlignment`（4.18%）/ `guessCharFormat`（4.11%）。**已被证伪、不要动**：`imageExtractor` 四锚点游标（0.90x）；段落格式共享文本上下文（真实样本慢 19–23%）；OLE 层 `readRegularStream`（1.16%）；Round 103 七条证伪项；`DATE_TIME_RE` 已删；Round 104/105/106/107 的重复遍历合并已完成。

## Round 108/100 — 2026-10-09
- 本轮**采纳 2 项、否决 1 项（外加 2 个变体）**，端到端 **1.047x（约 +4.7%）**。
- **改动后剖析（未混淆 bundle，60 轮×27 样本，7 635 samples）**：`tryBrokerFileTokenSync` 14.09%（node 内部/沙箱 shim）、`createParagraphsWithRealFormats` 10.88%、`detectCharacterStyles` 9.97%、`extractImagesFromStream` 8.04%、`applyStructuralFormats` 6.50%、GC 6.33%、`guessCharFormat` 4.83%、`detectAlignment` 4.02%、`bytesToBase64` 3.00%、`extractFormattedText` 2.20%、`extractChartsFromWordDocumentStream` 2.19%、`mergeCharFormatForParagraph` 2.10%、`decodeRangeWithoutGuard` 2.00%、`findJpegEnd` 1.26%。**Round 107 的图表扫描改动确实生效**：`parseFormatRuns` 5.35% → 0.73%，图表扫描独立成函数 2.19%（其中 1.59% 是两次 `indexOf` 刷新本身），合计 2.92% < 5.35%。**按「函数名 + 节点起始行」拆分**才能看对——`applyStructuralFormats` 被内联进包装方法后 253 ticks 全落在 `return applyStructuralFormats(paragraphs)`（3.31%），另有 2.92% 落在模块函数节点，**同一函数名会分裂成两个节点**。
- **采纳 1：`splitTextByParagraphMark`（段落切分改 `indexOf('\n')` 跳跃）**。原实现逐字符 `charCodeAt(i) !== 10` 只为找 0x0A，占该函数自耗时 17.4%（≈全进程 1.89%）。**先量化密度**：1 491 378 字符 / 34 945 个 '\n' → **2.34%**，按 Round 98/99/100 的「≥2% 收益归零」经验**本该不值得做**，但那条经验针对「循环体本身很便宜」的场景——这里循环体是 JS 逐字符调用，`indexOf` 是原生 SIMD，**每字符开销差一个量级**，实测仍是大幅收益。**「密度阈值」不是普适判据，必须实测。** 隔离：OLD 147.9/144.4 → NEW 38.7/37.6 ms = **3.8x**，mismatch 0（34 945 parts）。实现抽成 `src/utils/docParser.ts` 的**模块级导出纯函数**（便于常驻差分护栏），方法体只留一行调用。等价性：原循环 `i` 含端点走到 `text.length`，故末尾必多产出一个（可能为空的）part；`nl < 0` 分支用 `slice(partStart)` 产出同一个。**踩到的坑**：抽函数时第一版写 `arr.push(...split(...))`——数万段的 spread 实参会抛 `RangeError: Maximum call stack size exceeded`（Round 104 教训），改为直接赋值。
- **采纳 2：`extractImagesFromStream` 的稀疏 `switch` 改 256 项 `LEAD_KIND` 查找表**。四个 case 值（66/71/137/255）在 `[0x42, 0xFF]` 上**极度稀疏**（跨度 190 只有 4 个），V8 退化成比较链：`switch` 语句 14.7% + 四个 `case` 标签 15.8/13.9/12.3/9.5% = **66.2%**。密度实测（7.14 MB / 72 条流）：0x42 0.3432% / 0x47 0.1240% / 0x89 0.1182% / 0xFF 1.1111% → 合计 **1.6965%**（这也解释了 Round 107 四锚点游标为何只有 0.90x）。隔离（`find*` 未导出，两端用同样打桩体只隔离**分派**）：OLD 374.6/373.0 → NEW 283.8/282.8 ms = **1.32x**，dispatch mismatch 0。**被证伪的变体**：查表前再加 `data[i] < 0x42` 范围守卫（59.66% 的字节满足）**与旧实现打平**（375.6 vs 374.6）——多出的比较正好抵消省下的表读取。**可证明的边界**：把**非首字节**错映射到某分支是**无害**的（`bytesEqual` 会连 `data[i]` 一起比较，签名首字节就是那个被错映射的字节 → 必然 false），所以只有「真首字节映射错/映射丢」才会产生差异。
- **否决：`detectCharacterStyles` 的「去逐字符分配」（已证伪，不要再动）**。行级归因看似指向「每字符分配一个 `charStyle` 对象」（L6129 13.3% + L6131 9.5% + `isSameStyle` 本体 15.6%）。设计了整数键（fnCode × underline）比较、只在样式真正变化时才物化对象。注意 `isSameStyle` 的语义**不是等价关系**（任一 `fontName` 为 `undefined` 时只比 `underline`，故 A≈B、B≉C 但 A≈C），键比较必须显式复刻这条（已复刻，mismatch 0，33 819 段有产出）。**但性能反向**：OLD 1566.1/1604.5 → NEW 2149.6/2152.4 ms（**1.39x 更慢**）；内联物化版 NEW2 2174.5/2205.3 同样更慢。结论：**V8 已经把「每字符一个短命对象字面量」的开销抹掉了**（形状稳定 + bump 分配 + 逃逸分析/标量替换），多出的标量簿记反而更贵。**剖析的行归属在这里是误导性的**，按纪律否决，未落地生产代码。
- **常驻护栏 2 份 / 12 项**。① `tests/docParser.newlineSplit.test.ts`（5 项）：`referenceSplit` 是改动前实现的逐行转写；25 个固定用例（空串、首/尾/连续 '\n'、`\u0007\u0007` 表格行、CRLF、代理对、emoji）；**穷尽**长度 ≤4 的 `{a, \n, \u0007}` 字母表全枚举；**随机 3000 组**（长度 ≤80）；**10 万字符 / 5000 段**；非空转断言（part 总数 > 0、≥3 段的用例 ≥5）+ CP 不变式。② `tests/imageExtractor.dispatch.test.ts`（7 项）：不转写 `find*`，而是用**最小合法图片字节**（PNG=签名+IEND chunk、JPEG=SOI+EOI、GIF=GIF87a+7B LSD+0x3B、BMP=BM+size54）驱动真实函数——四种格式各自单独识别（首字节映射未丢）、四图混排顺序正确、5 种排列都得到对应序列（无分支互换）、**非空转（产出 4 张）**、全部 256 个字节值循环三次零误报、只有签名首字节零误报、签名明显不完整零误报。
- **鉴别力（负控 4 组）**：1a `partStart = cut`（切点不前进）→ **进程被 SIGTERM**（`indexOf` 反复命中同一个 `\n` → 死循环被 OOM kill），**非形式化捕获**（结论靠「进程无法跑完」而非断言输出，已如实标明）；1b `partStart = cut + 2`（切点偏移一格）→ **4 failed / 1 passed** ✓；2a `t[PNG_LEAD] = 4`（映射到 BMP 分支）→ **4 failed / 3 passed** ✓；2b `t[GIF_LEAD] = 0`（映射丢失）→ **4 failed / 3 passed** ✓。
- **护栏自身修的两处错**：① CP 不变式第一版写成「`cpStart` = 此前所有 part 长度 + 1 之和」——错，同一 `\n`-part 内被 `\u0007\u0007` 再切的相邻 part 只相差**前一个 part 的长度**；② 「截断的签名」用例第一版用 `PNG.subarray(0, 19)`（只砍 1 字节）——`findPngEnd` **不校验 CRC**，少 1 字节的 PNG 仍被判定为完整（**这是改动前就有的行为**），改用明显不足的 `subarray(0, 12)`。
- **端到端（27 份 / 7.6 MB，独立进程，`git stash` 切源码分别打包，15 轮/进程，交错 4×NEW / 4×OLD）**：NEW 中位数 `119.6/119.0/119.2/122.1`（中位数之中位数 ≈ **119.4**）vs OLD `125.0/124.0/125.1/126.1`（≈ **125.05**）→ **1.047x（约 +4.7%）**；按最小值 `115.1/116.0/116.1/117.0` vs `121.8/121.0/121.1/122.4` → **1.048x**。四组 NEW 与四组 OLD 各自紧聚且清晰分离。**一个必须记下的观察**：同一份「OLD」（0.7.51 的代码）在 Round 107 会话里量到中位数 ≈ 130.8 ms，本次会话量到 ≈ 125.05 ms——**跨会话有约 4.4% 的机器漂移**，正好说明「交错重复 + 同会话对比」是必需的，单看某一轮的绝对毫秒数会得出错误结论。
- **等价性证据**：① **端到端逐字节一致（最强）**——27 份 `parseWithFormat()` 的**完整结果**（含段落、格式、图片 data URL）序列化后 `cmp`：**27 文件 / 16 247 039 字节，0 处差异**。② 常驻差分护栏 2 份 / 12 项（见上）。③ 隔离差分：切分 mismatch 0（34 945 parts）、图片分派 mismatch 0（72 条流）。④ 负控 4 组（见上）。⑤ 全量测试 / 类型 / lint / 构建 / bench-diff 全绿。
- 验证：`npx vitest run tests/docParser.newlineSplit.test.ts tests/imageExtractor.dispatch.test.ts` → **12 passed**；`npm test` → **72 文件 / 1428 项**通过（较 107 的 70/1416 **+2 文件 +12 项**）；`npx vue-tsc --noEmit` 0 错误；`npm run lint` 0 错误；`npm run build` / `npm run build:lib` 通过；`node bench-diff.mjs 1080` 与 `cycle-1070` **除 `cycle`/`timestamp` 外全部字段逐位相同**（`median` 0.9502433994244857、`p25` 0.9154504595379104、`p10` 0.8968160758834334、`min` 0.8115474418758475、`max` 0.9999259480622746，13 个失败样本完全一致，零新增回归）。
- 指标：隔离 `splitTextByParagraphMark` **3.8x**、`extractImagesFromStream` 分派 **1.32x**；**端到端 1.047x（约 +4.7%）**。体积：主包 raw 318.03 → **318.10 kB**、gzip 109.62 → **109.63 kB**；库 `dist-lib/doc-preview.js` raw 351.72 → **351.78 kB**、gzip 94.58 → **94.61 kB**（**+0.03 kB gzip**）；库 UMD raw 262.62 → **262.72 kB**、gzip 82.79 → **82.82 kB**。**+0.03 kB gzip 换 4.7% 端到端**，收益明确、增长已论证。
- 清理的临时产物（16 项）：`.prof108-entry.ts`、`.prof108-bundle.mjs`、`.prof108-analyze.mjs`、`.prof108-lines.mjs`、`.prof108-nodes.mjs`、`.prof108/`、`.bench108-density.ts`、`.bench108-density.mjs`、`.bench108a.ts`、`.bench108a.mjs`、`.bench108b.ts`、`.bench108b.mjs`、`.bench108c.ts`、`.bench108c.mjs`、`.e2e-new.mjs`、`.e2e-old.mjs`。
- 发布：版本 `0.7.51 → 0.7.52`，双包已发布。
- 下一轮候选：`createParagraphsWithRealFormats`（10.88%，剩余可动的是 L7815–7817 的「spread + 解构 rest」，占该函数 14.3%，但 Round 107 的隔离口径与实际不一致，需**在真实对象上**重新 A/B——Round 103 教训）；`mergeCharFormatForParagraph`（2.10%，二分查找 + 格式归并）；`findJpegEnd`（1.26%，**数据相关**扫描无安全跳跃方式）；`applyStructuralFormats`（6.50%，内部行很分散，未找到集中热点）。**已被证伪、不要动**：`detectCharacterStyles` 键比较去分配（慢 1.39x）；图片扫描「范围守卫 + 表」（与旧实现打平）；`imageExtractor` 四锚点游标（0.90x）；段落格式共享文本上下文（真实样本慢 19–23%）；OLE 层 `readRegularStream`（1.16%）；Round 103 七条证伪项；`DATE_TIME_RE` 已删；Round 104–108 的重复遍历合并已完成。

## Round 109/100 — 2026-10-09
- 本轮**采纳 1 项、否决 4 个变体 + 4 个前置候选**，端到端 **1.048x（约 +4.8%）**。本轮最重要的产出是一条**方法学教训**（见下倒数第三条）。
- **改动后剖析（未混淆 bundle，7 798 samples）**：`detectCharacterStyles` 9.66%、`createParagraphsWithRealFormats` 8.26%、GC 7.45%、`applyStructuralFormats` 6.75%、`extractImagesFromStream` 6.25%（Round 108 的 8.04% 已降下来）、`guessCharFormat` 4.78%、`detectAlignment` 4.44%、`bytesToBase64` 3.10%。
- **动手前就排除的 4 个前置候选**：① `countChineseAndWhitespace` 合并——两个调用点（`textHeuristics.ts:186` 用 `text`、`:475` 用 `trimmed`）是**不同输入**，不可共享一次扫描；② `findJpegEnd`（1.24%）是**数据相关**扫描（要跳过 `0xFF00` 转义、找 SOS/EOI），无安全跳跃方式；③ `applyStructuralFormats`（6.75%）内部行很分散（最大单行 0.40%），未找到集中热点；④ `detectCharacterStyles`（9.66%）Round 108 已证伪「键比较去分配」路线，本轮未重复尝试。
- **采纳：`extractImagesFromStream` 的「整对跳过」**。Round 108 已把四个 `bytesEqual` 换成 `LEAD_KIND` 首字节分流，但**每字节**仍需「一次数组读取 + 一次比较」；真实流里 98.3% 的字节不是任何签名首字节，所以「两字节一起判定、都不像就前进 2」应再省一半。新增 65536 项 `PAIR_HAS_LEAD` 表，索引 `(data[i] << 8) | data[i + 1]`（高字节在前，**与宿主字节序无关**）。把四个分支体抽成纯推进函数 `pushImageAt(data, i, len, images)`（命中 push 并返回结束偏移，否则 `-1`），主循环改为 `while (i + 1 < len)` 只处理有配对的位置，**末字节在循环后单独收尾**。隔离（**OLD 取自 `git show HEAD:` 的逐字切片**）：162.7 → 121.5 ms = **1.34x**，mismatch 0，72 条真实流 / 7.49 MB 产出 125 张图（非空转）。
- **等价性**：只有「两个字节都**不是**首字节」时才跳过；此时逐字节版本在这两个位置上都只会走 `kind === 0 → continue`，无任何副作用 —— **被跳过的每一步都是逐字节版本的空转**。三条附带性质：① 表只映射「是否含首字节」，无签名顺序依赖；② 表对**调换高低字节是对称的**，所以索引字节顺序也不影响结果；③ 边界 `i + 1 === len` 由循环后的单字节收尾覆盖，末字节不会漏。
- **被否决的 4 个变体**：① **`Uint16Array` 视图 + 奇偶守卫**——一次 `u16[i>>1]` 代替两次字节读取，实测 **118.7 ms，与不带视图完全打平**：`byteOffset` 奇偶取决于 OLE 扇区偏移（本次样本 72/72 偶数属**巧合**），加上守卫后收益被比较抵消，白背一个对齐前提，否决；② **去掉 `i + 1 < len` 守卫、靠 `data[len]` 越界返回 `undefined`（`ToInt32` = 0）参与位或**——语义等价但 **1.156x（140.6 ms）更慢**，越界读取不便宜，否决；③ **分支内 `i = end; continue`（第一版生产形态，无辅助函数）**——1.249x（130.2 ms），改成辅助函数 + 末字节收尾形态后 **1.339x**，**+7.8%**，采纳后者；④ 早期合成语料的「2 字节合并表」1.87x 只作方向筛选，真实结构下不可复现，未采信。
- **常驻护栏 `tests/imageExtractor.pairSkip.test.ts`（5 项）**：不转写 `find*`（本轮未触及），用**最小合法图片字节**（与 Round 108 同源）驱动真实函数，断言一律写成「**恰好 1 张且字节完全相同**」——既抓漏报也抓误报。① **偏移 0..9 × 8 种填充字节**（320 组），填充字节刻意取遍四个签名首字节（`0x89`/`0xff`/`0x47`/`0x42`）与若干普通值；② **穷尽 65536 个字节对**（缓冲区最前放 `(b0,b1)`，紧随最小 JPEG `FF D8 FF D9`）；③ **穷尽长度 ≤3 的首字节前缀**（`{0x00,0x01,0x0a,0x42,0x47,0x89,0xff}`，399 组）；④ 末字节边界（长度 0..9 不越界不误报）；⑤ 多图顺序与去重。
- **鉴别力（负控 5 组）**：① 表只标记「高字节 == lead」的一半（漏低字节分支）→ **3 failed / 2 passed** ✓；② 表全部填 1（**更慢但等价**）→ **5 passed**（正确地零差异）✓；③ `i += 3`（跳过 3 字节）→ **3 failed / 2 passed** ✓；④ `i += 1`（**更慢但等价**）→ **5 passed**（正确地零差异）✓；⑤ 只标记「签名的前两个字节」这一对（看似合理的设计）→ **4 failed / 1 passed** ✓。报错精确到输入，如 `png padLen=1 pad=0x0: expected 0 to be 1`、`字节对 (0x42, 0x0) 出错：产出 0 张`。
- **本轮最重要的教训：会话内也有约 6% 漂移。** 第一版生产实现（分支内 `i = end; continue`）量到 130.2 ms；改成辅助函数形态后，**import 进来的生产实现**仍量到 **128.7 ms**，而同文件内联的等价写法 `V_tail` 是 **120.8 ms** —— 看起来像「抽函数没用」。于是把当前 `src` 的实现**逐字**搬进基准（只重命名标识符，记为 `V_prod`）作对照：`OLD 162.7 / NEW 121.5 / V_prod 120.6 / V_tail 119.5` —— **三者一致**。也就是说那 128.7 ms 不是算法差异，而是**同一实现在不同时刻的会话态漂移**（JIT 分层、GC 时机、后台负载）；复跑确认稳定在 **1.339x / 1.359x**。**纪律：隔离基准里不能只 import 一份被测实现，必须同时放一份逐字副本当对照**；两者相差超过噪声就说明测到的是会话态而非算法。（与 Round 108 的「跨会话 4.4% 漂移」是同一现象的两个方向：跨会话漂移要交错重复，会话内漂移要同轮内放副本。）
- **剖析口径与端到端不符，已查清原因**：剖析给 `extractImagesFromStream` **6.25%**，按此推算端到端只该有约 1.6%，实测 4.8%。原因是该函数**每份文档被调用多次**：`documentAssets.ts:71` 对 **Data 流与 WordDocument 流各扫一遍**（有 `maxScanBytes` 预算）、`pictureParser.ts:427` 走 fcPic 路径时再扫一次 Data 流、`chartParser.ts:91` 对每个图表流再扫一次 —— 所以「单函数 tick 占比」低估了它的实际权重。**后续剖析要拿端到端数字交叉验证，不能只看 tick 百分比。**
- **端到端（27 份 / 7.6 MB，独立进程，`git stash` 切源码分别打包，20 轮/进程，交错 6×NEW / 6×OLD）**：每进程中位数 NEW `137.6/138.6/127.9/133.5/128.1/132.1`（中位数 **133.5**）vs OLD `133.8/140.5/131.4/134.8/144.3/140.7`（**140.5**）→ **1.0524x**；每进程最小值 NEW 中位数 ≈ **122.5** vs OLD ≈ **127.4** → **1.0439x**；全样本中位数 NEW 131.2 / OLD 137.5 → **1.0480x**；全样本 p25 127.3 / 131.4 → 1.032x；全样本 min 120.8 / 123.8 → 1.025x。**四个估计量一致落在 1.03–1.05x**，取 **≈1.048x（约 +4.8%）**。
- **等价性证据**：① **端到端逐字节一致（最强）**——27 份 `parseWithFormat()` 的**完整结果**序列化后 `diff`：**27 文件 / 16 247 039 字节，0 处差异**。② 常驻护栏 1 份 / 5 项（含 320 组偏移×填充、穷尽 65536 字节对、399 组前缀穷尽）。③ 负控 5 组，其中 2 组是「更慢但等价」的阴性对照，正确地零差异。④ 隔离差分 mismatch 0 / 125 张图 / 72 条流。⑤ 全量测试 / 类型 / lint / 构建 / bench-diff 全绿。
- 验证：`npx vitest run tests/imageExtractor.pairSkip.test.ts tests/imageExtractor.dispatch.test.ts` → **12 passed**；`npm test` → **73 文件 / 1433 项**通过（较 108 的 72/1428 **+1 文件 +5 项**）；`npx vue-tsc --noEmit` 0 错误；`npm run lint` 0 错误；`npm run build` / `npm run build:lib` 通过；`node bench-diff.mjs 1090` 与 `cycle-1080` **除 `cycle`/`timestamp` 外逐字段相同**（`median` 0.9502433994244857、`p25` 0.9154504595379104、`p10` 0.8968160758834334、`min` 0.8115474418758475、`max` 0.9999259480622746，13 个失败样本完全一致，零新增回归）。
- 指标：隔离 `extractImagesFromStream` **1.34x**（162.7 → 121.5 ms）；**端到端 1.048x（约 +4.8%）**。体积：主包 raw 318.10 → **318.38 kB**、gzip 109.63 → **109.68 kB**；库 `dist-lib/doc-preview.js` raw 351.78 → **352.15 kB**、gzip 94.61 → **94.72 kB**（**+0.11 kB gzip**）；库 UMD raw 262.72 → **263.01 kB**、gzip 82.82 → **82.92 kB**。65536 项表是**运行时生成**的（不占包体），进包体的只有约 50 行代码；**+0.11 kB gzip 换 4.8% 端到端**，收益明确、增长已论证。
- 清理的临时产物（17 项）：`.prof109-entry.ts`、`.prof109-bundle.mjs`、`.prof109-analyze.mjs`、`.prof109-lines.mjs`、`.prof109/`、`.bench109a.ts`/`.mjs`、`.bench109b.ts`/`.mjs`、`.bench109c.ts`/`.mjs`、`.bench109d.ts`/`.mjs`、`.bench109d-gen.mjs`、`.e2e-entry.ts`、`.e2e-new.mjs`、`.e2e-old.mjs`。
- 发布：版本 `0.7.52 → 0.7.53`，双包已发布。
- 下一轮候选：`createParagraphsWithRealFormats`（8.26%，L7824–7826 的 spread + 解构 rest 占该函数 1.35%、`mergeCharFormatForParagraph` 调用点 1.92%，但需**在真实对象上**重新 A/B）；`detectCharacterStyles`（9.66%，需换角度）；`applyStructuralFormats`（6.75%，需先做**调用点级**归因而非行级）；`bytesToBase64`（3.10%，`fromCharCode.apply` 占该函数 2.83%，但 Round 103 已确认分块 0x2000 接近最优）；`guessCharFormat`（4.78%）/ `detectAlignment`（4.44%）尚未做过行级归因。**已被证伪、不要动**：Round 110 pieceMap 重叠临时数组消除（隔离与端到端均无稳定收益，已撤回）；`Uint16Array` 视图 + 奇偶守卫（打平）；越界读取代替守卫（1.156x 更慢）；`detectCharacterStyles` 键比较去分配（慢 1.39x）；图片扫描「范围守卫 + 表」（打平）；`imageExtractor` 四锚点游标（0.90x）；段落格式共享文本上下文（真实样本慢 19–23%）；`countChineseAndWhitespace` 合并（两个调用点输入不同）；OLE 层 `readRegularStream`（1.16%）；Round 103 七条证伪项；`DATE_TIME_RE` 已删；Round 104–109 的重复遍历合并已完成。

## Round 110/100 — 2026-10-09
- 本轮候选全部否决，未落地生产代码、未升号、未发布。尝试消除 `createParagraphsWithRealFormats` pieceMap 重叠处理的临时数组，27 份真实文档逐字节结果 0 处差异，定向 99/99、全量 1433/1433 通过；但交错 4×NEW/4×OLD 端到端无稳定收益（NEW 144.941/138.836/138.536/148.478 ms，OLD 139.361/141.384/145.928/148.199 ms；中位数约 1.014x，首轮隔离还出现退化），按硬纪律撤回。详见 `docs/changelog/2026-10-09-round110-optimization.md`。
- 下一轮：Round 111，重新剖析并只采纳真实端到端有稳定收益的候选。

## Round 111/100 — 2026-10-09
- **本轮是本项目近十轮最大单轮收益：端到端 1.117x（约 +11 %）。**采纳 1 项优化——`detectCharacterStyles` 的**整段快路径**。
- **起因：换角度攻最大单项**。`detectCharacterStyles` 在未混淆 bundle 剖析里占 11.15 %（最大单项）。Round 106（合并冒号扫描）与 Round 108（键比较去分配，慢 1.39x）已两次尝试「让每字符更快」，本轮改为「让大多数段落**根本不需要逐字符**」。
- **关键量化（插桩实测 27 份 / 33 819 段 / 1 456 460 字符）**：无 CJK 的段落占 99.98 %；无 CJK 且无数字占 9.48 % 段落但 **56.14 % 字符**；**无 CJK 且无冒号占 97.63 % 段落 / 90.59 % 字符**。
- **等价性论证**：无 CJK ⇒ `chineseSoFar` 恒为 0（兜底分支 fontName 恒 'Times New Roman'），且 `isDateUnitCode` 的六个日期单位**全是 CJK**，故 `shouldHaveUnderline` 的日期分支恒 false；无冒号 ⇒ 冒号分支也恒 false；而它**只对数字字符**可能返回 true ⇒ 任何数字都不带下划线。于是每个字符的样式对象只有 `{underline:false}` 或 `{fontName:'Times New Roman',underline:false}` 两种，由 `isSameStyle`「任一方无 fontName 时只比 underline」的语义**两两等价** ⇒ 整段只产出 **1 个**样式段，style 即 `text[0]` 的对象，且后处理是空操作。
- **中途版本的教训**：第一版把条件定成「无 CJK 且无数字」（只覆盖 54.26 % 字符），端到端只有 1.013–1.031x（三次独立交错测量）；把条件**放宽为「无 CJK 且无冒号」**后覆盖率跳到 90.59 %，端到端跃到 1.117x。**「等价条件能放多宽」比「循环能快多少」重要一个量级。**
- **改动**：`src/utils/docparser/heuristics/textHeuristics.ts`（+104/−24）新增两张守卫正则、`uniformStyleForFirstCode()`，并把冒号后处理抽成 `applyColonUnderline()` 供主循环与快路径 B 共用（逻辑逐字未变）；**主循环一行未改**。另在 `eslint.config.js` 的 `ignores` 加入 `.workbuddy-ai/**`（本轮起保留常驻剖析/基准脚手架于该 gitignore 目录，避免 `npm run lint` 被本地工具状态污染）。
- **隔离基准（同进程 A/B，四个变体）**：`OLD 788.9 / V_prod 107.5 / V1 122.5 / V2 109.4 ms`（min）→ **最终版 / 改动前 = 7.34x**，中途版 V1 只有 6.44x。等价性 mismatch 0，有产出 104 393 段，多段 2 537 段。
- **端到端（27 份 / 7.6 MB，独立进程，交错 5×NEW/5×OLD 再反向 5 对 = 20 进程 × 20 轮）**：中位数之中位数 NEW 114.08 vs OLD 127.42 → **1.1169x**；最小值之中位数 NEW 107.13 vs OLD 118.20 → **1.1033x**。**分离完全**：NEW 的 10 个最小值全 ≤ 111.2 ms，OLD 的 10 个全 ≥ 115.0 ms。
- **等价性证据**：① **端到端逐字节一致（最强）**——27 份 `parseWithFormat()` 完整结果序列化后 `cmp`：**27 文件 / 16 247 039 字符，0 处差异**。② 常驻差分护栏 `tests/textHeuristics.fastPath.test.ts`（7 项）：穷举长度 ≤ 5 无数字无 CJK 串（约 3.7 万）、穷举混合串长度 ≤ 4、**穷尽 65 536 个 BMP 单字符**、随机 5 000 串（断言产出 > 4 900、多段 > 100 **防空转**）、结构不变式与边界。③ 负控 4 组：fontName 改错 → 6 failed ✓；守卫漏冒号 → 5 failed ✓；守卫漏 CJK → 4 failed ✓；**更慢但等价**（快路径内加冗余扫描）→ 7 passed（正确零差异）✓。④ 全量测试 / 类型 / lint / 构建 / bench-diff 全绿。
- **一条「不是 bug」的记录**：中途版本的「守卫漏掉数字」负控 **6/6 全绿**。核查确认它是**等价改写**而非护栏失灵（无 CJK 时日期单位不存在，`shouldHaveUnderline` 只可能由冒号触发 ⇒「无冒号」已蕴含「无带下划线的数字」）。与 Round 107 负控 C 同源，已如实记录。
- **剖析口径修正两条**：① 行级归因把冒号收集的 `indexOf` 守卫读成「占全进程 1.07 %」，据此改成合并正则，但同进程 A/B 实测只快 **1.7 %**（527.1 → 518.5 ms）——**行级归因会误导，必须用 A/B 定值**。② 函数级 7.34x 折算端到端理论上限约 9.6 %，实测 **11 %**——本轮**首次端到端超过折算上限**，因为快路径同时消掉 1 456 460 次/轮的对象分配，收益一部分落在 GC（8.86 %）上，不在被计时的函数体内。
- 验证：`npx vue-tsc --noEmit` 0 错误；`npm run lint` **0 问题**；`npm run build` / `build:lib` 通过；定向 22/22；`npm test` **74 文件 / 1440 项**通过（较 109 的 73/1433 **+1 文件 +7 项**）；`node bench-diff.mjs 1110` 与 `cycle-1090` 除 `cycle`/`timestamp` 外**逐位相同**（`median` 0.9502433994244857、`p10` 0.8968160758834334、`p25` 0.9154504595379104、`min` 0.8115474418758475、`max` 0.9999259480622746，13 个失败样本与 `topIssues` 完全一致），零新增回归。
- 指标：隔离 **7.34x**；**端到端 1.117x（约 +11 %）**。体积：主包 raw 318.38 → **318.88 kB**、gzip 109.68 → **109.83 kB**；库 js raw 352.15 → **352.75 kB**、gzip 94.72 → **94.86 kB**（**+0.14 kB gzip**）；库 UMD raw 263.01 → **263.50 kB**、gzip 82.92 → **83.05 kB**。**+0.14 kB gzip 换 11 % 端到端**，收益明确、增长已论证。
- 工具链变化：本轮起不再逐轮删除剖析/基准脚手架，改为常驻 `.workbuddy-ai/perf-harness/`（已 gitignore + 加入 eslint ignores）。
- 发布：版本 `0.7.53 → 0.7.54`，双包已发布。
- 下一轮候选：`createParagraphsWithRealFormats`（9.91 %，热点在 L7842 `mergeCharFormatForParagraph` 调用点 2.23 % 与 L7845–7847 spread+rest 1.86 %）；`guessCharFormat`（7.17 %，本轮后已升为次热点，可考察「无 CJK 段落的标题探测短路」）；`applyStructuralFormats`（7.27 %，需调用点级归因）；`bytesToBase64`（3.40 %，Node 22 无原生 `Uint8Array.prototype.toBase64` 已排除）；`extractImagesFromStream`（5.07 %）/ `detectAlignment`（5.12 %）。**已被证伪、不要动**：`detectCharacterStyles` 键比较去分配（慢 1.39x）；Round 110 pieceMap 重叠临时数组消除；`Uint16Array` 视图 + 奇偶守卫（打平）；越界读取代替守卫（1.156x 更慢）；图片扫描「范围守卫 + 表」（打平）；`imageExtractor` 四锚点游标（0.90x）；段落格式共享文本上下文（真实样本慢 19–23 %）；`countChineseAndWhitespace` 合并（两个调用点输入不同）；OLE 层 `readRegularStream`（1.16 %）；Round 103 七条证伪项；`DATE_TIME_RE` 已删；Round 104–110 的重复遍历合并已完成。

## Round 112/100 — 2026-10-09
- 端到端 **1.084x（中位数）/ 1.108x（最小值）**，约 **+9 %**。采纳 1 项：`guessCharFormat` 与 `detectAlignment` 在**无 CJK 时跳过 O(n) 的 `countChineseAndWhitespace`**。
- **起因**：Round 111 之后 `guessCharFormat`（7.17 %）与 `detectAlignment`（5.12 %）成为新次热点，两者**各自**对同一段文本跑一次 O(n) 计数只为拿 `chineseCount`。
- **先量差距再动手**：探针实测每段两次调用的开销——逐字符计数 **824.8 ms** vs 正则探测 **39.4 ms**（30 轮 / 33 819 段）→ **20.93x**。真实语料 **99.98 % 的段落一个 CJK 都没有**（Round 111 已插桩），故绝大多数调用白跑。
- **等价性论证**：无 CJK ⇒ `chineseCount` 必为 0，而两个函数里对它的判断**全部是 `>= 2`**（`guessCharFormat` 三处：字体选择 / `pureName` / `isShortChineseTitle`；`detectAlignment` 两处：`onlyName` / 居中标题），全部短路 ⇒ 唯一依赖计数的 `chineseRatio` 与 `strippedLength`/`strippedLen` 都不会被读取。空串时原实现算出的 `chineseRatio` 是 `NaN`、新实现取 0，两者在 `> 0.7` / `> 0.5` 上同为假且那两处本身都在 `chineseCount >= 2` 之内。
- **改动**：新增 `HAS_CJK_RE = /[\u4e00-\u9fff]/`；两个调用点改为「先正则探测，命中才算」，未命中时计数与派生量置 0；**`countChineseAndWhitespace` 本身一行未改**（其穷尽护栏继续有效）。+36/−6 行。
- **端到端（27 份 / 7.6 MB，独立进程，交错 5×NEW/5×OLD 再反向 5 对 = 20 进程 × 20 轮；对照 = Round 111 后的状态）**：中位数之中位数 NEW 104.64 vs OLD 113.44 → **1.0840x**；最小值之中位数 NEW 97.99 vs OLD 108.54 → **1.1077x**。
- **等价性证据**：① **端到端逐字节一致（最强）**——27 份完整结果序列化后 `cmp`：**27 文件 / 16 247 039 字符，0 处差异**。② 常驻差分护栏 `tests/textHeuristics.cjkGuard.test.ts`（**6 项**）：参照实现是改动前两个函数的逐行转写（只借用导出的 `countChineseAndWhitespace` 与 `detectCharacterStyles`，作用域边界已注明）；穷举混合字母表长度 ≤ 3（`detectAlignment` 用 4 组 `(index, totalParagraphs)`）、**穷尽 65 536 个 BMP 单字符**（两函数各一遍）、随机 4 000 串（**断言 `cjkSeen > 1000` / `boldSeen > 10` / `alignSeen > 10` 防空转**）、标题与对齐的确定性用例（**断言 `bold > 0` / `align > 0`**）、`chineseCount` 的 2/4 边界（1–5 个 CJK）。③ 负控 4 组：无 CJK 分支写成 `chineseCount = 2` → 5 failed ✓；守卫取反 → 5 failed ✓；探测正则改成 `/[a-z]/` → 5 failed ✓；**更慢但等价**（守卫重复求值两次）→ 6 passed（正确零差异）✓。④ 全量测试 / 类型 / lint / 构建 / bench-diff 全绿。
- 验证：`npx vue-tsc --noEmit` 0 错误；`npm run lint` 0 问题；`npm run build` / `build:lib` 通过；定向 6/6；`npm test` **75 文件 / 1446 项**通过（较 111 的 74/1440 **+1 文件 +6 项**）；`node bench-diff.mjs 1120` 与 `cycle-1110` 全部统计字段逐位相同（`median` 0.9502433994244857、`p10` 0.8968160758834334、`p25` 0.9154504595379104、`min` 0.8115474418758475、`max` 0.9999259480622746，13 个失败样本与 `topIssues` 完全一致），零新增回归。
- 指标：**端到端 1.084x（约 +9 %）**。体积：主包 raw 318.88 → **318.98 kB**、gzip 109.83 → **109.87 kB**；库 js raw 352.75 → **352.93 kB**、gzip 94.86 → **94.91 kB**（**+0.05 kB gzip**）；库 UMD raw 263.50 → **263.59 kB**、gzip 83.05 → **83.10 kB**。**+0.05 kB gzip 换 9 % 端到端**，收益明确、增长已论证。
- 发布：版本 `0.7.54 → 0.7.55`，双包已发布。
- 下一轮候选：`createParagraphsWithRealFormats`（9.91 %，L7842 `mergeCharFormatForParagraph` 调用点 2.23 % + L7845–7847 spread/rest 1.86 %）；`applyStructuralFormats`（7.27 %，需调用点级归因）；`extractImagesFromStream`（5.07 %）；`bytesToBase64`（3.40 %，已排除原生方案）。**同源延伸**：`detectListInfo` 与 `detectAlignment` 仍对每段做 `text.trim()`（分配），可考察能否免掉；注意 `ALL_CAPS_LINE_RE` 带 `$`，直接在 `text` 上测**不等价**。**已被证伪、不要动**：Round 111 已记录的全部条目。
## Round 113/100 — 2026-10-10
- 本轮候选全部否决，未落地生产代码、未升号、未发布；轮次计入完成计数。基于真实 27 份样本 CPU 剖析（120 轮）选取 `createParagraphsWithRealFormats` 的 `overlapping.reduce` 显式循环改写。
- 逐文件结果：27/27 份完整 dump 相同；撤回后 `npm test` 75 文件 / 1446 项通过。
- 交错 4×NEW/4×OLD、每进程20轮：NEW 中位数 102.220/100.433/101.170/106.897 ms；OLD 97.287/100.363/100.363/98.980 ms；初始30轮 NEW 103.551、OLD 100.828 ms。无稳定收益且有退化，按硬纪律撤回。
- 工作区干净，包体未改变。详见 `docs/changelog/2026-10-10-round113-optimization.md`。
- 下一轮：Round 114，重新剖析 `applyStructuralFormats` 调用点或 `extractImagesFromStream` 多次调用权重，避免重复 pieceMap 候选。

## Round 114/100 — 2026-10-10
- 本轮候选全部否决，未落地生产代码、未升号、未发布；轮次计入完成计数。评估 `extractImagesFromStream` 中以两个 `LEAD_KIND` 查表替代现有 65536 项 `PAIR_HAS_LEAD` 查表。
- 27/27 份真实样本完整 dump 一致；交错 4×NEW/4×OLD、每进程20轮：NEW 中位数 95.649/94.836/95.302/95.809 ms，OLD 92.663/94.702/94.717/94.006 ms，NEW 稳定退化，按硬纪律撤回。
- 撤回后 `npm test` 75 文件 / 1446 项通过；`npm run build`、`build:lib`、`lint` 通过；`bench-diff 1140` 与既有基线逐字段一致。工作区干净，包体保持不变。详见 `docs/changelog/2026-10-10-round114-optimization.md`。
- 下一轮：Round 115，重新做 `applyStructuralFormats` 调用点级剖析或其他尚未证伪候选，禁止重复本轮图片扫描变体。

## Round 115/100 — 2026-10-10
- 本轮候选全部否决，未落地生产代码、未升号、未发布；轮次计入完成计数。评估 `applyStructuralFormats` 列表候选组 CV 计算：用两遍 `Uint32Array` 数值累加替换每组临时 `lengths` 数组与 `reduce`。
- 27/27 份真实样本完整 dump 逐文件一致；交错 4×NEW/4×OLD、每进程20轮：NEW 中位数 98.244/97.926/98.165/97.483 ms，OLD 97.395/96.465/97.758/97.269 ms，NEW 四组均未优于 OLD，按硬纪律撤回。
- 撤回后 `npm test` 75 文件 / 1446 项、`vue-tsc`、`build`、`build:lib`、`lint` 均通过；`bench-diff 1150` 27/27 成功且与 cycle-1140 逐字段一致，中位数 0.950、p25 0.915、p10 0.897、min 0.812。工作区干净，版本保持 0.7.55。详见 `docs/changelog/2026-10-10-round115-optimization.md`。
- 下一轮：Round 116，重新围绕 `createParagraphsWithRealFormats` 或其他尚未验证的真实热点做调用点级剖析，避免重复列表 CV 计算和图片扫描查表变体。

## Round 116/100 — 2026-10-10
- 采纳 1 项真实数据优化：`createParagraphsWithRealFormats` 按 `papx.istd` 缓存段落样式继承解析结果，避免重复 `resolveStyleFormat` 链遍历；新增 `tests/docParser.styleCache.test.ts` 护栏。
- 真实 27 份完整 dump 逐文件一致；故意错误缓存键的负控检测到差异。
- 独立进程交错 4×OLD/4×NEW、每进程20轮：OLD 中位数 98.481/98.641/98.656/98.927ms，NEW 94.795/95.670/95.670/96.532ms，四组均改善，约 2.4–3.9%。
- `npm test` 76 文件 / 1447 项、`vue-tsc`、lint、build/build:lib、bench-diff 1160 均通过；bench 与 cycle-1150 逐字段一致，中位数 0.950、p25 0.915、p10 0.897、min 0.812。
- 包体：主包 gzip 109.91 kB；库入口 gzip 94.95 kB、UMD gzip 83.11 kB。详见 `docs/changelog/2026-10-10-round116-optimization.md`。
- 下一轮：Round 117，重新剖析尚未证伪的真实热点。

## Round 117/100 — 2026-10-10
- 本轮候选否决，未升号、未发布；轮次计入完成计数。候选为「`detectParagraphFormat` 共享一次 `trim()` 并透传给 `detectAlignment` / `detectListInfo`」。
- 并发处置：本轮执行期间检测到并发自动化运行已把该候选提交为 `bcea037`，但未升号、未发布，且随后另一次运行又记为「已否决、已撤回」，状态不一致。本会话对 `bcea037` 做独立复核后据实撤回。
- 复核：候选与 Round 116 基线 27 份真实样本完整 `parseWithFormat()` 结果（16,247,039 字符）逐字节一致（语义等价）；交错 4×NEW/4×OLD、每进程 20 轮，NEW 中位数 114.215/112.306/111.857/104.667 ms，OLD 114.820/112.162/107.746/104.620 ms，NEW 仅 1/4 组优于 OLD、其余 3 组退化（最多约 3.8%），无稳定收益，按硬纪律否决。
- 撤回 `src/utils/docparser/heuristics/textHeuristics.ts` 至 Round 116 基线并删除 `tests/textHeuristics.paragraphFormat.test.ts`；保留 `bcea037` 中无害的 `.gitignore` 新增项 `.autopilot/`。
- 另否决「`resolveStyleFormat` 全局 `WeakMap` 缓存」候选（按数组身份键控，破坏「公开函数反映调用方可变数组」语义），改为新增常驻护栏 `tests/styleParser.test.ts` 的调用方可变性断言，并用缓存版负控验证护栏有鉴别力。
- 撤回后 `npm test` 76 文件 / 1448 项、`vue-tsc`、lint、build/build:lib 均通过；`bench-diff 1170` 27/27 成功，中位数 0.950、p25 0.915、p10 0.897、min 0.812，与既有基线一致。
- 包体与 Round 116 一致：主包 gzip 109.91 kB；库入口 gzip 94.95 kB、UMD gzip 83.11 kB。版本保持 0.7.56。详见 `docs/changelog/2026-10-10-round117-optimization.md`。
- 下一轮：Round 118，重新剖析真实热点，优先验证尚未证伪的调用点级候选。

## Round 119/100 — 2026-10-10
- 本轮候选否决，未升号、未发布；评估复用同一 `PlcfFld` 字段位置表解析结果，避免 hyperlinks/TOC、page fields、cross-references 三处重复 `parsePlcfFld`。
- 27 份真实样本完整 `parseWithFormat()` dump 逐字节一致，共 16,247,039 字符；交错 4×NEW/4×OLD、每进程 20 轮，NEW/OLD 中位数分别为 114.061/107.528、105.183/112.578、107.734/106.507、106.235/104.868ms，仅 2/4 组胜出，四组中位数中 NEW≈108.30ms、OLD≈107.87ms，整体略慢且无稳定收益，按硬纪律撤回。
- 撤回后 `npm test` 76 文件 / 1448 项、`vue-tsc`、lint、build/build:lib 均通过；包体保持 Round 116 基线：主包 gzip 109.91 kB、库入口 gzip 94.95 kB、UMD gzip 83.11 kB。
- `bench-diff 1190`：27/27 解析成功，中位数 0.950243、p25 0.915450、p10 0.896816、min 0.811547，与上一轮字段一致（除 cycle/timestamp）。版本保持 0.7.56，工作区已清理。
- 下一轮：Round 120，重新剖析真实热点，优先验证尚未证伪的调用点级候选。

## Round 120/100 — 2026-10-10
- 本轮候选否决，未落地生产代码、未升号、未发布；评估 `mergeCharFormatForParagraph` 逐字段回退样式属性，避免每个 CHPX run 创建 `{ ...styleFormat, ...run.format }` 临时对象。
- 候选来自真实 CPU profile：`mergeCharFormatForParagraph` 自耗约 3.10%，位列热点第 8；改动只在隔离 bundle 中验证，源码恢复至 Round 119 基线。
- 27/27 份真实样本完整 dump 逐字节一致；全量 `npm test` 76 文件 / 1448 项通过，`vue-tsc`、lint、build/build:lib 均通过；应用主 JS gzip 109.91 kB，库入口 gzip 94.95 kB，UMD gzip 83.11 kB。
- 交错 4×NEW/4×OLD、每进程 30 轮：NEW/OLD 中位数分别为 111.320/111.491、113.052/108.492、111.230/110.513、109.771/108.160 ms，仅 1/4 组胜出；整体中位数约 NEW 111.32 ms、OLD 110.51 ms，候选无稳定收益且略慢，按硬纪律撤回。
- `bench-diff 120`：27/27 解析成功，中位数 0.950243、p25 0.915450、p10 0.896816、min 0.811547；与上一轮逐字段一致（除 cycle/timestamp）。版本保持 0.7.56，工作区已清理。
- 下一轮：Round 121，重新剖析真实热点，优先验证 `createParagraphsWithRealFormats`、`applyStructuralFormats` 或图片提取调用点级候选。

## Round 121/100 — 2026-10-10
- 本轮候选否决，未落地生产代码、未升号、未发布；评估 `createParagraphsWithRealFormats` 中 CHPX 回退格式合并后的 `styles` 清除路径，尝试以两轮键复制替代对象展开与解构 rest。
- 真实 CPU profile（1132 samples）中 `createParagraphsWithRealFormats` 自耗 11.75%，格式合并调用行约 2.47%，对象清除路径约 1.41%。隔离真实输入 32,690 次合并调用等价，3 个故意错误负控均被捕获，慢但等价对照通过。
- 27 份真实样本完整 dump 逐字节一致；主调用路径交错 4×NEW/4×OLD、每进程40轮，NEW/OLD 中位数 116.827/118.002、116.223/107.326、110.804/107.073、108.978/108.345 ms，仅 2/4 组胜出且两组退化，无稳定收益，按硬纪律撤回。
- 全量测试 76/1448、vue-tsc、lint、build/build:lib、bench-diff 121 均通过；bench 中位 0.950243、p25 0.915450、p10 0.896816、min 0.811547，与 Round 120 逐字段一致。包体保持主包 gzip 109.91 kB、库入口 94.95 kB、UMD 83.11 kB。
- 版本保持 0.7.56，生产源码无变化；详见 `docs/changelog/2026-10-10-round121-optimization.md`。
- 下一轮：Round 122，重新剖析真实热点，优先寻找主调用路径可稳定获益的低分配候选。

## Round 122/100 — 2026-10-10
- 采纳 1 项真实数据优化：将 `applyStructuralFormats` 中独立的图片占位符标记循环合并进列表长度分析循环；无占位符段落继续直接读取长度，含占位符段落在同一处完成剥离与 `__hasEmbeddedPic` 标记。
- 27 份真实样本完整 dump 逐文件一致；隔离 20 轮候选/基线中位数 112.229/116.157ms。
- 独立进程交错 4×候选/4×基线、每进程25轮：候选/基线中位数 113.630/118.640、111.190/113.979、110.433/114.960、112.970/114.960ms，四组均改善，约 2.2%–4.2%。
- `npm test` 76文件/1448项、类型检查、lint、build/build:lib、bench-diff 122 全部通过；bench 与 cycle-121 逐字段一致（除 cycle/timestamp）。
- 包体保持主包 gzip 109.91 kB、库入口 94.95 kB、UMD 83.12 kB；版本升至 0.7.57，双包发布并核验 registry latest。
- 详见 `docs/changelog/2026-10-10-round122-optimization.md`。
- 下一轮：Round 123，重新剖析真实语料，优先审计剩余高占比路径，避免重复已验证候选。

## Round 123/100 — 2026-10-10
- 本轮基于真实 CPU profile 与字符分布审计 `createParagraphsWithRealFormats`、`applyStructuralFormats`、图片扫描、base64 和字符样式路径；未找到满足语义可证明、真实数据稳定收益且低风险的新增候选，未修改生产代码。
- profile 总样本 873：GC 10.42%、`createParagraphsWithRealFormats` 10.42%、`applyStructuralFormats` 合计 8.93%、图片扫描 4.47%、base64 4.12%；真实字符 1,456,460，ASCII 99.869%、CJK 0.003%。
- 27 份真实样本 dump 基线保持一致；`npm test` 76/1448、类型检查、lint、双构建全部通过；bench-diff 123 与 cycle-122 除 cycle/timestamp 外逐字段一致。
- 按硬纪律本轮为否决/无候选轮：版本保持 0.7.57，不升号、不提交、不发布双包。详见 `docs/changelog/2026-10-10-round123-optimization.md`。
- 下一轮：Round 124，重新实时剖析剩余高占比路径。

## Round 118/100 — 2026-10-10
- 本轮候选否决，未落地生产代码、未升号、未发布；轮次计入完成计数。候选为在 `mergeCharFormatForParagraph` 中预计算每个 CHPX run 的合并样式，避免段落级回退路径重复创建 style spread 对象。
- 27/27 份真实样本完整 `parseWithFormat()` dump 逐字节一致；全量 `npm test` 76 文件 / 1448 项通过，`vue-tsc`、lint、build/build:lib、bench-diff 118 均通过。
- 交错 4×NEW/4×OLD、每进程 20 轮：NEW/OLD 中位数分别为 105.050/105.081、104.785/104.688、105.511/103.788、105.004/106.931 ms，仅 2/4 组胜出且出现退化，无稳定收益，按硬纪律撤回。
- 版本保持 0.7.56，工作区干净，未发布；详见 `docs/changelog/2026-10-10-round118-optimization.md`。
- 下一轮：Round 119，重新基于真实剖析寻找尚未证伪且能在交错端到端中稳定获益的调用点级候选。

## Round 124/100 — 2026-10-10
- 否决图表流扫描第二字节锚点候选；生产代码完全撤回，保留 `tests/chartParser.streamScan.test.ts` 的4项真实流/边界常驻护栏，版本保持0.7.57，不升号、不发布。
- CPU profile 2239采样点：图表扫描占3.35%；27条真实WordDocument流共5,767,130字节，第二字节候选数比首字节少9.15%。真实隔离6组、每次200轮，中位OLD=664.579ms、NEW=650.256ms，约改善2.16%，但不足以证明端到端收益。
- 交错4×NEW/4×OLD、每进程40轮，NEW/OLD中位103.677/110.595、101.843/102.120、100.656/101.950、102.224/101.052ms；第4组退化1.16%，收益不稳定，按硬纪律否决。
- 27份完整parseWithFormat结果系统cmp一致；3个源码错误负控各触发护栏失败，慢但等价拷贝对照通过，负控全部撤回。
- 全量76文件/1452项测试、vue-tsc、lint、双构建通过；bench-diff124与123除cycle/timestamp外逐字段一致。主包/ESM/UMD gzip保持109.91/94.95/83.12kB。
- 详见 `docs/changelog/2026-10-10-round124-optimization.md`；下一轮Round125，重新剖析避免重复已否决方案。

## Round 125/100 — 2026-10-11
- 采纳JPEG熵编码段indexOf跳跃搜索；仅跳过非FF空转字节，保留填充/转义/标记/截断回退语义。版本0.7.57→0.7.58，按协议提交并双包发布，完成详情以optimization-loop.json/audit为准。
- CPU profile2873采样点，findJpegEnd自耗1.46%，主要在熵段逐字节扫描；45条真实流共6,455,182字节，提取125图/7JPEG。隔离6组150轮，上中位OLD730.217ms、NEW665.942ms，耗时降低8.80%。
- git stash仅切候选源码构建基线后恢复，双bundle预构建；交错4×NEW/4×OLD每进程50轮，NEW/OLD中位95.572/95.919、97.306/98.467、97.419/98.405、96.855/98.039ms，四组改善0.36%–1.21%。
- 27份候选及最终生产构建完整dump系统cmp通过；新增15项JPEG真实产出/65536穷尽/边界护栏，旧oracle逐行机器对照通过；3个错误负控失败、慢但等价对照通过。
- 全量76文件/1467项、类型/lint/双构建通过；bench-diff125与124除cycle/timestamp外逐字段相同。主包/ESM/UMD gzip109.94/94.98/83.14kB，分别+0.03/+0.03/+0.02kB。
- 详见 `docs/changelog/2026-10-11-round125-optimization.md`；下一轮Round126，目标Round208。

