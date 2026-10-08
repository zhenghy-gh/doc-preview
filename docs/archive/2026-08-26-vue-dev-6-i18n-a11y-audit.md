# vue-dev-6 i18n 完整性 + 键盘可达性/ARIA 审计（归档版）
署名 vue-dev-6 · 首轮核查（只查未改码）· 原载共享看板 vue-dev-6-i18n-a11y-audit，因看板 32 条上限按 D4 双轨制移入 docs/archive/。行号基于审计时点 DocPreview.vue=5990 行版本；T3-W3 接线后该文件行号整体漂移，引用前需重新定位。

■ A. i18n 完整性
A1 字典对称性 ✅：zh/en 各 286 顶层键 + shortcuts.items 嵌套 17 条，两侧键集完全一致。
A2 【P0→已修复】ShortcutsPanel.vue 13 处 t('shortcuts.items.xxx') 扁平键查嵌套字典必 miss 回退裸 key；tMap 死代码 0 调用。修复记录见 docs/changelog/2026-08-26-round1-vue-dev-6-i18n-p0.md。遗留：字典含 toggleOutline/toggleDarkMode/focusContent/closePanel 4 条无绑定标签，待裁决补绑定或删条目。
A3 动态拼接键 ✅ 全覆盖：charts.type/subtype、wordart.effect、shapes.type/anchor、sections.break、pageFields.type、crossRefs.type/switch、story.*、story.headerParts.* 与解析器产出逐一比对均存在。⚠️ 脆弱点：t() miss 返回 key(truthy)，`t('x.'+v) || t('x.unknown')` 兜底永不生效（原 442/446/450/647/667/1414/3390/3455/3481/3518/3530 行）。
A4 模板硬编码中文（原行号）：2872 skip-link「跳到文档内容」｜2893/2894/2895 缩放三钮 title+aria（toolbar.zoom.in/out/reset/reset.aria 闲置）｜2900 搜索文档｜2907 打印｜3015/3016 前一个/后一个匹配 aria（无键；title 误用 search.placeholder）｜3017 关闭搜索（无键）｜3082/3671 alt 图片N（images.alt 闲置；3688 旧路径已 t()化同屏不一致）｜3090 图片 fallback｜3388 节N｜3677 浮动。全角标点：13 处面板标题 `${t()}（${n}）`（3062/3268/3290/3313/3357/3377/3443/3469/3507/3547/3578/3615/3660）、3486/3490 全角冒号。
A5 脚本层硬编码中文：App.vue 26/28/55/78（app.upload.error.docx/format/size 三键闲置）｜DocPreview.vue 745-746/785/796/838/847 错误文案、1000 空文档长文案、1779 文档内容为空、2377 无匹配、457 磅单位、2408 打印页脚 CSS 第X页/共Y页、1408-1437 文本框 tooltip（textbox.anchor* 闲置）、715 [分页] 标记（AGENTS#32 有意设计备忘）。⚠️ 连锁雷：2583 copyText 用 title*="复制" 中文选择器定位按钮——i18n 化或切 EN 即失效（FIX-VUEW 范围）。
A6 死键约 24 组（双字典皆有零引用）：上列闲置键 + toolbar.stats/internal.links/page.fields/cross.refs/paginate、search.results、pagination.page、doc.status.empty、story.headers、toc.summary、index.summary、sections.index、section.pageSize。多数为 A4/A5 修复现成键。

■ B. 键盘可达性 & ARIA
✅ 达标：LoadingOverlay(role=status+aria-live+progressbar)、CollapsiblePanel(真 button+aria-expanded)、修订按钮组(role=group+aria-pressed)、toolbar separator、下载/复制/大纲/隐藏文字/主题按钮 aria-label(t()驱动)、根容器 tabindex=-1+focusContent、全局快捷键齐全且输入框聚焦时跳过、卸载移除监听、ShortcutsPanel role=dialog+Esc 可关。
P1：①大纲 outline-item 仅 @click 无 tabindex/role/keydown——键盘不可用；②ShortcutsPanel 模态无焦点管理（不移焦/无 trap/不还焦）缺 aria-modal；③App.vue emoji 图标按钮仅 title 无 aria-label（键已有 app.theme/font/reader.*）。
P2：④Home/End/PageUp/PageDown document 层无条件 preventDefault 劫持原生滚动（Home/End 未加修饰键过激进）；⑤ErrorDisplay 与 App error-banner 无 role=alert/aria-live；⑥搜索框仅 placeholder 无 aria-label、Aa/W 复选框 accessible name 晦涩；⑦skip-link 应改真锚点+目标 tabindex=-1；⑧CollapsiblePanel 缺 aria-controls/id 关联。
P3：⑨拖拽上传无键盘等价（有选择按钮兜底可接受）；⑩v-html 内图片 alt 依赖解析器输出。
