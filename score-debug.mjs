// 直接调用 extractParagraphsWithFormat 看 8/16 分数
import fs from 'fs';
import { DocParser } from './dist/doc-preview.js';

const buf = fs.readFileSync('docs/synthetic/04_plain.doc');
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
const p = new DocParser(ab);
// 通过日志触发，看到 "提取到 N 个段落"
const r = p.parseWithFormat();
console.log('\n=== 最终段落 ===');
r.document?.paragraphs?.forEach((x, i) => console.log(`  [${i}] "${x.text?.slice(0, 50)}"`));
