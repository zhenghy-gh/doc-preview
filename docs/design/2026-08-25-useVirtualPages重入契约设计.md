# useVirtualPages suspend/resume 计数器式可重入契约设计（COMPOSABLES-C 前置门）

- **作者**：vue-dev-2
- **日期**：2026-08-25
- **状态**：v1.0 草案 —— 待 captain 评审；评审通过后作为 COMPOSABLES-C 实施依据
- **依据**：contract-split-r1 v1.0 §1.3（composables 独立成波）+ vue-dev-2《Composable 抽取契约草案》域 C + pm《验收基线》DoD
- **行号基准**：当前工作区版本（DocPreview.vue 4818 行），一律以**符号名为锚**，行号仅供定位

---

## 一、背景与缺陷取证

### 1.1 现状代码位置

虚拟滚动启用标志目前是组件内单一布尔 ref `virtualScrollEnabled`（DocPreview.vue :193），由两处消费路径直接翻转：

| 写入点 | 符号 | 行为 |
|---|---|---|
| 搜索开关 | `toggleSearch`（:1089–1114） | 打开 :1098 置 `false`；关闭 :1108 置 `true` 并在 nextTick 重测高度+刷新可视范围（:1109–1112） |
| 大纲跳转 | `scrollToOutline`（:1325–1356） | 进场捕获 `wasVirtualEnabled`（:1328），条件置 `false`（:1330）；早退分支立即条件恢复（:1335）；正常路径 **setTimeout(600)** 后无条件恢复+重测（:1346–1353） |

另有窗口扩展写点 `scrollToPage`（:264–267 直接改 `visibleStart/visibleEnd`，不碰 enabled）与文档重载复位 `applyFormattedPages`（:984 附近重置窗口并清高度缓存）。

模板不直接绑定 `virtualScrollEnabled`（仅经 `isPageVisible`/`getPagePlaceholderHeight` 消费），因此该标志可以安全地退出响应式面。

### 1.2 竞态场景推演（现状缺陷）

**R1 大纲×搜索·定时器覆盖开启态**
大纲跳转 armed 定时器（T+600ms）尚未 fire 期间，用户打开搜索（`enabled=false`）；T+600 到点后定时器**无条件**置回 `true` —— 搜索所需的"全页面已渲染"前提被摧毁，非可视页面被占位 div 替换，已建立的高亮 span 随页面卸载而销毁，`scrollToMatch` 引用死元素 → 高亮导航失效。

**R2 双大纲连击·永久失活**
连续快速点击两个大纲项：第二次点击时 `enabled` 已被第一次置 `false`，于是 `wasVirtualEnabled=false` —— 第二次调用既不再挂起也**永不恢复**。若恰逢第一次的早退分支（容器查询失败 :1334–1336 已立即恢复），则两次都不留任何定时器 → 虚拟滚动**静默永久失效**直到重新加载文档。

**R3 关搜索 vs 大纲恢复交错**
关闭搜索的立即恢复（:1108）与大纲定时器恢复（:1348）互相独立：两者都会触发一次全量 `measureVisiblePageHeights + updateVisibleRange`，重叠时重复测量浪费；更坏情形下任一方的"无条件置 true"都会吞掉对方合法的挂起意图。

### 1.3 附带结构问题

- "恢复后重测量"三行逻辑在 `toggleSearch` / `scrollToOutline` / `applyFormattedPages` 三处手工重复；
- `setTimeout(600)` 是对 smooth scroll 动画时长的魔数猜测，慢机器上可能提前恢复（本期不改，见 §九开放问题）。

---

## 二、设计目标与非目标

**目标**
1. 挂起/恢复支持任意嵌套与并发，深度归零才真正恢复（计数器语义）；
2. 从 API 形态上消灭错配：重复恢复、他人代恢复、漏恢复均不可能或可检测；
3. "归零后重测+刷新"收敛为单点自动钩子，删除三处手工重复；
4. 全部行为可用 happy-dom 单测覆盖，不依赖真实滚动时序。

**非目标（红线：无行为变更，除 R1–R3 缺陷修复本身）**
- 不改分页断点/高度估算算法与魔数群（pageBuilder 域，另行波次）；
- 不改 `VIRTUAL_BUFFER=1`、小文档短路（≤3 页直通）、rAF 节流语义；
- 不把 `setTimeout(600)` 改为事件驱动（另立优化项，见 §九）；
- 不改变黄金快照输出（虚拟滚动不影响 pages HTML 序列化内容）。

---

## 三、API 契约（规范式）

