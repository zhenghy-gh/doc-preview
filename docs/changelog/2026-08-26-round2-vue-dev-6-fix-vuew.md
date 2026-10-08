# FIX-VUEW 完工变更摘要 · vue-dev-6 · 2026-08-26

## 任务
FIX-VUEW（leader 直发任务卡，captain 补全并授予接线后第一写者窗）：
① copyText 中文 title 选择器失效 → data-attr 方案（已批准）
② 缩放溢出（≥150% 裁切 / 与大纲侧栏重叠）修复

## 改了什么（业务代码仅 src/components/DocPreview.vue 三处 hunk；文件其余 M 为 vue-dev-3 T3-W3 在案改动）

### ① 复制按钮定位（~L1411 showCopySuccess + ~L1751 模板按钮）
- 根因：`document.querySelector('.toolbar-btn[title*="复制"]')` 以中文 title 文本定位按钮；I18N 波把 title 换成 `t('toolbar.copy')` 后 EN 界面为 "Copy text to clipboard"，选择器失配 → 复制成功 ✓ 反馈永不出现。
- 修复：📋 按钮加 `data-action="copy-text"` 语言无关属性；选择器改 `.toolbar-btn[data-action="copy-text"]`；注释记录根因。

### ② 缩放实现（~L3063 .paper-page 块）
- 根因：`transform: scale(var(--zoom))` 不参与布局——布局盒恒为 max-width 800px。≥150% 时视觉盒（150%→1200px、200%→1600px）向四周溢出：横向被容器/视口裁切、纵向压过后续面板（stories/properties）；且 transform-origin: top center 使左缘向左扩展，侵入 float:left + sticky 的大纲侧栏（220px）形成重叠。
- 修复：改用真实回流布局的 **`zoom: var(--zoom, 1)`**（CSS Baseline 2024：Chrome/Edge/Safari 长期支持、Firefox 126+/2024-05）。布局盒随缩放同步伸缩、margin:auto 保持居中、文档流正确预留高度宽度——裁切与重叠从根消除，空间不足时浏览器给出原生滚动条而非裁切。移除失去意义的 transform-origin 与 transform 过渡。

## 为什么这样修
- zoom 是唯一能让布局随缩放同步回流的标准属性；transform 方案要正确预留空间需 JS 测高补偿（高成本且与虚拟滚动高度缓存纠缠）。虚拟滚动量测（getBoundingClientRect）在新旧方案下均含缩放因子，语义一致无回归。
- data-action 属性对 i18n/class 重构免疫，且可被测试直接断言。

## 影响面
工具栏复制反馈路径 + .paper-page 缩放视觉路径。渲染管线（renderDocumentToPages/.page-content HTML）、虚拟滚动逻辑、解析器零触碰。MIN_ZOOM=50/MAX_ZOOM=200/STEP=10 未动。

## 关键度量（前→后）
- 新增 tests/fixVuew.test.ts（2 用例）：①挂载真实 DocPreview（setupState 关闭初始 loading 渲染工具栏，perf-baseline 同款手法）断言 [data-action="copy-text"] 存在且即 📋 按钮；②静态守卫钉死 .paper-page 必用 zoom、禁回退 transform:scale、旧中文选择器不得作为 querySelector 实参复活。
- npm run build ✅ vue-tsc 0 错误 / vite 1.08s。
- npm test ✅ **53 文件 / 1258 用例全绿**（1245 → 只增不减含本任务 +2；含 renderGolden 8/8 零漂移）。
- 注：本轮 build 的 worker 哈希变化（Dx_E8zp0→CovmPJR7）与本任务无关（DocPreview.vue 不进 worker chunk），系工作区他人并行在案改动所致，提请初验时勿误记我账。

## 用户可见效果
- 中英文界面下点复制均能出现 ✓ 成功反馈；
- 缩放 110%–200% 每档：页面完整可见不再右侧/底部裁切，开启大纲侧栏时不再被放大后的纸张覆盖；200% 下窗口过窄出现横向滚动条（原生行为）。

## 遗留备忘
- Firefox <126 不支持 CSS zoom，缩放控件对其无效（此前该群体是"能缩放但裁切重叠"的坏体验，现为不生效的降级，属可接受权衡，已写入代码注释）。
- 缩放切换后虚拟滚动占位高度沿用加载时缓存（新旧实现共有的既有语义），如需跟随缩放刷新属 PERF-T1 高度缓存域，未越界处理。
