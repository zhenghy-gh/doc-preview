/**
 * 单趟共享魔数扫描索引（Round 142）。
 *
 * 背景：同一次 `parseWithFormat` 里，`WordDocument` 流会被四个独立扫描器先后
 * 做全缓冲查找——
 *
 *   `extractShapesFromWordDocumentStream`   1 趟（锚点 0xF0）
 *   `extractEquationsFromWordDocumentStream` 1 趟（锚点 0xEF）
 *   `extractChartsFromWordDocumentStream`    2 趟（锚点 0xD0 / 0x50）
 *   `extractWordArtFromDrawingData`          1 趟（锚点 0xE0）
 *
 * 合计 **5 趟**原生 `Uint8Array.prototype.indexOf` 扫过同一条 ≈5.77 MB 的流，
 * 而真实语料上这 5 个锚点的**并集只占 0.970%**（实测 `0xD0`=6 610、
 * `0x50`=30 439、`0xF0`=6 752、`0xEF`=4 878、`0xE0`=7 278）。
 *
 * 本模块把 5 趟合并成**一趟** JS 扫描：用 65 536 项字节对查表，当相邻两字节
 * 都不是锚点首字节时一次跳过 2 字节（并集 0.970% ⇒ 约 94.7% 的迭代走这条快
 * 路径，等价于每个字节只付两次数组读取），命中时把偏移按锚点分桶。扫描器随后
 * 用 `nextMagicOffset`（桶上二分）代替 `data.indexOf`。
 *
 * 等价性：对任意 `from`，`nextMagicOffset` 返回 `bucket[lead]` 中第一个
 * `>= from` 的元素，而这正是反复 `data.indexOf(lead, from)` 的枚举结果；桶内
 * 无命中时返回 -1，与原生一致。
 *
 * `from` 的归一化必须与 `Uint8Array.prototype.indexOf` 的 `ToIntegerOrInfinity`
 * **逐条对齐**，否则会静默改变语义：
 *   - 非整数**向零截断**（`Math.trunc`，不是 `Math.floor`）；
 *   - `NaN` → 0；
 *   - **负数相对流末尾**（`max(length + from, 0)`，不是 0！）；
 *   - `+∞` → 越界（返回 -1），`-∞` → 0。
 * 生产调用点全部传非负整数，但原语必须真正等价，否则日后一次「顺手」的负数
 * 调用就会变成难查的静默错位（本轮的护栏正是靠穷尽 `from ∈ [-3, len+2]` 才发现
 * 初版把负数当成 0；而「向零截断」这条是再补一条显式负非整数用例才钉死的）。
 *
 * 回退保障：`index` 为 `undefined`、`index.data !== data` 或锚点不在索引内时
 * 一律退回原生 `data.indexOf`，因此**不传索引 = 逐字节等价旧实现**。
 *
 * ── Round 143：把图片扫描也并进这一趟 ──────────────────────────────────
 * 同一份 `parseWithFormat` 里，`WordDocument` 流还会被 `imageExtractor` 的图片
 * 魔数扫描器**再整扫一趟**（四个签名首字节 0x89/0xFF/0x47/0x42）。实测两者共扫
 * 同一对象 **5.414 MB / 11.599 MB = 46.68%**。故本模块的单趟扫描改为覆盖 9 个
 * 锚点：5 个魔数照旧分桶，4 个图片首字节收进一条**升序候选数组**
 * （`imageCandidates`），图片扫描器改为在候选数组上游走（见
 * `imageExtractor.scanImagesFromStream` 的等价性论证），于是那 5.4 MB 不再被扫第二遍。
 *
 * 注意 `imageCandidates` 是四个首字节的**并集**，不能当作单锚点桶使用 —— 因此
 * `nextMagicOffset` 对图片首字节（槽位 > 5）显式退回原生 `indexOf`。
 */

import { IMAGE_SIGNATURE_LEADS } from '../imageExtractor'

/** 参与合并扫描的魔数首字节：图表 OLE/ZIP、shapes FDG、equations、wordart。 */
const MAGIC_SCAN_LEADS = [0xd0, 0x50, 0xf0, 0xef, 0xe0]

