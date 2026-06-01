import fs from 'fs';
const buf = fs.readFileSync('docs/synthetic/04_plain.doc');
// 模拟 wordStream.data = buf[512..512+4096]
const data = buf.slice(512, 512 + 4096);
// 16-bit 路径 FIB 头部跳过
const startScan = 200;
let firstPara = -1;
for (let i = startScan; i < Math.min(data.length - 1, 1000); i++) {
  if (data[i] === 0x0D && data[i+1] === 0x00) {
    firstPara = i; break;
  }
}
console.log('16-bit first 0x0D 0x00 at stream offset:', firstPara);
if (firstPara > 0) {
  const next10 = data.slice(firstPara + 2, firstPara + 12);
  let s = '';
  for (let i = 0; i < next10.length - 1; i += 2) s += String.fromCharCode(next10[i] | (next10[i+1] << 8));
  console.log('  之后内容 (LE 16-bit):', JSON.stringify(s));
}
