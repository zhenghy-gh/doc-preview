# Round 139：同一次解析内共享图片扫描 / base64 编码结果

## 结论与候选

采纳「`document.images` 与 `document.pictures` 两条提取路径共用一份按**视图对象身份**键控的图片工作缓存」候选。交错端到端四组全部改善 5.711%–8.706%，隔离降低 44.669%。拟从现场 0.7.61 升至 0.7.62；实际发布结果以收尾状态、官方 metadata 及交付报告为准。

候选新增 `ImageWorkCache`（`scans: Map<Uint8Array, ExtractedImage[]>`、`dataUrls: Map<Uint8Array,{format,url}>`）与 `createImageWorkCache()`；把原 `extractImagesFromStream` 主体抽成内部纯函数 `scanImagesFromStream`，公开函数增加**可选** `cache` 参数；`bytesToBase64DataUrl` / `imagesToDataUrls` 增加可选 `cache`，命中时校验 `hit.format === format`；`extractPicturesFromDataStream` 透传 `cache`；`documentAssets.extractImages` / `extractPictures` 增加可选 `cache` 参数；`DocParser` 新增 `private readonly imageWorkCache`，在 `parseWithFormat()` 开头 `scans.clear()`，并经私有委托方法传给两条路径。

`cache` 省略时四条路径逐字节等价于旧实现（本轮用不带 cache 的旧路径作 oracle 逐字段比对）。可证等价依赖：两个消费点拿到的是**同一个** `wordDocData` 对象（同一次 `findWordDocumentStream().data`），两次调用之间无人写入该视图（解析全程只读）；`extractImages` 的预算窗口未截断时就是 `candidate` 本身、截断时 `subarray` 是新对象自然落到不同键；`extractPicturesFromDataStream` 用 `findImageIndexInStream` 按**内容**在流内定位，不依赖图片对象身份；缓存只存纯函数返回值，消费方只读遍历（`push` / 读 `img.data`、`img.format`）。不承诺覆写 `Uint8Array.prototype`、Proxy 入参或跨解析复用同一 `DocParser` 时缓冲区被改写的情形（后者由开头 clear 兜住）。

## 剖析与真实去重量测

本轮 CPU 剖析 27 份 DOC/DOT、80 遍，5219 总采样 311 节点；`extractImagesFromStream` 自耗 367/5219=7.032%，`bytesToBase64` 247/5219=4.733%，`(garbage collector)` 526/5219=10.079%；同轮时间日志 80 遍中位 92.547ms、min 88.568、p25 90.207。采样只指方向，不据此预测收益。profile bundle 与 cpuprofile 保存于 `.workbuddy-ai/perf-harness/round139-profile.mjs` / `round139.cpuprofile`。

新增身份探针（`round139-idgen.mjs` / `round139-idrun.mjs`，给 `extractImagesFromStream`、`extractPicturesFromDataStream`、`bytesToBase64`、`bytesToBase64DataUrl` 注入「对象→序号」记录）按**每次 `parseWithFormat` 为一个 epoch** 实测 27 份真实语料：

- `extractImages` 27 次、`extractPictures` 27 次、`extractPicturesFromDataStream` 25 次（Data 流 10 次 + `wordDocData` 15 次）；
- `extractImagesFromStream` 69 次调用 / 11,005,746 B / 54 个不同视图；其中 **15 次是同 epoch 内对同一 `wordDocData` 的重复扫描 = 4,610,956 B，占全部扫描字节 41.9%**，其余重复为零；
- `bytesToBase64DataUrl` 69 次调用；**共享扫描结果后**出现 3 次同 epoch 重复编码 = 1,502,881 B。这 3 次是扫描去重的**下游效应**（两条路径拿到同一批 `img.data` 对象后才出现），未共享扫描时实测重复为 0 —— 故两处缓存必须成对启用，只启用扫描缓存反而会把 1.50 MB 白编两遍。首版曾据此误判 base64 缓存无收益并撤下，重测后恢复。

