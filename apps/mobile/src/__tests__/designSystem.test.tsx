/**
 * PROMPT F.0 — design-system guardrails.
 *
 * Fails the build if any component file uses a forbidden "AI look" style:
 * gradients, glassmorphism/blur, purple/indigo hex, or Inter/Roboto/System
 * fonts. Also snapshots the primitive kit.
 */
import fs from 'fs';
import path from 'path';
import React from 'react';
import { render } from '@testing-library/react-native';
import { Button, Card, MetricReadout, Tag, Stat, Divider } from '../ui';

const MOBILE_ROOT = path.resolve(__dirname, '../..');
const SCAN_DIRS = [path.join(MOBILE_ROOT, 'app'), path.join(MOBILE_ROOT, 'src')];

// Strip comments so developer prose mentioning a forbidden word (e.g. "no
// gradients") doesn't trip the scanner — only real usage in code should fail.
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

function collectFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '__tests__' || entry.name === '.expo') continue;
      out.push(...collectFiles(full));
    } else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\.(ts|tsx)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

// Precise purple/indigo detector: blue is the dominant channel by a margin AND
// red is substantial (reddish-blue = violet/indigo). Spares our greys/greens/volt.
function findPurpleIndigo(content: string): string[] {
  const re = /#([0-9a-fA-F]{6})\b/g;
  const hits: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(content))) {
    const r = parseInt(m[1].slice(0, 2), 16);
    const g = parseInt(m[1].slice(2, 4), 16);
    const b = parseInt(m[1].slice(4, 6), 16);
    const isBlueDominant = b >= r && b >= g && b - Math.min(r, g) > 0x50;
    const isReddish = r >= g * 0.6;
    if (isBlueDominant && isReddish) hits.push('#' + m[1]);
  }
  return hits;
}

const FORBIDDEN_PATTERNS: { name: string; re: RegExp }[] = [
  { name: 'gradient', re: /gradient/i },
  { name: 'backdrop-blur', re: /backdrop[- ]?blur/i },
  { name: 'BlurView / expo-blur (glassmorphism)', re: /BlurView|expo-blur/i },
  { name: 'glassmorphism', re: /glassmorph/i },
  { name: 'Inter/Roboto/System font', re: /fontFamily:\s*['"](Inter|Roboto|System)/i },
];

describe('F.0 design-system guardrails', () => {
  const files = SCAN_DIRS.flatMap(collectFiles);

  it('scans a non-trivial number of component files', () => {
    expect(files.length).toBeGreaterThan(3);
  });

  it.each(FORBIDDEN_PATTERNS)('contains no $name', ({ re }) => {
    const offenders = files.filter((f) => re.test(stripComments(fs.readFileSync(f, 'utf8'))));
    expect(offenders.map((f) => path.relative(MOBILE_ROOT, f))).toEqual([]);
  });

  it('contains no purple/indigo hex colors', () => {
    const offenders: string[] = [];
    for (const f of files) {
      const hits = findPurpleIndigo(stripComments(fs.readFileSync(f, 'utf8')));
      if (hits.length) offenders.push(`${path.relative(MOBILE_ROOT, f)}: ${hits.join(', ')}`);
    }
    expect(offenders).toEqual([]);
  });

  it('caps corner radius at 12px (no pill-everything)', () => {
    const offenders: string[] = [];
    for (const f of files) {
      const content = stripComments(fs.readFileSync(f, 'utf8'));
      const re = /borderRadius:\s*(\d+)/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(content))) {
        if (parseInt(m[1], 10) > 12) offenders.push(`${path.relative(MOBILE_ROOT, f)}: ${m[1]}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe('F.0 primitive kit renders', () => {
  it('renders the primitives without crashing and matches snapshot', () => {
    const tree = render(
      <>
        <Card testID="card">
          <Stat label="KNEE DRIVE" value={92} unit="deg" />
        </Card>
        <MetricReadout testID="metric" value={61.5} unit="deg" />
        <Tag label="comparable" tone="signal" testID="tag" />
        <Divider />
        <Button label="Analyze" onPress={() => {}} testID="primary-btn" />
        <Button label="Cancel" variant="secondary" testID="secondary-btn" />
      </>
    ).toJSON();
    expect(tree).toBeTruthy();
    expect(tree).toMatchSnapshot();
  });
});
