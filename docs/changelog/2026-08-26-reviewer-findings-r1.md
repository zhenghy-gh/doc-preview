# reviewer-findings-r1 —— 工作区全部未提交改动首轮驻场评审

- 评审人：reviewer · 2026-08-26 · 只评不改（本文档为唯一产出物）
- 评审对象：当前工作区全部未提交改动 = rendering/ 六模块（chartRenderer/inlineAssetRenderer/listRenderer/paragraphStyleRenderer/pageBuilder/documentRenderer）+ DocPreview.vue 接线（5990→4818 行）+ TD-1a 类型收敛（docFormat/docParser/worker/parseWithWorker）+ W1-B（safeStorage/心跳/locale）+ W1-C（useDarkMode/App.vue 暗黑）+ W1-D（vite.config/package.json/dist-lib）+ I18N-P0（ShortcutsPanel/useI18n）+ tableText.collectTableBlock + 全部新增测试
- 方法：逐文件通读 diff/全文；对照首轮评审 checklist 五维（正确性/类型安全/边界条件/性能陷阱/Vue 响应式误用）；关键疑点交叉实证（token 存在性 grep、file-sample 引用 grep、dist 编译产物抽查）
- 独立验证：`npx vitest run`（renderGolden/documentRenderer/pageBuilder/listRenderer/chartRenderer/inlineAsset/paragraphStyle/safeStorage/heartbeat/shortcutsPanelI18n/composables）= **12 文件 / 107 用例全绿**（09:23 快照）
- 注意：评审期间工作区被队友并行修改（.gitignore 增补 dist-lib、probe 脚本删除发生在评审中途），行号以评审时点为准

---

## 一、I18N-P0 关闭质量（vue-dev-6）—— ✅ 通过，可销账

**结论**：修复正确、根因清晰、回归钉到位，同意关闭。

1. 根因诊断正确：shortcuts.items 为嵌套 Record，扁平键 `t('shortcuts.items.xxx')` 必 miss；改 `tMap('shortcuts.items', subKey)` 激活既有嵌套路径，无行为外溢。
2. ShortcutsPanel.vue：`shortcutList` computed 内调用 tMap → 渲染期读取 `_locale.value`，语言切换响应性成立；模板其余 t('shortcuts.title/close/help') 为顶层键，不受影响。
3. useI18n.ts 纯委托单例实现干净：readonly Ref 暴露、不复制状态、与 locale.ts 导出面同构；注释如实标注"options.dict 未来扩展"未实现，无过度承诺。
4. tests/shortcutsPanelI18n.test.ts：R1 裸 key 禁现 + R2 双语真实文案抽样 + afterEach 还原语言单例，质量好。

**遗留（不阻门，登记即可）**：
- 字典 4 条无绑定快捷键标签（toggleOutline/toggleDarkMode/focusContent/closePanel）——vue-dev-6 已移交，随 a11y 波或 DOC-POLISH 裁决。
- **I18N-G1**（缺口增补）：`inlineAssetRenderer.renderTextboxAnchorHtml` 已注入 `t` 却仅用于 anchorType，`位置/尺寸/锚点/文本框/浮动` 仍硬编码中文（inlineAssetRenderer.ts:33-60）；`documentRenderer.ts:83` 空文档兜底串 `<p>文档内容为空</p>` 硬编码。建议纳入 i18n 缺口清单（与 vue-dev-2 契约草案域 E 的缺口③④合并跟踪）。
- **I18N-G2**（存量提醒）：`locale.t` 缺键返回键名本身 → 全仓大量 `t(...) || fallback` 永不回退的模式仍在（首轮 M12），I18N-P0 只修了 shortcuts 一处。建议后续波次统一约定。

## 二、W1-B 并发边界（net-dev：safeStorage + 心跳）

**总体**：设计质量高。两段式心跳（启动 30s / 空闲 60s）方向正确且有假时钟边界测试（89s 存活断言、不二次结算断言）；per-call Worker 实例 + 闭包内计时器，多请求互不干扰；settled 守卫完整覆盖 onmessage/onerror/onIdleTimeout 三路竞争。

- **W1-B-R1（中）safeStorage 镜像复活**：`getItem` 把「原生返回 null（键不存在/被他处删除）」与「原生不可用」同等对待而回退内存镜像（safeStorage.ts:58-62）。后果：用户在其他标签页清除站点数据或 DevTools 删键后，本会话下一次读取会把已删除的偏好从镜像"复活"。建议：nativeGetItem 三态区分（undefined=环境不可用→回退镜像；null=键确凿不存在→视为权威并顺带清镜像）。
- **W1-B-R2（中低）无取消 API + 更长的孤儿窗口**：parseWithWorker 不提供 abort/dispose；组件卸载后 Worker 与计时器照常存活至结算。空闲窗引入前最坏 30s，现在最坏 30s+60s×N 心跳续命，孤儿 Worker 存活时间显著变长（解析完成即终止的正常路径不受影响）。建议：返回句柄 `{ promise, cancel() }` 或由宿主 onUnmounted 触发 terminate；至少在 DocPreview 卸载时清理。
- **W1-B-R3（低）启动窗内的静默主线程降级**：Worker 脚本 chunk 加载计入 30s 启动窗；慢网超时后 ≤16MB 文件走 fallbackParse = 主线程同步解析，大文件会造成 UI 冻结——恰是 Worker 要避免的体验，且用户无感知切换。建议：降级路径打 logger.warn（便于现场诊断），长期可把"启动窗"起点改为首字节到达后起算。
- **W1-B-D1（决策项意见）启动窗 30s vs 60s**：**建议维持 30s**。理由：真实解析会在入口同步上报首条 progress，窗口内只有脚本加载耗时；完全无响应的 Worker 早失败收益大；net-dev 所述"两个既有测试以 30_000ms 断言"虽是现实约束，但即使改也只值一行，不必为此放宽失败延迟。
- 备注：fallbackBuffer ≤16MB 预拷贝全程驻留属已知 C3 台账项，非本轮新引入，不重复立案。

