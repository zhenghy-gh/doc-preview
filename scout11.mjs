import fs from 'fs';
const buf = fs.readFileSync('docs/synthetic/04_plain.doc');
const data = buf.slice(512, 512 + 4096);
// 找所有 0x0D 0x00
const positions = [];
for (let i = 0; i < data.length - 1; i++) {
  if (data[i] === 0x0D && data[i+1] === 0x00) positions.push(i);
}
console.log('16-bit 段标位置 (前 10):', positions.slice(0, 10));
// 看每个 0x0D 0x00 后 30 字节内容
positions.slice(0, 6).forEach(p => {
  const after = data.slice(p + 2, p + 30);
  let s = '';
  for (let i = 0; i < after.length - 1; i += 2) {
    const c = after[i] | (after[i+1] << 8);
    s += c >= 0x20 && c < 0x7F ? String.fromCharCode(c) : '.';
  }
  console.log(`  [${p}] -> "${s}"`);
});
