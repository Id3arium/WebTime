let localTimer;
let lastStoredTime = 0;
let sessionStartTime;

async function getTimeData() {
    const data = await browser.storage.local.get(["date", "totalTime"]);
    //should not silently fail
    return {
        totalTime: data.totalTime || 0,
        date: data.date || new Date().toDateString(),
    };
}

function formatTime(timeInSeconds) {
    const hrs = Math.floor(timeInSeconds / 3600);
    const min = Math.floor((timeInSeconds % 3600) / 60);
    const sec = timeInSeconds % 60;

    const paddedHrs = String(hrs).padStart(2, "0")
    const paddedMin = String(min).padStart(2, "0")
    const paddedSec = String(sec).padStart(2, "0")
    return `${paddedHrs}:${paddedMin}:${paddedSec}`;
}

function createTimerElement() {
    const timerContainer = document.createElement("div");
    timerContainer.id = "web-time-timer";

    const timerText = document.createElement("div");
    timerText.id = "web-time-timer-text";
    timerText.textContent = "00:00:00";
    timerContainer.appendChild(timerText);

    document.body.insertAdjacentElement("afterbegin", timerContainer);
    return timerContainer;
}

function updateTimerText(timeInSeconds) {
    const formattedTime = formatTime(timeInSeconds);
    document.getElementById("web-time-timer-text").textContent = formattedTime;

    console.log("updateTimerText", formattedTime);
}

function updateTime() {
    const currentSessionTime = Math.floor(
        (Date.now() - sessionStartTime) / 1000
    );
    const currentTotalTime = lastStoredTime + currentSessionTime;
    updateTimerText(currentTotalTime);
}

// Initialize and start the timer process
function initTimer() {
    console.log("initTimer");

    createTimerElement();
    getTimeData().then((data) => {
        lastStoredTime = data.totalTime;
        sessionStartTime = Date.now();
        updateTime(); // Update once immediately
        setInterval(updateTime, 1000); // Then update every second
    });
}

initTimer();
