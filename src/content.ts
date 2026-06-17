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
let lastSessionNum: number | undefined;
let blurOverlay: HTMLDivElement | null = null;
let averagePopupDialog: HTMLDivElement | null = null;
let averagePopupPausedMedia: HTMLMediaElement[] = [];
let blockerDialog: HTMLDivElement | null = null;
let endSessionDialog: HTMLDivElement | null = null;
let windDownOverlay: HTMLDivElement | null = null;
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

// Scroll blocking is handled by the blur overlay's wheel/touchmove event handlers
// when pointer-events is set to 'all'. No need to touch document.body.style.overflow,
// which can interfere with site layout and cause scroll/loading bugs.

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

/** Pause every playing <video>/<audio> and return the ones that were paused,
 *  so callers that want to resume on close can. */
function pauseAllMedia(): HTMLMediaElement[] {
  const paused: HTMLMediaElement[] = [];
  document.querySelectorAll('video, audio').forEach(el => {
    const media = el as HTMLMediaElement;
    if (!media.paused) {
      media.pause();
      paused.push(media);
    }
  });
  return paused;
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
  let text: string;
  if (showSessionTime && lastSessionTime !== undefined && lastSessionLimitSeconds && lastSessionLimitSeconds > 0) {
    const remaining = Math.max(0, lastSessionLimitSeconds - lastSessionTime);
    text = `⏱ ${formatTimeAdaptive(remaining)}`;
  } else {
    text = formatTimeAdaptive(lastDailyTime);
  }
  if (timerText.textContent !== text) {
    timerText.textContent = text;
  }
}

function createBlurOverlay(): void {
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
    visibility: hidden;
  `;

  overlay.addEventListener('wheel', (e) => { e.preventDefault(); }, { passive: false });
  overlay.addEventListener('touchmove', (e) => { e.preventDefault(); }, { passive: false });

  document.body.appendChild(overlay);
  blurOverlay = overlay;
}

function showBlurOverlay(): HTMLDivElement {
  if (!blurOverlay) createBlurOverlay();
  blurOverlay!.style.visibility = 'visible';
  return blurOverlay!;
}

function hideBlurOverlay(): void {
  if (!blurOverlay) return;
  blurOverlay.style.opacity = '0';
  blurOverlay.style.pointerEvents = 'none';
  blurOverlay.style.visibility = 'hidden';
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

  const avg = formatTimeCompact(averageMinutes * 60);
  // Primary line = the actionable status; the average value gets its own
  // sub-line so it can never wrap awkwardly regardless of how large the numbers
  // get. Each line is nowrap so it stays intact on one row.
  const primaryLine = minutesLeft > 0
    ? `${minutesLeft} min until your 7-day average`
    : `You've reached your 7-day average`;

  el.innerHTML = `
    <div style="font-size: 16px; color: #ccc; margin-bottom: 4px; text-align: center !important; font-weight: 600; white-space: nowrap !important;">
      ${primaryLine}
    </div>
    <div style="font-size: 13px; color: #999; margin-bottom: 14px; text-align: center !important; white-space: nowrap !important;">
      (${avg})
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

  blurOverlay!.appendChild(el);
  averagePopupDialog = el;
  return el;
}

function showNudge(): void {
  const overlay = showBlurOverlay();
  overlay.style.pointerEvents = 'all';
  overlay.style.opacity = '1';

  const playingMedia: HTMLMediaElement[] = [];
  document.querySelectorAll('video, audio').forEach(el => {
    const media = el as HTMLMediaElement;
    if (!media.paused) {
      media.pause();
      playingMedia.push(media);
    }
  });

  const timer = document.querySelector('.web-time-timer') as HTMLElement | null;
  if (timer) {
    timer.style.transformOrigin = 'top right';
    timer.style.transition = `transform ${Constants.OVERLAY_DURATIONS.NUDGE_MS / 2}ms ease-in-out`;
    requestAnimationFrame(() => {
      timer.style.transform = 'scale(4.20)';

      setTimeout(() => {
        timer.style.transform = 'scale(1)';
      }, Constants.OVERLAY_DURATIONS.NUDGE_MS / 2);
    });
  }

  setTimeout(() => {
    hideBlurOverlay();
    playingMedia.forEach(m => m.play().catch(() => {}));
  }, Constants.OVERLAY_DURATIONS.NUDGE_MS);
}

function showAveragePopup(minutesLeft: number, averageMinutes: number, stats: SessionStartStats): void {
  if (isAnyMandatoryPopupVisible()) {
    popupQueue.push(() => showAveragePopup(minutesLeft, averageMinutes, stats));
    return;
  }

  const blurBg = showBlurOverlay();
  const el = createAveragePopupOverlay(minutesLeft, averageMinutes, stats);

  blurBg.style.pointerEvents = 'all';
  blurBg.style.opacity = '1';

  blockKeyboard(true);
  averagePopupPausedMedia = pauseAllMedia();

  setTimeout(() => { el.style.opacity = '1'; }, 100);
}

function hideAveragePopup(): void {
  hideBlurOverlay();

  blockKeyboard(false);
  averagePopupPausedMedia.forEach(m => m.play().catch(() => {}));
  averagePopupPausedMedia = [];
  if (averagePopupDialog) {
    averagePopupDialog.style.opacity = '0';
    setTimeout(() => {
      averagePopupDialog?.parentNode?.removeChild(averagePopupDialog);
      averagePopupDialog = null;
      dequeuePopup();
    }, 300);
  }
}

/** Format a cooldown duration as "Xm", "Ys", or "Xm Ys" — keeps sub-minute parts. */
function formatCooldownDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  if (m > 0 && s > 0) return `${m}m ${s}s`;
  if (m > 0) return `${m}m`;
  return `${s}s`;
}

function showBlocker(remainingSeconds: number, totalCooldownSeconds: number, cooldownCount: number, cooldownIncrementSeconds: number): void {
  pauseAllMedia();

  const blurBg = showBlurOverlay();
  blurBg.style.pointerEvents = 'all';
  blurBg.style.opacity = '1';

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

  // Build the cooldown explanation line. Increments may be sub-minute
  // (e.g. 3m30s), so format with seconds rather than rounding to whole minutes.
  const total = formatCooldownDuration(totalCooldownSeconds);
  const increment = formatCooldownDuration(cooldownIncrementSeconds);
  // Heading says which session ended; the sub-line shows the breakdown. When
  // the cooldown grows with each session (count × increment), show the math so
  // the rising duration reads as intentional — but compactly: "3 × 3m = 9m".
  // Otherwise just the total.
  let cooldownExplanation: string;
  if (cooldownCount > 1 && cooldownIncrementSeconds > 0) {
    cooldownExplanation = `${cooldownCount} × ${increment} = ${total} cooldown`;
  } else {
    cooldownExplanation = `${total} cooldown`;
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
      ${cooldownCount > 0 ? `Session ${cooldownCount} Ended` : 'Session Ended'}
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

  blurOverlay!.appendChild(el);
  blockerDialog = el;
  setTimeout(() => { el.style.opacity = '1'; }, 50);
}

function hideBlocker(): void {
  hideBlurOverlay();

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

function createWindDownOverlay(): void {
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
    visibility: hidden;
  `;

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
  document.body.appendChild(overlay);
  windDownOverlay = overlay;
}

