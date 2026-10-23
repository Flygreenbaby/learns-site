// Read-only status check: compares planned slugs in _content-plan.md
// against files that actually exist on disk, and reports byte size + whether
// the required tail sections are present.
// Usage: node scripts/status.cjs
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const plan = fs.readFileSync(path.join(root, '_content-plan.md'), 'utf8');

const blocks = plan.split(/^### /m).slice(1);
const domains = [];
for (const b of blocks) {
  const header = b.split('\n')[0];
  const dir = header.split('/')[0].replace(/[（(].*/, '').trim();
  if (!fs.existsSync(path.join(root, dir))) continue;
  const rows = [...b.matchAll(/^\| (\d+) \| `([a-z0-9-]+)` \| (.+?) \|/gm)].map((r) => ({
    num: Number(r[1]),
    slug: r[2],
    title: r[3],
  }));
  domains.push({ dir, rows });
}

const NEEDS = [
  '## 常见错误与排查',
  '## 练习',
  '## 官方文档与延伸阅读',
  '## 下一章',
];

let totalPlanned = 0;
let totalDone = 0;
const report = [];

for (const d of domains) {
  const existing = [];
  const missing = [];
  for (const r of d.rows) {
    const f = path.join(root, d.dir, r.slug + '.md');
    if (fs.existsSync(f)) {
      const text = fs.readFileSync(f, 'utf8');
      const bytes = Buffer.byteLength(text);
      const isProject = r.slug === 'project';
      const need = isProject ? ['## 下一章'] : NEEDS;
      const gaps = need.filter((s) => !text.includes(s));
      existing.push({ slug: r.slug, bytes, gaps });
    } else {
      missing.push(r.slug);
    }
  }
  totalPlanned += d.rows.length;
  totalDone += existing.length;
  report.push({ dir: d.dir, planned: d.rows.length, done: existing.length, existing, missing });
}

for (const r of report) {
  const flag = r.done === r.planned ? 'FULL' : r.done === 0 ? 'NONE' : 'PART';
  const bytes = r.existing.reduce((a, e) => a + e.bytes, 0);
  console.log(
    `${flag.padEnd(5)} ${r.dir.padEnd(22)} ${String(r.done).padStart(2)}/${String(r.planned).padEnd(3)} ${String(bytes).padStart(8)} B` +
      (r.missing.length ? `  missing: ${r.missing.join(', ')}` : ''),
  );
  for (const e of r.existing) {
    if (e.gaps.length) console.log(`        SECTION GAP ${e.slug} (${e.bytes} B): ${e.gaps.join(' | ')}`);
  }
}

console.log('---');
console.log(`planned ${totalPlanned}  done ${totalDone}  remaining ${totalPlanned - totalDone}`);
