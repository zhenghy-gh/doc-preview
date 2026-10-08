/**
 * Word 97-2003 的 16 色索引调色板（ico 索引 1–16 → CSS 颜色）。
 *
 * 该表原先在三个地方各写一份，形式还各不相同：
 *   - `formatParser.ts`      —— `SHD_COLOR_MAP`（对象字面量，用于段落底纹）
 *   - `rendering/paragraphStyleRenderer.ts` —— `BORDER_COLOR_MAP`（对象字面量，用于表格边框）
 *   - `tableText.ts`         —— `colorIndexToCss()` 里的 16 个 `case`（switch 形式）
 * 三者的取值与顺序逐项一致，现统一到本模块。
 *
 * 注意：`formatParser.ts` 里的 `highlightColor()`（sprmCHighlight 的高亮色）
 * **不是**同一张表 —— 它的索引顺序是 Word 高亮色的独立编码（1=黄、2=亮绿、
 * …、15=黑，默认黄）。那处刻意保留，不要并入这里。
 */
export const WORD_COLOR_PALETTE: Record<number, string> = {
  1: '#000000', // Black
  2: '#0000FF', // Blue
  3: '#00FFFF', // Cyan
  4: '#00FF00', // Green
  5: '#FF00FF', // Magenta
  6: '#FF0000', // Red
  7: '#FFFF00', // Yellow
  8: '#FFFFFF', // White
  9: '#000080', // Dark Blue
  10: '#008080', // Dark Cyan
  11: '#008000', // Dark Green
  12: '#800080', // Dark Magenta
  13: '#800000', // Dark Red
  14: '#808000', // Dark Yellow (Olive)
  15: '#808080', // Dark Gray
  16: '#C0C0C0', // Light Gray
}
