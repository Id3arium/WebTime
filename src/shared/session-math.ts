// Pure functions for session-limit / carryover math.
// No browser APIs — testable in isolation with `node --test`.

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
