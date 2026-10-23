// Read-only scan: report occurrences of consecutive '{{' OUTSIDE fenced code blocks.
// These break the VitePress build (Vue template interpolation).
// Usage: node scripts/scan-braces.cjs [dir]
const fs = require('fs');
const path = require('path');

const roots = process.argv.slice(2);
const dirs = roots.length ? roots : ['.'];

function mdFiles(d) {
  return fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(d, e.name);
    if (e.name === 'node_modules' || e.name.startsWith('.')) return [];
    if (e.isDirectory()) return mdFiles(full);
    return e.name.endsWith('.md') ? [full] : [];
  });
}

let total = 0;
for (const base of dirs) {
  for (const f of mdFiles(base)) {
    const lines = fs.readFileSync(f, 'utf8').split(/\r?\n/);
    let fence = null;
    lines.forEach((line, i) => {
      const m = line.match(/^(\s*)(```|~~~)/);
      if (m) {
        if (!fence) fence = m[2];
        else if (line.trim().startsWith(fence)) fence = null;
        return;
      }
      if (fence) return;
      if (line.includes('{{')) {
        console.log('BRACE ' + f + ':' + (i + 1) + '  ' + line.slice(0, 120));
        total++;
      }
    });
  }
}
console.log('violations outside fences: ' + total);
