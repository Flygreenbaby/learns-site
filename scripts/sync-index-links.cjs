// Idempotently turn the "章节目录" table's plain first column into links,
// using the slug table from _content-plan.md.
// Usage: node scripts/sync-index-links.cjs <dir> [<dir> ...]
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const plan = fs.readFileSync(path.join(root, '_content-plan.md'), 'utf8');

// dir -> [{num, slug}]
const slugsByDir = {};
for (const b of plan.split(/^### /m).slice(1)) {
  const dir = b.split('\n')[0].split('/')[0].replace(/[（(].*/, '').trim();
  slugsByDir[dir] = [...b.matchAll(/^\| (\d+) \| `([a-z0-9-]+)` \| (.+?) \|/gm)].map((r) => ({
    num: Number(r[1]),
    slug: r[2],
  }));
}

const targets = process.argv.slice(2);
if (!targets.length) {
  console.error('usage: node scripts/sync-index-links.cjs <dir> [<dir> ...]');
  process.exit(1);
}

for (const dir of targets) {
  const file = path.join(root, dir, 'index.md');
  if (!fs.existsSync(file)) {
    console.log('SKIP (no index.md): ' + dir);
    continue;
  }
  const rows = slugsByDir[dir];
  if (!rows) {
    console.log('SKIP (no plan table): ' + dir);
    continue;
  }
  const byNum = new Map(rows.map((r) => [r.num, r.slug]));
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  let inTable = false;
  let changed = 0;
  const out = lines.map((line) => {
    if (/^## 章节目录/.test(line)) {
      inTable = true;
      return line;
    }
    if (inTable && /^## /.test(line)) {
      inTable = false;
      return line;
    }
    if (!inTable) return line;
    const m = line.match(/^\| (\d+)\. ([^|]+?) \|(.*)$/);
    if (!m) return line;
    const num = Number(m[1]);
    const slug = byNum.get(num);
    if (!slug) return line;
    if (line.includes('](' + '/' + dir + '/')) return line; // already linked
    const label = m[2].trim();
    changed++;
    return '| [' + num + '. ' + label + '](/' + dir + '/' + slug + ') |' + m[3];
  });
  if (changed) {
    fs.writeFileSync(file, out.join('\n'), 'utf8');
  }
  console.log('LINKED ' + changed + ' rows in ' + dir + '/index.md (of ' + rows.length + ' planned)');
}
