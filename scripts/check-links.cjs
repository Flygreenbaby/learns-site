// Fast internal-link check without running a full VitePress build.
// Resolves every absolute in-site link (](/dir/slug) and ](/dir/)) against
// real .md files on disk, and reports the ones with no target.
// Usage: node scripts/check-links.cjs
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const SRC_EXCLUDE = ['README.md', 'TASK-HANDOFF.md'];

function mdFiles(d) {
  return fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(d, e.name);
    const rel = path.relative(root, full).replace(/\\/g, '/');
    if (e.name === 'node_modules' || e.name.startsWith('.')) return [];
    if (SRC_EXCLUDE.includes(rel)) return [];
    if (e.isDirectory()) return mdFiles(full);
    if (!e.name.endsWith('.md')) return [];
    if (e.name.startsWith('_')) return [];
    return [rel];
  });
}

const files = mdFiles(root);
const pages = new Set();
for (const f of files) {
  const rel = '/' + f.replace(/\.md$/, '');
  pages.add(rel);
  if (f.endsWith('index.md')) pages.add('/' + f.replace(/index\.md$/, ''));
}

const dead = [];
for (const f of files) {
  const text = fs.readFileSync(path.join(root, f), 'utf8');
  let inFence = false;
  text.split(/\r?\n/).forEach((line, i) => {
    if (/^(\s*)(```|~~~)/.test(line)) {
      inFence = !inFence;
      return;
    }
    if (inFence) return;
    for (const m of line.matchAll(/\]\((\/[^)\s#?]+)(?:[#?][^)\s]*)?\)/g)) {
      let link = m[1];
      if (!link.endsWith('/')) link += '/';
      const exact = pages.has(m[1]);
      const withSlash = pages.has(link);
      if (!exact && !withSlash) dead.push(f + ':' + (i + 1) + '  ' + m[1]);
    }
  });
}

// sidebar entries
for (const f of fs.readdirSync(root, { withFileTypes: true })) {
  if (!f.isDirectory()) continue;
  const sb = path.join(root, f.name, '_sidebar.ts');
  if (!fs.existsSync(sb)) continue;
  const text = fs.readFileSync(sb, 'utf8');
  const rel = f.name + '/_sidebar.ts';
  for (const m of text.matchAll(/link:\s*'([^']+)'/g)) {
    let link = m[1];
    if (!link.startsWith('/')) continue;
    if (/^(https?:|mailto:)/.test(link)) continue;
    const bare = link.replace(/\.html$/, '');
    const withSlash = bare.endsWith('/') ? bare : bare + '/';
    if (!pages.has(bare) && !pages.has(withSlash)) dead.push(rel + '  ' + link);
  }
}

if (dead.length) {
  const byTarget = {};
  for (const d of dead) {
    const t = d.split(/\s+/).pop();
    byTarget[t] = (byTarget[t] || 0) + 1;
  }
  console.log('DEAD LINKS: ' + dead.length + ' (' + Object.keys(byTarget).length + ' distinct targets)');
  for (const [t, n] of Object.entries(byTarget)) console.log('  ' + t + '   <- ' + n + ' reference(s)');
  const uniq = [...new Set(dead)];
  if (uniq.length <= 60) uniq.forEach((d) => console.log('    ' + d));
} else {
  console.log('OK: no dead internal links. ' + pages.size + ' page targets.');
}