```ts
/** 恢复句柄：幂等——首次调用执行配对减一，之后 no-op */
export type VirtualScrollRelease = () => void

export interface UseVirtualPagesOptions {
  containerRef: Ref<HTMLElement | null>
  pageCount: Ref<number>
  estimatePageHeightPx(): number      // 占位估算注入（宿主用 pageHeightPt*1.333 实现）
  buffer?: number                      // 默认 1
}

export interface UseVirtualPagesReturn {
  // —— 既有能力（签名不变，随迁）——
  isPageVisible(i: number): boolean
  placeholderHeight(i: number): number
  measureVisible(): void
  refreshRange(): void
  invalidate(): void                   // 文档重载：清高度缓存+重置窗口（并做 §四.4 的防御）
  ensurePageRendered(idx: number): void   // 供分页域强制目标页入窗
  dispose(): void                      // 移除 window 监听 + 强制清账

  // —— 本设计新增：重入挂起协议 ——
  /**
   * 挂起虚拟滚动。返回恢复句柄；depth++。
   * 同一时刻允许多个持有者（嵌套/并发），全部 release 后才恢复。
   * @param owner 调用方标签（'search' | 'outline' | ...），用于调试日志与残留诊断
   */
  suspend(owner: string): VirtualScrollRelease
  /** 兜底清账：丢弃全部未 release 的持有者，depth 清零并触发一次归零钩子。
   *  用于组件卸载、文档重载防御、异常路径。 */
  forceResumeAll(reason?: string): void
  /** 只读派生：是否处于启用状态（≡ depth===0）。非响应式暴露亦可，
   *  因模板不直接消费；如需模板用则包 shallowRef。 */
  isEnabled(): boolean
}
```

### 3.1 为什么是 token-release 而不是裸 `resume()`

| 方案 | 重复恢复 | 他人代恢复 | 漏恢复（异常路径） |
|---|---|---|---|
| 裸 `suspend()/resume()` 对 | 需运行时校验，多一次出错面 | 可能（无归属约束） | 需 try/finally 纪律，易漏 |
| **token-release（本设计）** | 句柄幂等，天然安全 | 不可能（句柄闭包私有） | 句柄交给 finally / 定时器回调持有，配合 `forceResumeAll` 兜底为 0 残留 |

token-release 在实现上就是"每个 token 对应一次 depth++ 与其唯一配对的 depth--"，计数器语义由实现保证而非由调用方纪律保证。`owner` 参数保留用于 dev 日志与 `invalidate/dispose` 时的残留告警（§四.4）。

---

## 四、内部状态机

### 4.1 状态

```ts
let depth = 0                                  // 当前挂起深度（模块/composable 作用域，非响应式）
const holders = new Map<symbol, string>()      // symbol(token) -> owner 标签
```

`enabled ≡ depth === 0`（派生值，不落存储）。原 `virtualScrollEnabled` ref 删除；`isPageVisible`/`updateVisibleRange` 改读派生值，判断逻辑逐字不变。

### 4.2 不变量

- I1 `depth === holders.size`（每个 token 恰好记账一次）；
- I2 `release` 幂等：token 出 Map 后再次调用为 no-op；
- I3 仅当 `depth` 由 1→0 时触发一次归零钩子（§4.3）；由 0→1 时触发一次挂起钩子（现语义下挂起无需动作，预留空实现便于将来加"回到顶部锚定"类策略）；
- I4 `dispose()/forceResumeAll()` 后 `holders` 清空且旧句柄全部降级为 no-op（通过统一 token 表实现，无需逐句柄注销）。

### 4.3 归零钩子（单点化）

```ts
function onFullyResumed(): void {           // depth 1→0 时调用
  nextTick(() => {
    measureVisible()
    refreshRange()
  })
}
```

等价聚合现状三处手工序列（`toggleSearch`:1109–1112、`scrollToOutline`:1349–1352、以及 `applyFormattedPages` 重载路径中经 `refreshVisibleRange` 的既有调用），删除重复。多次相邻归零（如双大纲先后 release）各触发一次钩子——与现状两次独立恢复的重测次数一致，无额外开销放大；如需合并可后续加微任务去抖，本期不做（保持行为最接近现状）。

### 4.4 防御性清账

- `invalidate()`（文档重载）：若 `holders` 非空，dev 模式 `console.warn('[useVirtualPages] invalidate with active holders:', [...owners])` 后 `forceResumeAll('invalidate')`。对应域 A 契约"搜索打开期间文档重载须先 close()"的双保险；
- `dispose()`（组件卸载）：先移除 scroll/resize 监听，再 `forceResumeAll('dispose')`。防止卸载后定时器回调触达已销毁闭包。

---

## 五、现有调用点迁移映射

| 现状（符号@行） | 迁移后 |
|---|---|
| `toggleSearch` 打开 :1098 `= false` | `const releaseSearch = virtualPages.suspend('search')`（存入组件级 let） |
| `toggleSearch` 关闭 :1108–1112 | `releaseSearch?.(); releaseSearch = null`（归零钩子自动重测，删三行手工序列） |
| `scrollToOutline` :1328–1331 捕获+置 false | `const releaseOutline = suspend('outline')`（**无条件挂起**，删除 wasVirtualEnabled 条件——挂起是幂等安全的，R2 根因消除） |
| `scrollToOutline` 早退 :1334–1336 | `releaseOutline()` |
| `scrollToOutline` 定时器 :1346–1353 | `setTimeout(() => releaseOutline(), 600)`（600ms 原样保留） |
| `applyFormattedPages` :984 复位 | 改调 `invalidate()` |
| `isPageVisible`/`updateVisibleRange`/`handleVirtualScroll`/`measureVisiblePageHeights` | 函数体逐字随迁，仅 enabled 读点改为派生值 |
| `scrollToPage` :264–267 窗口扩展 | 改调 `ensurePageRendered(idx)`（分页域契约既有条款） |

