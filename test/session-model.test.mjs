// Tests for src/shared/session-model.ts.
// Run with: npm test  (or: node --test test/session-model.test.mjs)
// Compiles the module inline via esbuild, then runs assertions.
//
// Headline cases: live-length-change (shrink preserves elapsed time) and grace
// baked in at session birth (no mid-session gap, wind-down only at the true
// extended tail).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const out = mkdtempSync(join(tmpdir(), 'webtime-model-test-'));
const outFile = join(out, 'session-model.mjs');
await build({
  entryPoints: ['src/shared/session-model.ts'],
  bundle: true,
  format: 'esm',
  outfile: outFile,
  platform: 'node',
});
const mod = await import(pathToFileURL(outFile).href);
const {
  startSession, effectiveLength, endsAt, displayFor,
  naturalEnd, endEarly, changeLength,
  computeGraceSeconds, computePhiNudgeTimes, nextNudgeToFire, markNudgeFired,
  windDownState, WIND_DOWN_DURATION,
} = mod;

const M = 60;

// ---------------------------------------------------------------------------
// Derivers
// ---------------------------------------------------------------------------

test('effectiveLength sums base + carryover + grace', () => {
  const s = startSession({ dailyTotal: 0, baseLength: 30 * M, carryover: 5 * M, graceSeconds: 1 * M });
  assert.equal(effectiveLength(s), 36 * M);
  assert.equal(endsAt(s), 36 * M); // startDaily 0
});

test('displayFor: fresh session shows full effective length', () => {
  const s = startSession({ dailyTotal: 0, baseLength: 30 * M });
  const d = displayFor(s, 0);
  assert.equal(d.sessionTime, 0);
  assert.equal(d.sessionLimitSeconds, 30 * M);
  assert.equal(d.remaining, 30 * M);
});

test('displayFor: anchored to startDaily, not a daily modulo', () => {
  // Session started at daily=2400 (i.e. session 2). 5 min in.
  const s = startSession({ dailyTotal: 40 * M, baseLength: 30 * M, sessionNum: 2 });
  const d = displayFor(s, 45 * M);
  assert.equal(d.sessionTime, 5 * M);
  assert.equal(d.remaining, 25 * M);
});

// ---------------------------------------------------------------------------
// CASE 1 — the headline bug: shrink preserves elapsed time
// ---------------------------------------------------------------------------

test('changeLength: 55→45 min at 40 min in → 5 min remaining (the reported bug)', () => {
  const s = startSession({ dailyTotal: 0, baseLength: 55 * M });
  // 40 min in → 15 min left on the old 55 min limit
  assert.equal(displayFor(s, 40 * M).remaining, 15 * M);

  const { session, expired } = changeLength(s, { dailyTotal: 40 * M, newBaseLength: 45 * M });
  assert.equal(expired, false);
  // Elapsed preserved (40 min), so remaining drops by exactly the 10 min delta.
  assert.equal(displayFor(session, 40 * M).sessionTime, 40 * M);
  assert.equal(displayFor(session, 40 * M).remaining, 5 * M);
});

// ---------------------------------------------------------------------------
// CASE 2 — shrink past elapsed → expired (caller fires cooldown)
// ---------------------------------------------------------------------------

test('changeLength: shrink below elapsed → expired=true', () => {
  const s = startSession({ dailyTotal: 0, baseLength: 55 * M });
  const { expired } = changeLength(s, { dailyTotal: 40 * M, newBaseLength: 30 * M });
  assert.equal(expired, true); // 40 min in, new limit 30 → over
});

test('changeLength: shrink to exactly elapsed → expired=true (remaining 0)', () => {
  const s = startSession({ dailyTotal: 0, baseLength: 55 * M });
  const { session, expired } = changeLength(s, { dailyTotal: 40 * M, newBaseLength: 40 * M });
  assert.equal(expired, true);
  assert.equal(displayFor(session, 40 * M).remaining, 0);
});

