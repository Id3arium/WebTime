// Live session card for the detail ("This site") view's right panel. NEW in the
// redesign — the old popup only edited session *settings*, never rendered a live
// session. Reads the background's persisted session state from storage and uses
// the pure session-model functions to derive elapsed / remaining / cooldown.
//
// Three states, mirroring the design:
//   Active   — a session is running: elapsed / limit, progress, "End early".
//   Cooldown — session ended, counting down until the next unlocks.
//   Off      — limits disabled for this domain (or no session yet).

import { formatClock, getLocalDateStr } from '../shared/utils.js';
import { displayFor, type ActiveSession } from '../shared/session-model.js';

declare const browser: typeof chrome;

const SESSION_STATE_KEY = 'webTimeSessionState';
const SETTINGS_KEY = 'webTimeSettings';

// The currently-shown domain/reset, so the storage listener re-renders the right
// card. Set by renderSessionCard; read by the onChanged handler below.
let liveDomain: string | null = null;
let liveDayReset = 0;
let storageListenerWired = false;

/**
 * Make the session card REACTIVE: re-render whenever the background mutates
 * session state or settings in storage. Without this the card only painted once
 * (right after the popup's own write, racing the background), so toggling rules
 * appeared to do nothing until a manual refresh. Idempotent — wires once.
 */
function ensureStorageListener(): void {
  if (storageListenerWired) return;
  storageListenerWired = true;
  browser.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (!(SESSION_STATE_KEY in changes) && !(SETTINGS_KEY in changes)) return;
    if (liveDomain === null) return;
    renderSessionCard(liveDomain, liveDayReset).catch(err =>
      console.error('Error re-rendering session card on storage change:', err));
  });
}

interface SessionState {
  date: string;
  sessions: Record<string, ActiveSession>;
  cooldownEndTime: Record<string, number>;
  cooldownTotalSec: Record<string, number>;
}

/**
 * The session model anchors `startDaily` to the active DOMAIN's today seconds
 * (background.ts: `todaysData[trackedTabDomain]`), NOT the all-sites total — so
 * the card must derive elapsed from the same per-domain figure or sessionTime
 * is wildly inflated.
 */
function domainDailySeconds(
  timeHistory: Record<string, Record<string, number>>, date: string, domain: string
): number {
  return timeHistory[date]?.[domain] || 0;
}

function el(tag: string, cls: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}

const PHI = (1 + Math.sqrt(5)) / 2;

interface DomainLimits {
  sessionLimitEnabled?: boolean;
  sessionLimit?: number;          // minutes
  cooldownIncrement?: number;     // minutes (may be fractional)
  nudgeCount?: number;
}

// Serialize writes: rapid stepper clicks each do read-modify-write on the same
// settings object, so concurrent calls would clobber each other. Chain them.
let writeQueue: Promise<void> = Promise.resolve();

/** Persist one domain's limit settings, mirroring saveSettings' storage shape.
 *  Serialized via writeQueue so back-to-back changes don't race. */
function saveDomainLimits(domain: string, next: DomainLimits): Promise<void> {
  // Snapshot `next` now — it's a live working copy the caller keeps mutating.
  const snapshot = { ...next };
  writeQueue = writeQueue.then(() => writeDomainLimits(domain, snapshot));
  return writeQueue;
}

async function writeDomainLimits(domain: string, next: DomainLimits): Promise<void> {
  const data = await browser.storage.local.get('webTimeSettings');
  const settings = data.webTimeSettings || { global: {}, domains: {} };
  if (!settings.domains) settings.domains = {};

  const hasAny = next.sessionLimitEnabled || (next.sessionLimit || 0) > 0 || (next.cooldownIncrement || 0) > 0;
  if (hasAny) {
    settings.domains[domain] = {
      sessionLimitEnabled: next.sessionLimitEnabled || false,
      sessionLimit: (next.sessionLimit || 0) > 0 ? next.sessionLimit : undefined,
      cooldownIncrement: (next.cooldownIncrement || 0) > 0 ? next.cooldownIncrement : undefined,
      nudgeCount: next.nudgeCount,
    };
  } else {
    delete settings.domains[domain];
  }
  await browser.storage.local.set({ webTimeSettings: settings });
  browser.runtime.sendMessage({ type: 'SETTINGS_UPDATED' });
}

/** A stepper handle: its element plus a setter to drive it from outside (e.g. a
 *  sibling stepper carrying into it) without re-firing onChange. */
interface Stepper {
  el: HTMLElement;
  /** Update the displayed value (and `cur`) silently — no onChange. */
  setValue: (v: number) => void;
}

/** A labelled stepper: value + unit, with ▲/▼ buttons. When `onCarry` is set,
 *  stepping past min/max wraps around (within [min,max]) and reports the
 *  direction so a neighbour (e.g. minutes) can absorb the carry. */
