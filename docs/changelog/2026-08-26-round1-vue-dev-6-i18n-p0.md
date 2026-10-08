# I18N-P0 完工变更摘要 · vue-dev-6 · 2026-08-26

## 任务
I18N-P0：ShortcutsPanel 13 处扁平键 `t('shortcuts.items.xxx')` 失效修复 + tMap 死代码激活。
（来源：vue-dev-6 i18n/a11y 首轮审计 A2 项，captain 派单，locale.ts 写权序由 captain 裁定归我）

## 改了什么（2 文件，未 commit）
1. **src/components/ShortcutsPanel.vue**（+19/-14）
   - 根因：字典中 `shortcuts.items` 是**嵌套 Record**（17 条），组件却用扁平 dotted key 查询；`t()` miss 时返回 key 本身 → 中英双语下面板 13 条标签全部渲染为裸串 `shortcuts.items.nextMatch` 等。
   - 修复：13 处 label 全部改为 `tMap('shortcuts.items', subKey)`；消费入口从裸 `import { t } from '../utils/locale'` 切换到 **`useI18n()`**（COMPOSABLES-E 统一入口，纯委托单例，零行为增量）；文件头注释记录根因与修法。
2. **tests/shortcutsPanelI18n.test.ts**（新增，2 用例）
   - R1：任何语言下 `.shortcut-label` 均不得出现 `shortcuts.items.` 裸 key 前缀；
   - R2：zh-CN/en 各抽样断言真实文案（搜索文档/Search document 等）且 13 条数量不回退；
   - afterEach 还原 `setLocale('zh-CN')` 单例卫生（对齐 chartRenderer 冒烟先例）。

## 为什么这样修
- tMap 即为此场景设计（locale.ts L766 嵌套访问路径），激活它 = 零字典改动、最小 diff、双语即时生效；
- 不采用"双字典补 13 条扁平键"方案：会造成同一文案嵌套/扁平双份存储，违背单一事实源；
- useI18n() 接线顺带兑现 E 域"面板组件不再散落裸 import"的方向，后续 DOC-POLISH/面板迁移可直接复用。

## 影响面
仅快捷键面板标签渲染路径；locale.ts 字典与实现**零触碰**（工作区中 locale.ts 的既有 M 为 vue-dev-2 B1/safeStorage 改造，非本任务产物）；DocPreview.vue 零触碰。

## 关键度量（前→后）
- npm run build：✅ vue-tsc 0 错误，vite 1.26s；main 307.90KB/gzip 104.60（基线 307.69/104.55，+0.21KB 为接线与注释，远低于 §2.1 的 5% 阈值）；worker 哈希不变 Dx_E8zp0。
- npm test：✅ **52 文件 / 1245 用例全绿**（前账 50/1236 → 只增不减，含本任务 +2）。
- 定向复跑：shortcutsPanelI18n(2) + componentTests(15) + useI18n(3) = 20/20 绿。
- 用户可见效果：快捷键面板（⌨️ / ? / Ctrl+ 打开）13 条说明在 zh 显示「搜索文档/上一页…」、en 显示「Search document/Previous page…」，不再是原始键名。

## 遗留与移交
- 字典仍存 4 条无对应按键绑定的嵌套标签（toggleOutline/toggleDarkMode/focusContent/closePanel）——属「文档/字典/实现三方一致」议题，建议随 a11y 波或 DOC-POLISH 一并裁决（补绑定或删条目），未混入本 P0。
- FIX-VUEW（copyText 中文选择器 + 缩放溢出）：排队中；注意 T3-W3 重接线后 DocPreview.vue 行号已整体漂移（5990→4820），开工时先重新定位现场再动刀。
