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
let dayResetTime = 0; // Hour when day resets
let isSaving = false; // Lock to prevent race conditions during simultaneous saves

// Nudge and reminder system state
let interventionState = {
    lastNudgeTime: {},         // domain -> timestamp (Tier 1: visual nudges)
    lastReminderTime: {},      // domain -> timestamp (Tier 2: popup reminders)
    snoozedUntil: {},          // domain -> timestamp or 'tomorrow'
    reminderPhaseReached: {}   // domain -> boolean
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
    if (isSaving) {
        console.log('Save already in progress, skipping...');
        return;
    }
    
    isSaving = true;
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
    } finally {
        isSaving = false;
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
        // Reset intervention state for new day
        interventionState = {
            lastNudgeTime: {},
            lastReminderTime: {},
            snoozedUntil: {},
            reminderPhaseReached: {}
        };
        console.log("New day, reset timer.");
    }
    updateTimerDisplay(todaysTotalTimeInActiveDomain);

    if (todaysTotalTimeInActiveDomain % SAVE_INTERVAL_SECONDS === 0) {
        saveTimeData();
    }
    
    checkForInterventions();
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
            interventionState.snoozedUntil[domain] = message.duration;
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

async function checkForInterventions() {
    if (!trackedTabDomain || !activeTabId) return;
    
    const isCurrentlyActive = await checkAndClearSnooze();
    if (!isCurrentlyActive) return;
    
    const settings = await loadInterventionSettings();
    if (!settings) return;
    
    // Check which nudge system to use
    if (settings.domainSettings.usePhiNudges) {
        checkPhiBasedNudges(settings);
    } else {
        checkTier1Nudges(settings);
    }
    
    checkTier2Reminders(settings);
}

async function checkAndClearSnooze() {
    const snoozeUntil = interventionState.snoozedUntil[trackedTabDomain];
    if (!snoozeUntil) return true;
    
    const isSnoozedUntilTomorrow = snoozeUntil === 'tomorrow';
    if (isSnoozedUntilTomorrow) return false;
    
    const isStillSnoozed = Date.now() < snoozeUntil;
    if (isStillSnoozed) return false;
    
    // Snooze expired, clear it
    delete interventionState.snoozedUntil[trackedTabDomain];
    return true;
}

async function loadInterventionSettings() {
    const data = await browser.storage.local.get('webTimeSettings');
    const settings = data.webTimeSettings || { global: {}, domains: {} };
    const global = settings.global || {};
    const domainSettings = settings.domains?.[trackedTabDomain] || {};
    
    const nudgeEnabled = domainSettings.nudgeEnabled || false;
    const reminderEnabled = domainSettings.reminderEnabled || false;
    
    if (!nudgeEnabled && !reminderEnabled) return null;
    
    return {
        global,
        domainSettings,
        nudgeEnabled,
        nudgeThreshold: domainSettings.nudgeThreshold * 60, // convert to seconds
        nudgeInterval: domainSettings.nudgeInterval,
        reminderEnabled,
        reminderThreshold: domainSettings.reminderThreshold * 60, // convert to seconds
        reminderInterval: domainSettings.reminderInterval,
        timeInSeconds: todaysTotalTimeInActiveDomain
    };
}

/**
 * Calculate nudge times using φ-based exponential decay
 * @param {number} timeLimitMinutes - When reminders start (in minutes)
 * @param {number} reminderIntervalMinutes - How often reminders repeat (in minutes)
 * @returns {Array<number>} Array of nudge times in seconds, sorted ascending
 */
function calculatePhiNudgeTimes(timeLimitMinutes, reminderIntervalMinutes) {
    const φ = Constants.PHI;
    const timeLimitSeconds = timeLimitMinutes * 60;
    
    // Calculate number of nudges: round(φ × sqrt(timeLimit / reminderInterval))
    const numNudges = Math.round(φ * Math.sqrt(timeLimitMinutes / reminderIntervalMinutes));
    
    if (numNudges === 0) return [];
    
    const nudgeTimes = [];
    
    for (let i = 1; i <= numNudges; i++) {
        // Calculate time remaining before limit using φ^i decay
        const timeBeforeLimit = timeLimitSeconds / Math.pow(φ, i);
        
        // Convert to time from start (invert: limit - timeBeforeLimit)
        const baseTimeSeconds = timeLimitSeconds - timeBeforeLimit;
        
        // Add ±2 minute jitter for unpredictability
        const jitterSeconds = (Math.floor(Math.random() * 5) - 2) * 60;
        
        // Ensure nudge is at least 1 minute in and before time limit
        const nudgeTime = Math.max(60, Math.min(timeLimitSeconds - 60, Math.round(baseTimeSeconds + jitterSeconds)));
        
        nudgeTimes.push(nudgeTime);
    }
    
    // Sort ascending (earliest first)
    nudgeTimes.sort((a, b) => a - b);
    
    return nudgeTimes;
}

