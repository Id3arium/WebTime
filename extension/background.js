let todaysTotalTime = 0;
let activeTabId = null;
const trackedTabIds = new Set();
let timerInterval = null;

const SAVE_INTERVAL_SECONDS = Constants.SAVE_INTERVAL_SECONDS;
let tabLastActivity = {};
let trackedTabDomain = null;
const INACTIVITY_THRESHOLD_MS = Constants.INACTIVITY_THRESHOLD_MS;
const ACTIVITY_CHECK_INTERVAL_MS = Constants.ACTIVITY_CHECK_INTERVAL_MS;

let currentDateStr = getLocalDateStr(); 
let timeHistory = {};

// Nudge system state
let nudgeState = {
    lastFlashTime: {},      // domain -> timestamp
    lastNudgeTime: {},      // domain -> timestamp
    snoozedUntil: {},       // domain -> timestamp or 'tomorrow'
    limitReached: {}        // domain -> boolean
};

// Use shared utility function
function getLocalDateStr() {
    return Utils.getLocalDateStr();
}

// Use shared utility function
function extractDomain(url) {
    return Utils.extractDomain(url);
}

function migrateDataIfNeeded(oldTimeHistory) {
    // Check if data is in old format (values are numbers instead of objects)
    const dates = Object.keys(oldTimeHistory);
    if (dates.length === 0) return oldTimeHistory;

    const firstDate = dates[0];
    if (typeof oldTimeHistory[firstDate] === "number") {
        console.log("Migrating old YouTube-only data to new multi-site format");

        // Convert: "2025-04-26": 12145 -> "2025-04-26": {"youtube.com": 12145}
        const migratedHistory = {};
        for (const [date, seconds] of Object.entries(oldTimeHistory)) {
            migratedHistory[date] = {
                "youtube.com": seconds,
            };
        }

        console.log(`Migrated ${dates.length} days of data from old format`);
        return migratedHistory;
    }

    // Data is already in new format
    console.log("Data already in new multi-site format");
    return oldTimeHistory;
}

function initDefaultTimeData() {
    todaysTotalTime = 0;
    timeHistory = {};
    console.log("Initialized with default values");
}

