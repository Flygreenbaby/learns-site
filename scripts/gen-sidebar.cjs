// Regenerate <dir>/_sidebar.ts from the _content-plan.md slug table,
// including only chapters whose .md file actually exists on disk.
// This keeps the sidebar free of 404 entries while content is still being written.
// Usage: node scripts/gen-sidebar.cjs [<dir> ...]   (no args = all domains)
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const plan = fs.readFileSync(path.join(root, '_content-plan.md'), 'utf8');

const rowsByDir = {};
for (const b of plan.split(/^### /m).slice(1)) {
  const header = b.split('\n')[0];
  if (!/^([a-z0-9-]+)\/（/.test(header)) continue; // only slug tables, e.g. "css/（4 章已完成，补 8 个）"
  const dir = header.split('/')[0].replace(/[（(].*/, '').trim();
  // chapters finished before the plan table was written are listed in a prose line;
  // they must still appear in the sidebar, so read them back and prepend them.
  const done = [...b.matchAll(/^已完成（[^）]*）：(.+)$/gm)]
    .flatMap((m) => [...m[1].matchAll(/`([a-z0-9-]+)`/g)].map((s) => s[1]));
  const extra = done.map((slug) => {
    const file = path.join(root, dir, slug + '.md');
    if (!fs.existsSync(file)) return null;
    const h1 = (fs.readFileSync(file, 'utf8').match(/^# (.+)$/m) || [, slug])[1];
    return { num: 0, slug, text: h1 };
  }).filter(Boolean);
  const rows = [...b.matchAll(/^\| (\d+) \| `([a-z0-9-]+)` \| (.+?) \|/gm)].map((r) => ({
    num: Number(r[1]),
    slug: r[2],
    text: r[3].replace(/`/g, ''),
  }));
  rowsByDir[dir] = [...extra, ...rows];
}

// domain display name comes from domains.ts (single source of truth)
const ds = fs.readFileSync(path.join(root, '.vitepress/domains.ts'), 'utf8');
const titleOf = {};
for (const m of ds.matchAll(/dir: '([a-z0-9-]+)'[\s\S]*?title: '([^']+)'/g)) titleOf[m[1]] = m[2];

const targets = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(rowsByDir);

for (const dir of targets) {
  const rows = rowsByDir[dir];
  if (!rows) {
    console.log('SKIP (no plan table): ' + dir);
    continue;
  }
  const live = rows.filter((r) => fs.existsSync(path.join(root, dir, r.slug + '.md')));
  const items = [
    `      { text: '领域首页与学习路线', link: '/${dir}/' }`,
    ...live.map((r) => `      { text: '${r.text}', link: '/${dir}/${r.slug}' }`),
  ].join(',\n');
  const title = titleOf[dir] || dir;
  const file = path.join(root, dir, '_sidebar.ts');
  const content =
    `import type { DefaultTheme } from 'vitepress'\n\n` +
    `/**\n * ${title} 领域侧边栏。\n` +
    ` * 由 scripts/gen-sidebar.cjs 依据 _content-plan.md 与磁盘上已存在的章节文件生成，\n` +
    ` * 只在本目录内维护：新增章节时写好 .md 文件再重新生成，不影响其他领域。\n */\n` +
    `const sidebar: DefaultTheme.SidebarItem[] = [\n  {\n    text: '${title}',\n    items: [\n${items}\n    ]\n  }\n]\n\n` +
    `export default sidebar\n`;
  const prev = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  if (prev === content) {
    console.log(`UNCHANGED ${dir} (${live.length}/${rows.length} chapters)`);
    continue;
  }
  fs.writeFileSync(file, content, 'utf8');
  console.log(`WROTE ${dir}/_sidebar.ts (${live.length}/${rows.length} chapters registered)`);
}