/**
 * Check if it's time to show a φ-based nudge
 * Uses exponential decay spacing that accelerates as time passes
 */
function checkPhiBasedNudges(settings) {
    const { reminderEnabled, reminderThreshold, reminderInterval, timeInSeconds } = settings;
    
    // Phi nudges require reminders to be enabled (they lead up to reminders)
    if (!reminderEnabled) return;
    
    // Don't nudge after hitting reminder threshold
    if (timeInSeconds >= reminderThreshold) return;
    
    const timeLimitMinutes = reminderThreshold / 60;
    const reminderIntervalMinutes = reminderInterval;
    
    // Calculate nudge times fresh every time (cheap operation, ensures settings changes take effect)
    const nudgeTimes = calculatePhiNudgeTimes(timeLimitMinutes, reminderIntervalMinutes);
    
    // Check if current time matches any nudge time
    for (const nudgeTime of nudgeTimes) {
        if (timeInSeconds === nudgeTime) {
            const lastNudge = interventionState.lastNudgeTime[trackedTabDomain] || -1;
            
            // Prevent duplicate nudges at same time
            if (timeInSeconds !== lastNudge) {
                sendNudge();
                interventionState.lastNudgeTime[trackedTabDomain] = timeInSeconds;
                console.log(`φ-nudge triggered at ${Math.round(timeInSeconds/60)}min`);
                break;
            }
        }
    }
}

function checkTier1Nudges(settings) {
    const { nudgeEnabled, nudgeThreshold, nudgeInterval, reminderEnabled, reminderThreshold, timeInSeconds } = settings;
    
    if (!nudgeEnabled) return;
    
    const hasReachedNudgeThreshold = timeInSeconds >= nudgeThreshold;
    if (!hasReachedNudgeThreshold) return;
    
    // If reminders are enabled and we've hit reminder threshold, stop nudging
    if (reminderEnabled && timeInSeconds >= reminderThreshold) return;
    
    const timeOverThreshold = timeInSeconds - nudgeThreshold;
    const nudgeIntervalSeconds = nudgeInterval * 60;
    const isOnNudgeInterval = timeOverThreshold % nudgeIntervalSeconds === 0;
    if (!isOnNudgeInterval) return;
    
    const lastNudge = interventionState.lastNudgeTime[trackedTabDomain] || -1;
    const alreadyNudgedAtThisTime = timeInSeconds === lastNudge;
    if (alreadyNudgedAtThisTime) return;
    
    sendNudge();
    interventionState.lastNudgeTime[trackedTabDomain] = timeInSeconds;
}

function checkTier2Reminders(settings) {
    const { reminderEnabled, reminderThreshold, reminderInterval, timeInSeconds, global } = settings;
    
    if (!reminderEnabled) return;
    
    const hasReachedReminderThreshold = timeInSeconds >= reminderThreshold;
    if (!hasReachedReminderThreshold) return;
    
    const timeOverThreshold = timeInSeconds - reminderThreshold;
    const reminderIntervalSeconds = reminderInterval * 60;
    const isOnReminderInterval = timeOverThreshold % reminderIntervalSeconds === 0;
    if (!isOnReminderInterval) return;
    
    const lastReminder = interventionState.lastReminderTime[trackedTabDomain] || -1;
    const alreadyRemindedAtThisTime = timeInSeconds === lastReminder;
    if (alreadyRemindedAtThisTime) return;
    
    showReminder(global.customMessage);
    interventionState.lastReminderTime[trackedTabDomain] = timeInSeconds;
    interventionState.reminderPhaseReached[trackedTabDomain] = true;
}

function sendNudge() {
    if (!activeTabId) return;
    
    browser.tabs.sendMessage(activeTabId, {
        type: 'NUDGE'
    }).catch(err => console.warn('Failed to send nudge:', err));
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
