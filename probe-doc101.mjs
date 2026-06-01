// 探针: 找出 doc-101.doc 中首段 "This is Heading1 Text" 的实际位置
// 用法: node probe-doc101.mjs
import fs from 'fs';

const fp = process.argv[2] || 'docs/doc-101.doc';
const buf = fs.readFileSync(fp);
console.log(`📂 ${fp}: ${buf.length} bytes`);

// 在 stream 0-30000 范围找所有 0x0D 字节的位置
const crs = [];
for (let i = 0; i < Math.min(30000, buf.length); i++) {
  if (buf[i] === 0x0D) crs.push(i);
}
console.log(`\n🔍 0-30000 区间共 ${crs.length} 个 0x0D 字节`);
console.log(`   前 20 个位置: ${crs.slice(0, 20).join(', ')}`);

// 在每个 0x0D 附近打印可读字符串片段
console.log('\n📖 每个 0x0D 附近的可读字符串片段 (前后各 30 字节的 ASCII 可读部分):');
for (let j = 0; j < Math.min(crs.length, 10); j++) {
  const pos = crs[j];
  const before = buf.slice(Math.max(0, pos - 30), pos);
  const after = buf.slice(pos + 1, Math.min(buf.length, pos + 30));
  const beforeStr = Array.from(before).filter(b => b >= 32 && b <= 126).map(b => String.fromCharCode(b)).join('');
  const afterStr = Array.from(after).filter(b => b >= 32 && b <= 126).map(b => String.fromCharCode(b)).join('');
  console.log(`  [${pos.toString().padStart(5)}] 0x0D | before:"${beforeStr}" | after:"${afterStr}"`);
}

// 找 "This is Heading" 的位置
const search = 'This is Heading';
let idx = buf.indexOf(Buffer.from(search));
console.log(`\n🎯 "${search}" 在 byte 偏移: ${idx}`);

// 找 "Lorem ipsum" 位置
const lorem = buf.indexOf(Buffer.from('Lorem ipsum'));
console.log(`🎯 "Lorem ipsum" 在 byte 偏移: ${lorem}`);

// 在标题附近找 0x0D
if (idx >= 0) {
  const searchStart = Math.max(0, idx - 200);
  const searchEnd = Math.min(buf.length, idx + 200);
  const crsNearby = [];
  for (let i = searchStart; i < searchEnd; i++) {
    if (buf[i] === 0x0D) crsNearby.push(i);
  }
  console.log(`\n📍 标题附近 ±200 字节内的 0x0D 位置: ${crsNearby.length} 个`);
  console.log(`   具体: ${crsNearby.join(', ')}`);
}
