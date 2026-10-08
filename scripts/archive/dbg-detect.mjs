import fs from 'fs';
const buf = fs.readFileSync('docs/synthetic/04_plain.doc');
// 模拟 detectEncodingFromBinary
const data = buf.slice(512);  // 模拟 wordStream.data
const startOffset = Math.min(2048, Math.floor(data.length / 4));
const endOffset = Math.min(data.length, startOffset + 100000);
let totalCR = 0, cr0 = 0;
for (let i = startOffset; i < endOffset - 1; i++) {
  if (data[i] === 0x0D) {
    totalCR++;
    if (data[i+1] === 0x00) cr0++;
  }
}
console.log('totalCR:', totalCR, 'crFollowedByNull:', cr0);
console.log('ratio:', cr0 / (totalCR || 1));
console.log('return:', totalCR === 0 ? null : (cr0/totalCR < 0.3));
