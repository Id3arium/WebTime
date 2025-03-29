// Initialize variables
let isTrackedSiteActive = false; // Is a tracked site currently being viewed?
let sessionStartTime = 0; // When did the current browsing session start?
let todaysTotalTime = 0; // Total time spent on tracked sites today
let currentDate = new Date().toDateString(); // Today's date for daily reset
let trackedSite = "youtube.com"; // List of sites to track (expandable in the future)

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

function isTrackedSite(url) {
    if (!url || typeof url !== "string") {
        console.log("isTrackedSite earlyFalse");
        return false;
    }
    console.log("isTrackedSite:", url.includes(trackedSite));
    return url.includes(trackedSite);
}

async function handleTrackedTabActivated(activeInfo) {
    console.log("handleTrackedTabActivated");
    const currTab = await browser.tabs.get(activeInfo.tabId);
    updateTimingState(currTab.url, currTab.id);
}

function handleTabUpdated(tabId, changeInfo, tab) {
    if (changeInfo.status == "complete") {
        updateTimingState(tab.url, tab.id);
    }
}

function updateTimingState(tabUrl, tabId) {
    if (!isTrackedSiteActive) {
        startTimingSession(tabId);
        return;
    } 
    if (!isTargetSite(tabUrl)) {
        stopTimingSession(tabId);
        return;
    } 
    const currentTotal = todaysTotalTime + Math.floor((Date.now() - sessionStartTime) / 1000);
    browser.tabs.sendMessage(tabId, {
        action: "timerStart",
        totalTime: currentTotal
    }).catch(err => console.log("Send message to additional YouTube tab error:", err));
}

function startTimingSession(tabId) {
    sessionStartTime = Date.now();
    isTrackedSiteActive = true;
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

    isTrackedSiteActive = false;
    console.log("stopTimingSession()");
    
    // Notify the content script
    if (tabId) {
        browser.tabs.sendMessage(tabId, {
            action: "timerStop"
        }).catch(err => console.log("Send message error:", err));
    }
}

function syncTimeWithDisplay(tabId) {
    if (isTrackedSiteActive && tabId) {
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

    browser.tabs.onActivated.addListener(handleTrackedTabActivated);
    browser.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
        if (changeInfo.status == "complete") {
            updateTimingState(tab.url, tabId);
        }
    });
    
    // Set up periodic time updates to content script (every 5 seconds)
    setInterval(() => {
        if (isTrackedSiteActive) {
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