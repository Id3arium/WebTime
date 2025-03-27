// Initialize variables
let isTargetSiteActive = false; // Is a tracked site currently being viewed?
let sessionStartTime = 0; // When did the current browsing session start?
let todaysTotalTime = 0; // Total time spent on tracked sites today
let currentDate = new Date().toDateString(); // Today's date for daily reset
let targetSite = "youtube.com"; // List of sites to track (expandable in the future)

function resetTodaysTracking() {
    todaysTotalTime = 0;
    browser.storage.local.set({
        date: currentDate,
        totalTime: 0,
    });
    console.log("Reset daily counter for new day");
}

function saveTimeData() {
    browser.storage.local.set({
        date: currentDate,
        totalTime: todaysTotalTime,
    });
}

async function loadTimeData() {
    const data = await browser.storage.local.get(["date", "totalTime"]);
    if (data.date === currentDate) {
        todaysTotalTime = data.totalTime || 0;
        console.log("Loaded saved time:", todaysTotalTime, "seconds");
    } else {
        resetTodaysTracking();
    }
}

function isTargetSite(url) {
    if (!url || typeof url !== "string") {
        console.log("isTargetSite earlyFalse");
        return false;
    }
    console.log("isTargetSite url.includes(targetSite)", url.includes(targetSite));
    return url.includes(targetSite);
}

async function handleTimedTabActivated(activeInfo) {
    console.log("handleTimedTabActivated");
    const currTab = await browser.tabs.get(activeInfo.tabId);
    updateTimingState(currTab.url, currTab.id);
}

function handleTabUpdated(tabId, changeInfo, tab) {
    if (changeInfo.status == "complete") {
        updateTimingState(tab.url, tab.id);
    }
}

function updateTimingState(tabUrl, tabId) {
    if (isTargetSite(tabUrl)) {
        if (!isTargetSiteActive) {
            startTimingSession(tabId);
        }
    } else {
        if (isTargetSiteActive) {
            stopTimingSession(tabId);
        }
    }
}

function startTimingSession(tabId) {
    sessionStartTime = Date.now();
    isTargetSiteActive = true;
    console.log("startTimingSession()");
    
    // Notify the content script
    if (tabId) {
        browser.tabs.sendMessage(tabId, {
            action: "timerStart",
            totalTime: todaysTotalTime
        }).catch(err => console.log("Send message error (likely content script not loaded yet):", err));
    }
}

function stopTimingSession(tabId)
{
    const timingSession = Math.floor((Date.now() - sessionStartTime) / 1000);
    todaysTotalTime += timingSession;
    console.log(`Added ${timingSession} seconds. Todays total: ${todaysTotalTime}s`);
    saveTimeData();

    isTargetSiteActive = false;
    console.log("stopTimingSession()");
    
    // Notify the content script
    if (tabId) {
        browser.tabs.sendMessage(tabId, {
            action: "timerStop"
        }).catch(err => console.log("Send message error:", err));
    }
}

function syncTimeWithDisplay(tabId) {
    if (isTargetSiteActive && tabId) {
        const currentTotal = todaysTotalTime + Math.floor((Date.now() - sessionStartTime) / 1000);
            
        browser.tabs.sendMessage(tabId, {
            action: "syncTime",
            currentTotal: currentTotal
        }).catch(err => console.log("Update error (normal if tab closed):", err));
    }
}

async function init() {
    console.log("Initialized the WebTime extension");
    await loadTimeData();

    browser.tabs.onActivated.addListener(handleTimedTabActivated);
    browser.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
        if (changeInfo.status == "complete") {
            updateTimingState(tab.url, tabId);
        }
    });
    
    // Set up periodic time updates to content script (every 5 seconds)
    setInterval(() => {
        if (isTargetSiteActive) {
            browser.tabs.query({active: true, currentWindow: true}).then(tabs => {
                if (tabs[0]) {
                    syncTimeWithDisplay(tabs[0].id);
                }
            });
        }
    }, 5000);
}

// Start the extension
init();