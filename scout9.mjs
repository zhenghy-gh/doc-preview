import fs from 'fs';
const buf = fs.readFileSync('docs/synthetic/04_plain.doc');
// stream[200..2000] 的单字节 0x0D 位置
const positions = [];
for (let i = 200; i < 2000; i++) {
  if (buf[i] === 0x0D) positions.push(i);
}
console.log('stream[200..2000] 内 0x0D 位置:', positions);
// "Plain" 应该在 stream[1058] LE
// 8-bit 路径看到 stream[1058]=0x50('P') 不是 0x0D
// 那为什么 8-bit 解析出 "Plain ASCII body content"？看 stream[1000..1200] 单字节
console.log('\nstream[1000..1200] 单字节解读:');
let s = '';
for (let i = 1000; i < 1200; i++) {
  const b = buf[i];
  s += b >= 0x20 && b < 0x7F ? String.fromCharCode(b) : '.';
}
console.log(s);