## 三、W1-C 同步边界（ui-kit-dev：useDarkMode + App.vue）

**总体**：单一数据源目标达成，App.vue 14 处硬编码色全量 token 化且所用变量（--accent-gradient-from/to、--accent-hover、--accent-light、--error-*、--shadow 等）已核实双主题均有定义；DocPreview 仅 11 行外科手术接入，模板绑定零改动。storage 事件回环分析正确（同值守卫 → 一跳收敛，不成风暴）。

- **W1-C-R1（低）storage 回声写回**：收到他标签事件赋值后 watch 会把同值再写回原生存储（useDarkMode.ts:52-56 + 61-65）。无害（一跳收敛）但产生冗余写与一次多余 storage 广播；可在 watch 内比较原生现值短路。顺手项，不阻门。
- **W1-C-R2（低）系统偏好运行时不跟随**：仅在模块加载读一次 prefers-color-scheme；无存储偏好的用户在应用打开期间切换系统主题不会跟随。建议补 matchMedia change 监听（仅在无存储偏好时生效）。
- **W1-C-R3（低）`event.newValue === null` 忽略 × W1-B-R1 叠加**：他处删键保持当前态是合理选择，但叠加 safeStorage 镜像后，"删除"在本会话彻底失效（见 W1-B-R1）。修 W1-B-R1 时需一并复核此交互。
- **W1-C-R4（中低）第三偏好键漏收编**：App.vue L124/L128 `use-webfont` 仍裸读裸写 localStorage——受限环境下 `toggleWebFont` 抛 SecurityError 且未捕获（事件回调内未 try/catch）。B1 的白屏风险它没有（在 setup 内而非模块顶层），但与 B1/B2 方向不一致且是真实的受限环境崩溃点。建议随 B2 键名前缀波一并收编 safeStorage。

## 四、W1-D 发布残留（vue-dev-5：vite.config/package.json）

**总体**：产物隔离方案正确（app=dist / lib=dist-lib、emptyOutDir、dts 同步、exports 条件映射 types 前置、files/prepublishOnly/engines/sideEffects 齐备）；样本 doc 排除插件经 grep 证实 src/index.html/examples/README 零引用，GH Pages 演示不受影响。

- **W1-D-R1（中，流程性）.gitignore 与产物隔离必须同 commit**：评审中途观察到 .gitignore 新增 `dist-lib` 条目（此前 vue-dev-5 自报"未含 dist-lib/ 现 untracked"）。若该 hunk 未与 vite.config/package.json 绑定提交，中间态任何 `git add -A` 都会把 354KB ES + 259KB UMD 产物带入版本库。请 captain 在提交流程中把三者锁为一个原子提交。
- **W1-D-R2（中低）文档残留**（作者已自报，发布前必修）：README L91/L93 与 examples/standalone.html L121 仍引用 `./dist` 库产物路径；`npm i` 消费者按旧路径 import 将直接失败。
- **W1-D-R3（低）双 CSS exports 键缺弃用说明**：`"./style.css"` 新键 + `"./dist/style.css"` 兼容旧键并存是对的，但未注明弃用时间表；建议 CHANGELOG/README 标注"旧键保留至 x.y，届时移除"，避免永久双载。
- **W1-D-R4（低）排除守卫是点删除不是模式排除**：closeBundle 里 rmSync 单个文件（vite.config.ts 新增插件）。publicDir 未来新增任何样本/大文件都会再次无声进 dist。建议维护排除数组或改为构建前 staging publicDir。

## 五、快照协议对齐 + 迁移等价性