接线后复测：真实扫描 69 次/11,005,746 B → **54 次/6,394,790 B、同 epoch 重复 0**；真实编码 69 次/3,068,414 B → **66 次/1,565,533 B、同 epoch 重复 0**。

## 隔离基准

`round139-isolated.mjs` 先用插桩 bundle 定位「旧实现会重复处理」的视图对象，再用**干净 bundle**（`round139-clean-src.ts`，无插桩）对这些视图计时；旧总工作量 = 全部视图各一次 + 重复视图再一次。预热 3 遍、30 轮取中位：

| 子系统 | 全部视图 | 重复视图 | 全部 ms | 重复 ms | 旧 ms | 降低 |
|---|---:|---:|---:|---:|---:|---:|
| 魔数扫描 | 54（6,394,790 B） | 15（4,610,956 B） | 4.964 | 3.255 | 8.218 | 39.602% |
| base64 编码 | 66（1,565,533 B） | 3（1,502,881 B） | 4.048 | 4.021 | 8.069 | 49.830% |
| 合计 | — | — | — | — | 16.288 | **44.669%** |

隔离值只覆盖图片子系统，不能当完整 parse 收益；本轮端到端另行交错测量。

## 常驻护栏与鉴别力

新增 `tests/imageExtractor.workCache.test.ts` 14 项：oracle 逐字段对照（PNG/JPEG/BMP/GIF 四分支同流）；命中返回**同一数组引用**（绕过缓存即失败）；等长但内容不同视图各自扫描；`subarray` 子视图与原视图各占一键且结果等于不带 cache 的子视图 oracle；空/7 字节输入返回 `[]` 且不写缓存；同一视图同格式命中且 payload 与旧实现相同；同一视图换格式必须重新编码（MIME 前缀不同、payload 相同）；`imagesToDataUrls` 逐项等价；`extractPicturesFromDataStream` 带/不带 cache 逐字段相同；先 `extractImagesFromStream` 再 `extractPicturesFromDataStream` 共用同一次扫描且图片对象身份被复用；`DocParser` 同实例重复解析结果一致且缓存条目数不翻倍；多图真实文档 `unicode-02006-zia.doc` 产出**恰好 49 张**且互不相同（若去重误并不同偏移图片数量会掉下来）；两独立实例产出逐字段相同。

控制在内存替换生产源并运行同 14 护栏，三个错控均**只**由预期用例捕获：NC1 删掉 `hit.format === format` → 「同一视图换格式」1 失败/13 通过；NC2 把 `scans` 键换成「字节长度」→ 「等长但内容不同视图」1 失败/13 通过；NC3 删掉 `parseWithFormat` 开头的 `scans.clear()` → 「缓存不跨解析累积」1 失败/13 通过（实测 `expected 6 to be 3`，正是预言的翻倍）。慢但等价对照即「不带 cache 的旧路径」，全部通过。

## 全门禁与端到端

候选 `npm test` 全量 77 文件 1634 项、`npx vue-tsc --noEmit`、`npm run lint`、`npm run build`（main gzip 110.15 kB）、`npm run build:lib`（doc-preview.js 354.50 kB / gzip 95.66 kB）全部通过；test 与 lint 串行执行，未并发。

`round139-prebuild.mjs` 实际 `git stash push -- <4 个候选文件>` 只切本轮源码，逐步断言 OLD 源码逐字等于 HEAD、`stash pop` 后逐字等于候选，stash 列表收尾为空。计时前预建 OLD/NEW 生产库并保存 sha256（`round139-bundles.json`）。8 个独立进程正反交错 4×NEW/4×OLD 各 100 遍：

| 组 | NEW ms | OLD ms | 耗时降低 |
|---|---:|---:|---:|
| 1 | 91.114 | 96.633 | 5.711% |
| 2 | 91.220 | 98.989 | 7.848% |
| 3 | 92.135 | 98.575 | 6.533% |
| 4 | 91.073 | 99.758 | 8.706% |

