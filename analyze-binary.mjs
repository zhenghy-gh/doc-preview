import fs from 'fs';
import path from 'path';

const filePath = path.join(process.cwd(), 'docs', '6a164d2b7d5a1fdadbc11541.doc');
const buffer = fs.readFileSync(filePath);

console.log('文件大小:', buffer.length);

// 扇区大小
const sectorSize = Math.pow(2, buffer.readUInt16LE(30));
console.log('扇区大小:', sectorSize);

// 读取目录表位置
const dirSector = buffer.readUInt32LE(48);
const dirOffset = dirSector * sectorSize + 512;
console.log('目录表偏移:', dirOffset);

// 读取 WordDocument 流信息
let wordDocOffset = 0;
let wordDocSize = 0;

for (let i = 0; i < 10; i++) {
  const entryOffset = dirOffset + i * 128;
  if (entryOffset >= buffer.length) break;
  
  const nameLength = buffer.readUInt16LE(entryOffset + 64);
  if (nameLength === 0) continue;
  
  const name = buffer.slice(entryOffset, entryOffset + nameLength - 2).toString('utf16le').replace(/\0/g, '');
  const startSector = buffer.readUInt32LE(entryOffset + 116);
  const size = buffer.readUInt32LE(entryOffset + 120);
  
  if (name.includes('WordDocument')) {
    wordDocOffset = startSector * sectorSize + 512;
    wordDocSize = size;
    console.log(`\n找到 WordDocument:`);
    console.log(`  名称: "${name}"`);
    console.log(`  起始扇区: ${startSector}`);
    console.log(`  文件偏移: ${wordDocOffset}`);
    console.log(`  大小: ${size}`);
  }
}

// 读取 WordDocument 流前500字节
const wordDoc = buffer.slice(wordDocOffset, wordDocOffset + Math.min(wordDocSize, 500));

console.log('\nWordDocument 流前200字节的十六进制:');
const hex = [];
for (let i = 0; i < Math.min(200, wordDoc.length); i++) {
  hex.push(wordDoc[i].toString(16).padStart(2, '0'));
}
console.log(hex.join(' '));

// 查找段落标记
console.log('\n查找前20个段落标记 (0x0D):');
let count = 0;
for (let i = 0; i < Math.min(wordDoc.length - 1, 5000); i++) {
  if (wordDoc[i] === 0x0D) {
    const nextByte = wordDoc[i + 1];
    if (count < 20) {
      if (nextByte === 0x00) {
        console.log(`  UTF-16LE @ 流内 offset ${i} (文件 ${i + wordDocOffset})`);
      } else {
        console.log(`  8-bit @ 流内 offset ${i}, next: 0x${nextByte.toString(16)}`);
      }
    }
    count++;
  }
}
console.log(`总段落标记数(前5000字节): ${count}`);

// 解码前300字节
console.log('\n作为 UTF-16LE 解码前300字节:');
let decoded = '';
let nonAscii = [];
for (let i = 0; i < Math.min(wordDoc.length - 1, 300); i += 2) {
  const charCode = wordDoc.readUInt16LE(i);
  if (charCode >= 0x4E00 && charCode <= 0x9FFF) {
    decoded += String.fromCharCode(charCode);
  } else if (charCode >= 0x20 && charCode <= 0x7E) {
    decoded += String.fromCharCode(charCode);
  } else if (charCode === 0x0D) {
    decoded += '\n[CR]';
  } else if (charCode !== 0x00) {
    decoded += `[${charCode.toString(16)}]`;
    nonAscii.push({ offset: i, code: charCode, char: String.fromCharCode(charCode) });
  }
}
console.log(decoded);

// 显示非ASCII字符
if (nonAscii.length > 0) {
  console.log('\n非ASCII字符:');
  nonAscii.slice(0, 20).forEach(c => {
    console.log(`  offset ${c.offset}: U+${c.code.toString(16).padStart(4, '0')} "${c.char}"`);
  });
}
