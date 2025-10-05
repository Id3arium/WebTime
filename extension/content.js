// This script creates a timer element and appends it to the body of the webpage.
// It also provides functions to update the timer text and manage the timer state.

let timerText = null;
let lastActivityTime = Date.now();
let blurOverlay = null;
let nudgePopup = null;
let flashInterval = null;

function createTimerElement() {
    const timer = document.createElement("div");
    timer.className = "web-time-timer";

    timerText = document.createElement("div");
    timerText.className = "web-time-timer-text";
    timerText.textContent = "00:00:00";

    timer.appendChild(timerText);
    document.body.appendChild(timer);

    console.log("Timer element created and added to page.");
}

function createBlurOverlay() {
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
        background: rgba(0, 0, 0, 0.1);
        z-index: 999999;
        pointer-events: none;
        opacity: 0;
        transition: opacity 0.3s ease;
    `;
    
    // Insert BEFORE timer so timer renders on top and doesn't get blurred
    const timer = document.querySelector('.web-time-timer');
    if (timer) {
        document.body.insertBefore(overlay, timer);
    } else {
        document.body.appendChild(overlay);
    }
    
    blurOverlay = overlay;
    return overlay;
}

function createNudgePopup(message, totalTime) {
    if (nudgePopup) return nudgePopup;
    
    const popup = document.createElement('div');
    popup.className = 'web-time-nudge-popup';
    popup.style.cssText = `
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        background: #2a2a2a;
        color: #eee;
        padding: 24px 32px;
        border-radius: 12px;
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
        z-index: 1000001;
        pointer-events: auto;
        min-width: 320px;
        max-width: 400px;
        text-align: center;
        opacity: 0;
        transition: opacity 0.3s ease;
        overflow: hidden;
    `;
    
    popup.innerHTML = `
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
        <div style="font-size: 18px; font-weight: 600; margin-bottom: 12px;">
            ${totalTime} on this site today
        </div>
        <div style="font-size: 14px; color: #bbb; margin-bottom: 20px;">
            ${message}
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
    
    // Add hover effects
    const buttons = popup.querySelectorAll('button');
    buttons.forEach(btn => {
        if (btn.classList.contains('web-time-close-btn')) {
            btn.addEventListener('click', () => {
                hideNudgePopup();
            });
        } else if (btn.classList.contains('web-time-snooze-btn')) {
            btn.addEventListener('mouseenter', () => {
                btn.style.background = '#555';
            });
            btn.addEventListener('mouseleave', () => {
                btn.style.background = '#444';
            });
            btn.addEventListener('click', () => {
                handleSnooze(btn.dataset.duration);
            });
        }
    });
    
    document.body.appendChild(popup);
    nudgePopup = popup;
    return popup;
}

function showWarningFlash() {
    const overlay = createBlurOverlay();
    overlay.style.opacity = '1';
    
    // Pulse the timer
    const timer = document.querySelector('.web-time-timer');
    if (timer) {
        timer.style.transition = 'transform 0.3s ease-in-out';
        timer.style.transform = 'scale(2.5)';
        
        setTimeout(() => {
            timer.style.transform = 'scale(1)';
        }, Constants.OVERLAY_DURATIONS.WARNING_FLASH_MS / 2); // Pulse for half the duration
    }
    
    setTimeout(() => {
        overlay.style.opacity = '0';
    }, Constants.OVERLAY_DURATIONS.WARNING_FLASH_MS);
}

function showNudgePopup(message, totalTime, duration = Constants.OVERLAY_DURATIONS.POPUP_DISPLAY_MS) {
    const overlay = createBlurOverlay();
    const popup = createNudgePopup(message, totalTime);
    
    // Show overlay and popup
    overlay.style.opacity = '1';
    setTimeout(() => {
        popup.style.opacity = '1';
        
        // Animate progress bar
        const progressBar = popup.querySelector('.web-time-progress-bar');
        if (progressBar) {
            progressBar.style.transitionDuration = `${duration}ms`;
            progressBar.style.width = '0%';
        }
    }, 100);
    
    // Auto-dismiss
    setTimeout(() => {
        hideNudgePopup();
    }, duration);
}

function hideNudgePopup() {
    if (blurOverlay) {
        blurOverlay.style.opacity = '0';
    }
    if (nudgePopup) {
        nudgePopup.style.opacity = '0';
        setTimeout(() => {
            if (nudgePopup && nudgePopup.parentNode) {
                nudgePopup.parentNode.removeChild(nudgePopup);
                nudgePopup = null;
            }
        }, 300);
    }
}

function handleSnooze(duration) {
    hideNudgePopup();
    
    const snoozeUntil = duration === 'tomorrow' 
        ? 'tomorrow'
        : Date.now() + parseInt(duration);
    
    browser.runtime.sendMessage({
        type: 'SNOOZE_NUDGES',
        duration: snoozeUntil
    });
}

function handleIncomingMessage(message, sender, sendResponse) {
    if (message.type === "TIME_UPDATE") {
        if (timerText) {
            timerText.textContent = Utils.formatTimeWithSeconds(message.time);
        } else {
            console.error(
                "Timer text element not found when trying to update time!"
            );
        }
    } else if (message.type === "WARNING_FLASH") {
        showWarningFlash();
    } else if (message.type === "SHOW_NUDGE") {
        showNudgePopup(message.customMessage, message.totalTime, message.duration);
    }
}

function updateActivityState() {
    lastActivityTime = Date.now();
    browser.runtime.sendMessage({ type: "USER_ACTIVE" });
}

// Set up event listeners for user activity
document.addEventListener("scroll", updateActivityState);
document.addEventListener("keydown", updateActivityState);
document.addEventListener("mousemove", updateActivityState);

function init() {
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