// ---------------------------------------------------------------------------
// CASE 3 — grow mid-session
// ---------------------------------------------------------------------------

test('changeLength: 45→55 min at 30 min in → 25 min remaining, not expired', () => {
  const s = startSession({ dailyTotal: 0, baseLength: 45 * M });
  const { session, expired } = changeLength(s, { dailyTotal: 30 * M, newBaseLength: 55 * M });
  assert.equal(expired, false);
  assert.equal(displayFor(session, 30 * M).remaining, 25 * M);
});

// ---------------------------------------------------------------------------
// CASE 4 — endEarly bakes carryover + grace into the next session AT BIRTH
// ---------------------------------------------------------------------------

test('endEarly: 10 min left → carryover 10 min, grace 1 min, both baked into next session', () => {
  const s = startSession({ dailyTotal: 0, baseLength: 30 * M, sessionNum: 1 });
  // 20 min in → 10 min left
  const r = endEarly(s, { dailyTotal: 20 * M, cooldownIncrement: 5 * M });
  assert.ok(r !== null);
  assert.equal(r.graceEarned, 1 * M); // 10% of 10 min = 1 min

  const next = r.nextSession;
  assert.equal(next.sessionNum, 2);
  assert.equal(next.startDaily, 20 * M);     // anchored at current daily
  assert.equal(next.carryover, 10 * M);
  assert.equal(next.graceSeconds, 1 * M);
  // Effective length from second 0 — grace is part of the duration, no gap.
  assert.equal(effectiveLength(next), 30 * M + 10 * M + 1 * M);
});

test('endEarly: returns null when nothing left to claim', () => {
  const s = startSession({ dailyTotal: 0, baseLength: 30 * M });
  assert.equal(endEarly(s, { dailyTotal: 30 * M, cooldownIncrement: 5 * M }), null);
  assert.equal(endEarly(s, { dailyTotal: 35 * M, cooldownIncrement: 5 * M }), null);
});

// ---------------------------------------------------------------------------
// CASE 5 — grace does not compound
// ---------------------------------------------------------------------------

test('endEarly: a grace-extended session earns no new grace', () => {
  // This session was BORN with grace (graceSeconds > 0).
  const s = startSession({ dailyTotal: 0, baseLength: 30 * M, graceSeconds: 1 * M, sessionNum: 2 });
  // End it early with time left — should NOT earn more grace.
  const r = endEarly(s, { dailyTotal: 20 * M, cooldownIncrement: 5 * M });
  assert.ok(r !== null);
  assert.equal(r.graceEarned, 0);
  assert.equal(r.nextSession.graceSeconds, 0);
  // Carryover still rolls (the unused time is real regardless of grace).
  assert.equal(r.nextSession.carryover, 11 * M); // effLen 31 min, 20 in → 11 left
});

// ---------------------------------------------------------------------------
// CASE 6 — catch-up nudge after a shrink
// ---------------------------------------------------------------------------

test('nextNudgeToFire: a nudge that moves behind us after shrink fires once', () => {
  // Long session with a known nudge schedule.
  const s0 = startSession({ dailyTotal: 0, baseLength: 60 * M });
  const times = computePhiNudgeTimes(effectiveLength(s0));
  assert.ok(times.length > 0, 'expected at least one nudge for a 60-min session');
  const firstNudge = times[0];

  // Sit just BEFORE the first nudge — nothing due yet.
  assert.equal(nextNudgeToFire(s0, firstNudge - 1), null);

  // Now we're AT/after it → it's due.
  const due = nextNudgeToFire(s0, firstNudge);
  assert.equal(due, firstNudge);

  // Mark fired, then it must not fire again.
  const s1 = markNudgeFired(s0, due);
  assert.equal(nextNudgeToFire(s1, firstNudge), null);
});

// ---------------------------------------------------------------------------
// CASE 7 — catch-up after a skipped tick
// ---------------------------------------------------------------------------