function stepper(opts: {
  label: string; rec?: string; value: number; unit?: string;
  min: number; max: number; step: number;
  onChange: (v: number) => void;
  /** Called when a step crosses min/max. Return false to veto the wrap (the
   *  value stays pinned at the edge it tried to cross). */
  onCarry?: (dir: number) => boolean;
}): Stepper {
  const group = el('div', 'sc-stepper-group');
  const head = el('div', 'sc-stepper-head');
  head.append(el('span', 'sc-stepper-label', opts.label));
  if (opts.rec) head.append(el('span', 'sc-stepper-rec', opts.rec));

  const box = el('div', 'sc-stepper-box');
  const valWrap = el('span', 'sc-stepper-val');
  const setText = (v: number) => {
    valWrap.replaceChildren(document.createTextNode(String(v)));
    if (opts.unit) valWrap.append(Object.assign(document.createElement('span'), {
      className: 'sc-stepper-unit', textContent: opts.unit,
    }));
  };
  let cur = opts.value;
  setText(cur);

  const btns = el('div', 'sc-stepper-btns');
  const mk = (sym: string, dir: number): HTMLButtonElement => {
    const b = document.createElement('button');
    b.className = 'sc-stepper-btn';
    b.textContent = sym;
    b.addEventListener('click', () => {
      const span = opts.max - opts.min + opts.step; // wrap modulus, in step units
      const raw = cur + dir * opts.step;
      if (opts.onCarry && (raw > opts.max || raw < opts.min)) {
        // Past an edge: let the neighbour absorb the carry. If it accepts, wrap
        // within [min,max]; if it vetoes (e.g. minutes already 0), stay put.
        if (opts.onCarry(dir)) {
          cur = ((((raw - opts.min) % span) + span) % span) + opts.min;
        }
      } else {
        cur = Math.max(opts.min, Math.min(opts.max, raw));
      }
      // Round to the step grid to keep fractional steps (e.g. 0.5) from
      // accumulating binary floating-point dust like 3.4999999.
      cur = Math.round(cur / opts.step) * opts.step;
      setText(cur);
      opts.onChange(cur);
    });
    return b;
  };
  btns.append(mk('▲', 1), mk('▼', -1));
  box.append(valWrap, btns);
  group.append(head, box);
  return {
    el: group,
    setValue: (v: number) => { cur = v; setText(cur); },
  };
}

function cardShell(): HTMLElement {
  return el('div', 'sc-card');
}

/**
 * Per-site "Session rules" card (top of the detail right panel). Toggle +
 * limit / cooldown / nudge steppers. Persists per-domain on every change.
 */
