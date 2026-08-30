/**
 * Regression test for the drill-key namespace bug: reference_drills.sql's
 * seed keys used to be a completely different vocabulary (`a_skips`,
 * `wall_drills`, ...) than the `drillId`s biomech2d.py's DRILLS dict
 * actually emits (`drill-wall-drive`, `drill-hip-hitch`, ...). Every lookup
 * in approveSuggestion() (apps/api/src/db/queries.ts) matches on drill_key,
 * so a mismatch meant `refDrill` was silently undefined for every approval
 * in production — cues/rationale in every calendar event were empty.
 *
 * This test has no DB and no mocks: it parses the actual seed SQL file and
 * asserts every key biomech2d.py's DRILLS dict can emit is present. It
 * would have failed against the pre-fix seed file (zero of its 10 keys
 * matched any real drillId) and passes now that the keys are aligned.
 */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SEED_PATH = join(__dirname, '../seeds/reference_drills.sql');

// Mirrors biomech2d.py's DRILLS dict keys (apps/ml-worker/src/biomech2d.py).
// Cross-language, so kept in sync by hand — this test's whole purpose is to
// catch drift between the two, so a manual list here is the right guard
// rather than something that could itself silently drift unnoticed.
const REAL_DRILL_IDS = [
  'drill-wall-drive',
  'drill-high-knee-switch',
  'drill-dribble-bound',
  'drill-heel-recovery',
  'drill-arm-iso',
  'drill-quick-feet',
  'drill-wickets',
  'drill-banded-starts',
  'drill-metronome',
  'drill-lateral-band',
  'drill-hip-hitch',
];

function parseSeedKeys(sql: string): string[] {
  // Each row starts `('<key>', ...` — the key is always the first quoted
  // value in the tuple, immediately after the opening paren.
  const matches = sql.matchAll(/\(\s*'([^']+)'\s*,/g);
  return [...matches].map((m) => m[1]!);
}

describe('reference_drills seed key alignment', () => {
  const seedSql = readFileSync(SEED_PATH, 'utf-8');
  const seedKeys = parseSeedKeys(seedSql);

  it('parses a non-empty set of keys from the seed file (sanity check on the parser itself)', () => {
    expect(seedKeys.length).toBeGreaterThan(0);
  });

  it('every biomech2d.py drillId has a matching reference_drills seed row', () => {
    const missing = REAL_DRILL_IDS.filter((id) => !seedKeys.includes(id));
    expect(missing).toEqual([]);
  });

  it('does not still contain any of the old, orphaned seed keys', () => {
    const orphaned = ['a_skips', 'wall_drills', 'standing_arm_swings', 'sled_pulls',
      'b_skips', 'ankle_stiffness', 'hip_circles', 'power_skips', 'wicket_runs',
      'torso_lean_march'];
    const stillPresent = orphaned.filter((k) => seedKeys.includes(k));
    expect(stillPresent).toEqual([]);
  });

  it('seed file declares a recovery_phases column so phase content has somewhere to land', () => {
    expect(seedSql).toMatch(/INSERT INTO reference_drills \([^)]*\brecovery_phases\b/);
  });

  it('drill-hip-hitch (pelvic_drop) has all 4 recovery phases in order', () => {
    const row = seedSql.match(/'drill-hip-hitch',[\s\S]*?\n \]'\);/);
    expect(row).not.toBeNull();
    const phaseNumbers = [...row![0].matchAll(/"phase":\s*(\d)/g)].map((m) => Number(m[1]));
    expect(phaseNumbers).toEqual([1, 2, 3, 4]);
  });
});
