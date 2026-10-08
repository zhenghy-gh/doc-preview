// 模拟 8-bit 和 16-bit 路径的产物，手动算 score
function score(text) {
  let s = 0;
  const len = text.length;
  if (len < 4) return 0;
  const en = (text.match(/[A-Za-z]{3,}/g) || []).length;
  if (en >= 2) s += 30; else if (en >= 1) s += 10;
  const cn = (text.match(/[一-鿿]/g) || []).length;
  if (cn >= 3) s += 25; else if (cn >= 1) s += 5;
  if (len >= 10 && len <= 500) s += Math.min(len/2, 50);
  if (/[,.]/.test(text) || /[，。]/.test(text)) s += 10;
  if (/^[A-Z]/.test(text.trim())) s += 5;
  return s;
}

const t8 = ["椀渀 ASCII", "Plain ASCII body content. Plain ASCII body content. Plain ASCII body content. Plain ASCII body content. Plain ASCII body content."];
const t16 = ["Plain ASCII Title", "Plain ASCII body content. Plain ASCII body content. Plain ASCII body content. Plain ASCII body content. Plain ASCII body content."];
console.log('8-bit score:', t8.map(score).reduce((a,b)=>a+b, 0), 'length:', t8.length);
console.log('16-bit score:', t16.map(score).reduce((a,b)=>a+b, 0), 'length:', t16.length);
console.log('condition (score16 > score8*1.5):', t16.map(score).reduce((a,b)=>a+b, 0) > t8.map(score).reduce((a,b)=>a+b, 0) * 1.5);
console.log('condition (alt.length >= paras.length/2):', t16.length, '>=', t8.length/2, '?', t16.length >= t8.length/2);
