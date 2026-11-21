# 2026-11-21 · 任务 B：a11y 深化评估（两项均否决，不强行改）

承接 `docs/changelog/2026-11-21-i18n-a11y-audit.md` 的结论（上一轮已确认工具栏/大纲
「全部按钮有可访问名、可聚焦、ARIA 状态正确，无阻断项」）。本轮按任务要求评估两项
「深化」是否值得落地，结论均为**否决**，证据如下。

## 1. PreviewToolbar 的 WAI-ARIA roving tabindex —— 否决

### 现状基线（已充分可达）

`PreviewToolbar.vue` 根节点已声明 `role="toolbar"` + `aria-label`；内部 **14 个原生
`<button>`**（缩放 3 + 搜索 1 + 打印/下载/复制 4 + 大纲/隐藏 2 + 主题/快捷键 2 +
翻页 2），全部默认 `tabindex=0`，Tab 可达、Enter/Space 可激活、各有 `aria-label`；
切换态有 `aria-pressed`，展开态有 `aria-expanded`/`aria-controls`，禁用态正确。
上一轮审计已判定**无阻断问题**。

### 键盘冲突核查（方向键确实空闲）

`DocPreview.vue#handleKeydown`（行 1630–1732）绑定的全局键为 Ctrl/⌘+F/P、Esc、
Ctrl+=/−/0、F3/Ctrl+G、PageUp/PageDown/Home/End、?/Ctrl+/ —— **没有 ArrowLeft/
ArrowRight/ArrowUp/ArrowDown**。故方向键移动焦点在键位上不与现有快捷键冲突。

### 否决理由（成本/风险高于边际收益）

1. **不是修缺陷，是改行为**：基线已经全键盘可达，roving tabindex 只减少 Tab 停靠点，
   属于键盘效率增强；没有用户缺陷驱动，收益纯边际。
2. **6 个动态禁用态使「始终恰有一个可聚焦停靠点」并非低成本**：`canZoomOut` /
   `canZoomIn` / `outlineAvailable` / `currentPage<=1` / `currentPage>=totalPages`
   在正常使用中频繁变化；正确实现必须在全部 14 个按钮上绑定响应式 `tabindex`，并加
   监听器在「当前停靠按钮变禁用」时把停靠点迁到下一个可用按钮，否则整个工具栏会
   从 Tab 序列「消失」（可访问性反退化）。这远超「加个方向键 handler」的成本。
3. **结构不规整**：工具栏被 `.toolbar-left`/`.toolbar-right` 两个无 role 的 div 分隔，
   夹着分隔线与统计 span，翻页按钮还嵌在独立的 `role="group"` 里；WAI-ARIA toolbar
   模式期望直接子项为工具栏项，此处需要额外的遍历/分组处理。
4. **外部焦点契约**：`DocPreview` 经 `defineExpose().focusSearchToggle()`（Ctrl+F 路径）
   直接 `.focus()` 搜索按钮；roving 状态需与该外部调用同步，又多一处状态一致性面。
5. **回归面**：改动落在一个已全绿、被 `a11yAudit.test.ts` 等测试覆盖的稳定组件上，
   需新增焦点管理测试并承担焦点顺序/禁用态的隐蔽回归风险。

按章程「风险/收益不佳即写结论、不强行改」⇒ 不实现。若未来确有键盘效率诉求，应作为
独立功能级变更，配套完整焦点管理测试与人工读屏验证，而非本轮顺带改。

## 2. 大纲项 `<div role="button">` 改原生 `<button>` —— 否决（证据不足）

### 现状基线（已是合规可访问模式）

`OutlineSidebar.vue` 的大纲项用 `<div role="button" tabindex="0" @click
@keydown.enter.prevent @keydown.space.prevent>`，配 `:focus-visible` 焦点环。
ARIA 角色、Tab 可聚焦、Enter/Space 激活三要素齐全，上一轮审计已确认正确。

### 否决理由

1. **无功能缺陷**：原生 `<button>` 的「Enter/Space 激活 + 隐式 button 角色」在该 div 方案里
   已由显式属性等价覆盖，切换不修复任何 bug。
2. **样式回归风险**：`.outline-item` 现依赖 div 的无边框/无背景默认样式；原生 button 带 UA
   边框与背景，需补 `border:0;background:transparent;width:100%;text-align:left;font:inherit`
   等重置，否则 `white-space:nowrap / text-overflow:ellipsis / 层级缩进` 视觉易漂移；缩进还
   依赖 `.outline-level-N` 的 CSS 变量，跨元素类型迁移需回归验证。
3. **重复激活风险**：原生 button 自身在 Enter/Space 触发 click，必须同时删掉两条
   `@keydown.*.prevent` 处理器，否则一次按键可能 emit 两次 `navigate`。
4. **测试契约改动**：`tests/components/a11yAudit.test.ts` 与 `searchAndOutline.test.ts`
   断言 `.outline-item` 的 `tabindex="0"` 与键盘激活；迁移需改测试，而当前测试已证明旧实现
   可用 —— 属于「为改而改」。

无证据表明现状不可达或违反规范 ⇒ 否决，保留 div 方案并记录。

## 结论

两项均为「已合规基线之上的边际增强」，在缺乏缺陷驱动时，改动成本与回归风险高于收益。
与上一轮 a11y 审计一致：**当前 UI 的 a11y 状态健康，不强行改**。未提供"为凑改动而写"的测试。
