# 2026-11-21 · 任务 A：i18n 扫描脚本化

## 动机

`tests/localeIntegrity.test.ts` 已具备静态扫描能力（zh/en 键集一致、插值参数一致、
组件 `t()` 静态键、`t('prefix.' + x)` 动态前缀、`tMap()` 嵌套键），但它是 vitest 内部逻辑，
无法单独复跑、无法在 CI 之外（如改字典后手动自检）直接调用，且覆盖面只到
`src/components/**/*.vue` + `App.vue` —— `src/utils/rendering/`、`src/composables/` 等
`.ts` 文件里的 `t()`/`tMap()`（如 `charts.type.`、`shapes.anchor.`）完全没被扫到。

## 实现

新增 `scripts/i18nScan.mjs`（纯 Node，无浏览器依赖），把测试里的扫描函数逐个移植为 CLI：

- `extractTopLevelKeys` / `segmentByKey` / `extractNestedKeys` / `extractParams`：
  zh/en 字典块解析（口径与测试完全一致，含 `'\n}'` 截断以避免吞入文件尾部实现代码）；
- `stripComments` / `collectUsedKeys`：正则扫描 `src/**/*.{ts,vue}` 全量源文件（80 个），
  去掉 `//` 与 `/* */` 注释避免示例 key 误报；`t('key')` 静态键、`t('prefix.' + x)` 动态前缀、
  `tMap('p','s')` 嵌套键分别归类；
- 5 项检查（zh/en 键集一致、插值参数一致、静态键存在、动态前缀有效、tMap 嵌套可解析）
  + 5 项防退化断言（字典定位、zh 键 >100、源文件 ≥20、静态键 >100、前缀/tMap 非空）；
- 任一失败 → `process.exitCode = 1` 并逐条打印缺失项；`--json <path>` 可归档报告。

新增 npm script `audit:i18n`。**原 `tests/localeIntegrity.test.ts` 原样保留**，脚本是补充而非替代 ——
CI 里 vitest 仍守 `.vue`/`App.vue`，CLI 额外守住 `.ts` 使用点并支持人工/CI 单独复跑。

## 负控验证（3 类路径各自独立击穿）

| 负控操作（临时改 locale.ts，随即还原） | 预期失败项 | 实测 |
|---|---|---|
| 两本字典各删 `toolbar.search` | 静态键 test | ✅ 恰好报 2 项静态键缺失，exit 1 |
| 两本字典各删全部 `shapes.type.*` | 动态前缀 | ✅ 恰好报 zh/en 前缀缺失，exit 1 |
| 两本字典各删 `shortcuts.items.toggleSearch` | tMap 嵌套键 | ✅ 恰好报 zh/en tMap 缺失，exit 1 |

基线（未改动）运行：`zh=301 / en=301 keys`，80 源文件，189 静态键 / 11 动态前缀 / 13 tMap，
全部解析成功，exit 0。每次负控后 `git diff --exit-code -- src/utils/locale.ts` 均为干净。

## 门禁

`npm run audit:i18n` exit 0；负控三次均 exit 1 且只击穿对应检查项。未改动任何解析器/渲染代码，
vitest 原守卫不动。