/**
 * Round 143：单趟扫描覆盖的**全部**锚点 = 5 个魔数首字节 + 4 个图片签名首字节。
 *
 * 动机：同一次 `parseWithFormat` 里，`WordDocument` 流会被 `buildMagicScanIndex`
 * 与 `scanImagesFromStream` **各扫一整趟**。真实 27 份语料实测两者共扫同一对象
 * **5.414 MB / 11.599 MB = 46.68%**（`r143-imgprobe.mjs`）。把 9 个锚点并进同一次
 * 扫描，图片扫描器改为消费索引里的升序候选数组，即可省掉其中一整趟。
 *
 * 代价：并集密度从 0.970%（5 锚点）升到 2.68%（9 锚点），单趟本身慢约 18%
 * （配对跳过命中率下降）；但换来的是少扫 5.4 MB，净收益为正（见 Round 143 changelog）。
 */
const SCAN_LEADS = [...MAGIC_SCAN_LEADS, ...IMAGE_SIGNATURE_LEADS]

/** 首字节 → 槽位（1..5 为魔数，6..9 为图片）；0 表示该字节不是任何锚点。 */
const LEAD_SLOT = new Uint8Array(256)

/** 字节对 `(hi << 8) | lo` 中是否含任一锚点首字节；用于 2 字节跳跃快路径。 */
const PAIR_HAS_LEAD = new Uint8Array(65536)

for (let k = 0; k < SCAN_LEADS.length; k++) {
  const lead = SCAN_LEADS[k]
  LEAD_SLOT[lead] = k + 1
  for (let other = 0; other < 256; other++) {
    PAIR_HAS_LEAD[(lead << 8) | other] = 1
    PAIR_HAS_LEAD[(other << 8) | lead] = 1
  }
}

export interface MagicScanIndex {
  /** 被索引的数据；用于防止索引被误用到另一条流上。 */
  readonly data: Uint8Array
  /** 与 `MAGIC_SCAN_LEADS` 同序的升序偏移桶。 */
  readonly buckets: number[][]
  /**
   * 与 `IMAGE_SIGNATURE_LEADS` 对应的**升序**候选位置（四个首字节的并集）。
   * 供 `imageExtractor.scanImagesFromStream` 替代逐字节扫描。
   */
  readonly imageCandidates: number[]
}

/** 一趟扫过 `data`，把 5 个魔数锚点分桶、4 个图片首字节收进升序候选数组。 */
export function buildMagicScanIndex(data: Uint8Array): MagicScanIndex {
  const buckets: number[][] = []
  for (let k = 0; k < MAGIC_SCAN_LEADS.length; k++) buckets.push([])
  const imageCandidates: number[] = []

  const len = data.length
  let i = 0
  while (i + 1 < len) {
    if (PAIR_HAS_LEAD[(data[i] << 8) | data[i + 1]] === 0) {
      i += 2
      continue
    }
    const slot = LEAD_SLOT[data[i]]
    if (slot !== 0) {
      if (slot <= MAGIC_SCAN_LEADS.length) buckets[slot - 1].push(i)
      else imageCandidates.push(i)
    }
    i++
  }
  // 末字节没有配对字节，单独收尾（漏掉它会让「锚点在最后一字节」的输入失配）。
  if (i < len) {
    const slot = LEAD_SLOT[data[i]]
    if (slot !== 0) {
      if (slot <= MAGIC_SCAN_LEADS.length) buckets[slot - 1].push(i)
      else imageCandidates.push(i)
    }
  }

  return { data, buckets, imageCandidates }
}

/**
 * `data.indexOf(lead, from)` 的等价替代：命中索引时在桶上二分，否则退回原生。
 *
 * 只有 5 个**魔数**锚点有桶；传入图片首字节（槽位 > 5）时同样退回原生，因为
 * `imageCandidates` 是四个首字节的并集、按单一首字节查询会串结果。
 */
export function nextMagicOffset(
  index: MagicScanIndex | undefined,
  data: Uint8Array,
  lead: number,
  from: number
): number {
  if (index === undefined || index.data !== data) return data.indexOf(lead, from)
  if (lead < 0 || lead > 0xff) return data.indexOf(lead, from)
  const slot = LEAD_SLOT[lead]
  if (slot === 0 || slot > MAGIC_SCAN_LEADS.length) return data.indexOf(lead, from)

  // 与 `indexOf` 的 `ToIntegerOrInfinity` 对齐：**向零截断**、负数相对流末尾、NaN 视作 0。
  let target = Math.trunc(from)
  if (Number.isNaN(target)) target = 0
  else if (target < 0) target = Math.max(data.length + target, 0)

  const bucket = index.buckets[slot - 1]
  let lo = 0
  let hi = bucket.length
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if (bucket[mid] < target) lo = mid + 1
    else hi = mid
  }
  return lo < bucket.length ? bucket[lo] : -1
}
