let todaysTotalTimeInActiveDomain = 0;
let activeTabId = null;
const trackedTabIds = new Set();
let timerInterval = null;

const SAVE_INTERVAL_SECONDS = Constants.SAVE_INTERVAL_SECONDS;
let tabLastActivity = {};
let trackedTabDomain = null;
const INACTIVITY_THRESHOLD_MS = Constants.INACTIVITY_THRESHOLD_MS;
const ACTIVITY_CHECK_INTERVAL_MS = Constants.ACTIVITY_CHECK_INTERVAL_MS;

let currentDateStr = Utils.getLocalDateStr(); 
let timeHistory = {};
let dayResetTime = 0; // Hour when day resets (0-4)

// Nudge system state
let nudgeState = {
    lastFlashTime: {},      // domain -> timestamp
    lastNudgeTime: {},      // domain -> timestamp
    snoozedUntil: {},       // domain -> timestamp or 'tomorrow'
    limitReached: {}        // domain -> boolean
};

// Use shared utility function
function getLocalDateStr() {
    return Utils.getLocalDateStr(dayResetTime);
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
    todaysTotalTimeInActiveDomain = 0;
    timeHistory = {};
    console.log("Initialized with default values");
}

async function saveTimeData() {
    console.log(`saveTimeData() ${currentDateStr}: ${todaysTotalTimeInActiveDomain} seconds`);
    try {
        if (!timeHistory[currentDateStr]) {
            timeHistory[currentDateStr] = {};
        }

        // timeHistory[currentDateStr]["youtube.com"] = todaysTotalTimeInActiveDomain;
        if (trackedTabDomain) {
            timeHistory[currentDateStr][trackedTabDomain] = todaysTotalTimeInActiveDomain;
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
            todaysTotalTimeInActiveDomain = 0;
        } else {
            const todaysData = timeHistory[currentDateStr] || {};
            // todaysTotalTimeInActiveDomain = todaysData["youtube.com"] || 0;
            todaysTotalTimeInActiveDomain = trackedTabDomain ? (todaysData[trackedTabDomain] || 0) : 0;
        }

        console.log(
            `Loaded data for ${currentDateStr}, time: ${todaysTotalTimeInActiveDomain}`
        );
    } catch (error) {
        console.error("Error loading time data:", error);
        initDefaultTimeData();
    }
}