export async function renderSessionSettingsCard(
  domain: string | null,
  // Reset time no longer needed here — the live card re-renders reactively via
  // the storage listener rather than being re-rendered from persist().
  _dayResetTime = 0,
): Promise<void> {
  const host = document.getElementById('session-settings-card');
  if (!host) return;
  if (!domain) { host.replaceChildren(); return; }

  const data = await browser.storage.local.get('webTimeSettings');
  const settings = data.webTimeSettings || { global: {}, domains: {} };
  const d: DomainLimits = settings.domains?.[domain] || {};

  // Working copy persisted on each control change.
  const cur: Required<DomainLimits> = {
    sessionLimitEnabled: d.sessionLimitEnabled || false,
    sessionLimit: d.sessionLimit || 30,
    cooldownIncrement: d.cooldownIncrement || 3,
    nudgeCount: d.nudgeCount ?? Math.round(PHI * Math.sqrt((d.sessionLimit || 30) / 15)),
  };
  // Just persist. The live session card re-renders REACTIVELY via the storage
  // listener (on both our settings write and the background's session-state
  // write), so we don't manually re-render here and race the background.
  const persist = () => saveDomainLimits(domain, cur)
    .catch(err => console.error('Error saving domain limits:', err));

  const card = el('div', 'sc-card sc-settings');

  // header: title + toggle
  const head = el('div', 'sc-head');
  head.append(el('span', 'sc-settings-title', 'Session rules'));
  const toggle = document.createElement('button');
  toggle.className = 'sc-toggle';
  const knob = el('span', 'sc-toggle-knob');
  toggle.appendChild(knob);
  const reflectToggle = () => {
    toggle.classList.toggle('on', cur.sessionLimitEnabled);
    body.style.opacity = cur.sessionLimitEnabled ? '1' : '0.4';
  };
  toggle.addEventListener('click', () => {
    cur.sessionLimitEnabled = !cur.sessionLimitEnabled;
    reflectToggle();
    persist();
  });
  head.append(toggle);

  // body: two two-up rows — [session length | nudges], then the cooldown
  // increment split into [minutes | seconds] steppers.
  const body = el('div', 'sc-settings-body');
  const recNudges = `(rec ${Math.round(PHI * Math.sqrt(cur.sessionLimit / 15))})`;

  // Cooldown is stored as one fractional-minutes number; the two steppers each
  // own a part and recombine on change. Read once so they share a baseline.
  let coolMin = Math.floor(cur.cooldownIncrement);
  let coolSec = Math.round((cur.cooldownIncrement - coolMin) * 60);
  const persistCooldown = () => { cur.cooldownIncrement = coolMin + coolSec / 60; persist(); };

  const rowOne = el('div', 'sc-settings-twoup');
  rowOne.append(
    stepper({
      label: 'Session length', value: cur.sessionLimit, unit: 'min',
      min: 1, max: 240, step: 1,
      onChange: v => { cur.sessionLimit = v; persist(); },
    }).el,
    stepper({
      label: 'Nudges', rec: recNudges, value: cur.nudgeCount, unit: '',
      min: 0, max: 20, step: 1,
      onChange: v => { cur.nudgeCount = v; persist(); },
    }).el
  );

  // Minutes + seconds steppers. Seconds runs 0/15/30/45 and rolls into minutes
  // when it crosses an edge — ▲ at 45s bumps a minute, ▼ at 0s borrows one
  // (vetoed when already at 0m so the cooldown can't go negative).
  const minStepper = stepper({
    label: 'Cooldown', value: coolMin, unit: 'm',
    min: 0, max: 120, step: 1,
    onChange: v => { coolMin = v; persistCooldown(); },
  });
  const secStepper = stepper({
    label: 'Cooldown secs', value: coolSec, unit: 's',
    min: 0, max: 45, step: 15,
    onChange: v => { coolSec = v; persistCooldown(); },
    onCarry: dir => {
      if (dir < 0 && coolMin <= 0) return false; // can't borrow below 0m
      coolMin = Math.min(120, Math.max(0, coolMin + dir));
      minStepper.setValue(coolMin);
      return true; // persisted by the seconds onChange that follows
    },
  });

  const rowTwo = el('div', 'sc-settings-twoup');
  rowTwo.append(minStepper.el, secStepper.el);
  body.append(rowOne, rowTwo);

  card.append(head, body);
  host.replaceChildren(card);
  reflectToggle();
}

/** Off — limits disabled for this domain. */
function renderOff(host: HTMLElement): void {
  const card = el('div', 'sc-card sc-off');
  card.append(
    el('div', 'sc-off-title', 'No limit on this site'),
    el('div', 'sc-off-sub', 'Tracking time only. Turn limits on above to run sessions here.')
  );
  host.replaceChildren(card);
}

/** Idle — limits ON but no session running yet (e.g. not the active tab today). */
function renderIdle(host: HTMLElement, limitMinutes: number): void {
  const card = el('div', 'sc-card sc-off');
  card.append(
    el('div', 'sc-off-title', 'No active session'),
    el('div', 'sc-off-sub',
      `A ${limitMinutes}-minute session starts when you browse this site.`)
  );
  host.replaceChildren(card);
}

