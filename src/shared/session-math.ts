// Pure functions for session-limit / carryover math.
// No browser APIs — testable in isolation with `node --test`.

const PHI = (1 + Math.sqrt(5)) / 2;

export const WIND_DOWN_DURATION = 60;

export interface SessionTimerState {
  /** Daily total seconds for this domain. */
  dailyTotal: number;
  /** Base session limit in seconds (>0). */
  baseLimit: number;
  /** Next boundary in daily-seconds (when current session ends). */
  boundary: number;
  /** Extra seconds added to current session beyond baseLimit (carryover). */
  carryover: number;
}

export interface SessionTimerDisplay {
  /** Seconds elapsed in the current session. */
  sessionTime: number;
  /** Total length of the current session = baseLimit + carryover. */
  sessionLimitSeconds: number;
  /** Seconds remaining = sessionLimitSeconds - sessionTime. */
  remaining: number;
}

export function nextBoundary(dailyTotal: number, baseLimit: number): number {
  return (Math.floor(dailyTotal / baseLimit) + 1) * baseLimit;
}

export function computeTimerDisplay(state: SessionTimerState): SessionTimerDisplay {
  const effectiveLimit = state.baseLimit + state.carryover;
  const start = state.boundary - effectiveLimit;
  const sessionTime = Math.max(0, state.dailyTotal - start);
  return {
    sessionTime,
    sessionLimitSeconds: effectiveLimit,
    remaining: effectiveLimit - sessionTime
  };
}

export interface EndEarlyResult {
  newBoundary: number;
  newCarryover: number;
  cooldownSeconds: number;
  sessionNum: number;
}

/**
 * Compute the new state after ending a session early.
 *
 * Returns null if there's no carryover to claim (already at boundary, normal
 * cooldown will fire on its own).
 */
export function endSessionEarly(opts: {
  dailyTotal: number;
  baseLimit: number;
  /** Current boundary (caller should ensure it's been initialized). */
  boundary: number;
  /** Existing carryover on the current session (0 if not extended). */
  priorCarryover: number;
  /** Per-session cooldown increment in seconds (0 = use baseLimit as fallback). */
  cooldownIncrement: number;
}): EndEarlyResult | null {
  const { dailyTotal, baseLimit, boundary, priorCarryover, cooldownIncrement } = opts;

  // Session number = how many baseLimit chunks have been consumed when this
  // session ends. Strip the carryover from the boundary first, since it shifts
  // boundary up but doesn't represent a new "session".
  const sessionNum = Math.round((boundary - priorCarryover) / baseLimit);
  const newCarryover = Math.max(0, boundary - dailyTotal);

  if (newCarryover <= 0) return null;

  const cooldownSeconds = cooldownIncrement > 0
    ? sessionNum * cooldownIncrement
    : baseLimit;

  return {
    // Next session is anchored at current dailyTotal, lasts (base + newCarryover).
    newBoundary: dailyTotal + baseLimit + newCarryover,
    newCarryover,
    cooldownSeconds,
    sessionNum
  };
}

/**
 * Compute the new state after a normal cooldown fires (boundary reached).
 * Carryover is consumed; next session is aligned again.
 */
export function naturalCooldown(opts: {
  baseLimit: number;
  boundary: number;
  priorCarryover: number;
  cooldownIncrement: number;
}): { newBoundary: number; newCarryover: number; cooldownSeconds: number; sessionNum: number } {
  const { baseLimit, boundary, priorCarryover, cooldownIncrement } = opts;
  const sessionNum = Math.round((boundary - priorCarryover) / baseLimit);
  const cooldownSeconds = cooldownIncrement > 0
    ? sessionNum * cooldownIncrement
    : baseLimit;
  return {
    newBoundary: boundary + baseLimit,
    newCarryover: 0,
    cooldownSeconds,
    sessionNum
  };
}

/**
 * Compute phi-based nudge times within a session.
 * Returns sorted array of session-relative seconds (0 = session start).
 * Nudges accelerate toward the session end (sparse early, frequent late).
 */
export function computePhiNudgeTimes(effectiveLimit: number, overrideCount?: number): number[] {
  if (effectiveLimit <= 0) return [];

  const numNudges = overrideCount !== undefined ? overrideCount : Math.round(PHI * Math.sqrt(effectiveLimit / 60 / 15));
  if (numNudges <= 0) return [];

  const nudgeTimes: number[] = [];
  for (let i = 1; i <= numNudges; i++) {
    const timeBeforeEnd = effectiveLimit / Math.pow(PHI, i);
    const nudgeTime = Math.round(effectiveLimit - timeBeforeEnd);
    if (nudgeTime >= 60 && nudgeTime <= effectiveLimit - WIND_DOWN_DURATION) {
      nudgeTimes.push(nudgeTime);
    }
  }

  nudgeTimes.sort((a, b) => a - b);
  return nudgeTimes;
}

/** 10% of remaining time is earned as grace for the next session. */
export function computeGraceSeconds(remainingSeconds: number): number {
  return Math.floor(remainingSeconds * 0.1);
}

export function isInWindDown(
  sessionTime: number,
  effectiveLimit: number
): { active: boolean; progress: number; remaining: number } {
  const windDownStart = effectiveLimit - WIND_DOWN_DURATION;
  if (sessionTime < windDownStart || effectiveLimit < WIND_DOWN_DURATION) {
    return { active: false, progress: 0, remaining: effectiveLimit - sessionTime };
  }
  const elapsed = sessionTime - windDownStart;
  return {
    active: true,
    progress: Math.min(1, elapsed / WIND_DOWN_DURATION),
    remaining: Math.max(0, effectiveLimit - sessionTime)
  };
}
