// /diff 单轮评测：解析 → textutil 基准 → 文本相似度 → 聚类失败 → JSON 报告
// 用法：node bench-diff.mjs [cycleNumber]
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { execSync } from 'child_process';
import { DocParser } from './dist/doc-preview.js';

const CYCLE = process.argv[2] || '1';
const ROOT = process.cwd();
const DOCS = path.join(ROOT, 'docs');
const BENCH = path.join(ROOT, '.doc-preview-bench');
const BASE_TXT = path.join(BENCH, 'baseline', 'text');
const REP = path.join(BENCH, 'reports');
for (const d of [BASE_TXT, REP]) fs.mkdirSync(d, { recursive: true });

const files = fs.readdirSync(DOCS).filter(f => f.endsWith('.doc') || f.endsWith('.dot'));
console.log(`📂 扫描到 ${files.length} 个样本`);

function sha256(buf) { return crypto.createHash('sha256').update(buf).digest('hex'); }
function readTextSafe(p) { try { return fs.readFileSync(p, 'utf8'); } catch { return null; } }

// ── 1) 基准生成（textutil） ────────────────────────
console.log('\n📐 阶段 B: 生成 textutil 基准…');
const baseline = {}; // sha256 -> { name, text, parseResult, similar }
let baseHit = 0, baseNew = 0;
for (const name of files) {
  const fp = path.join(DOCS, name);
  const buf = fs.readFileSync(fp);
  const sha = sha256(buf);
  const out = path.join(BASE_TXT, sha + '.txt');
  let text = null;
  if (fs.existsSync(out)) {
    text = readTextSafe(out);
    baseHit++;
  } else {
    try {
      // textutil: -convert txt 输出到 stdout 不行，要写文件
      const tmp = path.join(BENCH, 'baseline', '_tmp_' + sha + '.txt');
      execSync(`textutil -convert txt -output "${tmp}" "${fp}"`, { stdio: 'pipe' });
      if (fs.existsSync(tmp)) {
        text = fs.readFileSync(tmp, 'utf8');
        fs.renameSync(tmp, out);
        baseNew++;
      }
    } catch (e) {
      text = null;
    }
  }
  baseline[sha] = { name, text, size: buf.length };
}
console.log(`   命中 ${baseHit} 个, 新增 ${baseNew} 个`);

// ── 2) 解析 + 提取文本 ─────────────────────────────
console.log('\n🔬 阶段 C: 解析 + 文本对比…');
const results = [];
let parseOK = 0, parseFail = 0;
for (const name of files) {
  const fp = path.join(DOCS, name);
  const buf = fs.readFileSync(fp);
  const sha = sha256(buf);
  const r = { name, sha, size: buf.length, parse: null, renderText: null, baseline: null, similarity: null, issue: null };
  try {
    // Buffer → ArrayBuffer（DocParser 内部用 DataView，需 ArrayBuffer）
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    const parser = new DocParser(ab);
    const parsed = parser.parseWithFormat();
    parseOK++;
    r.parse = { ok: true, paragraphs: parsed.document?.paragraphs?.length || 0 };
    // 还原成纯文本：parseWithFormat 返回 { document: { paragraphs: [{text,...}] } }
    r.renderText = (parsed.document?.paragraphs || []).map(p => (p && p.text) || '').join('\n');
    if (!r.renderText && parsed.text) r.renderText = parsed.text;
  } catch (e) {
    parseFail++;
    r.parse = { ok: false, err: e.message };
    r.issue = `parse_fail: ${e.message.split('\n')[0].slice(0, 60)}`;
  }
  r.baseline = baseline[sha]?.text ?? null;
  if (r.renderText !== null && r.baseline !== null) {
    r.similarity = sim(r.baseline, r.renderText);
    if (r.similarity < 0.95 && r.issue === null) {
      // 简单聚类：基于字符长度比 + 头尾对比
      r.issue = classify(r.baseline, r.renderText);
    }
  } else if (r.parse.ok && r.baseline === null) {
    r.issue = 'no_baseline';
  }
  results.push(r);
}
console.log(`   解析成功 ${parseOK}, 失败 ${parseFail}`);

// ── 3) 统计 ───────────────────────────────────────
const sims = results.filter(r => r.similarity !== null).map(r => r.similarity).sort((a, b) => a - b);
const stats = {
  total: results.length,
  parseSuccess: parseOK,
  parseFail,
  baselineMissing: results.filter(r => r.baseline === null).length,
  similarityCount: sims.length,
  median: pct(sims, 0.5),
  p10: pct(sims, 0.1),
  p25: pct(sims, 0.25),
  min: sims[0] ?? null,
  max: sims[sims.length - 1] ?? null,
};

// 失败模式聚类
const issueMap = new Map();
for (const r of results) {
  if (!r.issue) continue;
  const k = r.issue;
  if (!issueMap.has(k)) issueMap.set(k, { pattern: k, count: 0, samples: [] });
  const v = issueMap.get(k);
  v.count++;
  if (v.samples.length < 5) v.samples.push(r.name);
}
const topIssues = [...issueMap.values()].sort((a, b) => b.count - a.count);

