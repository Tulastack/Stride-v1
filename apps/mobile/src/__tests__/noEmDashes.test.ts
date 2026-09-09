/**
 * No em dashes anywhere in the app. They read as machine-written, and the copy
 * an athlete sees has to sound like a person wrote it. A comma, a colon or a
 * full stop always covers the same job.
 *
 * This guards the source rather than just the strings, because a dash in a
 * comment is the one that gets copied into the next string somebody writes.
 */
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '../..');
const DIRS = ['app', 'src'];
const EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx']);
// Written as an escape so this file does not trip its own check.
const EM_DASH = String.fromCharCode(0x2014);

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules') continue;
      out.push(...walk(full));
    } else if (EXTENSIONS.has(path.extname(entry.name))) {
      out.push(full);
    }
  }
  return out;
}

describe('house style', () => {
  it('uses no em dashes', () => {
    const offenders: string[] = [];
    for (const dir of DIRS) {
      for (const file of walk(path.join(ROOT, dir))) {
        const lines = fs.readFileSync(file, 'utf8').split('\n');
        lines.forEach((line, i) => {
          if (line.includes(EM_DASH)) {
            offenders.push(`${path.relative(ROOT, file)}:${i + 1}  ${line.trim()}`);
          }
        });
      }
    }
    expect(offenders).toEqual([]);
  });
});