function showWindDown(progress: number, _remainingSeconds: number): void {
  if (!windDownOverlay) return;

  windDownOverlay.style.visibility = 'visible';
  const opacity = 0.3 * progress;
  windDownOverlay.style.background = `rgba(0, 0, 0, ${opacity})`;

  const barFill = windDownOverlay.querySelector('.web-time-wind-down-bar-fill') as HTMLElement | null;
  if (barFill) {
    const widthPct = Math.max(0, (1 - progress) * 100);
    barFill.style.width = `${widthPct}%`;
  }
}

function hideWindDown(): void {
  if (!windDownOverlay) return;
  windDownOverlay.style.visibility = 'hidden';
  windDownOverlay.style.background = 'rgba(0, 0, 0, 0)';
  const barFill = windDownOverlay.querySelector('.web-time-wind-down-bar-fill') as HTMLElement | null;
  if (barFill) {
    barFill.style.width = '100%';
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
;
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

  // Pause playing media and track them for resume on cancel
  const playingMedia: HTMLMediaElement[] = [];
  document.querySelectorAll('video, audio').forEach(el => {
    const media = el as HTMLMediaElement;
    if (!media.paused) {
      media.pause();
      playingMedia.push(media);
    }
  });

  const blurBg = showBlurOverlay();
  blurBg.style.pointerEvents = 'all';
  blurBg.style.opacity = '1';

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
      End session ${lastSessionNum ?? ''}?<br>
      ${escapeHtml(formatTimeAdaptive(Math.floor(remaining * 1.1)))} will be added to next session
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
  blurOverlay!.appendChild(el);
  endSessionDialog = el;
  setTimeout(() => { el.style.opacity = '1'; }, 50);
  // Tell background to freeze the timer while the user decides.
  browser.runtime.sendMessage({ type: 'END_SESSION_CONFIRM_OPEN' }).catch(() => {});

  const confirmAndClose = (): void => {
    browser.runtime.sendMessage({ type: 'END_SESSION_EARLY' }).catch(() => {});
    close(false);
  };

  const close = (resumeMedia: boolean = true): void => {
    if (!endSessionDialog) return;
    document.removeEventListener('keydown', keyHandler, true);
    endSessionDialog.style.opacity = '0';
    hideBlurOverlay();
  
    blockKeyboard(false);
    if (resumeMedia) {
      playingMedia.forEach(m => m.play().catch(() => {}));
    }
    browser.runtime.sendMessage({ type: 'END_SESSION_CONFIRM_CLOSE' }).catch(() => {});
    setTimeout(() => {
      endSessionDialog?.parentNode?.removeChild(endSessionDialog);
      endSessionDialog = null;
    }, 300);
  };

  const keyHandler = (e: KeyboardEvent): void => {
    if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); confirmAndClose(); }
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(true); }
  };
  document.addEventListener('keydown', keyHandler, true);

  el.querySelector('.web-time-end-cancel')?.addEventListener('click', () => close(true));
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
    lastSessionNum = message.sessionNum;
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
    showBlocker(message.cooldownRemainingSeconds, message.totalCooldownSeconds, message.cooldownCount, message.cooldownIncrementSeconds);
  } else if (message.type === "HIDE_BLOCKER") {
    hideBlocker();
  } else if (message.type === "SHOW_WIND_DOWN") {
    showWindDown(message.progress, message.remainingSeconds);
  } else if (message.type === "HIDE_WIND_DOWN") {
    hideWindDown();
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
  createBlurOverlay();
  createWindDownOverlay();
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
