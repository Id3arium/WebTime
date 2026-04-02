import { Constants } from './shared/constants.js';
import { formatTimeWithSeconds, formatTimeCompact, escapeHtml } from './shared/utils.js';
import type { ExtensionMessage, SessionStartStats } from './types.js';

declare const browser: typeof chrome;

let timerText: HTMLDivElement | null = null;
let lastActivityTime = Date.now();
let blurOverlay: HTMLDivElement | null = null;
let reminderDialog: HTMLDivElement | null = null;
let sessionStartDialog: HTMLDivElement | null = null;
let averagePopupDialog: HTMLDivElement | null = null;

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

function createTimerElement(): void {
  const timer = document.createElement("div");
  timer.className = "web-time-timer";

  timerText = document.createElement("div");
  timerText.textContent = "00:00:00";
  timerText.style.cssText = "color: #f7f7f7 !important;";

  timer.appendChild(timerText);
  document.body.appendChild(timer);

  console.log("Timer element created and added to page.");
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
    backdrop-filter: blur(3px);
    -webkit-backdrop-filter: blur(3px);
    background: rgba(0, 0, 0, 0.3);
    z-index: 999999;
    pointer-events: none;
    opacity: 0;
    transition: opacity 0.3s ease;
  `;

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
    padding: 24px 32px;
    border-radius: 6px;
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
    <div style="font-size: 14px; color: #999; margin-bottom: 8px;">
      ${totalTime} on this site today
    </div>
    <div style="font-size: 18px; font-weight: 600; margin-bottom: 20px; color: #fff;">
      ${escapeHtml(message)}
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
      <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 6px;">
        <div style="width: 42px; font-size: 12px; color: #888; text-align: right; flex-shrink: 0;">${dayName} ${dayOfMonth}</div>
        <div style="flex: 1; height: 16px; background: #333; border-radius: 3px; overflow: hidden;">
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
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    background: #2a2a2a;
    color: #eee;
    padding: 24px 28px;
    border-radius: 8px;
    box-shadow: 0 6px 32px rgba(0, 0, 0, 0.5);
    z-index: 1000001;
    pointer-events: auto;
    width: 300px;
    opacity: 0;
    transition: opacity 0.3s ease;
  `;

  const avgLabel = stats.averageSeconds > 0
    ? `7-day avg: <strong>${formatTimeCompact(stats.averageSeconds)}</strong> / day`
    : 'No recent history yet';

  el.innerHTML = `
    <div style="font-size: 14px; font-weight: 600; color: #ccc; margin-bottom: 16px; text-align: center; letter-spacing: 0.02em;">
      Usage in past ${stats.days.length} days
    </div>
    <div style="margin-bottom: 16px;">
      ${buildBarChart(stats.days)}
    </div>
    <div style="font-size: 13px; color: #aaa; margin-bottom: 24px; padding-top: 10px; border-top: 1px solid #3a3a3a; text-align: center;">
      ${avgLabel}
    </div>
    <button class="web-time-continue-btn" style="
      width: 100%;
      background: #3a3a3a;
      border: none;
      color: #eee;
      padding: 11px;
      border-radius: 6px;
      cursor: pointer;
      font-size: 14px;
      transition: background 0.2s;
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
    padding: 28px 32px;
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
    <div style="font-size: 15px; color: #eee; margin-bottom: 6px;">
      You're at 80% of your 7-day average.
    </div>
    <div style="font-size: 22px; font-weight: 600; color: #fff; margin-bottom: 8px;">
      avg: ${avgLabel} / day
    </div>
    <div style="font-size: 13px; color: #888; margin-bottom: 24px;">
      ${untilAvgLine}
    </div>
    <button class="web-time-avg-continue-btn" style="
      width: 100%;
      background: #3a3a3a;
      border: none;
      color: #eee;
      padding: 11px;
      border-radius: 6px;
      cursor: pointer;
      font-size: 14px;
      transition: background 0.2s;
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
  overlay.style.opacity = '1';

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
  }, Constants.OVERLAY_DURATIONS.NUDGE_MS);
}

function showSessionStart(stats: SessionStartStats): void {
  if (isAnyMandatoryPopupVisible()) {
    popupQueue.push(() => showSessionStart(stats));
    return;
  }

  const blurBg = createBlurOverlay();
  const el = createSessionStartOverlay(stats);

  blurBg.style.pointerEvents = 'none';
  blurBg.style.opacity = '1';
  setTimeout(() => { el.style.opacity = '1'; }, 100);
}

function hideSessionStart(): void {
  if (blurOverlay) blurOverlay.style.opacity = '0';
  if (sessionStartDialog) {
    sessionStartDialog.style.opacity = '0';
    setTimeout(() => {
      sessionStartDialog?.parentNode?.removeChild(sessionStartDialog);
      sessionStartDialog = null;
      if (blurOverlay) blurOverlay.style.pointerEvents = 'none';
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

  blurBg.style.pointerEvents = 'none';
  blurBg.style.opacity = '1';
  setTimeout(() => { el.style.opacity = '1'; }, 100);
}

function hideAveragePopup(): void {
  if (blurOverlay) blurOverlay.style.opacity = '0';
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

  blurBg.style.opacity = '1';
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
  if (blurOverlay) blurOverlay.style.opacity = '0';
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

function handleIncomingMessage(
  message: ExtensionMessage,
  _sender: chrome.runtime.MessageSender,
  _sendResponse: (response?: unknown) => void
): void {
  if (message.type === "TIME_UPDATE") {
    if (timerText) {
      timerText.textContent = formatTimeWithSeconds(message.time);
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

  try {
    const readyMessage = { type: "CONTENT_SCRIPT_READY" };
    browser.runtime.sendMessage(readyMessage);
  } catch (error) {
    console.error("Error sending CONTENT_SCRIPT_READY message:", error);
  }
  console.log("Sent CONTENT_SCRIPT_READY message to background.");
}

init();