test('nextNudgeToFire: jumping past a nudge still fires it next call', () => {
  const s = startSession({ dailyTotal: 0, baseLength: 60 * M });
  const times = computePhiNudgeTimes(effectiveLength(s));
  const firstNudge = times[0];
  // Daily jumps from before the nudge to well past it (simulated skipped ticks).
  const due = nextNudgeToFire(s, firstNudge + 30);
  assert.equal(due, firstNudge); // not dropped
});

test('nextNudgeToFire: picks the LATEST overdue unfired nudge', () => {
  const s = startSession({ dailyTotal: 0, baseLength: 60 * M });
  const times = computePhiNudgeTimes(effectiveLength(s));
  assert.ok(times.length >= 2, 'need >=2 nudges for this case');
  // Past the second nudge with none fired → should return the second (latest eligible).
  const due = nextNudgeToFire(s, times[1] + 5);
  assert.equal(due, times[1]);
});

// ---------------------------------------------------------------------------
// CASE 8 — wind-down only at the extended tail (after carryover + grace)
// ---------------------------------------------------------------------------

test('windDownState: not active at base-60 when session has carryover+grace', () => {
  const s = startSession({ dailyTotal: 0, baseLength: 30 * M, carryover: 5 * M, graceSeconds: 1 * M });
  const eff = effectiveLength(s); // 36 min
  // At base - 60 (29 min in) — would be wind-down on a plain 30-min session,
  // but here the real end is 36 min, so NOT active.
  assert.equal(windDownState(s, 30 * M - WIND_DOWN_DURATION).active, false);
  // At the true tail (eff - 60) — active.
  assert.equal(windDownState(s, eff - WIND_DOWN_DURATION).active, true);
  // One second before the very end — progress near 1.
  const wd = windDownState(s, eff - 1);
  assert.ok(wd.progress > 0.9 && wd.progress <= 1);
});

// ---------------------------------------------------------------------------
// CASE 9 — cooldown length: increment in seconds, 0 = immediate roll-over
// ---------------------------------------------------------------------------

test('naturalEnd: cooldown = sessionNum * increment (seconds)', () => {
  const s3 = startSession({ dailyTotal: 0, baseLength: 30 * M, sessionNum: 3 });
  const r = naturalEnd(s3, { dailyTotal: 30 * M, cooldownIncrement: 5 * M });
  assert.equal(r.cooldownSeconds, 15 * M); // 3 * 5 min
  assert.equal(r.nextSession.sessionNum, 4);
  assert.equal(r.nextSession.carryover, 0); // natural end consumes carryover
});

test('naturalEnd: increment 0 → 0 cooldown (limit still fires, immediate roll-over)', () => {
  const s = startSession({ dailyTotal: 0, baseLength: 30 * M, sessionNum: 1 });
  const r = naturalEnd(s, { dailyTotal: 30 * M, cooldownIncrement: 0 });
  assert.equal(r.cooldownSeconds, 0);     // no wait
  assert.equal(r.nextSession.sessionNum, 2); // but the session DID end & rolled over
});

test('cooldown increment is seconds-granular (not minute-rounded)', () => {
  const s = startSession({ dailyTotal: 0, baseLength: 30 * M, sessionNum: 2 });
  // 90-second increment → session 2 cooldown = 180s. Proves sub-minute works.
  const r = naturalEnd(s, { dailyTotal: 30 * M, cooldownIncrement: 90 });
  assert.equal(r.cooldownSeconds, 180);
});

// ---------------------------------------------------------------------------
// CASE 10 — endEarly with nothing left (covered above) + grace formula
// ---------------------------------------------------------------------------

test('computeGraceSeconds: floor of 10% of given-up time', () => {
  assert.equal(computeGraceSeconds(10 * M), 1 * M);
  assert.equal(computeGraceSeconds(55), 5);  // floor(5.5)
  assert.equal(computeGraceSeconds(0), 0);
});
