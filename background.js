let todaysTotalTime = 0;
let activeTabId = null;
const trackedTabIds = new Set(); 
let timerInterval = null;
const trackedSitePattern = "*://*.youtube.com/*"; 

async function loadTimeData() {
    try {
        let storedData = await browser.storage.local.get("trackedTime");
        let loadedTime = storedData.trackedTime
        todaysTotalTime = loadedTime ?? 0;

        if (loadedTime !== undefined) {
             console.log("Loaded saved time:", todaysTotalTime);
        } else {
             console.log("No saved time found. Starting fresh with:", todaysTotalTime);
        }
    } catch (error) {
        console.error("Error loading time from storage:", error);
    }
}

function isTrackedTabUrl(url) {
    if (typeof url !== 'string' || !(url.startsWith('http'))) return false;
    
    const trackedDomains = ['youtube.com'];
    try {
        const parsedUrl = new URL(url);
        return trackedDomains.some(domain => 
            parsedUrl.hostname === domain || parsedUrl.hostname.endsWith('.' + domain)
        );
    } catch (error) {
        console.error("Error parsing URL:", error);
        return false;
    }
}

async function saveTimeData() {
    console.log(`Attempting to save time: ${todaysTotalTime}`);
    try {
        await browser.storage.local.set({ 
            trackedTime: todaysTotalTime,
        });
        console.log("Time successfully saved.");
    } catch (error) {
        console.error("Error saving time to storage:", error);
    }
}

function startTimer() {
    if (timerInterval) return;

    timerInterval = setInterval(() =>{ 
        todaysTotalTime++;
        updateTimerDisplay(todaysTotalTime);
    }, 1000)
    console.log("Timer started.");
}

function stopTimer() {
    if (!timerInterval) return;

    clearInterval(timerInterval);
    timerInterval = null;
    saveTimeData();
    console.log("Timer stopped.");
}

function updateTimerDisplay(updatedTime) {
    const message = { type: "TIME_UPDATE", time: updatedTime };
    trackedTabIds.forEach(tabId => {
        browser.tabs.sendMessage(tabId, message).catch(error => { 
            console.warn(`Failed to send TIME_UPDATE to tab ${tabId}. Maybe it closed? Error:`, error);
        });
    });
}

async function updateTimingState(tabId) {
    try {
        const activeTab = await browser.tabs.get(tabId);
        if (!activeTab || !activeTab.url) {
            console.log(`Tab ${tabId} was closed or has no URL`);
            stopTimer();
            return;
        }
        const isTrackedUrl = isTrackedTabUrl(activeTab.url);
        const isAudible = activeTab.audible;
        console.log(`Tab ${tabId}: tracked=${isTrackedUrl}, audible=${isAudible}`);
        
        if (isTrackedUrl && isAudible) {
            startTimer();
        } else {
            stopTimer();
        }
    } catch (error) {
        console.error(`Error in updateTimingState for tab ${tabId}:`, error);
        stopTimer(); // Safety measure: stop timer if we can't determine state
    }
}

function handleTabActivated(activeInfo) {
    console.log(`handleTabActivated called for tab ${activeInfo.tabId}`);
    activeTabId = activeInfo.tabId; 
    updateTimingState(activeTabId);
}

function handleTabUpdated(tabId, changeInfo, tab) {
    console.log(`handleTabUpdated() called for tab ${tabId}`, changeInfo);
    if (changeInfo.url !== undefined) {
        const isTrackedSite = isTrackedTabUrl(changeInfo.url);
        if (isTrackedSite) {
            trackedTabIds.add(tabId);
            console.log(`Added tab ${tabId} to tracked tabs`);
        } else {
            trackedTabIds.delete(tabId);
            console.log(`Removed tab ${tabId} from tracked tabs`);
        }
    }
    const hasRelevantChanges = changeInfo.url !== undefined || changeInfo.audible !== undefined;
    if (tabId === activeTabId && hasRelevantChanges) {
        updateTimingState(tabId);
    }
}

function handleTabRemoved(tabId, removeInfo) {
    console.log(`handleTabRemoved() called for tab ${tabId}`);
    if (tabId === activeTabId) {
        stopTimer();
        activeTabId = null;
    }
    trackedTabIds.delete(tabId); 
}

function handleMessage(message, sender, sendResponse) {
    console.log(`handleMessage()`, message, sender);
    if (message.type === "CONTENT_SCRIPT_READY" && sender.tab) {
        trackedTabIds.add(sender.tab.id);
        updateTimerDisplay(todaysTotalTime);
    }
}

async function init() {
    browser.tabs.onActivated.addListener(handleTabActivated);
    browser.tabs.onUpdated.addListener(handleTabUpdated);
    browser.tabs.onRemoved.addListener(handleTabRemoved);
    browser.runtime.onMessage.addListener(handleMessage);

    await loadTimeData();

    let trackedTabs = await browser.tabs.query({ url: trackedSitePattern })
    trackedTabs.forEach(tab => trackedTabIds.add(tab.id));

    let activeTabs = await browser.tabs.query({ active: true, currentWindow: true });
    if (activeTabs.length > 0) {
        activeTabId = activeTabs[0].id;
        updateTimingState(activeTabId);
    }
    console.log("Initialization complete.");
}
init();