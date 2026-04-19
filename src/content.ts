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
let reminderDialog: HTMLDivElement | null = null;
let sessionStartDialog: HTMLDivElement | null = null;
let averagePopupDialog: HTMLDivElement | null = null;
let blockerDialog: HTMLDivElement | null = null;

// Queue of popup-show functions — at most one mandatory popup visible at a time.
// When a popup is dismissed it calls dequeuePopup() to show the next waiting one.
const popupQueue: Array<() => void> = [];

function isAnyMandatoryPopupVisible(): boolean {
  return sessionStartDialog !== null || averagePopupDialog !== null;
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

function createReminderOverlay(message: string, totalTime: string): HTMLDivElement {
  if (reminderDialog) return reminderDialog;

  const reminderElement = document.createElement('div');
  reminderElement.className = 'web-time-reminder-overlay';
  reminderElement.style.cssText = `
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    background: #2a2a2a;
    color: #eee;
    padding: 24px;
    border-radius: 8px;
    box-shadow: 0 6px 32px rgba(0, 0, 0, 0.4);
    z-index: 1000001;
    pointer-events: auto;
    min-width: 320px;
    max-width: 400px;
    text-align: center;
    opacity: 0;
    transition: opacity 0.3s ease;
    overflow: hidden;
  `;

  reminderElement.innerHTML = `
    <button class="web-time-close-btn" style="
      position: absolute;
      top: 12px;
      right: 12px;
      background: none;
      border: none;
      color: #999;
      font-size: 24px;
      cursor: pointer;
      padding: 4px 8px;
      line-height: 1;
      transition: color 0.2s;
    " onmouseover="this.style.color='#fff'" onmouseout="this.style.color='#999'">×</button>
    <div style="font-size: 18px; font-weight: 600; margin-bottom: 8px; color: #ccc;">
      ${escapeHtml(message)}
    </div>
    <div style="font-size: 16px; color: #ccc; font-weight: 500; margin-bottom: 20px;">
      ${totalTime} on this site today
    </div>
    <div style="display: flex; gap: 12px; justify-content: center; margin-bottom: 16px;">
      <button class="web-time-snooze-btn" data-duration="3600000" style="
        background: #444;
        border: none;
        color: #eee;
        padding: 10px 20px;
        border-radius: 6px;
        cursor: pointer;
        font-size: 14px;
        transition: background 0.2s;
      ">Snooze 1hr</button>
      <button class="web-time-snooze-btn" data-duration="tomorrow" style="
        background: #444;
        border: none;
        color: #eee;
        padding: 10px 20px;
        border-radius: 6px;
        cursor: pointer;
        font-size: 14px;
        transition: background 0.2s;
      ">Snooze till tmrw</button>
    </div>
    <div style="
      position: absolute;
      bottom: 0;
      left: 0;
      width: 100%;
      height: 4px;
      background: rgba(255, 255, 255, 0.1);
    ">
      <div class="web-time-progress-bar" style="
        height: 100%;
        background: #4a9eff;
        width: 100%;
        transition: width linear;
      "></div>
    </div>
  `;

  const buttons = reminderElement.querySelectorAll('button');
  buttons.forEach(btn => {
    if (btn.classList.contains('web-time-close-btn')) {
      btn.addEventListener('click', () => hideReminderOverlay());
    } else if (btn.classList.contains('web-time-snooze-btn')) {
      btn.addEventListener('mouseenter', () => { (btn as HTMLButtonElement).style.background = '#555'; });
      btn.addEventListener('mouseleave', () => { (btn as HTMLButtonElement).style.background = '#444'; });
      btn.addEventListener('click', () => handleSnooze((btn as HTMLButtonElement).dataset.duration || '3600000'));
    }
  });

  document.body.appendChild(reminderElement);
  reminderDialog = reminderElement;
  return reminderElement;
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

function createSessionStartOverlay(stats: SessionStartStats): HTMLDivElement {
  if (sessionStartDialog) return sessionStartDialog;

  const el = document.createElement('div');
  el.className = 'web-time-session-start-overlay';
  el.style.cssText = `
    position: fixed;
    top: 42%;
    left: 50%;
    transform: translate(-50%, -50%);
    background: #2a2a2a;
    color: #eee;
    padding: 24px;
    border-radius: 8px;
    box-shadow: 0 6px 32px rgba(0, 0, 0, 0.5);
    z-index: 1000001;
    pointer-events: auto;
    width: 300px;
    opacity: 0;
    transition: opacity 0.3s ease;
  `;

  const avgLabel = stats.averageSeconds > 0
    ? `${formatTimeCompact(stats.averageSeconds)} / day average`
    : '<span style="color: #777;">No recent history</span>';

  el.innerHTML = `
    <div style="font-size: 18px; font-weight: 600; color: #ccc; margin-bottom: 12px; text-align: center;">
      Usage this week
    </div>
    <div style="margin-bottom: 12px;">
      ${buildBarChart(stats.days)}
    </div>
    <div style="font-size: 14px; color: #ccc; font-weight: 500; margin-bottom: 14px; padding-top: 10px; border-top: 1px solid #3a3a3a; text-align: center;">
      ${avgLabel}
    </div>
    <button class="web-time-continue-btn" style="
      width: 100%;
      background: #3a3a3a;
      border: none;
      color: #eee;
      padding: 7px;
      border-radius: 6px;
      cursor: pointer;
      font-size: 13px;
      text-align: center;
      transition: background 0.2s, opacity 0.3s;
    ">Continue</button>
  `;

  const continueBtn = el.querySelector('.web-time-continue-btn') as HTMLButtonElement;
  continueBtn.addEventListener('mouseenter', () => { continueBtn.style.background = '#4a4a4a'; });
  continueBtn.addEventListener('mouseleave', () => { continueBtn.style.background = '#3a3a3a'; });
  continueBtn.addEventListener('click', () => hideSessionStart());

  document.body.appendChild(el);
  sessionStartDialog = el;
  return el;
}

function createAveragePopupOverlay(minutesLeft: number, averageMinutes: number): HTMLDivElement {
  if (averagePopupDialog) return averagePopupDialog;

  const el = document.createElement('div');
  el.className = 'web-time-average-popup-overlay';
  el.style.cssText = `
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    background: #2a2a2a;
    color: #eee;
    padding: 24px;
    border-radius: 8px;
    box-shadow: 0 6px 32px rgba(0, 0, 0, 0.5);
    z-index: 1000001;
    pointer-events: auto;
    min-width: 300px;
    max-width: 380px;
    text-align: center;
    opacity: 0;
    transition: opacity 0.3s ease;
  `;

  const avgHours = Math.floor(averageMinutes / 60);
  const avgMins = averageMinutes % 60;
  const avgLabel = avgHours > 0 && avgMins > 0
    ? `${avgHours}h ${avgMins}m`
    : avgHours > 0 ? `${avgHours}h` : `${avgMins}m`;

  const untilAvgLine = minutesLeft > 0
    ? `You'll reach the average in ${minutesLeft} min.`
    : `You've reached your 7-day average.`;

  el.innerHTML = `
    <div style="font-size: 18px; font-weight: 600; color: #ccc; margin-bottom: 6px;">
      Approaching your average
    </div>
    <div style="font-size: 16px; color: #ccc; font-weight: 500; margin-bottom: 8px;">
      ${avgLabel} / day
    </div>
    <div style="font-size: 14px; color: #eee; margin-bottom: 24px;">
      ${untilAvgLine}
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
  blockKeyboard(true);

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
    blockKeyboard(false);
  }, Constants.OVERLAY_DURATIONS.NUDGE_MS);
}

function showSessionStart(stats: SessionStartStats): void {
  if (isAnyMandatoryPopupVisible()) {
    popupQueue.push(() => showSessionStart(stats));
    return;
  }

  const blurBg = createBlurOverlay();
  const el = createSessionStartOverlay(stats);

  // Simple/closable popup — button appears immediately, no media pause
  blurBg.style.pointerEvents = 'all';
  blurBg.style.opacity = '1';
  blockPageScroll(true);
  blockKeyboard(true);

  setTimeout(() => { el.style.opacity = '1'; }, 100);
}

function hideSessionStart(): void {
  if (blurOverlay) {
    blurOverlay.style.opacity = '0';
    blurOverlay.style.pointerEvents = 'none';
  }
  blockPageScroll(false);
  blockKeyboard(false);
  if (sessionStartDialog) {
    sessionStartDialog.style.opacity = '0';
    setTimeout(() => {
      sessionStartDialog?.parentNode?.removeChild(sessionStartDialog);
      sessionStartDialog = null;
      dequeuePopup();
    }, 300);
  }
}

function showAveragePopup(minutesLeft: number, averageMinutes: number): void {
  if (isAnyMandatoryPopupVisible()) {
    popupQueue.push(() => showAveragePopup(minutesLeft, averageMinutes));
    return;
  }

  const blurBg = createBlurOverlay();
  const el = createAveragePopupOverlay(minutesLeft, averageMinutes);

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

function showReminderOverlay(
  message: string,
  totalTime: string,
  duration: number = Constants.OVERLAY_DURATIONS.REMINDER_DISPLAY_MS
): void {
  const blurBg = createBlurOverlay();
  const reminderElement = createReminderOverlay(message, totalTime);

  // Half-closable popup — buttons appear after half the timer
  blurBg.style.pointerEvents = 'all';
  blurBg.style.opacity = '1';
  blockPageScroll(true);
  blockKeyboard(true);
  pauseAllMedia();

  const halfDuration = Math.round(duration / 2);
  const allButtons = reminderElement.querySelectorAll('button');
  allButtons.forEach(btn => {
    (btn as HTMLElement).style.opacity = '0';
    (btn as HTMLElement).style.pointerEvents = 'none';
    (btn as HTMLElement).style.transition = 'opacity 0.3s ease, background 0.2s';
  });
  setTimeout(() => {
    allButtons.forEach(btn => {
      (btn as HTMLElement).style.opacity = '1';
      (btn as HTMLElement).style.pointerEvents = 'auto';
    });
  }, halfDuration);

  setTimeout(() => {
    reminderElement.style.opacity = '1';

    const progressBar = reminderElement.querySelector('.web-time-progress-bar') as HTMLElement | null;
    if (progressBar) {
      progressBar.style.transitionDuration = `${duration}ms`;
      progressBar.style.width = '0%';
    }
  }, 100);

  setTimeout(() => {
    hideReminderOverlay();
  }, duration);
}

function hideReminderOverlay(): void {
  if (blurOverlay) {
    blurOverlay.style.opacity = '0';
    blurOverlay.style.pointerEvents = 'none';
  }
  blockPageScroll(false);
  blockKeyboard(false);
  if (reminderDialog) {
    reminderDialog.style.opacity = '0';
    setTimeout(() => {
      if (reminderDialog && reminderDialog.parentNode) {
        reminderDialog.parentNode.removeChild(reminderDialog);
        reminderDialog = null;
      }
    }, 300);
  }
}

function handleSnooze(duration: string): void {
  hideReminderOverlay();

  const snoozeUntil: number | 'tomorrow' = duration === 'tomorrow'
    ? 'tomorrow'
    : Date.now() + parseInt(duration);

  browser.runtime.sendMessage({
    type: 'SNOOZE_REMINDERS',
    duration: snoozeUntil
  });
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
    position: fixed;
    top: 42%;
    left: 50%;
    transform: translate(-50%, -50%);
    background: #2a2a2a;
    color: #eee;
    padding: 28px;
    border-radius: 8px;
    box-shadow: 0 6px 32px rgba(0, 0, 0, 0.5);
    z-index: 1000001;
    pointer-events: auto;
    width: 300px;
    text-align: center;
    opacity: 0;
    transition: opacity 0.3s ease;
    overflow: hidden;
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
  } else if (message.type === "SHOW_REMINDER") {
    showReminderOverlay(message.customMessage || '', message.totalTime, message.duration);
  } else if (message.type === "SHOW_SESSION_START") {
    showSessionStart(message.stats);
  } else if (message.type === "SHOW_AVERAGE_POPUP") {
    showAveragePopup(message.minutesLeft, message.averageMinutes);
  } else if (message.type === "SHOW_BLOCKER") {
    showBlocker(message.cooldownRemainingSeconds, message.totalCooldownSeconds, message.cooldownCount, message.cooldownIncrementMinutes);
  } else if (message.type === "HIDE_BLOCKER") {
    hideBlocker();
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
