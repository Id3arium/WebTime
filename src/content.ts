import { Constants } from './shared/constants.js';
import { formatTimeCompact, escapeHtml } from './shared/utils.js';
import type { ExtensionMessage, SessionStartStats } from './types.js';

declare const browser: typeof chrome;

let timerText: HTMLDivElement | null = null;
let lastActivityTime = Date.now();
let showSessionTime = false;  // global toggle: false = daily time, true = session time
let lastDailyTime = 0;
let lastSessionTime: number | undefined;
let lastSessionLimitSeconds: number | undefined;
let blurOverlay: HTMLDivElement | null = null;
let averagePopupDialog: HTMLDivElement | null = null;
let blockerDialog: HTMLDivElement | null = null;
let endSessionDialog: HTMLDivElement | null = null;
let windDownOverlay: HTMLDivElement | null = null;
let graceDialog: HTMLDivElement | null = null;
let endSessionShortcut: string = 'Ctrl+E'; // default; overridden by settings

// CSS reset applied to all popup/dialog root elements to prevent site styles from bleeding in
const CSS_RESET = `
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif !important;
  font-size: 14px !important;
  font-weight: 400 !important;
  font-style: normal !important;
  line-height: 1.4 !important;
  letter-spacing: normal !important;
  text-transform: none !important;
  text-decoration: none !important;
  text-align: left !important;
  color: #eee !important;
  direction: ltr !important;
  -webkit-font-smoothing: antialiased !important;
  box-sizing: border-box !important;
`;

// Queue of popup-show functions — at most one mandatory popup visible at a time.
// When a popup is dismissed it calls dequeuePopup() to show the next waiting one.
const popupQueue: Array<() => void> = [];

function isAnyMandatoryPopupVisible(): boolean {
  return averagePopupDialog !== null;
}

function dequeuePopup(): void {
  const next = popupQueue.shift();
  if (next) next();
}

function blockPageScroll(block: boolean): void {
  if (block) {
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';
  } else {
    document.body.style.overflow = '';
    document.documentElement.style.overflow = '';
  }
}

/** Block keyboard events from reaching the page (e.g. space/k to play/pause on YT) */
function blockKeyboardHandler(e: KeyboardEvent): void {
  // Allow Tab for accessibility within our popup buttons
  if (e.key === 'Tab') return;
  e.stopPropagation();
  e.preventDefault();
}

let keyboardBlocked = false;

function blockKeyboard(block: boolean): void {
  if (block && !keyboardBlocked) {
    // Capture phase so we intercept before the page's handlers
    document.addEventListener('keydown', blockKeyboardHandler, true);
    document.addEventListener('keyup', blockKeyboardHandler, true);
    document.addEventListener('keypress', blockKeyboardHandler, true);
    keyboardBlocked = true;
  } else if (!block && keyboardBlocked) {
    document.removeEventListener('keydown', blockKeyboardHandler, true);
    document.removeEventListener('keyup', blockKeyboardHandler, true);
    document.removeEventListener('keypress', blockKeyboardHandler, true);
    keyboardBlocked = false;
  }
}

function pauseAllMedia(): void {
  document.querySelectorAll('video, audio').forEach(el => {
    const media = el as HTMLMediaElement;
    if (!media.paused) {
      media.pause();
    }
  });
}

