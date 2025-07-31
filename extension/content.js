// This script creates a timer element and appends it to the body of the webpage.
// It also provides functions to update the timer text and manage the timer state.

let timerText = null; 
let lastActivityTime = Date.now();

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

function handleIncomingMessage(message, sender, sendResponse) {
  if (message.type === "TIME_UPDATE") {
    if (timerText) {
      timerText.textContent = Utils.formatTimeWithSeconds(message.time);
    } else {
      console.error("Timer text element not found when trying to update time!");
    }
  }
}

function updateActivityState() {
    lastActivityTime = Date.now();
    browser.runtime.sendMessage({ type: "USER_ACTIVE" });
}

// Set up event listeners for user activity
document.addEventListener('scroll', updateActivityState);
document.addEventListener('keydown', updateActivityState);
document.addEventListener('mousemove', updateActivityState);

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