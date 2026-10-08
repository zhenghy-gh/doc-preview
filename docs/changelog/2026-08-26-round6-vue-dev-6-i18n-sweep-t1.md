# I18N-SWEEP-T1 完工变更摘要 · vue-dev-6 · 2026-08-26 19:30 CST

## 任务
leader 直发（captain v70）：①脚本层硬编码文案簇（审计 A5）换键；②COMPOSABLES-E 后续——App.vue 语言按钮 useI18n 接线。

## 改了什么（3 窗口内文件）

### App.vue
1. **useI18n 接线兑现**：`import {currentLocale,setLocale,t} from utils/locale` → `useI18n()` 解构（`locale: currentLocale` 重命名保持模板零改动）。setLocale 经 safeStorage 持久化 + 单例顶层启动恢复全链路即得，语言选择刷新不丢。
2. 错误文案 ×4 换既有键：app.upload.error.docx / error.format({ext}) / error.size({size,max}) ×2
3. 语言钮 aria 由双语硬编码字面量简化为 `:aria-label="t('app.lang.switch')"`（键值即该双语串）。

### DocPreview.vue 脚本层 ×9
- onErrorCaptured：'未知渲染错误'→error.parse.unknown、❌串→error.render({msg})
- '解析失败' ×2 →error.parse.fail；'未知错误' ×2→error.parse.unknown
- 空文档长文案→新键 error.emptyDoc（zh 逐字节保留原文案/en 新译）
- searchStatusLabel '无匹配'→search.no.results（措辞升级为"无匹配结果"，组件 chrome 非快照面）
- formatSizePt 磅单位→新键 sections.sizePt（{pt}磅 ({cm}cm)/{pt} pt ({cm} cm)，zh 字节不变）
- 打印页脚 CSS 三段→print.p1/p2/p3（第 X 页 / 共 Y 页 ↔ Page X of Y）
- 弹窗拦截 alert→新键 print.popupBlocked

### locale.ts
新增 5 组键双册对称：error.emptyDoc / sections.sizePt / print.p1 / print.p2 / print.p3 / print.popupBlocked。

## 明确顺延项（非遗漏，各有契约级理由）
1. **文本框 tooltip 簇+documentRenderer:83 空文档兜底**：已迁入 rendering/ 纯函数模块（合同禁 vue 依赖），换键需先裁决"纯渲染器 i18n 注入"契约（options 注入 or 调用方预格式化）。且 zh 字节需逐字保留防 golden 漂移。
2. **加载超时双串**（DOMException reason+error.value）：errorClassifier 以『加载超时』关键字匹配 network 类，翻译须同步改分类器关键词——跨模块语义耦合，单独小单。
3. **[分页] 标记**：AGENTS#32 有意设计，维持。

## 红线实测与责任面切割
- npm test ✅ **58 文件/1287 用例全绿**（终验）；renderGolden ✅ 11/11 零漂移
- 我窗口三文件 vue-tsc **零错误**
- ⚠️ 全局 build 红 3 错误位于 src/utils/docparser/formatRecovery.ts（TS2304 ctx ×2/TS6133 ×1）——**他写者 19:17-19:23 并行落盘的新模块半成品**（mtime 三连跳实证），非本任务产物、未触碰；预计其收敛后自清，若静默后仍红请重派。
- 过程一笔 useI18n 契约名笔误（currentLocale vs locale）被 tsc 拦截即改。

## 效果
EN 语言下上传校验/解析错误/空文档/搜索状态/尺寸单位/打印页脚全部英文呈现；语言选择持久化经 useI18n 统一入口。A5 清单闭环率：窗口内 100%，纯渲染器域 2 处待契约。
