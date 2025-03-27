// Initialize variables
let isTargetSiteActive = false; // Is a tracked site currently being viewed?
let sessionStartTime = 0; // When did the current browsing session start?
let todaysTotalTime = 0; // Total time spent on tracked sites today
let currentDate = new Date().toDateString(); // Today's date for daily reset
let targetSite = "youtube.com"; // List of sites to track (expandable in the future)

function resetDaylyCounter() {
    todaysTotalTime = 0;
    browser.storage.local.set({
        date: currentDate,
        totalTime: 0,
    });
    console.log("Reset daily counter for new day");
}

async function setTimeData() {
    const data = await browser.storage.local.get(["date", "totalTime"]);
    if (data.date === currentDate) {
        todaysTotalTime = data.totalTime || 0;
        console.log("Loaded saved time:", todaysTotalTime, "seconds");
    } else {
        resetDaylyCounter();
    }
}

function isTargetSite(url) {
    if (!url || typeof url !== "string")
    {
        console.log("isTargetSite earlyFalse");
        return false;
    }
    return url.includes(targetSite);
}

async function handleTimedTabActivated(activeInfo) {
    console.log("handleTimedTabActivated");
    const currTab = await browser.tabs.get(activeInfo.tabId);
    attemptToTimeTab(currTab.url);
}

function updateTotalTime() {
    const secondsSpent = Math.floor((Date.now() - sessionStartTime) / 1000);
    todaysTotalTime += secondsSpent;

    browser.storage.local.set({
        date: currentDate,
        totalTime: todaysTotalTime,
    });

    console.log(
        `Added ${secondsSpent} seconds to today's total. New total: ${todaysTotalTime} seconds`
    );
}

function handleTabUpdated(tabId, changeInfo, tab) {
    if (changeInfo.status == "complete") {
        attemptToTimeTab(tab.url);
    }
}

function attemptToTimeTab(tabUrl) {
    if (isTargetSite(tabUrl)) {
        if (!isTargetSiteActive) {
            sessionStartTime = Date.now();
            isTargetSiteActive = true;
            console.log("started timing session");
        }
    } else {
        if (isTargetSiteActive) {
            updateTotalTime();
            isTargetSiteActive = false;
            console.log("stopped timing session");
        }
    }
}

function init() {
    console.log("Initialiized the WebTime extension");
    setTimeData();

    browser.tabs.onActivated.addListener(handleTimedTabActivated);
    browser.tabs.onUpdated.addListener(handleTabUpdated);
}

// Start the extension
init();