四组均改善且方向与组内顺序无关，满足本轮采纳判据。候选 NEW 组中位离散度明显小于 OLD（91.07–92.14 vs 96.63–99.76），与「少扫 4.61 MB、少编 1.50 MB、少分配一批 subarray/字符串」一致，但 GC 占比与离散度只作方向性解释，不据此承诺具体 GC 收益。少量静态读取/轻量文件记录非严格整机空载，无统计显著性承诺，不跨轮比较绝对 ms。

候选/最终两对 27 份完整 `parseWithFormat` JSON 系统 cmp 均逐字节一致，共 54 次；本轮 dump 16,247,039 字符，sha256 `588de3f1f1ab3b82d040379dc2c77d48004b1b05b9c90cf802d22ed476b1933c`。`bench-diff 139` 与 `138` 除 `cycle`/`timestamp` 全部字段 deepEqual，非要求相似度为 1。ESM OLD 361,753 B / gzip 95,036；NEW 362,917 B / gzip 95,657（+1164 B / **+621 gzip**）。包体增长主要来自真实代码（两个 Map + 六处查表 + 参数透传）与 lib 构建在**类字段降级**时保留的字段 JSDoc；`imageExtractor` 侧大段 JSDoc 与 `interface` 在构建中被消除（实测 CJK 仅 +108 字），增长以端到端 5.7%–8.7% 收益为代价，予以接受。

## 已否决的竞争方向

- **`isWhitespaceCode` 区间分支**：行级归因 L6004 仅 25/5219=0.479%、L6003 6 tick，含 `detectAlignment` 调用点合计约 40 tick=0.77%，不达阈值，放弃。
- **`extractChartsFromWordDocumentStream` 双锚点改单锚点 + 4 字节签名校验**：`round139-anchor.mjs` 实测完整 OLE 签名 `D0CF11E0` 与 ZIP 签名 `504B0304` 在全部 27 个 WordDocument 流（5,767,130 B）中计数**均为 0**，而单字节 0xD0/0x50 各有 6610/30439 次；双锚点机制正是为「零命中时不为每次单字节付逐字节比较」而存在，改单锚点会退化且真实收益无证据，放弃。
- **按流内容哈希去重 base64**：实测 75% 编码字节是重复内容，但 `extractPictures` 注释明确「每张图可能是不同偏移的 subarray」，内容去重会让 `document.images` 从 54 个 URL 缩到实际唯一卡片数，属**可观察行为变化**，存在回归风险；故只做基于**对象身份**（可证等价）的缓存。
- **`applyStructuralFormats` 重构**：函数主体 9.10% + 薄委托 4.52% 是最大热点块，但改动面过大，本轮不动。
- **`formatRecovery.ts` 重复扫描**：991 行停放 WIP，全仓无 `src` 引用、已被 tree-shake，是否接线/删除留待后续轮次。

## 记录、缺口及下一轮

本轮 changelog/progress/memory 记录齐全；计划单提交包括生产/护栏/版本与账本，官方双包 release 闭环后前移。根目录 `.prof*`/`.bench*`/`.e2e-*` 为零，stash 为空；常驻证据 `.workbuddy-ai/perf-harness/round139-*` 保留。不能把源码干净冒称整个工作区干净：既有 `.workbuddy-ai/optimization-loop.json` 自然修改与历史 `outputs/` 保留，本地 memory 由既有 gitignore 保护。

- 历史 progress/changelog 缺号（6-10、27、32-33、49-51、55）及 Round 67 重复不补造。
- 仅 27 份现有样本；`Data` 流因 `readStream` 每次 `new Uint8Array` 属「同内容不同对象」，其约 10 次重复扫描**未**被本轮消除，属已知未覆盖面。
- 本轮等价性只覆盖「同一视图对象」；调用方若在两次 `parseWithFormat` 之间改写缓冲区，靠开头 `clear()` 而非内容校验兜底，未做内容级断言。
- 状态/audit 自然收尾、`outputs/` 未跟踪和忽略 memory 为非阻断交付边界。
- 完成后下一轮 140，目标 208。