- **R-1（高·本轮最重要发现）列表项的修订/超链接抑制语义在接线中丢失**：
  - 原实现（迁移前 DocPreview.vue#renderNestedList）：列表项渲染显式传 `renderParagraphHtml(child.text, …, 0, child.text.length, [])` —— 第 6 参 hyperlinks=[] 显式清空、第 7 参 revisions=undefined，**列表项刻意不吃全文链接与修订**。
  - 现实现：documentRenderer 的 renderParagraphHtml 闭包化为 5 参（documentRenderer.ts:93-99），内部恒用 `input.hyperlinks`/`input.revisions`（:82,113-115,124-143）；listRenderer.ts:112 虽仍按旧形状多传 `[]`，但已被闭包无视。
  - 后果：凡文档同时含列表与**位于文档前部（cpStart < 任一列表项文本长度）的超链接/修订**——每个 `<li>` 都会被注入同一锚链接；marks 模式出现错误 `<ins>/<del>` 包裹，accepted/rejected 模式甚至会在列表项里误删文本（applyRevisionsToText 以 [0,itemLen) 为窗口命中真实修订区间）。
  - 为什么 8/8 golden 零漂移没拦住：现有夹具 list 与 revisions 是两个互斥场景，无"列表×修订""列表×超链接"组合夹具——这正是快照协议的覆盖盲区。
  - 建议（小改）：① 给 renderParagraph 回调增加显式的 links/revisions 抑制通道（如 listRenderer 的 ParagraphHtmlFn 收紧为 5 参并在 documentRenderer 内提供 listVariant 闭包，捕获空数组）；② 补两个组合 golden 夹具钉死；③ ParagraphHtmlFn 类型里 vestigial 的 `hyperlinks?: unknown, revisions?: unknown` 形参同步删除（现在是类型级谎言）。
- **R-2（中）golden 夹具矩阵缺口**：8 个夹具均单页、无分页断点、无 `\v` 软换行、无隐藏文字开关、无 pageBreakBefore、无多节分栏切换、无 FibBase/scoring 回退路径渲染形态。建议按「特性 × 组合」补 2-3 例（优先 R-1 的两组合），并把 CI=true 下漂移必败写成配置而非口头须知（toMatchFileSnapshot 非 CI 漂移只生成 pending 文件）。
- **R-3（低）documentRenderer 模块级可变计数器**：chartIdx/picIdx 为模块级 let（documentRenderer.ts:74-75），与文件头"纯度边界"声明相悖；当前同步执行无实际交错的可能，但既然 createPageBuilder 都做了状态实例化，这两个也应降为函数局部变量（两层闭包均可捕获），彻底消除"未来并发/重入即污染"的暗雷。同函数 `renderChartHtml(chart, chartIdx, t)` 的 seq 参数当前未被消费（chartRenderer `_seq`），属预留接口，建议注释标明。
- **R-4（低）RenderParagraph 死字段**：docFormat.ts 新增的顶层 `listId/listLevel/listType/listStyle/tableDepth/headingLevel/_cpEnd` 七个字段在渲染链路零消费（实际读取路径全在 paraFormat 上：documentRenderer.ts:270,289、listRenderer.ts:163-183）。类型噪声会误导后续消费者写出 `para.listType`（永远 undefined）。建议删除或明确注释"预留、勿用"。
- **迁移保真正面确认**：pageBuilder（魔数群逐一原样）、paragraphStyleRenderer（含 hasHtml 分支）、tableText.collectTableBlock（含 parsedRows<1 continue 的怪癖）、listRenderer 双层 \u0001 消费结构、尾部图表/图片兜底循环，均与原实现逐段一致；TD-1a 类型收敛干净（worker 产物哈希不变是强证据）；CHART-FIX-S1 文字卡处置干净且 name 已转义。

## 六、存量问题现状核对（防重复派单，均为本轮改动范围外的遗留）

| 编号 | 问题 | 现状 | 归属 |
|---|---|---|---|
| 首轮 H5 | measureVisiblePageHeights 用已渲染子集序号当页面索引（现 :1008-1018） | 未修 | perf-dev T1（排队） |
| 首轮 M6 | 属性面板与文档域面板共用 v-model="showProperties"（现 :1928/:2018） | 未修 | 待派 |
| FIX-VUEW① | copyText `title*="复制"` 选择器（现 :1412） | 未开工 | vue-dev-6（卡已补发） |
| FIX-VUEW② | transform:scale 缩放溢出 + 测量失真（现 :3069） | 未开工 | vue-dev-6 |
| 首轮 M14 | 大纲导航 index 与 DOM p 序号错位 | 未修 | 待派（建议 data-para-index） |
| net A4 | loadFromUrl/loadFromFile 连续加载无代数号竞态（watch source 现 :1658） | 未修 | W2-1 |
| 首轮 M4 | hasHtml=true 时段落文本绕过 escapeHtml（现 paragraphStyleRenderer.ts:121/156/161/259） | 未修 | 安全专项待排 |

## 七、裁决请求汇总（请 captain 定夺）

1. **R-1 是否阻塞 T3 收官终验**：reviewer 意见=是（迁移引入的行为回归 + 违反其自身"行为等价红线"声明）；修复成本低（一处闭包变体 + 两个夹具）。
2. W1-B-D1 启动窗维持 30s（reviewer 支持 net-dev 现状）。
3. W1-D-R1 的 .gitignore 原子提交要求是否写入本轮提交 checklist。
4. I18N-G1/G2、W1-C-R4(use-webfont) 并入哪一波（建议 B2 键名前缀波搭车）。

—— reviewer · 2026-08-26 · 本轮零业务代码改动，定向测试复跑 107/107 仅作验证