/** Active session state. */
function renderActive(host: HTMLElement, s: ActiveSession, dailyTotal: number, shortcut: string | null): void {
  const { sessionTime, sessionLimitSeconds } = displayFor(s, dailyTotal);
  const remaining = Math.max(0, sessionLimitSeconds - sessionTime);
  // Percent LEFT (not spent) so the bar's gone-but-not-forgotten job — proportion
  // at a glance — is carried by a number that moves the SAME direction as the
  // countdown timer (down), instead of a bar that filled up against it.
  const pctLeft = sessionLimitSeconds > 0 ? Math.round((remaining / sessionLimitSeconds) * 100) : 0;
  // endEarly() rolls the FULL remaining into the next session as carryover, plus
  // a 10% grace bonus on top of it (computeGraceSeconds). No new bonus if this
  // session was already grace-extended (grace can't compound).
  const grace = s.graceSeconds > 0 ? 0 : Math.floor(remaining * 0.1);
  const rollover = remaining + grace;
  // Near-the-end warmth lives on the percent now that the bar is gone.
  const leftColor = pctLeft < 15 ? 'var(--warn)' : 'var(--good)';

  const card = cardShell();

  // Title carries the live "· NN% left" — the old elapsed/limit line was
  // redundant with the ledger's "time left" below, so it's gone.
  const head = el('div', 'sc-head');
  const title = el('span', 'sc-title', `Session ${s.sessionNum}`);
  const pctEl = el('span', 'sc-title-pct', ` · ${pctLeft}% left`);
  pctEl.style.color = leftColor;
  title.append(pctEl);
  head.append(title);
  head.append(el('span', 'sc-badge sc-badge-active', 'Active'));

  // What "End early" does, as a ledger: quiet label on the left, value
  // right-aligned so the figures stack into a column that visibly adds up.
  // A divider sits before the total, whose value is the green "what you keep".
  const breakdown = el('div', 'sc-breakdown');
  const row = (label: string, value: string, opts: { op?: string; total?: boolean } = {}): HTMLElement => {
    const r = el('div', `sc-breakdown-row${opts.total ? ' is-total' : ''}`);
    r.append(el('span', 'sc-breakdown-label', label));
    const val = el('span', 'sc-breakdown-val');
    if (opts.op) val.append(el('span', 'sc-breakdown-op', `${opts.op} `));
    val.append(document.createTextNode(value));
    r.append(val);
    return r;
  };
  breakdown.append(row('Time left', formatClock(remaining)));
  if (grace > 0) breakdown.append(row('10% bonus', formatClock(grace), { op: '+' }));
  breakdown.append(el('div', 'sc-breakdown-rule'));
  breakdown.append(row(`Time added to Session ${s.sessionNum + 1}`, formatClock(rollover), { total: true }));

  const btn = el('button', 'sc-btn');
  btn.id = 'session-end-early-btn';
  btn.textContent = shortcut ? `End session (${shortcut})` : 'End session early';

  card.append(head, breakdown, btn);
  host.replaceChildren(card);

  btn.addEventListener('click', () => {
    // Don't end immediately — an accidental click would be unrecoverable. Ask the
    // active tab to show the confirmation overlay (same as the keyboard shortcut),
    // then close the popup so the user confirms in context.
    browser.runtime.sendMessage({ type: 'SHOW_END_SESSION_CONFIRM' });
    window.close();
  });
}

/** Cooldown state. */
function renderCooldown(host: HTMLElement, s: ActiveSession, endTime: number, totalSec: number): void {
  const remainSec = Math.max(0, Math.ceil((endTime - Date.now()) / 1000));
  // The session cooling down is the one before the (next) stored session.
  const endedNum = Math.max(1, s.sessionNum - 1);

  const card = cardShell();

  const head = el('div', 'sc-head');
  head.append(el('span', 'sc-title', `Session ${endedNum} ended`));
  head.append(el('span', 'sc-badge sc-badge-cooldown', 'Cooldown'));

  // No fill-up bar here either — the countdown number is the whole story.
  // (totalSec retained in the signature for callers; unused now the bar is gone.)
  void totalSec;
  card.append(
    head,
    el('div', 'sc-time', formatClock(remainSec)),
    el('div', 'sc-sub', `until Session ${s.sessionNum} unlocks`)
  );
  host.replaceChildren(card);
}

/**
 * Render the session card for the currently selected domain.
 * Reads live session state + settings + daily total from storage.
 */
export async function renderSessionCard(domain: string | null, dayResetTime: number): Promise<void> {
  liveDomain = domain;
  liveDayReset = dayResetTime;
  ensureStorageListener();

  const host = document.getElementById('session-card');
  if (!host) return;
  if (!domain) { renderOff(host); return; }

  const data = await browser.storage.local.get([SESSION_STATE_KEY, 'webTimeSettings', 'trackedTime']);
  const settings = data.webTimeSettings || { global: {}, domains: {} };
  const domainSettings = settings.domains?.[domain] || {};

  // Limits off for this domain → Off card.
  if (!domainSettings.sessionLimitEnabled) { renderOff(host); return; }

  const state = data[SESSION_STATE_KEY] as SessionState | undefined;
  const today = getLocalDateStr(dayResetTime);

  // Stale (different day) state shouldn't drive the card.
  if (!state || state.date !== today) { renderOff(host); return; }

  const session = state.sessions?.[domain];
  const limitMinutes = domainSettings.sessionLimit || 30;

  // Cooldown takes precedence — there's a future cooldown end for this domain.
  const cooldownEnd = state.cooldownEndTime?.[domain] || 0;
  if (session && cooldownEnd > Date.now()) {
    renderCooldown(host, session, cooldownEnd, state.cooldownTotalSec?.[domain] || 0);
    return;
  }

  if (session) {
    const timeHistory = data.trackedTime?.timeHistory || {};
    const dailyTotal = domainDailySeconds(timeHistory, today, domain);
    const { remaining } = displayFor(session, dailyTotal);
    // Genuinely running only while time remains; otherwise the background has
    // moved on (cooldown just ended or a new session is pending) — show Idle.
    if (remaining > 0) {
      const sc = settings.global?.endSessionShortcut;
      const shortcut = sc === null ? null : (sc || 'Ctrl+E');
      renderActive(host, session, dailyTotal, shortcut);
      return;
    }
  }

  // Limits on, but nothing active for this domain right now.
  renderIdle(host, limitMinutes);
}
