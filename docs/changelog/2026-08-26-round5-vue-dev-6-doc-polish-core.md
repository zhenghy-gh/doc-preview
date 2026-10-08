# DOC-POLISH 核心五项完工变更摘要 · vue-dev-6 · 2026-08-26 19:15 CST

## 任务
leader 直发进窗令（合入暂停解除）：DOC-POLISH 核心五项清单——①模板硬编码中文换键 ②大纲键盘可达 ③模态焦点管理核销确认 ④preventDefault 守卫 ⑤role=alert/accessible name。

## 改了什么（4 文件；DocPreview.vue 大额 diff 含此前各波在案改动，本轮净增以逐条列示为准）

### 字典新增 4 键（src/utils/locale.ts，zh/en 双册对称）
`app.skip.content` / `search.prevMatch` / `search.nextMatch` / `search.close`（其余全部复用既有闲置键：toolbar.zoom.in/out/reset/reset.aria、toolbar.search、toolbar.print、images.alt、story.image.caption、sections.index、images.floating——兑现审计 A6"死键复活"路线）。

### ① 模板硬编码中文换键（26 处批量 + 2 冒号）
- skip-link/缩放三钮/搜索钮/打印钮 → 既有键
- 搜索条 ▲▼ 钮：aria 换新键 search.prevMatch/nextMatch，**顺带修复 title 误用 `t('search.placeholder')+' ▲'` 的错位语义**
- 关闭搜索钮 → search.close 新键
- 图片 alt ×2 → images.alt({n})；caption 兜底 → story.image.caption；节N → sections.index({n})；浮动 → images.floating
- **13 处面板标题全角括号** → 新增 `panelTitle(key, n)` 助手：zh 全角（）/ en 半角 ()，按 currentLocale 取形
- crossRefs 两处全角冒号 → ASCII ": "（与属性面板既有风格一致）
- 验收：模板区"含中文且非 t()"行数 = **0**

### ② 大纲键盘可达（原 P1①）
outline-item 增 `role="button"` + `tabindex="0"` + `:aria-label` + `@keydown.enter/space.prevent` → 键盘用户可全程使用大纲跳转。

### ③ ShortcutsPanel 模态焦点管理（核销落地）
- `aria-modal="true"` + panel `tabindex="-1"`
- 打开：记录 previouslyFocused → nextTick 焦点移入面板；关闭：焦点归还触发元素
- Tab 圈闭 trapFocus（首尾循环+逃逸回收），WAI-ARIA dialog 模式

### ④ preventDefault 守卫（原 P2④）
翻页类按键（PageUp/PageDown/Home/End）新增 `inPreview` 包含性判定：焦点不在本组件预览区内时放行浏览器原生行为，不再 document 级全局劫持滚动。

### ⑤ role=alert 与可及名
- ErrorDisplay 容器 + App error-banner 补 `role="alert"`（出现即被读屏播报）
- App.vue 三枚 emoji 图标钮（主题/字体/阅读模式）补 :aria-label（复用 app.theme.*/app.font.*/app.reader.* 键）；语言钮补显式 aria-label

## 影响面与红线实测
- 过程一次笔误（defineProps 未接参致 script 内 modelValue 未绑定）当场被 vue-tsc 拦截，即改 props.modelValue 后全绿——无带病落盘。
- npm run build ✅ vue-tsc 0 错误 / vite 0.75s；main 314.21KB/gzip107.20（较上轮 +2KB 为焦点管理与助手逻辑，远低 §2.1 阈值）
- npm test ✅ **58 文件 / 1287 用例全绿**；renderGolden ✅ 11/11 零漂移（快照仅覆盖 .page-content 内联 HTML，组件 chrome 变更天然不扰）
- localeIntegrity 双字典键集/插值参数守卫 ✅（新增键两侧对称）
- 未 commit。写者窗用毕交还。

## 遗留备忘（未越界项，供后续排期）
脚本层硬编码中文（审计 A5：错误文案簇/无匹配/磅单位/打印页脚 CSS/[分页]标记/文本框 tooltip）属模板外文案域，本令范围仅模板故未动；copyText 中文选择器已随 FIX-VUEW 清除。