async function saveTimeData() {
    console.log(`saveTimeData() ${currentDateStr}: ${todaysTotalTime} seconds`);
    try {
        if (!timeHistory[currentDateStr]) {
            timeHistory[currentDateStr] = {};
        }

        // timeHistory[currentDateStr]["youtube.com"] = todaysTotalTime;
        if (trackedTabDomain) {
            timeHistory[currentDateStr][trackedTabDomain] = todaysTotalTime;
        }

        const storageData = {
            lastDate: currentDateStr,
            timeHistory: timeHistory,
            version: 1,
        };

        await browser.storage.local.set({
            trackedTime: storageData,
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

        timeHistory = migrateDataIfNeeded(trackedTime.timeHistory);

        if (currentDateStr !== trackedTime.lastDate) {
            console.log(
                `New day detected (Last: ${trackedTime.lastDate}, Now: ${currentDateStr})`
            );
            todaysTotalTime = 0;
        } else {
            const todaysData = timeHistory[currentDateStr] || {};
            // todaysTotalTime = todaysData["youtube.com"] || 0;
            todaysTotalTime = trackedTabDomain ? (todaysData[trackedTabDomain] || 0) : 0;
        }

        console.log(
            `Loaded data for ${currentDateStr}, time: ${todaysTotalTime}`
        );
    } catch (error) {
        console.error("Error loading time data:", error);
        initDefaultTimeData();
    }
}

function incrementTimer() {
    todaysTotalTime++;
    const newDateStr = getLocalDateStr();
    if (newDateStr !== currentDateStr) {
        saveTimeData();
        currentDateStr = newDateStr;
        todaysTotalTime = 0;
        // Reset nudge state for new day
        nudgeState = {
            lastFlashTime: {},
            lastNudgeTime: {},
            snoozedUntil: {},
            limitReached: {}
        };
        console.log("New day, reset timer.");
    }
    updateTimerDisplay(todaysTotalTime);

    if (todaysTotalTime % SAVE_INTERVAL_SECONDS === 0) {
        saveTimeData();
    }
    
    // Check for nudges
    checkNudges();
}

function startTimer() {
    if (timerInterval) return;

    timerInterval = setInterval(incrementTimer, 1000);
    console.log("Timer started.");
}

function stopTimer() {
    if (!timerInterval) return;

    clearInterval(timerInterval);
    timerInterval = null;
    saveTimeData();
}

function updateTimerDisplay(updatedTime) {
    const message = { type: "TIME_UPDATE", time: updatedTime };
    trackedTabIds.forEach((tabId) => {
        browser.tabs.sendMessage(tabId, message).catch((error) => {
            console.warn(`Failed to send TIME_UPDATE to tab ${tabId}. Removing from tracking.`);
            trackedTabIds.delete(tabId); 
            delete tabLastActivity[tabId]; 
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

        handleDomainSwitch(activeTab.url);
        handleTimerState(activeTab, tabId);
        
    } catch (error) {
        console.error(`Error in updateTimingState for tab ${tabId}:`, error);
        stopTimer();
    }
}

function handleDomainSwitch(url) {
    const domain = extractDomain(url);
    if (domain === trackedTabDomain) { return; }

    if (trackedTabDomain) {
        saveTimeData();
    }

    trackedTabDomain = domain;
    
    if (!trackedTabDomain) {
        Utils.log(`Switched to non-trackable URL: ${url}`);
        todaysTotalTime = 0;
        updateTimerDisplay(0);
        return;
    }

    const todayData = timeHistory[currentDateStr] || {};
    todaysTotalTime = todayData[trackedTabDomain] || 0;
    console.log(`Switched to domain: ${trackedTabDomain}, time: ${todaysTotalTime}`);
    updateTimerDisplay(todaysTotalTime);
}

function handleTimerState(activeTab, tabId) {
    const isWebUrl = activeTab.url.startsWith('http://') || activeTab.url.startsWith('https://');
    if (!isWebUrl) {
        stopTimer();
        return;
    }

    const lastActivity = tabLastActivity[tabId] || 0;
    const isUserActive = (Date.now() - lastActivity) < INACTIVITY_THRESHOLD_MS;
    
    if (activeTab.audible || isUserActive) {
        startTimer();
    } else {
        stopTimer();
    }
}

function handleTabActivated(activeInfo) {
    console.log(`handleTabActivated called for tab ${activeInfo.tabId}`);
    activeTabId = activeInfo.tabId;
    updateTimingState(activeTabId);
}

function handleTabUpdated(tabId, changeInfo, tab) {
    if (changeInfo.url !== undefined) {
        const domain = extractDomain(changeInfo.url);
        if (domain) {
            trackedTabIds.add(tabId);
            console.log(`Added tab ${tabId} to tracked tabs`);
        } else {
            trackedTabIds.delete(tabId);
            delete tabLastActivity[tabId]; 
            console.log(`Removed tab ${tabId} from tracked tabs`);
        }
    }
    const hasRelevantChanges = changeInfo.url !== undefined || changeInfo.audible !== undefined;
    if (tabId === activeTabId && hasRelevantChanges) {
        updateTimingState(tabId);
    }
}

function handleTabRemoved(tabId, removeInfo) {
    if (tabId === activeTabId) {
        stopTimer();
        activeTabId = null;
    }
    trackedTabIds.delete(tabId);
    delete tabLastActivity[tabId];
}

function handleMessageReceived(message, sender, sendResponse) {
    console.log(`handleMessage()`, message, sender);
    if (message.type === "CONTENT_SCRIPT_READY" && sender.tab) {
        trackedTabIds.add(sender.tab.id);
        updateTimerDisplay(todaysTotalTime);
    }
    if (message.type === "USER_ACTIVE" && sender.tab) {
        tabLastActivity[sender.tab.id] = Date.now();
    }
    if (message.type === "SNOOZE_NUDGES" && sender.tab) {
        const domain = extractDomain(sender.tab.url);
        if (domain) {
            nudgeState.snoozedUntil[domain] = message.duration;
            console.log(`Snoozed nudges for ${domain} until`, message.duration);
        }
    }
}

function importData(file) {
    const reader = new FileReader();
    reader.onload = (event) => {
        const data = JSON.parse(event.target.result);
        browser.storage.local.set(data);
    };
    reader.readAsText(file);
}

function exportData() {
    browser.storage.local.get("trackedTime").then((data) => {
        const blob = new Blob([JSON.stringify(data)], {
            type: "application/json",
        });
        const url = URL.createObjectURL(blob);

        browser.downloads.download({
            url: url,
            filename: "webtime-data.json",
            saveAs: true,
        });
    });
}

async function checkNudges() {
    if (!trackedTabDomain || !activeTabId) return;
    
    // Check if snoozed
    const snoozeUntil = nudgeState.snoozedUntil[trackedTabDomain];
    if (snoozeUntil) {
        if (snoozeUntil === 'tomorrow') {
            // Still snoozed until tomorrow
            return;
        } else if (Date.now() < snoozeUntil) {
            // Still snoozed
            return;
        } else {
            // Snooze expired
            delete nudgeState.snoozedUntil[trackedTabDomain];
        }
    }
    
    // Get settings
    const data = await browser.storage.local.get('webTimeSettings');
    const settings = data.webTimeSettings || { global: {}, domains: {} };
    const global = settings.global || {};
    const domainSettings = settings.domains?.[trackedTabDomain] || {};
    
    // Check if this domain has a limit
    if (!domainSettings.dailyLimit) return;
    
    const limitSeconds = domainSettings.dailyLimit * 60;
    const timeInSeconds = todaysTotalTime;
    const warningThreshold = limitSeconds * 0.8;
    
    const flashInterval = (global.flashInterval || 2) * 60; // Convert to seconds
    const remindInterval = (global.remindInterval || 15) * 60; // Convert to seconds
    
    // Check for warning flash (80-100%)
    if (timeInSeconds >= warningThreshold && timeInSeconds < limitSeconds) {
        const lastFlash = nudgeState.lastFlashTime[trackedTabDomain] || 0;
        if (timeInSeconds - lastFlash >= flashInterval) {
            sendWarningFlash();
            nudgeState.lastFlashTime[trackedTabDomain] = timeInSeconds;
        }
    }
    
    // Check for nudge popup (at limit or after)
    if (timeInSeconds >= limitSeconds) {
        const justReachedLimit = !nudgeState.limitReached[trackedTabDomain];
        const lastNudge = nudgeState.lastNudgeTime[trackedTabDomain] || 0;
        const shouldShowNudge = justReachedLimit || (timeInSeconds - lastNudge >= remindInterval);
        
        if (shouldShowNudge) {
            showNudge(global.customMessage);
            nudgeState.lastNudgeTime[trackedTabDomain] = timeInSeconds;
            nudgeState.limitReached[trackedTabDomain] = true;
        }
    }
}

function sendWarningFlash() {
    if (!activeTabId) return;
    
    browser.tabs.sendMessage(activeTabId, {
        type: 'WARNING_FLASH'
    }).catch(err => console.warn('Failed to send warning flash:', err));
}

function showNudge(customMessage) {
    if (!activeTabId) return;
    
    const totalTime = Utils.formatTimeWithSeconds(todaysTotalTime);
    
    browser.tabs.sendMessage(activeTabId, {
        type: 'SHOW_NUDGE',
        customMessage: customMessage,
        totalTime: totalTime,
        duration: Constants.OVERLAY_DURATIONS.POPUP_DISPLAY_MS
    }).catch(err => console.warn('Failed to show nudge:', err));
}

async function init() {
    browser.tabs.onActivated.addListener(handleTabActivated);
    browser.tabs.onUpdated.addListener(handleTabUpdated);
    browser.tabs.onRemoved.addListener(handleTabRemoved);
    browser.runtime.onMessage.addListener(handleMessageReceived);

    await loadTimeData();

    let trackedTabs = await browser.tabs.query({url: ["http://*/*", "https://*/*"]});
    trackedTabs.forEach((tab) => trackedTabIds.add(tab.id));

    let activeTabs = await browser.tabs.query({
        active: true,
        currentWindow: true,
    });
    if (activeTabs.length > 0) {
        activeTabId = activeTabs[0].id;
        updateTimingState(activeTabId);
    }

    setInterval(() => {
        if (activeTabId) {
            updateTimingState(activeTabId);
        }
    }, ACTIVITY_CHECK_INTERVAL_MS);
    console.log("Initialization complete.");
}
init();