function formatCountdown(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function createTimerElement(): void {
  const timer = document.createElement("div");
  timer.className = "web-time-timer";

  timerText = document.createElement("div");
  timerText.textContent = "00:00:00";
  timerText.style.cssText = "color: #f7f7f7 !important;";

  timer.appendChild(timerText);

  // Click to toggle between daily time and session time (synced globally across tabs)
  timer.addEventListener('click', () => {
    if (lastSessionTime !== undefined && lastSessionLimitSeconds !== undefined && lastSessionLimitSeconds > 0) {
      showSessionTime = !showSessionTime;
      updateTimerText();
      browser.storage.local.set({ webTimeShowSessionTimer: showSessionTime });
    }
  });
  timer.style.cursor = 'pointer';

  document.body.appendChild(timer);

  console.log("Timer element created and added to page.");
}

/** Adaptive time format: MM:SS when < 1h, H:MM:SS when >= 1h */
function formatTimeAdaptive(timeInSeconds: number): string {
  timeInSeconds = Math.max(0, Math.floor(timeInSeconds));
  const hours = Math.floor(timeInSeconds / 3600);
  const minutes = Math.floor((timeInSeconds % 3600) / 60);
  const seconds = timeInSeconds % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function updateTimerText(): void {
  if (!timerText) return;
  if (showSessionTime && lastSessionTime !== undefined && lastSessionLimitSeconds && lastSessionLimitSeconds > 0) {
    const remaining = Math.max(0, lastSessionLimitSeconds - lastSessionTime);
    timerText.textContent = `⏱ ${formatTimeAdaptive(remaining)}`;
  } else {
    timerText.textContent = formatTimeAdaptive(lastDailyTime);
  }
}

function createBlurOverlay(): HTMLDivElement {
  if (blurOverlay) return blurOverlay;

  const overlay = document.createElement('div');
  overlay.className = 'web-time-blur-overlay';
  overlay.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    backdrop-filter: blur(6px);
    -webkit-backdrop-filter: blur(6px);
    background: rgba(0, 0, 0, 0.3);
    z-index: 999999;
    pointer-events: none;
    opacity: 0;
    transition: opacity 0.3s ease;
    overflow: hidden;
  `;

  // Block scrolling when overlay is active
  overlay.addEventListener('wheel', (e) => { e.preventDefault(); }, { passive: false });
  overlay.addEventListener('touchmove', (e) => { e.preventDefault(); }, { passive: false });

  const timer = document.querySelector('.web-time-timer');
  if (timer) {
    document.body.insertBefore(overlay, timer);
  } else {
    document.body.appendChild(overlay);
  }

  blurOverlay = overlay;
  return overlay;
}

function buildBarChart(days: SessionStartStats['days']): string {
  const maxSeconds = Math.max(...days.map(d => d.seconds), 1);
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  return days.map(({ date, seconds }) => {
    const [y, m, d] = date.split('-').map(Number);
    const dateObj = new Date(y, m - 1, d, 12, 0, 0);
    const dayName = dayNames[dateObj.getDay()];
    const dayOfMonth = dateObj.getDate();
    const barWidth = Math.round((seconds / maxSeconds) * 100);
    const label = seconds > 0 ? formatTimeCompact(seconds) : '—';

    return `
      <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 4px;">
        <div style="width: 56px; font-size: 12px; color: #888; text-align: right; flex-shrink: 0; white-space: nowrap;">${dayName} ${dayOfMonth}</div>
        <div style="flex: 1; height: 10px; background: #333; border-radius: 3px; overflow: hidden;">
          ${seconds > 0 ? `<div style="width: ${barWidth}%; height: 100%; background: rgba(69, 113, 231, 0.7); border-radius: 3px;"></div>` : ''}
        </div>
        <div style="width: 44px; font-size: 12px; color: #aaa; flex-shrink: 0;">${label}</div>
      </div>
    `;
  }).join('');
}

function createAveragePopupOverlay(minutesLeft: number, averageMinutes: number, stats: SessionStartStats): HTMLDivElement {
  if (averagePopupDialog) return averagePopupDialog;

  const el = document.createElement('div');
  el.className = 'web-time-average-popup-overlay';
  el.style.cssText = `
    ${CSS_RESET}
    position: fixed !important;
    top: 42% !important;
    left: 50% !important;
    transform: translate(-50%, -50%) !important;
    background: #2a2a2a !important;
    padding: 24px !important;
    border-radius: 8px !important;
    box-shadow: 0 6px 32px rgba(0, 0, 0, 0.5) !important;
    z-index: 1000001 !important;
    pointer-events: auto !important;
    width: 350px !important;
    opacity: 0 !important;
    transition: opacity 0.3s ease !important;
  `;

  const untilAvgLine = minutesLeft > 0
    ? `${minutesLeft} min until your ${formatTimeCompact(averageMinutes * 60)} 7-day average`
    : `You've reached your ${formatTimeCompact(averageMinutes * 60)} 7-day average`;

  el.innerHTML = `
    <div style="font-size: 13px; color: #aaa; margin-bottom: 14px; text-align: center !important;">
      ${untilAvgLine}
    </div>
    <div style="margin-bottom: 12px;">
      ${buildBarChart(stats.days)}
    </div>
    <button class="web-time-avg-continue-btn" style="
      width: 100%;
      background: #3a3a3a;
      border: none;
      color: #eee;
      padding: 7px;
      border-radius: 6px;
      cursor: pointer;
      font-size: 13px;
      text-align: center !important;
      transition: background 0.2s, opacity 0.3s;
    ">Continue</button>
  `;

  const continueBtn = el.querySelector('.web-time-avg-continue-btn') as HTMLButtonElement;
  continueBtn.addEventListener('mouseenter', () => { continueBtn.style.background = '#4a4a4a'; });
  continueBtn.addEventListener('mouseleave', () => { continueBtn.style.background = '#3a3a3a'; });
  continueBtn.addEventListener('click', () => hideAveragePopup());

  document.body.appendChild(el);
  averagePopupDialog = el;
  return el;
}

function showNudge(): void {
  const overlay = createBlurOverlay();
  overlay.style.pointerEvents = 'all';
  overlay.style.opacity = '1';
  blockPageScroll(true);
  // Note: do NOT block keyboard for nudges. They last <1s and blocking
  // keys for that brief window feels like an unresponsiveness bug.

  const timer = document.querySelector('.web-time-timer') as HTMLElement | null;
  if (timer) {
    timer.style.transformOrigin = 'top right';
    timer.style.transition = 'transform 0.3s ease-in-out';
    timer.style.transform = 'scale(4.20)';

    setTimeout(() => {
      timer.style.transform = 'scale(1)';
    }, Constants.OVERLAY_DURATIONS.NUDGE_MS / 2);
  }

  setTimeout(() => {
    overlay.style.opacity = '0';
    overlay.style.pointerEvents = 'none';
    blockPageScroll(false);
  }, Constants.OVERLAY_DURATIONS.NUDGE_MS);
}

function showAveragePopup(minutesLeft: number, averageMinutes: number, stats: SessionStartStats): void {
  if (isAnyMandatoryPopupVisible()) {
    popupQueue.push(() => showAveragePopup(minutesLeft, averageMinutes, stats));
    return;
  }

  const blurBg = createBlurOverlay();
  const el = createAveragePopupOverlay(minutesLeft, averageMinutes, stats);

  // Simple/closable popup — button appears immediately
  blurBg.style.pointerEvents = 'all';
  blurBg.style.opacity = '1';
  blockPageScroll(true);
  blockKeyboard(true);
  pauseAllMedia();

  setTimeout(() => { el.style.opacity = '1'; }, 100);
}

function hideAveragePopup(): void {
  if (blurOverlay) {
    blurOverlay.style.opacity = '0';
    blurOverlay.style.pointerEvents = 'none';
  }
  blockPageScroll(false);
  blockKeyboard(false);
  if (averagePopupDialog) {
    averagePopupDialog.style.opacity = '0';
    setTimeout(() => {
      averagePopupDialog?.parentNode?.removeChild(averagePopupDialog);
      averagePopupDialog = null;
      dequeuePopup();
    }, 300);
  }
}

function showBlocker(remainingSeconds: number, totalCooldownSeconds: number, cooldownCount: number, cooldownIncrementMinutes: number): void {
  pauseAllMedia();

  const blurBg = createBlurOverlay();
  blurBg.style.pointerEvents = 'all';
  blurBg.style.opacity = '1';
  blockPageScroll(true);
  blockKeyboard(true);

  if (blockerDialog) {
    // Update existing blocker countdown
    const countdownEl = blockerDialog.querySelector('.web-time-blocker-countdown');
    if (countdownEl) {
      countdownEl.textContent = formatCountdown(remainingSeconds);
    }
    const progressEl = blockerDialog.querySelector('.web-time-blocker-progress-fill') as HTMLElement | null;
    if (progressEl && totalCooldownSeconds > 0) {
      // Bar shrinks from 100% to 0% (same direction as reminder)
      const pct = Math.max(0, (remainingSeconds / totalCooldownSeconds) * 100);
      progressEl.style.width = `${pct}%`;
    }
    return;
  }

  // Build the cooldown explanation line
  const totalMinutes = Math.round(totalCooldownSeconds / 60);
  let cooldownExplanation: string;
  if (cooldownCount > 1 && cooldownIncrementMinutes > 0) {
    cooldownExplanation = `Session ${cooldownCount} · ${cooldownCount} × ${cooldownIncrementMinutes}m = ${totalMinutes}m cooldown`;
  } else if (cooldownCount === 1 && cooldownIncrementMinutes > 0) {
    cooldownExplanation = `Session ${cooldownCount} · ${totalMinutes}m cooldown`;
  } else {
    cooldownExplanation = `${totalMinutes}m cooldown`;
  }

  const el = document.createElement('div');
  el.className = 'web-time-blocker-overlay';
  el.style.cssText = `
    ${CSS_RESET}
    position: fixed !important;
    top: 42% !important;
    left: 50% !important;
    transform: translate(-50%, -50%) !important;
    background: #2a2a2a !important;
    padding: 28px !important;
    border-radius: 8px !important;
    box-shadow: 0 6px 32px rgba(0, 0, 0, 0.5) !important;
    z-index: 1000001 !important;
    pointer-events: auto !important;
    width: 350px !important;
    text-align: center !important;
    opacity: 0 !important;
    transition: opacity 0.3s ease !important;
    overflow: hidden !important;
  `;

  el.innerHTML = `
    <div style="font-size: 18px; font-weight: 600; color: #ccc; margin-bottom: 8px;">
      Session limit reached
    </div>
    <div style="font-size: 14px; color: #eee; margin-bottom: 16px;">
      ${cooldownExplanation}
    </div>
    <div style="font-size: 24px; font-weight: 500; color: #fff; margin-bottom: 16px; font-variant-numeric: tabular-nums;" class="web-time-blocker-countdown">
      ${formatCountdown(remainingSeconds)}
    </div>
    <div style="
      position: absolute;
      bottom: 0;
      left: 0;
      width: 100%;
      height: 4px;
      background: rgba(255, 255, 255, 0.1);
    ">
      <div class="web-time-blocker-progress-fill" style="
        height: 100%;
        background: #4a9eff;
        width: 100%;
        transition: width 1s linear;
      "></div>
    </div>
  `;

  document.body.appendChild(el);
  blockerDialog = el;
  setTimeout(() => { el.style.opacity = '1'; }, 50);
}

function hideBlocker(): void {
  if (blurOverlay) {
    blurOverlay.style.opacity = '0';
    blurOverlay.style.pointerEvents = 'none';
  }
  blockPageScroll(false);
  blockKeyboard(false);
  if (blockerDialog) {
    blockerDialog.style.opacity = '0';
    setTimeout(() => {
      blockerDialog?.parentNode?.removeChild(blockerDialog);
      blockerDialog = null;
    }, 300);
  }
}

// ============================================================================
// Wind-Down Overlay — progressive darkening before session end
// ============================================================================

function showWindDown(progress: number, _remainingSeconds: number): void {
  if (!windDownOverlay) {
    const overlay = document.createElement('div');
    overlay.className = 'web-time-wind-down-overlay';
    overlay.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      z-index: 999998;
      pointer-events: none;
      transition: background 1s linear;
    `;

    // Shrinking bar — starts full width, shrinks from both ends toward center
    const barTrack = document.createElement('div');
    barTrack.className = 'web-time-wind-down-bar-track';
    barTrack.style.cssText = `
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 4px;
      background: rgba(255, 255, 255, 0.08);
    `;
    const barFill = document.createElement('div');
    barFill.className = 'web-time-wind-down-bar-fill';
    barFill.style.cssText = `
      height: 100%;
      margin: 0 auto;
      width: 100%;
      transition: width 1s linear;
      background: #4a9eff;
    `;
    barTrack.appendChild(barFill);
    overlay.appendChild(barTrack);

    const timer = document.querySelector('.web-time-timer');
    if (timer) {
      document.body.insertBefore(overlay, timer);
    } else {
      document.body.appendChild(overlay);
    }
    windDownOverlay = overlay;
  }

  const opacity = 0.3 * progress;
  windDownOverlay.style.background = `rgba(0, 0, 0, ${opacity})`;

  // Bar shrinks from both ends: 100% → 0%
  const barFill = windDownOverlay.querySelector('.web-time-wind-down-bar-fill') as HTMLElement | null;
  if (barFill) {
    const widthPct = Math.max(0, (1 - progress) * 100);
    barFill.style.width = `${widthPct}%`;
  }
}

function hideWindDown(): void {
  if (windDownOverlay) {
    windDownOverlay.parentNode?.removeChild(windDownOverlay);
    windDownOverlay = null;
  }
}

// ============================================================================
// Grace Period Prompt
// ============================================================================

function showGracePrompt(graceSecs: number): void {
  if (graceDialog) return;

  hideWindDown();

  const blurBg = createBlurOverlay();
  blurBg.style.pointerEvents = 'all';
  blurBg.style.opacity = '1';
  blockPageScroll(true);
  blockKeyboard(true);
  pauseAllMedia();

  const el = document.createElement('div');
  el.className = 'web-time-grace-overlay';
  el.style.cssText = `
    ${CSS_RESET}
    position: fixed !important;
    top: 50% !important;
    left: 50% !important;
    transform: translate(-50%, -50%) !important;
    background: #2a2a2a !important;
    padding: 24px !important;
    border-radius: 8px !important;
    box-shadow: 0 6px 32px rgba(0, 0, 0, 0.5) !important;
    z-index: 1000002 !important;
    pointer-events: auto !important;
    width: 350px !important;
    text-align: center !important;
    opacity: 0 !important;
    transition: opacity 0.3s ease !important;
  `;
  el.innerHTML = `
    <div style="font-size: 16px; color: #ccc; margin-bottom: 6px; font-weight: 600;">
      Session ended
    </div>
    <div style="font-size: 15px; color: #eee; margin-bottom: 18px; line-height: 1.4;">
      You earned ${escapeHtml(formatTimeAdaptive(graceSecs))} of grace time. Use it?
    </div>
    <div style="display: flex; gap: 8px;">
      <button class="web-time-grace-decline" style="
        flex: 1; background: #3a3a3a; border: none; color: #eee;
        padding: 8px; border-radius: 6px; cursor: pointer; font-size: 13px;
      ">End Now</button>
      <button class="web-time-grace-accept" style="
        flex: 1; background: #4571e7; border: none; color: #fff;
        padding: 8px; border-radius: 6px; cursor: pointer; font-size: 13px;
      ">Use Grace</button>
    </div>
  `;

  document.body.appendChild(el);
  graceDialog = el;
  setTimeout(() => { el.style.opacity = '1'; }, 50);

  const closeGrace = (): void => {
    if (!graceDialog) return;
    document.removeEventListener('keydown', graceKeyHandler, true);
    graceDialog.style.opacity = '0';
    if (blurOverlay) {
      blurOverlay.style.opacity = '0';
      blurOverlay.style.pointerEvents = 'none';
    }
    blockPageScroll(false);
    blockKeyboard(false);
    setTimeout(() => {
      graceDialog?.parentNode?.removeChild(graceDialog);
      graceDialog = null;
    }, 300);
  };

  const acceptGrace = (): void => {
    browser.runtime.sendMessage({ type: 'GRACE_ACCEPTED' }).catch(() => {});
    closeGrace();
  };

  const declineGrace = (): void => {
    browser.runtime.sendMessage({ type: 'GRACE_DECLINED' }).catch(() => {});
    closeGrace();
  };

  const graceKeyHandler = (e: KeyboardEvent): void => {
    if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); acceptGrace(); }
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); declineGrace(); }
  };
  document.addEventListener('keydown', graceKeyHandler, true);

  el.querySelector('.web-time-grace-decline')?.addEventListener('click', declineGrace);
  el.querySelector('.web-time-grace-accept')?.addEventListener('click', acceptGrace);
}

function hideGracePrompt(): void {
  if (graceDialog) {
    graceDialog.style.opacity = '0';
    if (blurOverlay) {
      blurOverlay.style.opacity = '0';
      blurOverlay.style.pointerEvents = 'none';
    }
    blockPageScroll(false);
    blockKeyboard(false);
    setTimeout(() => {
      graceDialog?.parentNode?.removeChild(graceDialog);
      graceDialog = null;
    }, 300);
  }
}

// ============================================================================
// End Session Early — keyboard shortcut + confirmation popup
// ============================================================================

/** Convert a KeyboardEvent into the canonical "Ctrl+Shift+E" style string. */
function keyEventToShortcut(e: KeyboardEvent): string | null {
  // Ignore pure modifier keypresses
  if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return null;
  const parts: string[] = [];
  if (e.ctrlKey) parts.push('Ctrl');
  if (e.metaKey) parts.push('Cmd');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');
  // Use e.code for letter/digit keys so Alt+E doesn't become Alt+´ on Mac
  let k: string;
  if (/^Key[A-Z]$/.test(e.code)) {
    k = e.code.slice(3);
  } else if (/^Digit\d$/.test(e.code)) {
    k = e.code.slice(5);
  } else {
    k = e.key.length === 1 ? e.key.toUpperCase() : e.key;
  }
  parts.push(k);
  return parts.join('+');
}

function isEndSessionShortcutMatch(e: KeyboardEvent): boolean {
  if (!endSessionShortcut) return false;
  const pressed = keyEventToShortcut(e);
  if (!pressed) return false;
  // Treat Ctrl and Cmd as interchangeable for cross-platform comfort
  const normalize = (s: string) => s.replace(/\bCmd\b/g, 'Ctrl');
  return normalize(pressed) === normalize(endSessionShortcut);
}

function isAnyInterventionVisible(): boolean {
  return averagePopupDialog !== null
    || blockerDialog !== null
    || endSessionDialog !== null
    || graceDialog !== null;
}

function isInTextInput(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (target.isContentEditable) return true;
  return false;
}

function showEndSessionConfirm(): void {
  if (endSessionDialog) return;
  // Need an active session to end
  if (lastSessionTime === undefined || !lastSessionLimitSeconds || lastSessionLimitSeconds <= 0) return;

  const remaining = Math.max(0, lastSessionLimitSeconds - lastSessionTime);
  if (remaining <= 0) return; // already at boundary

  const blurBg = createBlurOverlay();
  blurBg.style.pointerEvents = 'all';
  blurBg.style.opacity = '1';
  blockPageScroll(true);
  blockKeyboard(true);

  const el = document.createElement('div');
  el.className = 'web-time-end-session-overlay';
  el.style.cssText = `
    ${CSS_RESET}
    position: fixed !important;
    top: 50% !important;
    left: 50% !important;
    transform: translate(-50%, -50%) !important;
    background: #2a2a2a !important;
    padding: 24px !important;
    border-radius: 8px !important;
    box-shadow: 0 6px 32px rgba(0, 0, 0, 0.5) !important;
    z-index: 1000002 !important;
    pointer-events: auto !important;
    width: 350px !important;
    text-align: center !important;
    opacity: 0 !important;
    transition: opacity 0.3s ease !important;
  `;
  el.innerHTML = `
    <div style="font-size: 16px; color: #eee; margin-bottom: 18px; line-height: 1.4;">
      End session early and carry over the remaining ${escapeHtml(formatTimeAdaptive(remaining))}?
    </div>
    <div style="display: flex; gap: 8px;">
      <button class="web-time-end-cancel" style="
        flex: 1; background: #3a3a3a; border: none; color: #eee;
        padding: 8px; border-radius: 6px; cursor: pointer; font-size: 13px;
      ">Cancel</button>
      <button class="web-time-end-ok" style="
        flex: 1; background: #4571e7; border: none; color: #fff;
        padding: 8px; border-radius: 6px; cursor: pointer; font-size: 13px;
      ">OK</button>
    </div>
  `;
  document.body.appendChild(el);
  endSessionDialog = el;
  setTimeout(() => { el.style.opacity = '1'; }, 50);
  // Tell background to freeze the timer while the user decides.
  browser.runtime.sendMessage({ type: 'END_SESSION_CONFIRM_OPEN' }).catch(() => {});

  const confirmAndClose = (): void => {
    browser.runtime.sendMessage({ type: 'END_SESSION_EARLY' }).catch(() => {});
    close();
  };

  const close = (): void => {
    if (!endSessionDialog) return;
    document.removeEventListener('keydown', keyHandler, true);
    endSessionDialog.style.opacity = '0';
    if (blurOverlay) {
      blurOverlay.style.opacity = '0';
      blurOverlay.style.pointerEvents = 'none';
    }
    blockPageScroll(false);
    blockKeyboard(false);
    browser.runtime.sendMessage({ type: 'END_SESSION_CONFIRM_CLOSE' }).catch(() => {});
    setTimeout(() => {
      endSessionDialog?.parentNode?.removeChild(endSessionDialog);
      endSessionDialog = null;
    }, 300);
  };

  const keyHandler = (e: KeyboardEvent): void => {
    if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); confirmAndClose(); }
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
  };
  document.addEventListener('keydown', keyHandler, true);

  el.querySelector('.web-time-end-cancel')?.addEventListener('click', close);
  el.querySelector('.web-time-end-ok')?.addEventListener('click', confirmAndClose);
}

// When this tab becomes visible (after being backgrounded/discarded), ask
// background for the current blocker state. If the message fails, it means the
// extension was updated and this content script is orphaned — reload the tab
// so it picks up the new version instead of running stale code.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    browser.runtime.sendMessage({ type: 'REQUEST_BLOCKER_STATE' }).catch(() => {
      console.log('WebTime: extension context invalidated, reloading tab');
      location.reload();
    });
  }
});

document.addEventListener('keydown', (e) => {
  if (!isEndSessionShortcutMatch(e)) return;
  // Don't fire while another intervention is up
  if (isAnyInterventionVisible()) return;
  // Don't fire while typing in a text input — too many in-app shortcut conflicts
  if (isInTextInput(e.target)) return;
  e.preventDefault();
  e.stopPropagation();
  showEndSessionConfirm();
}, true);

function handleIncomingMessage(
  message: ExtensionMessage,
  _sender: chrome.runtime.MessageSender,
  _sendResponse: (response?: unknown) => void
): void {
  if (message.type === "TIME_UPDATE") {
    lastDailyTime = message.time;
    lastSessionTime = message.sessionTime;
    lastSessionLimitSeconds = message.sessionLimitSeconds;
    // Note: don't reset showSessionTime here. The toggle is a global preference
    // and updateTimerText() already falls back to daily display when session
    // data is unavailable for this tab (e.g. domain has no session limit, or
    // another domain is currently active so background sends shared updates).
    if (timerText) {
      updateTimerText();
    } else {
      console.error("Timer text element not found when trying to update time!");
    }
  } else if (message.type === "NUDGE") {
    showNudge();
  } else if (message.type === "SHOW_AVERAGE_POPUP") {
    showAveragePopup(message.minutesLeft, message.averageMinutes, message.stats);
  } else if (message.type === "SHOW_BLOCKER") {
    showBlocker(message.cooldownRemainingSeconds, message.totalCooldownSeconds, message.cooldownCount, message.cooldownIncrementMinutes);
  } else if (message.type === "HIDE_BLOCKER") {
    hideBlocker();
    hideGracePrompt();
  } else if (message.type === "SHOW_WIND_DOWN") {
    showWindDown(message.progress, message.remainingSeconds);
  } else if (message.type === "HIDE_WIND_DOWN") {
    hideWindDown();
  } else if (message.type === "SHOW_GRACE_PROMPT") {
    showGracePrompt(message.graceSeconds);
  }
}

function updateActivityState(): void {
  lastActivityTime = Date.now();
  browser.runtime.sendMessage({ type: "USER_ACTIVE" });
}

// Exported for testing but also needed to prevent unused variable warning
export { lastActivityTime };

document.addEventListener("scroll", updateActivityState);
document.addEventListener("keydown", updateActivityState);
document.addEventListener("mousemove", updateActivityState);

function init(): void {
  console.log("initTimer()");

  createTimerElement();
  browser.runtime.onMessage.addListener(handleIncomingMessage);

  // Load persisted timer toggle state
  browser.storage.local.get('webTimeShowSessionTimer').then(data => {
    if (data.webTimeShowSessionTimer !== undefined) {
      showSessionTime = data.webTimeShowSessionTimer;
      updateTimerText();
    }
  });

  // Sync timer toggle across tabs when changed elsewhere
  browser.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.webTimeShowSessionTimer) {
      showSessionTime = changes.webTimeShowSessionTimer.newValue ?? false;
      updateTimerText();
    }
    if (area === 'local' && changes.webTimeSettings) {
      const newSettings = changes.webTimeSettings.newValue;
      const sc = newSettings?.global?.endSessionShortcut;
      // null = explicitly disabled, undefined = use default
      endSessionShortcut = sc === null ? '' : (sc || 'Ctrl+E');
    }
  });

  // Load the end-session shortcut from settings
  browser.storage.local.get('webTimeSettings').then(data => {
    const sc = data.webTimeSettings?.global?.endSessionShortcut;
    endSessionShortcut = sc === null ? '' : (sc || 'Ctrl+E');
  });

  try {
    const readyMessage = { type: "CONTENT_SCRIPT_READY" };
    browser.runtime.sendMessage(readyMessage);
  } catch (error) {
    console.error("Error sending CONTENT_SCRIPT_READY message:", error);
  }
  console.log("Sent CONTENT_SCRIPT_READY message to background.");
}

init();
