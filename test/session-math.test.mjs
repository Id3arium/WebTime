// Run with: npm test
// Compiles src/shared/session-math.ts inline via esbuild, then runs assertions.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const out = mkdtempSync(join(tmpdir(), 'webtime-test-'));
const outFile = join(out, 'session-math.mjs');
await build({
  entryPoints: ['src/shared/session-math.ts'],
  bundle: true,
  format: 'esm',
  outfile: outFile,
  platform: 'node',
});
const mod = await import(pathToFileURL(outFile).href);
const {
  nextBoundary, computeTimerDisplay, endSessionEarly, naturalCooldown,
  computePhiNudgeTimes, computeGraceSeconds, isInWindDown, WIND_DOWN_DURATION,
} = mod;

const M = 60;

test('nextBoundary: aligned to next multiple of baseLimit', () => {
  assert.equal(nextBoundary(0, 30 * M), 30 * M);
  assert.equal(nextBoundary(25 * M, 30 * M), 30 * M);
  assert.equal(nextBoundary(30 * M, 30 * M), 60 * M);
  assert.equal(nextBoundary(31 * M, 30 * M), 60 * M);
});

test('display: fresh aligned session shows full base', () => {
  const d = computeTimerDisplay({
    dailyTotal: 0, baseLimit: 30 * M, boundary: 30 * M, carryover: 0,
  });
  assert.equal(d.sessionTime, 0);
  assert.equal(d.sessionLimitSeconds, 30 * M);
  assert.equal(d.remaining, 30 * M);
});

test('display: aligned session 25 min in shows 5 min remaining', () => {
  const d = computeTimerDisplay({
    dailyTotal: 25 * M, baseLimit: 30 * M, boundary: 30 * M, carryover: 0,
  });
  assert.equal(d.sessionTime, 25 * M);
  assert.equal(d.remaining, 5 * M);
});

test('endSessionEarly: at 25 min into 30 min session yields 5 min carryover', () => {
  const r = endSessionEarly({
    dailyTotal: 25 * M, baseLimit: 30 * M, boundary: 30 * M,
    priorCarryover: 0, cooldownIncrement: 10 * M,
  });
  assert.ok(r !== null);
  assert.equal(r.newCarryover, 5 * M);
  assert.equal(r.sessionNum, 1);
  assert.equal(r.cooldownSeconds, 10 * M);
  assert.equal(r.newBoundary, 60 * M);
});

test('display: just after end-early at 25 min shows 35 min remaining (BUG REPRO)', () => {
  // The user-reported bug: after end-early the next session should show 35:00
  // (30 base + 5 carryover), not 5:00.
  const r = endSessionEarly({
    dailyTotal: 25 * M, baseLimit: 30 * M, boundary: 30 * M,
    priorCarryover: 0, cooldownIncrement: 10 * M,
  });
  // At cooldown end, dailyTotal is still 25 min (timer was paused).
  const d = computeTimerDisplay({
    dailyTotal: 25 * M,
    baseLimit: 30 * M,
    boundary: r.newBoundary,
    carryover: r.newCarryover,
  });
  assert.equal(d.sessionTime, 0, 'sessionTime should be 0 at start of new extended session');
  assert.equal(d.sessionLimitSeconds, 35 * M, 'limit should be 35 min');
  assert.equal(d.remaining, 35 * M, 'remaining should be 35 min');
});

test('display: 1 sec into the extended session shows 34:59', () => {
  const r = endSessionEarly({
    dailyTotal: 25 * M, baseLimit: 30 * M, boundary: 30 * M,
    priorCarryover: 0, cooldownIncrement: 10 * M,
  });
  const d = computeTimerDisplay({
    dailyTotal: 25 * M + 1,
    baseLimit: 30 * M,
    boundary: r.newBoundary,
    carryover: r.newCarryover,
  });
  assert.equal(d.sessionTime, 1);
  assert.equal(d.remaining, 35 * M - 1);
});

test('naturalCooldown after carryover-extended session: clears carryover, session 2', () => {
  const r = endSessionEarly({
    dailyTotal: 25 * M, baseLimit: 30 * M, boundary: 30 * M,
    priorCarryover: 0, cooldownIncrement: 10 * M,
  });
  const nc = naturalCooldown({
    baseLimit: 30 * M,
    boundary: r.newBoundary,
    priorCarryover: r.newCarryover,
    cooldownIncrement: 10 * M,
  });
  assert.equal(nc.sessionNum, 2);
  assert.equal(nc.cooldownSeconds, 20 * M);
  assert.equal(nc.newCarryover, 0);
  assert.equal(nc.newBoundary, 90 * M);
});

test('endSessionEarly: returns null if already at boundary', () => {
  const r = endSessionEarly({
    dailyTotal: 30 * M, baseLimit: 30 * M, boundary: 30 * M,
    priorCarryover: 0, cooldownIncrement: 10 * M,
  });
  assert.equal(r, null);
});

// --- computePhiNudgeTimes ---

test('phiNudges: zero or negative limit returns empty', () => {
  assert.deepEqual(computePhiNudgeTimes(0), []);
  assert.deepEqual(computePhiNudgeTimes(-10), []);
});

