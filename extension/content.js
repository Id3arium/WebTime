// This script creates a timer element and appends it to the body of the webpage.
// It also provides functions to update the timer text and manage the timer state.

let timerText = null; 

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

function formatTime(timeInSeconds) {
  timeInSeconds = Math.max(0, Math.floor(timeInSeconds));
  
  const hours = Math.floor(timeInSeconds / 3600);
  const minutes = Math.floor((timeInSeconds % 3600) / 60);
  const seconds = timeInSeconds % 60;
  
  // Format seconds into HH:MM:SS
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function handleIncomingMessage(message, sender, sendResponse) {
  if (message.type === "TIME_UPDATE") {
    if (timerText) {
      timerText.textContent = formatTime(message.time);
    } else {
      console.error("Timer text element not found when trying to update time!");
    }
  }
}

let lastActivityTime = Date.now();
const INACTIVITY_TIMEOUT = 7000; //in ms

function updateActivityState() {
    lastActivityTime = Date.now();
    browser.runtime.sendMessage({ type: "USER_ACTIVE" });
}

// Set up event listeners for user activity
document.addEventListener('mousemove', updateActivityState);
document.addEventListener('scroll', updateActivityState);
document.addEventListener('keydown', updateActivityState);

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