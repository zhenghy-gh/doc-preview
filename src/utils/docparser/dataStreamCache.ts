/**
 * Round 148：**同一次解析内**共享的 `Data` 流读取缓存（可选）。
 *
 * ── 为什么需要 ────────────────────────────────────────────────────────
 * 一次 `parseWithFormat()`（及 `parse()`）会经 4 个上游入口反复读同一条
 * `Data` 流，每次都 `readStream` 出一份**新的全流拷贝**：
 *   - `docParser.parseFormatRuns` → `extractShapesFromDataStream`；
 *   - `documentAssets.extractImages` → 魔数扫描候选源；
 *   - `documentAssets.extractPictures` → PICF 解析 + 魔数兜底扫描；
 *   - `storySplitter.splitHeaderParts` → 页眉页脚图片 `parsePicfAt`。
 *
 * 真实 27 份语料实测（`r148-dataprobe.mjs`，一轮 parseWithFormat）：
 * `readStream('Data')` **58 次**、共读 **2,236,262 字节**，其中约 18–22 个
 * 文档有 Data 流（平均 3.25 次重复读）。这是 Round 146 表格流缓存
 * （1Table 141→27 次）之后明确留给后续轮次的「同内容不同对象」型重复——
 * `OleParser.readStream` 每次 `new Uint8Array`，身份键控的缓存天然抓不到，
 * 须改按**目录条目身份**键控才可及。
 *
 * ── 为什么按条目身份键控是**可证等价**的 ──────────────────────────────
 * 缓存**默认不启用**（`cache` 省略时逐字节等价于旧实现）。只有
 * `DocParser` 在一次解析内显式传同一个缓存实例，且：
 *   - `findStreamByName` 返回的是 `directory` 数组里的**同一个条目对象**
 *     （不复制、不重建），同一次解析内同一命名流的查找必然命中同一键；
 *   - 四个消费方对 Data 流**全部只读**（边界检查后的魔数扫描 / `parsePicfAt`
 *     字段读取 / `subarray` 取窗），没有任何代码写入该视图——与 Round 139/143
 *     对 `wordDocData` 的只读前提同构，并由 27 份语料全结果逐字节比对守住；
 *   - 缓存里存的是 `readStream` 的原始 `data` 视图（不拷贝、不改写），
 *     消费方各自保留自己的长度门槛（`> 0` / `>= 64`），与旧逐调用判断一致；
 *   - 空流与缺流一律返回 `null`（与旧代码「`data.length > 0` 才用」等价），
 *     且**不写入缓存**——缺流文件的每次查找仍走廉价线性扫描，不占键位。
 *
 * 生命周期：缓存由 `DocParser` 实例持有（每次 `parse()` / `parseWithFormat()`
 * 开始清空），不跨解析驻留，也不是模块级全局状态。
 */

import type { DirectoryEntry, OleParser } from '../oleParser'

/** `Data` 条目对象 → 该流的数据视图（`null` 表示空流，缺流不进缓存）。 */
export type DataStreamCache = Map<DirectoryEntry, Uint8Array | null>

/**
 * 读一次 `Data` 流；`cache` 提供时按条目身份在同一次解析内共享。
 *
 * 返回 `null` 表示「没有 Data 流或流为空」——与旧实现各消费点
 * `if (dataStream.data && dataStream.data.length > 0)` 的判断等价
 * （`>= 64` 等更严门槛仍由消费方自行施加）。
 */
export function readDataStreamShared(
  ole: OleParser,
  directory: DirectoryEntry[],
  cache?: DataStreamCache,
): Uint8Array | null {
  const entry = ole.findStreamByName(directory, 'Data')
  if (!entry) return null
  if (cache === undefined) return readDataStreamOnce(ole, entry)
  const hit = cache.get(entry)
  if (hit !== undefined) return hit
  const data = readDataStreamOnce(ole, entry)
  cache.set(entry, data)
  return data
}

/** 无缓存的单次读取主体（与旧实现逐字节等价：只保留非空 `data` 视图）。 */
function readDataStreamOnce(ole: OleParser, entry: DirectoryEntry): Uint8Array | null {
  const stream = ole.readStream(entry)
  if (stream.data && stream.data.length > 0) return stream.data
  return null
}