---

## 六、竞态场景复验（新契约下）

| 场景 | 新行为 |
|---|---|
| R1 大纲定时器未决时打开搜索 | outline token 未 release（depth≥1），搜索再 suspend（depth≥2）；T+600 outline release → depth=1 ≠ 0 → **保持挂起**，搜索前提完好。搜索关闭 release → depth=0 归零钩子单次执行 ✓ |
| R2 双大纲连击 | 每次 suspend 无条件入账（depth=2）；A 定时器 release→1，B 定时器 release→0。即使 A 早退分支先行 release，B 的 token 仍持账，**不存在无人恢复路径** ✓ |
| R3 关搜索与大纲恢复交错 | 两个 token 各自独立配对；谁后 release 谁触发归零钩子，恰好一次 ✓ |
| 搜索打开→文档重载 | 宿主守卫先 close()（域 A 契约）；即使遗漏，`invalidate()` 防御清账 + dev 告警兜底 ✓ |

---

## 七、单测矩阵（COMPOSABLES-C 交付物之一，vitest + happy-dom）

| # | 用例 | 断言要点 |
|---|---|---|
| T1 | 单层 suspend/release | release 前 `isEnabled()===false`；release 后 true 且归零钩子（重测+刷新）恰执行一次 |
| T2 | 嵌套（search 内 outline） | 内层 release 后仍禁用；外层 release 后恢复 |
| T3 | 同 owner 多 token（双大纲连击） | 两个句柄各自有效；只 release 其一保持禁用 |
| T4 | 句柄双重调用幂等 | 二次 release 不改变 depth、不重复触发钩子 |
| T5 | forceResumeAll 清账 | 任意数量未决句柄后调用 → 立即启用；旧句柄再调用 no-op |
| T6 | invalidate 含残留持有者 | 清账生效 + dev 告警含 owner 名单 |
| T7 | dispose 后旧句柄 no-op | 无异常抛出、无状态复活 |
| T8 | 小文档短路不受挂起影响 | ≤3 页时 `isPageVisible` 恒真（既有语义回归钉） |
| T9 | ensurePageRendered 扩窗 | 目标 idx 入窗且夹紧边界（分页域联动回归钉） |
| T10 | 归零钩子时序 | 断言在 nextTick 后执行重测（fake timers 或 await nextTick ×2） |

mock 策略：containerRef 用 happy-dom 元素桩（`.document-content` querySelector 返回可控伪元素列表），不依赖真实布局；`estimatePageHeightPx` 固定常数保证确定性。

---

## 八、实施时序与验收门（COMPOSABLES-C）

1. **Step-1 新文件侧**：新建 `src/composables/useVirtualPages.ts`（本契约 + §七全部用例），不接线；build+test 全绿即报备；
2. **Step-2 接线窗口**（单写者规则，等 DocPreview.vue 编辑权）：按 §五映射表替换七处，删除组件本地 `pages/virtualScrollEnabled/visibleStart/visibleEnd/pageHeights/scrollTicking/VIRTUAL_BUFFER` 及五个本地函数；此 commit 内新旧并存对比（dev 断言输出一致后删旧，参照 contract §3.3.5 双向验证精神）；
3. **Step-3 回归门**：build ✅ + 全量 test 只增不减 ✅ + renderGolden 快照逐字节一致 ✅ + 手验三条路径（大纲连击、搜索中大纲、关搜索瞬间切大纲）+ perf-ledger 追加一行。

行为变化声明：除 §六表列缺陷场景外，一切可观察行为与现状逐字节一致；R1–R3 属缺陷修复，按 pm 基线 R2/L3-R3「已实现能力不得回退」反向受益。

---

## 九、开放问题（不阻塞本契约）

1. **600ms 魔数**：建议后续以 `scrollend` 事件（Chrome 114+/Firefox 109+，Safari 仍缺）或 transitionend + 超时上限混合方案替代；涉及交互手感，另立 P3 项征 designer 意见；
2. **归零钩子去抖**：多 token 密集释放时会多次重测；如 perf-dev 度量显示热点，可加微任务级 merge（行为不变，纯开销优化），本期不做；
3. **isEnabled 响应式形态**：当前无模板/外部消费者，按普通函数暴露；若未来调试面板需要展示，再升级 `Readonly<Ref<boolean>>`（一行改动）。

---

## 十、变更记录

| 版本 | 日期 | 说明 |
|---|---|---|
| v1.0 | 2026-08-25 | vue-dev-2 初稿：缺陷取证（R1–R3）+ token-release 契约 + 状态机 + 迁移映射 + 测试矩阵 + 实施门 |

—— vue-dev-2 · 待 captain 评审；评审意见回填后升 v1.1 定稿