test('phiNudges: 15 min session produces nudges', () => {
  const nudges = computePhiNudgeTimes(15 * M);
  assert.ok(nudges.length > 0, 'should have at least one nudge');
  assert.ok(nudges.length <= 3, `too many nudges for 15min: ${nudges.length}`);
  for (const t of nudges) {
    assert.ok(t >= 60, `nudge at ${t}s is before 60s mark`);
    assert.ok(t <= 15 * M - WIND_DOWN_DURATION, `nudge at ${t}s overlaps wind-down`);
  }
});

test('phiNudges: 30 min session has more nudges than 15 min', () => {
  const short = computePhiNudgeTimes(15 * M);
  const long = computePhiNudgeTimes(30 * M);
  assert.ok(long.length >= short.length, 'longer session should have at least as many nudges');
});

test('phiNudges: nudges are sorted ascending', () => {
  const nudges = computePhiNudgeTimes(45 * M);
  for (let i = 1; i < nudges.length; i++) {
    assert.ok(nudges[i] > nudges[i - 1], `nudges not sorted: ${nudges[i-1]} >= ${nudges[i]}`);
  }
});

test('phiNudges: nudges accelerate toward end (gaps shrink)', () => {
  const nudges = computePhiNudgeTimes(45 * M);
  if (nudges.length >= 3) {
    const gaps = [];
    for (let i = 1; i < nudges.length; i++) {
      gaps.push(nudges[i] - nudges[i - 1]);
    }
    for (let i = 1; i < gaps.length; i++) {
      assert.ok(gaps[i] <= gaps[i - 1],
        `gap ${i} (${gaps[i]}s) should be <= gap ${i-1} (${gaps[i-1]}s)`);
    }
  }
});

test('phiNudges: overrideCount=0 disables nudges', () => {
  assert.deepEqual(computePhiNudgeTimes(30 * M, 0), []);
});

test('phiNudges: overrideCount forces exact count (within filterable range)', () => {
  const nudges = computePhiNudgeTimes(30 * M, 8);
  assert.ok(nudges.length > 0, 'should produce nudges with override=8');
  assert.ok(nudges.length <= 8, `should have at most 8 nudges, got ${nudges.length}`);
});

test('phiNudges: undefined overrideCount uses auto formula', () => {
  const auto = computePhiNudgeTimes(30 * M);
  const explicit = computePhiNudgeTimes(30 * M, undefined);
  assert.deepEqual(auto, explicit);
});

test('phiNudges: no nudge in last 60s (wind-down territory)', () => {
  for (const limit of [10 * M, 15 * M, 30 * M, 60 * M]) {
    const nudges = computePhiNudgeTimes(limit);
    for (const t of nudges) {
      assert.ok(t <= limit - WIND_DOWN_DURATION,
        `limit=${limit}s: nudge at ${t}s is in wind-down zone`);
    }
  }
});

// --- computeGraceSeconds ---

test('grace: 0 session gives 0 grace', () => {
  assert.equal(computeGraceSeconds(0), 0);
});

test('grace: under 5 min gives 0 grace', () => {
  assert.equal(computeGraceSeconds(4 * M), 0);
  assert.equal(computeGraceSeconds(299), 0);
});

test('grace: 5 min gives 15s', () => {
  assert.equal(computeGraceSeconds(5 * M), 15);
});

test('grace: 15 min gives 45s', () => {
  assert.equal(computeGraceSeconds(15 * M), 45);
});

test('grace: 30 min gives 90s', () => {
  assert.equal(computeGraceSeconds(30 * M), 90);
});

test('grace: 45 min gives 135s', () => {
  assert.equal(computeGraceSeconds(45 * M), 135);
});

test('grace: 7 min (not a multiple of 5) gives 15s', () => {
  assert.equal(computeGraceSeconds(7 * M), 15);
});

// --- isInWindDown ---

test('windDown: not active when far from end', () => {
  const r = isInWindDown(0, 30 * M);
  assert.equal(r.active, false);
  assert.equal(r.progress, 0);
});

test('windDown: not active if effectiveLimit <= WIND_DOWN_DURATION', () => {
  const r = isInWindDown(50, 60);
  assert.equal(r.active, false);
});

test('windDown: activates at effectiveLimit - 60', () => {
  const limit = 30 * M;
  const start = limit - WIND_DOWN_DURATION;

  const before = isInWindDown(start - 1, limit);
  assert.equal(before.active, false);

  const at = isInWindDown(start, limit);
  assert.equal(at.active, true);
  assert.ok(at.progress >= 0 && at.progress <= 1);
});

test('windDown: progress ramps 0 to 1 over 60s', () => {
  const limit = 30 * M;
  const start = limit - WIND_DOWN_DURATION;

  const early = isInWindDown(start, limit);
  assert.ok(early.progress < 0.1, `progress at start should be near 0, got ${early.progress}`);

  const mid = isInWindDown(start + 30, limit);
  assert.ok(Math.abs(mid.progress - 0.5) < 0.05, `progress at midpoint should be ~0.5, got ${mid.progress}`);

  const end = isInWindDown(limit, limit);
  assert.equal(end.progress, 1);
  assert.equal(end.remaining, 0);
});

test('windDown: remaining decreases correctly', () => {
  const limit = 15 * M;
  const r = isInWindDown(limit - 30, limit);
  assert.equal(r.active, true);
  assert.equal(r.remaining, 30);
});
