// Per-file validator for newly written chapters. Read-only.
// Usage: node scripts/check-file.cjs <path/to/chapter.md> [...]
// Exits 1 if any FAIL. Prints PASS/WARN/FAIL lines per file.
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');

// valid in-site targets = every planned slug + every file on disk
const plan = fs.readFileSync(path.join(root, '_content-plan.md'), 'utf8');
const valid = new Set();
for (const m of plan.matchAll(/^### ([a-z0-9-]+)\/（/gm)) valid.add('/' + m[1] + '/');
for (const m of plan.matchAll(/^\| \d+ \| `([a-z0-9-]+)` \| /gm)) {
  // associate with the section we are in
}
let curDir = null;
for (const line of plan.split(/\r?\n/)) {
  const h = line.match(/^### ([a-z0-9-]+)\/（/);
  if (h) {
    curDir = h[1];
    valid.add('/' + curDir + '/');
    continue;
  }
  const r = line.match(/^\| \d+ \| `([a-z0-9-]+)` \|/);
  if (r && curDir) valid.add('/' + curDir + '/' + r[1]);
  const d = line.match(/^已完成（[^）]*）：(.+)$/);
  if (d && curDir) for (const s of d[1].matchAll(/`([a-z0-9-]+)`/g)) valid.add('/' + curDir + '/' + s[1]);
}
for (const dir of fs.readdirSync(root, { withFileTypes: true })) {
  if (!dir.isDirectory() || dir.name.startsWith('.') || dir.name === 'node_modules') continue;
  for (const f of fs.readdirSync(path.join(root, dir.name))) {
    if (f.endsWith('.md') && !f.startsWith('_')) {
      valid.add('/' + dir.name + '/' + f.replace(/\.md$/, ''));
      if (f === 'index.md') valid.add('/' + dir.name + '/');
    }
  }
}
valid.add('/guide/roadmap');
valid.add('/guide/how-to-use');
valid.add('/');

const NEED = ['## 常见错误与排查', '## 练习', '## 官方文档与延伸阅读', '## 下一章'];
const LANGS =
  'bash sh text sql ts tsx js jsx mts cts json jsonc yaml yml nginx dockerfile vue vue-html html md css scss go py toml ini diff shell console plaintext xml env properties conf hcl'.split(
    ' ',
  );

let bad = 0;
for (const arg of process.argv.slice(2)) {
  const file = path.isAbsolute(arg) ? arg : path.resolve(process.cwd(), arg);
  const rel = path.relative(root, file).replace(/\\/g, '/');
  if (!fs.existsSync(file)) {
    console.log('FAIL ' + arg + ' : file not found');
    bad++;
    continue;
  }
  const raw = fs.readFileSync(file, 'utf8');
  const text = raw.replace(/\r\n/g, '\n');
  const lines = text.split('\n');
  const problems = [];
  const notes = [];
  const add = (s) => problems.push(s);

  if (text.startsWith('---\n')) add('has YAML frontmatter (forbidden)');

  // fence tracking
  let fence = null;
  let fences = 0;
  const noLang = [];
  const outside = [];
  let inExercise = 0;
  let outExercise = 0;
  let inCallout = 0;
  let outCallout = 0;
  let answers = 0;
  const isProject = /\/project\.md$/.test(rel);
  lines.forEach((line, i) => {
    const f = line.match(/^(\s*)(```|~~~)(.*)$/);
    if (f) {
      if (!fence) {
        fence = f[2];
        fences++;
        const lang = f[3].trim().split(/\s+/)[0];
        if (!lang) noLang.push(i + 1);
        else if (!LANGS.includes(lang.toLowerCase())) noLang.push(i + 1 + '(' + lang + ')');
      } else if (line.trim().startsWith(fence)) {
        fence = null;
      }
      return;
    }
    if (fence) return;
    outside.push(line);
    if (/<Exercise[\s>]/.test(line)) inExercise++;
    if (/<\/Exercise>/.test(line)) outExercise++;
    if (/<Callout[\s>]/.test(line)) inCallout++;
    if (/<\/Callout>/.test(line)) outCallout++;
    if (/<template #answer>/.test(line)) answers++;
  });
  if (fence) add('unclosed code fence');
  if (noLang.length) add('code fence without a known language at line ' + noLang.join(', '));
  const body = outside.join('\n');
  const h1s = outside.filter((l) => /^# /.test(l));
  if (h1s.length !== 1) add('H1 count outside fences = ' + h1s.length + ' (must be exactly 1)');
  if (lines[0] && !/^# /.test(lines[0])) add('first line is not the H1');
  if (body.includes('{{')) add('{{ found outside a code fence (breaks the Vue template build)');
  if (inExercise !== outExercise) add('Exercise open/close ' + inExercise + '/' + outExercise);
  if (inCallout !== outCallout) add('Callout open/close ' + inCallout + '/' + outCallout);
  if (!isProject && answers !== inExercise) add('answers ' + answers + ' < exercises ' + inExercise + ' (every exercise needs a #answer)');
  if (!isProject && inExercise < 3) add('only ' + inExercise + ' exercises (need 3-6)');
  if (!isProject && inExercise > 6) add(inExercise + ' exercises (max 6)');

  for (const m of body.matchAll(/<Exercise\b[^>]*>/g)) {
    const d = (m[0].match(/difficulty="([^"]*)"/) || [])[1];
    if (d === undefined) add('Exercise without difficulty: ' + m[0].slice(0, 60));
    else if (!['基础', '进阶', '挑战'].includes(d)) add('bad difficulty "' + d + '"');
    const t = (m[0].match(/title="([^"]*)"/) || [])[1];
    if (t === undefined) add('Exercise without title');
    else if (/<[a-zA-Z/]/.test(t) || t.includes('"')) add('Exercise title contains a tag or quote (forbidden): ' + t.slice(0, 50));
    else if (t.includes('`')) notes.push('exercise title has backticks, house rule says avoid: ' + t.slice(0, 40));
  }
  for (const m of body.matchAll(/<Callout\b[^>]*>/g)) {
    const t = (m[0].match(/type="([^"]*)"/) || [])[1];
    if (!['info', 'warn', 'danger', 'verified', 'unverified'].includes(t)) add('bad Callout type "' + t + '"');
    const ti = (m[0].match(/title="([^"]*)"/) || [])[1];
    if (ti && /<[a-zA-Z/]/.test(ti)) add('Callout title contains a tag (forbidden): ' + ti.slice(0, 50));
    else if (ti && ti.includes('`')) notes.push('callout title has backticks, house rule says avoid: ' + ti.slice(0, 40));
  }
  // blank line right after an opening component tag / before a closing one
  for (let i = 0; i < lines.length; i++) {
    if (/^<(Exercise|Callout)\b[^>]*>\s*$/.test(lines[i]) && i + 1 < lines.length && lines[i + 1].trim() !== '') {
      add('no blank line after <' + RegExp.$1 + '> opening tag at line ' + (i + 1));
    }
    if (/^<\/(Exercise|Callout)>\s*$/.test(lines[i]) && i > 0 && lines[i - 1].trim() !== '') {
      add('no blank line before </' + RegExp.$1 + '> at line ' + (i + 1));
    }
  }

  const need = isProject ? ['## 下一章', '## 官方文档与延伸阅读'] : NEED;
  for (const s of need) if (!text.includes(s)) add('missing section ' + s);
  if (!isProject) {
    const order = need.map((s) => text.indexOf(s));
    for (let i = 1; i < order.length; i++) if (order[i] < order[i - 1]) add('sections out of order');
  }

  for (const m of text.matchAll(/\]\((\/[^)\s#?]+)(?:[#?][^)\s]*)?\)/g)) {
    const link = m[1];
    const withSlash = link.endsWith('/') ? link : link + '/';
    if (!valid.has(link) && !valid.has(withSlash)) add('unknown in-site link ' + link);
  }

  const bytes = Buffer.byteLength(raw);
  const min = isProject ? 15000 : 11000;
  const max = isProject ? 60000 : 32000;
  if (bytes < min) add('too short: ' + bytes + ' B (need ' + min + '+)');
  if (bytes > max) add('too long: ' + bytes + ' B (max ' + max + ')');
  const ideal = isProject ? [18000, 34000] : [14000, 30000];
  const warn =
    bytes < ideal[0]
      ? '  [size: ' + Math.round(bytes / 1024) + ' KB, a bit thin]'
      : bytes > ideal[1]
        ? '  [size: ' + Math.round(bytes / 1024) + ' KB, over ceiling]'
        : '';

  if (problems.length) {
    bad++;
    console.log('FAIL ' + rel + '  (' + bytes + ' B, fences=' + fences + ')');
    for (const p of problems) console.log('      - ' + p);
  } else {
    console.log('PASS ' + rel + '  (' + Math.round(bytes / 1024) + ' KB, ' + inExercise + ' exercises, ' + inCallout + ' callouts, fences=' + fences + ')' + warn);
  }
  for (const n of notes) console.log('      note: ' + n);
}
process.exit(bad ? 1 : 0);
