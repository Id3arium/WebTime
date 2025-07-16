let todaysTotalTime = 0;
let activeTabId = null;
const trackedTabIds = new Set();
let timerInterval = null;
const trackedSitePattern = "*://*.youtube.com/*";
const SAVE_INTERVAL_SECONDS = 60;
let tabActivity = {};
const INACTIVITY_TIMEOUT = 2500; // in ms

let currentDateStr = getLocalDateStr(); // Format: "YYYY-MM-DD"
let timeHistory = {};

function getLocalDateStr() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0"); // Months are 0-indexed
    const day = String(now.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}

function isTrackedTabUrl(url) {
    if (typeof url !== "string" || !url.startsWith("http")) return false;

    const trackedDomains = ["youtube.com"];
    try {
        const parsedUrl = new URL(url);
        return trackedDomains.some(
            (domain) =>
                parsedUrl.hostname === domain ||
                parsedUrl.hostname.endsWith("." + domain)
        );
    } catch (error) {
        console.error("Error parsing URL:", error);
        return false;
    }
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

        timeHistory[currentDateStr]["youtube.com"] = todaysTotalTime;

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
            // Get YouTube time specifically (for now, until we expand to all sites)
            const todayData = timeHistory[currentDateStr] || {};
            todaysTotalTime = todayData["youtube.com"] || 0;
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
        console.log("New day, reset timer.");
    }
    updateTimerDisplay(todaysTotalTime);

    if (todaysTotalTime % SAVE_INTERVAL_SECONDS === 0) {
        saveTimeData();
    }
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
            console.warn(
                `Failed to send TIME_UPDATE to tab ${tabId}. Maybe it closed? Error:`,
                error
            );
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
        const lastActivity = tabActivity[tabId] || 0;
        const isUserActive = Date.now() - lastActivity < INACTIVITY_TIMEOUT;

        // console.log(`Tab ${tabId}: tracked=${isTrackedUrl}, audible=${activeTab.audible}, active=${isUserActive}`);

        if (isTrackedUrl && (activeTab.audible || isUserActive)) {
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
    const hasRelevantChanges =
        changeInfo.url !== undefined || changeInfo.audible !== undefined;
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
}

function handleMessageRecieved(message, sender, sendResponse) {
    console.log(`handleMessage()`, message, sender);
    if (message.type === "CONTENT_SCRIPT_READY" && sender.tab) {
        trackedTabIds.add(sender.tab.id);
        updateTimerDisplay(todaysTotalTime);
    }
    if (message.type === "USER_ACTIVE" && sender.tab) {
        tabActivity[sender.tab.id] = Date.now();
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

async function init() {
    browser.tabs.onActivated.addListener(handleTabActivated);
    browser.tabs.onUpdated.addListener(handleTabUpdated);
    browser.tabs.onRemoved.addListener(handleTabRemoved);
    browser.runtime.onMessage.addListener(handleMessageRecieved);

    await loadTimeData();

    let trackedTabs = await browser.tabs.query({ url: trackedSitePattern });
    trackedTabs.forEach((tab) => trackedTabIds.add(tab.id));

    let activeTabs = await browser.tabs.query({
        active: true,
        currentWindow: true,
    });
    if (activeTabs.length > 0) {
        activeTabId = activeTabs[0].id;
        updateTimingState(activeTabId);
    }

    // Set up periodic check for inactivity
    setInterval(() => {
        if (activeTabId) {
            updateTimingState(activeTabId);
        }
    }, 2500);
    console.log("Initialization complete.");
}
init();
