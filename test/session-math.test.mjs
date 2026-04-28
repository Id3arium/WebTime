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
const { nextBoundary, computeTimerDisplay, endSessionEarly, naturalCooldown } = mod;

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