// ── 4) 写报告 ──────────────────────────────────────
const report = {
  cycle: Number(CYCLE),
  timestamp: new Date().toISOString(),
  ...stats,
  topIssues,
  failures: results.filter(r => r.issue).map(r => ({
    name: r.name, sha: r.sha, size: r.size,
    parse: r.parse, similarity: r.similarity, issue: r.issue,
  })),
};
const repPath = path.join(REP, `cycle-${CYCLE}.json`);
fs.writeFileSync(repPath, JSON.stringify(report, null, 2));
console.log(`\n📝 报告: ${repPath}`);

// ── 5) 控制台输出 ──────────────────────────────────
printReport(report);

// 附：每个失败样本的详细对比片段（前几行）
const failures = results.filter(r => r.issue && r.renderText && r.baseline);
if (failures.length > 0) {
  console.log(`\n🔍 失败样本详细（前 ${Math.min(5, failures.length)} 个）：`);
  for (const r of failures.slice(0, 5)) {
    console.log(`\n  ── ${r.name}  sim=${r.similarity.toFixed(3)}  issue=${r.issue}`);
    const a = (r.baseline || '').split('\n').slice(0, 3).map(s => '    B│ ' + s.slice(0, 80));
    const b = (r.renderText || '').split('\n').slice(0, 3).map(s => '    R│ ' + s.slice(0, 80));
    console.log(a.join('\n'));
    console.log(b.join('\n'));
  }
}

// ── helpers ────────────────────────────────────────
function sim(a, b) {
  if (a === b) return 1;
  if (!a || !b) return 0;
  const charSim = charSimilarity(a, b);
  const tokSim = tokenSimilarity(a, b);
  return 0.6 * charSim + 0.4 * tokSim;
}
function charSimilarity(a, b) {
  const longer = a.length >= b.length ? a : b;
  const shorter = a.length >= b.length ? b : a;
  if (longer.length === 0) return 1;
  const W = 32;
  let matched = 0;
  for (let i = 0; i < shorter.length; i += W) {
    const piece = shorter.slice(i, i + W);
    if (longer.indexOf(piece) >= 0) matched += piece.length;
  }
  return matched / longer.length;
}
function tokenSimilarity(a, b) {
  const grams = s => {
    const out = new Map();
    for (let i = 0; i < s.length - 1; i++) {
      const g = s.substr(i, 2);
      out.set(g, (out.get(g) || 0) + 1);
    }
    return out;
  };
  const A = grams(a), B = grams(b);
  if (A.size === 0 && B.size === 0) return 1;
  let inter = 0, union = 0;
  const keys = new Set([...A.keys(), ...B.keys()]);
  for (const k of keys) {
    const a = A.get(k) || 0, b = B.get(k) || 0;
    inter += Math.min(a, b);
    union += Math.max(a, b);
  }
  return union === 0 ? 0 : inter / union;
}
function pct(sorted, p) {
  if (sorted.length === 0) return null;
  const i = Math.floor((sorted.length - 1) * p);
  return sorted[i];
}
function classify(baseline, render) {
  if (!baseline) return 'no_baseline';
  const head = baseline.slice(0, 80);
  const rHead = render.slice(0, 80);
  if (render.length > baseline.length * 1.1 && /[\x00-\x08\x0B-\x1F]/.test(rHead)) {
    return 'prefix_noise';
  }
  if (Math.abs(render.length - baseline.length) < 50) {
    return 'middle_diff';
  }
  if (render.split('\n').length < baseline.split('\n').length / 2) {
    return 'paragraph_merged';
  }
  if (render.split('\n').length > baseline.split('\n').length * 1.5) {
    return 'paragraph_split';
  }
  if (render.length < baseline.length * 0.5) return 'text_truncated';
  if (render.length > baseline.length * 1.5) return 'text_redundant';
  return 'misc_diff';
}
function printReport(r) {
  console.log('\n═══════════════════════════════════════');
  console.log(`   轮次 #${r.cycle}   ·  ${r.timestamp}`);
  console.log('═══════════════════════════════════════');
  console.log(`样本: ${r.total} (parse ${r.parseSuccess}✅/${r.parseFail}❌, baseline 缺 ${r.baselineMissing})`);
  console.log(`相似度: 中位 ${r.median?.toFixed(3)} / p25 ${r.p25?.toFixed(3)} / p10 ${r.p10?.toFixed(3)} / min ${r.min?.toFixed(3)}`);
  if (r.topIssues.length > 0) {
    console.log('\n主要问题:');
    for (const t of r.topIssues.slice(0, 10)) {
      console.log(`  · ${t.pattern}  (${t.count} 个)  例: ${t.samples.slice(0, 3).join(', ')}`);
    }
  } else {
    console.log('\n✅ 无问题样本');
  }
  console.log('═══════════════════════════════════════');
}
