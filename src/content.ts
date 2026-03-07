import { Constants } from './shared/constants.js';
import { formatTimeWithSeconds, escapeHtml } from './shared/utils.js';
import type { ExtensionMessage } from './types.js';

declare const browser: typeof chrome;

let timerText: HTMLDivElement | null = null;
let lastActivityTime = Date.now();
let blurOverlay: HTMLDivElement | null = null;
let reminderDialog: HTMLDivElement | null = null;

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
      btn.addEventListener('click', () => {
        hideReminderOverlay();
      });
    } else if (btn.classList.contains('web-time-snooze-btn')) {
      btn.addEventListener('mouseenter', () => {
        (btn as HTMLButtonElement).style.background = '#555';
      });
      btn.addEventListener('mouseleave', () => {
        (btn as HTMLButtonElement).style.background = '#444';
      });
      btn.addEventListener('click', () => {
        handleSnooze((btn as HTMLButtonElement).dataset.duration || '3600000');
      });
    }
  });

  document.body.appendChild(reminderElement);
  reminderDialog = reminderElement;
  return reminderElement;
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
  if (blurOverlay) {
    blurOverlay.style.opacity = '0';
  }
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
      console.error(
        "Timer text element not found when trying to update time!"
      );
    }
  } else if (message.type === "NUDGE") {
    showNudge();
  } else if (message.type === "SHOW_REMINDER") {
    showReminderOverlay(message.customMessage || '', message.totalTime, message.duration);
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