function incrementTimer() {
    todaysTotalTimeInActiveDomain++;
    const newDateStr = getLocalDateStr();
    if (newDateStr !== currentDateStr) {
        saveTimeData();
        currentDateStr = newDateStr;
        todaysTotalTimeInActiveDomain = 0;
        // Reset nudge state for new day
        nudgeState = {
            lastFlashTime: {},
            lastNudgeTime: {},
            snoozedUntil: {},
            limitReached: {}
        };
        console.log("New day, reset timer.");
    }
    updateTimerDisplay(todaysTotalTimeInActiveDomain);

    if (todaysTotalTimeInActiveDomain % SAVE_INTERVAL_SECONDS === 0) {
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
        todaysTotalTimeInActiveDomain = 0;
        updateTimerDisplay(0);
        return;
    }

    const todayData = timeHistory[currentDateStr] || {};
    todaysTotalTimeInActiveDomain = todayData[trackedTabDomain] || 0;
    console.log(`Switched to domain: ${trackedTabDomain}, time: ${todaysTotalTimeInActiveDomain}`);
    updateTimerDisplay(todaysTotalTimeInActiveDomain);
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
        updateTimerDisplay(todaysTotalTimeInActiveDomain);
    }
    if (message.type === "USER_ACTIVE" && sender.tab) {
        tabLastActivity[sender.tab.id] = Date.now();
    }
    if (message.type === "SNOOZE_REMINDERS" && sender.tab) {
        const domain = extractDomain(sender.tab.url);
        if (domain) {
            nudgeState.snoozedUntil[domain] = message.duration;
            console.log(`Snoozed reminders for ${domain} until`, message.duration);
        }
    }
    if (message.type === "SETTINGS_UPDATED") {
        // Reload day reset time when settings change
        browser.storage.local.get('webTimeSettings').then(data => {
            const settings = data.webTimeSettings || { global: {} };
            const newResetTime = settings.global?.dayResetTime || 0;
            if (newResetTime !== dayResetTime) {
                dayResetTime = newResetTime;
                console.log(`Day reset time updated to: ${dayResetTime}:00`);
                // Recalculate current date with new reset time
                const newDateStr = getLocalDateStr();
                if (newDateStr !== currentDateStr) {
                    // Date changed due to reset time change, trigger rollover
                    saveTimeData();
                    currentDateStr = newDateStr;
                    const todayData = timeHistory[currentDateStr] || {};
                    todaysTotalTimeInActiveDomain = trackedTabDomain ? (todayData[trackedTabDomain] || 0) : 0;
                    updateTimerDisplay(todaysTotalTimeInActiveDomain);
                    console.log(`Date changed to ${currentDateStr} due to reset time change`);
                }
            }
        });
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
    
    // Get settings (per domain)
    const data = await browser.storage.local.get('webTimeSettings');
    const settings = data.webTimeSettings || { global: {}, domains: {} };
    const global = settings.global || {};
    const domainSettings = settings.domains?.[trackedTabDomain] || {};
    
    // Check if this domain has a limit
    if (!domainSettings.dailyLimit) return;
    
    const limitSeconds = domainSettings.dailyLimit * 60;
    const timeInSeconds = todaysTotalTimeInActiveDomain;
    
    const nudgeInterval = domainSettings.nudgeInterval; // minutes
    const nudgePeriod = domainSettings.nudgePeriod; // minutes  
    const reminderInterval = domainSettings.reminderInterval; // minutes
    
    // Tier 1: Flash nudges (from limit until nudge period ends)
    if (nudgeInterval && timeInSeconds >= limitSeconds) {
        const nudgePeriodSeconds = nudgePeriod ? nudgePeriod * 60 : 0;
        const timeOverLimit = timeInSeconds - limitSeconds;
        
        // Only nudge if we're still in nudge period (or nudge period is disabled)
        if (!nudgePeriod || timeOverLimit < nudgePeriodSeconds) {
            const lastFlash = nudgeState.lastFlashTime[trackedTabDomain] || limitSeconds - 1;
            const nudgeIntervalSeconds = nudgeInterval * 60;
            
            if (timeInSeconds - lastFlash >= nudgeIntervalSeconds) {
                sendWarningFlash();
                nudgeState.lastFlashTime[trackedTabDomain] = timeInSeconds;
            }
        }
    }
    
    // Tier 2: Reminders (after nudge period)
    if (reminderInterval && nudgePeriod && timeInSeconds >= limitSeconds) {
        const nudgePeriodSeconds = nudgePeriod * 60;
        const timeOverLimit = timeInSeconds - limitSeconds;
        
        // Only show reminders after nudge period
        if (timeOverLimit >= nudgePeriodSeconds) {
            const justReachedTier2 = !nudgeState.limitReached[trackedTabDomain];
            const lastReminder = nudgeState.lastNudgeTime[trackedTabDomain] || 0;
            const reminderIntervalSeconds = reminderInterval * 60;
            const shouldShowReminder = justReachedTier2 || (timeInSeconds - lastReminder >= reminderIntervalSeconds);
            
            if (shouldShowReminder) {
                showReminder(global.customMessage);
                nudgeState.lastNudgeTime[trackedTabDomain] = timeInSeconds;
                nudgeState.limitReached[trackedTabDomain] = true;
            }
        }
    }
}

function sendWarningFlash() {
    if (!activeTabId) return;
    
    browser.tabs.sendMessage(activeTabId, {
        type: 'WARNING_FLASH'
    }).catch(err => console.warn('Failed to send warning flash:', err));
}

function showReminder(customMessage) {
    if (!activeTabId) return;
    
    const totalTime = Utils.formatTimeWithSeconds(todaysTotalTimeInActiveDomain);
    
    browser.tabs.sendMessage(activeTabId, {
        type: 'SHOW_REMINDER',
        customMessage: customMessage,
        totalTime: totalTime,
        duration: Constants.OVERLAY_DURATIONS.REMINDER_DISPLAY_MS
    }).catch(err => console.warn('Failed to show reminder:', err));
}

async function init() {
    browser.tabs.onActivated.addListener(handleTabActivated);
    browser.tabs.onUpdated.addListener(handleTabUpdated);
    browser.tabs.onRemoved.addListener(handleTabRemoved);
    browser.runtime.onMessage.addListener(handleMessageReceived);

    // Load day reset time setting
    const settingsData = await browser.storage.local.get('webTimeSettings');
    const settings = settingsData.webTimeSettings || { global: {} };
    dayResetTime = settings.global?.dayResetTime || 0;
    console.log(`Day reset time loaded: ${dayResetTime}:00`);
    
    // Update currentDateStr with the loaded reset time
    currentDateStr = getLocalDateStr();

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
