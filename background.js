let todaysTotalTime = 0;
let activeTabId = null;
const trackedTabIds = new Set(); 
let timerInterval = null;
const trackedSitePattern = "*://*.youtube.com/*"; 
const SAVE_INTERVAL_SECONDS = 60;

let currentDateStr = new Date().toISOString().split('T')[0]; // Format: "YYYY-MM-DD"
let timeHistory = {};

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
function initDefaultTimeData() {
    todaysTotalTime = 0;
    timeHistory = {};
    console.log("Initialized with default values");
}

async function saveTimeData() {
    console.log(`saveTimeData() ${currentDateStr}: ${todaysTotalTime} seconds`);
    try {
        timeHistory[currentDateStr] = todaysTotalTime;
        
        const storageData = {
            lastDate: currentDateStr,
            timeHistory: timeHistory,
            version: 1
        };
        
        await browser.storage.local.set({ 
            trackedTime: storageData
        });
        console.log("Time data successfully saved with history.");
    } catch (error) {
        console.error("Error saving time data to storage:", error);
    }
}

async function loadTimeData() {
    try {
        const storedData = await browser.storage.local.get("trackedTime");
        const trackedTime = storedData.trackedTime;
        
        if (!trackedTime || !trackedTime.lastDate || !trackedTime.timeHistory) {
            initDefaultTimeData();
            return;
        }
        
        timeHistory = trackedTime.timeHistory;
        
        if (currentDateStr !== trackedTime.lastDate) {
            console.log(`New day detected (Last: ${trackedTime.lastDate}, Now: ${currentDateStr})`);
            todaysTotalTime = 0;
        } else {
            todaysTotalTime = timeHistory[currentDateStr] || 0;
        }
        
        console.log(`Loaded data for ${currentDateStr}, time: ${todaysTotalTime}`);
    } catch (error) {
        console.error("Error loading time data:", error);
        initDefaultTimeData();
    }
}

function incrementTimer() {
    const newDateStr = new Date().toISOString().split('T')[0];
    if (newDateStr !== currentDateStr) { // new day, reset timer
        saveTimeData(); 
        todaysTotalTime = 0;
        currentDateStr = newDateStr;
    }

    todaysTotalTime++;
    updateTimerDisplay(todaysTotalTime);
}

function startTimer() {
    if (timerInterval) return;
    
    timerInterval = setInterval(() => {
        todaysTotalTime++;
        updateTimerDisplay(todaysTotalTime);

        if (todaysTotalTime % SAVE_INTERVAL_SECONDS === 0) {
            saveTimeData(); 
        }
    }, 1000); 
}

function stopTimer() {
    if (!timerInterval) return;

    clearInterval(timerInterval);
    timerInterval = null;
    saveTimeData();
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
        console.log(`Tab ${tabId}: tracked=${isTrackedUrl}, audible=${activeTab.audible}`);
        
        if (isTrackedUrl && activeTab.audible) {
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
    // console.log(`handleTabUpdated() called for tab ${tabId}`);
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
    // console.log(`handleTabRemoved() called for tab ${tabId}`);
    if (tabId === activeTabId) {
        stopTimer();
        activeTabId = null;
    }
    trackedTabIds.delete(tabId); 
}

function handleMessageRecieved(message, sender, sendResponse) {
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
    browser.runtime.onMessage.addListener(handleMessageRecieved);

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