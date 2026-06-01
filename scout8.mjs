import fs from 'fs';
const buf = fs.readFileSync('docs/synthetic/04_plain.doc');
// 看 stream[1058..1500] - "Plain ASCII Title" 周围
for (let i = 1024 + 1058; i < 1024 + 1500; i += 2) {
  const lo = buf[i], hi = buf[i+1];
  const c = lo | (hi << 8);
  process.stdout.write(c >= 0x20 && c < 0x7F ? String.fromCharCode(c) : `[${c.toString(16)}]`);
}
console.log('\n');
// 看 stream[1500..2000] - 段标之后
for (let i = 1024 + 1500; i < 1024 + 2000; i += 2) {
  const lo = buf[i], hi = buf[i+1];
  const c = lo | (hi << 8);
  process.stdout.write(c >= 0x20 && c < 0x7F ? String.fromCharCode(c) : `[${c.toString(16)}]`);
}
