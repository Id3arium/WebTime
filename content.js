// Module-level variables
let timerRunning = false;
let lastKnownTotal = 0;
let sessionStartTime = 0;
let updateInterval;

async function getStoredData() {
    try {
        const data = await browser.storage.local.get(["date", "totalTime"]);
        return {
            totalSeconds: data.totalTime || 0,
            date: data.date || new Date().toDateString()
        };
    } catch (error) {
        console.error("Error getting time data:", error);
        return { totalSeconds: 0, date: new Date().toDateString() };
    }
}

function formatTime(timeInSeconds) {
    timeInSeconds = Math.max(0, Math.floor(timeInSeconds));
    
    const hours = Math.floor(timeInSeconds / 3600);
    const minutes = Math.floor((timeInSeconds % 3600) / 60);
    const seconds = timeInSeconds % 60;
    
    // Format seconds into HH:MM:SS
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function createTimerElement() {
    const existingTimer = document.getElementById("web-time-timer");
    if (existingTimer) {
        existingTimer.remove();
        console.log("Removed existing timer element");
    }
    
    const timerContainer = document.createElement("div");
    timerContainer.id = "web-time-timer";
    
    const timerText = document.createElement("div");
    timerText.id = "web-time-timer-text";
    timerText.textContent = "00:00:00";
    
    timerContainer.appendChild(timerText);
    document.body.insertAdjacentElement("afterbegin", timerContainer);
    
    console.log("Timer element created");
    return timerContainer;
}

function updateTimerText(timeInSeconds) {
    const formattedTime = formatTime(timeInSeconds);
    const timerElement = document.getElementById("web-time-timer-text");
    
    if (timerElement) {
        timerElement.textContent = formattedTime;
        console.log("updateTimerText()", formattedTime);
    }
}

function updateTime(){
    console.log("updateTime() timerRunning:", timerRunning);
    if (!timerRunning) return;
    
    const currentSessionTime = Math.floor((Date.now() - sessionStartTime) / 1000);
    const currentTotalTime = lastKnownTotal + currentSessionTime;
    
    updateTimerText(currentTotalTime);
}

function startTimer(initialTotal) {
    timerRunning = true;
    lastKnownTotal = initialTotal || 0;
    sessionStartTime = Date.now();
    
    // Clear any existing interval just in case
    if (updateInterval) {
        clearInterval(updateInterval);
    }
    
    updateTime(); // Update immediately
    updateInterval = setInterval(updateTime, 1000);
    console.log("Timer started with initial total:", lastKnownTotal);
}

function stopTimer() {
    timerRunning = false;
    clearInterval(updateInterval);
    console.log("Timer stopped");
}

function handleVisibilityChange() {
    if (document.hidden) {
        // Page is hidden (tab inactive or navigated away)
        stopTimer();
    }
}

// Initialize everything
async function initTimer() {
    console.log("Initializing timer");
    
    // Create the timer UI
    createTimerElement();
    
    // Set up visibility change listener
    document.addEventListener("visibilitychange", handleVisibilityChange);
    
    // Get initial time from storage
    const data = await getStoredData();
    lastKnownTotal = data.totalSeconds;
    
    // We don't start the timer here - we wait for the background script to tell us
    console.log("Timer initialized, waiting for background script");
}

// Listen for messages from the background script
browser.runtime.onMessage.addListener((message) => {
    console.log("Received message. properties:", Object.keys(message));
    
    switch (message.action) {
        case "timerStart":
            createTimerElement(); // Ensure element exists
            console.log("totalTime value:", message.totalTime);
            startTimer(message.totalTime);
            break;
            
        case "timerStop":
            stopTimer();
            break;
            
        case "syncTime":
            if (timerRunning) {
                // Sync with background's time
                console.log("currentTotal value:", message.currentTotal);
                lastKnownTotal = message.currentTotal;
                sessionStartTime = Date.now();
                updateTime();
            }
            break;
    }
});

// Start everything when the page loads
initTimer();