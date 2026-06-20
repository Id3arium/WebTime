// Live session card for the detail ("This site") view's right panel. NEW in the
// redesign — the old popup only edited session *settings*, never rendered a live
// session. Reads the background's persisted session state from storage and uses
// the pure session-model functions to derive elapsed / remaining / cooldown.
//
// Three states, mirroring the design:
//   Active   — a session is running: elapsed / limit, progress, "End early".
//   Cooldown — session ended, counting down until the next unlocks.
//   Off      — limits disabled for this domain (or no session yet).

import { formatDuration, getLocalDateStr } from '../shared/utils.js';
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

/** A labelled stepper: value + unit, with ▲/▼ buttons. */
function stepper(opts: {
  label: string; rec?: string; value: number; unit?: string;
  min: number; max: number; step: number;
  onChange: (v: number) => void;
}): HTMLElement {
  const group = el('div', 'sc-stepper-group');
  const head = el('div', 'sc-stepper-head');
  head.append(el('span', 'sc-stepper-label', opts.label));
  if (opts.rec) head.append(el('span', 'sc-stepper-rec', opts.rec));

  const box = el('div', 'sc-stepper-box');
  const valWrap = el('span', 'sc-stepper-val');
  const setText = (v: number) => {
    valWrap.textContent = String(v);
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
      cur = Math.max(opts.min, Math.min(opts.max, cur + dir * opts.step));
      setText(cur);
      opts.onChange(cur);
    });
    return b;
  };
  btns.append(mk('▲', 1), mk('▼', -1));
  box.append(valWrap, btns);
  group.append(head, box);
  return group;
}

function progressBar(pct: number, color: string): HTMLElement {
  const track = el('div', 'sc-bar-track');
  const fill = el('div', 'sc-bar-fill');
  fill.style.width = `${Math.max(0, Math.min(100, pct))}%`;
  fill.style.background = color;
  track.appendChild(fill);
  return track;
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

  // body: limit (full row) + cooldown/nudges (two-up)
  const body = el('div', 'sc-settings-body');
  const recCooldown = `(rec ${Math.max(1, Math.round(cur.sessionLimit / 3))}m)`;
  const recNudges = `(rec ${Math.round(PHI * Math.sqrt(cur.sessionLimit / 15))})`;

  body.append(
    stepper({
      label: 'Session length', value: cur.sessionLimit, unit: 'min',
      min: 1, max: 240, step: 5,
      onChange: v => { cur.sessionLimit = v; persist(); },
    })
  );

  const twoUp = el('div', 'sc-settings-twoup');
  twoUp.append(
    stepper({
      label: 'Cooldown', rec: recCooldown, value: cur.cooldownIncrement, unit: 'm',
      min: 0, max: 120, step: 1,
      onChange: v => { cur.cooldownIncrement = v; persist(); },
    }),
    stepper({
      label: 'Nudges', rec: recNudges, value: cur.nudgeCount, unit: '',
      min: 0, max: 20, step: 1,
      onChange: v => { cur.nudgeCount = v; persist(); },
    })
  );
  body.append(twoUp);

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
function renderActive(host: HTMLElement, s: ActiveSession, dailyTotal: number): void {
  const { sessionTime, sessionLimitSeconds } = displayFor(s, dailyTotal);
  const remaining = Math.max(0, sessionLimitSeconds - sessionTime);
  const pct = sessionLimitSeconds > 0 ? Math.round((sessionTime / sessionLimitSeconds) * 100) : 0;
  // endEarly() rolls the FULL remaining into the next session as carryover, plus
  // a 10% grace bonus on top of it (computeGraceSeconds). The card shows the full
  // rollover and flags the +10% — matching the model, not just the 10%.
  const grace = s.graceSeconds > 0 ? 0 : Math.floor(remaining * 0.1);
  const rollover = remaining + grace;
  // Active session reads green ("you're good"); only warms to amber as it nears
  // the limit. Cooldown (below) is blue to match the rest of the extension.
  const barColor = pct > 85 ? 'var(--warn)' : 'var(--good)';

  const card = cardShell();

  const head = el('div', 'sc-head');
  head.append(el('span', 'sc-title', `Session ${s.sessionNum}`));
  head.append(el('span', 'sc-badge sc-badge-active', 'Active'));

  const time = el('div', 'sc-time');
  time.append(document.createTextNode(formatDuration(sessionTime)));
  time.append(el('span', 'sc-time-limit', ` / ${formatDuration(sessionLimitSeconds)}`));

  const carryLine = el('div', 'sc-note');
  carryLine.append(document.createTextNode('End now and '));
  carryLine.append(el('span', 'sc-good', `~${formatDuration(rollover)} rolls over`));
  carryLine.append(document.createTextNode(
    ` to Session ${s.sessionNum + 1}${grace > 0 ? ' (+10%)' : ''}`));

  const btn = el('button', 'sc-btn');
  btn.id = 'session-end-early-btn';
  btn.textContent = 'End session early';

  card.append(head, time, progressBar(pct, barColor), carryLine, btn);
  host.replaceChildren(card);

  btn.addEventListener('click', () => {
    browser.runtime.sendMessage({ type: 'END_SESSION_EARLY' });
  });
}

/** Cooldown state. */
function renderCooldown(host: HTMLElement, s: ActiveSession, endTime: number, totalSec: number): void {
  const remainSec = Math.max(0, Math.ceil((endTime - Date.now()) / 1000));
  const elapsedSec = Math.max(0, totalSec - remainSec);
  const pct = totalSec > 0 ? Math.round((elapsedSec / totalSec) * 100) : 0;
  // The session cooling down is the one before the (next) stored session.
  const endedNum = Math.max(1, s.sessionNum - 1);

  const card = cardShell();

  const head = el('div', 'sc-head');
  head.append(el('span', 'sc-title', `Session ${endedNum} ended`));
  head.append(el('span', 'sc-badge sc-badge-cooldown', 'Cooldown'));

  card.append(
    head,
    el('div', 'sc-time', formatDuration(remainSec)),
    el('div', 'sc-sub', `until Session ${s.sessionNum} unlocks`),
    progressBar(pct, 'var(--accent)')
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
      renderActive(host, session, dailyTotal);
      return;
    }
  }

  // Limits on, but nothing active for this domain right now.
  renderIdle(host, limitMinutes);
}
