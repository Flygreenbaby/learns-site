// Sync domain status metadata from real disk content:
//   1) <StatusBadge ... /> line in each domain index.md
//   2) status / statusNote fields in .vitepress/domains.ts
// Only touches domains whose computed state differs from what is on disk,
// so hand-written notes for finished domains stay untouched.
// Usage: node scripts/sync-meta.cjs [--dry] [--all]
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const dry = process.argv.includes('--dry');
const force = process.argv.includes('--all');

const plan = fs.readFileSync(path.join(root, '_content-plan.md'), 'utf8');
const planned = {};
for (const b of plan.split(/^### /m).slice(1)) {
  const dir = b.split('\n')[0].split('/')[0].replace(/[（(].*/, '').trim();
  planned[dir] = [...b.matchAll(/^\| (\d+) \| `([a-z0-9-]+)` \| (.+?) \|/gm)].map((r) => r[2]);
}

const domainsTs = path.join(root, '.vitepress/domains.ts');
let text = fs.readFileSync(domainsTs, 'utf8');
const dirsInOrder = [...text.matchAll(/dir: '([a-z0-9-]+)'/g)].map((m) => m[1]);

function countDone(dir) {
  const slugs = planned[dir];
  if (slugs) {
    return { done: slugs.filter((s) => fs.existsSync(path.join(root, dir, s + '.md'))).length, planned: slugs.length };
  }
  const n = fs
    .readdirSync(path.join(root, dir))
    .filter((f) => f.endsWith('.md') && f !== 'index.md' && !f.startsWith('_')).length;
  return { done: n, planned: n };
}

const results = [];
for (const dir of dirsInOrder) {
  const c = countDone(dir);
  const status = c.done === 0 ? 'planned' : c.done < c.planned ? 'partial' : 'ready';
  const note =
    status === 'ready'
      ? `${c.planned} 章正文全部完成（第 ${c.planned} 章为阶段项目），可连续学习`
      : status === 'partial'
        ? `${c.done} / ${c.planned} 章正文已完成，其余按大纲继续`
        : '';
  results.push({ dir, ...c, status, note });
}

if (dry) {
  for (const r of results) console.log(`${r.dir.padEnd(22)} ${String(r.done).padStart(2)}/${String(r.planned).padEnd(3)} ${r.status}`);
  process.exit(0);
}

// ---- 1. StatusBadge in each domain index.md ----
let badgeChanges = 0;
for (const r of results) {
  const file = path.join(root, r.dir, 'index.md');
  if (!fs.existsSync(file)) continue;
  const t = fs.readFileSync(file, 'utf8');
  const m = t.match(/<StatusBadge[^>]*\/>/);
  if (!m) {
    console.log('NO BADGE: ' + r.dir);
    continue;
  }
  const cur = m[0];
  const curState = (cur.match(/state="([a-z]+)"/) || [])[1];
  const stale = /正文未写|大纲已定/.test(cur);
  if (!force && curState === r.status && !stale) continue;
  const next = `<StatusBadge state="${r.status}"${r.note ? ` note="${r.note}"` : ''} />`;
  if (next === cur) continue;
  fs.writeFileSync(file, t.replace(cur, next), 'utf8');
  badgeChanges++;
  console.log(`BADGE ${r.dir}: ${curState} -> ${r.status}`);
}

// ---- 2. domains.ts status / statusNote ----
let tsChanges = 0;
const blocks = text.split(/\n(?=  \{)/);
const out = blocks.map((block) => {
  const dm = block.match(/dir: '([a-z0-9-]+)'/);
  if (!dm) return block;
  const r = results.find((x) => x.dir === dm[1]);
  if (!r) return block;
  const curState = (block.match(/status: '([a-z]+)'/) || [])[1];
  const curNote = (block.match(/statusNote: '([^']*)'/) || [])[1];
  const stale = !curNote && r.status !== 'planned';
  if (!force && curState === r.status && !stale) return block;
  let nb = block;
  // drop existing statusNote, then set status with a fresh note
  nb = nb.replace(/,?\n\s*statusNote: '[^']*'/, '');
  nb = nb.replace(/status: '[a-z]+'/, r.note ? `status: '${r.status}',\n    statusNote: '${r.note}'` : `status: '${r.status}'`);
  if (nb !== block) {
    tsChanges++;
    console.log(`DOMAINS ${r.dir}: ${curState} -> ${r.status}`);
  }
  return nb;
});
if (tsChanges) fs.writeFileSync(domainsTs, out.join('\n'), 'utf8');

console.log(`badge updates: ${badgeChanges}, domains.ts updates: ${tsChanges}`);
