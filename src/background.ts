import { Constants } from './shared/constants.js';
import { extractDomain, formatTimeWithSeconds, getLocalDateStr, log, compute7DayStats } from './shared/utils.js';
import type {
  TimeHistory,
  Domain,
  DateString,
  InterventionState,
  InterventionSettings,
  WebTimeSettings,
  ExtensionMessage
} from './types.js';

declare const browser: typeof chrome;

// State variables
let todaysTotalTimeInActiveDomain = 0;
let activeTabId: number | null = null;
const trackedTabIds = new Set<number>();
let timerInterval: ReturnType<typeof setInterval> | null = null;

const SAVE_INTERVAL_SECONDS = Constants.SAVE_INTERVAL_SECONDS;
const tabLastActivity: Record<number, number> = {};
let trackedTabDomain: Domain | null = null;
let inactivityThresholdMs = Constants.INACTIVITY_THRESHOLD_MS;
let reminderDisplayMs = Constants.OVERLAY_DURATIONS.REMINDER_DISPLAY_MS;
const ACTIVITY_CHECK_INTERVAL_MS = Constants.ACTIVITY_CHECK_INTERVAL_MS;

let currentDateStr: DateString = getLocalDateStr();
let timeHistory: TimeHistory = {};
let dayResetTime = 0;
let isSaving = false;

let interventionState: InterventionState = {
  lastNudgeTime: {},
  lastReminderTime: {},
  snoozedUntil: {},
  sessionStartShown: {},
  averagePopupShown: {}
};

function getLocalDateStrWithReset(): DateString {
  return getLocalDateStr(dayResetTime);
}

function migrateDataIfNeeded(oldTimeHistory: TimeHistory | Record<DateString, number>): TimeHistory {
  const dates = Object.keys(oldTimeHistory);
  if (dates.length === 0) return oldTimeHistory as TimeHistory;

  const firstDate = dates[0];
  if (typeof oldTimeHistory[firstDate] === "number") {
    console.log("Migrating old YouTube-only data to new multi-site format");

    const migratedHistory: TimeHistory = {};
    for (const [date, seconds] of Object.entries(oldTimeHistory)) {
      migratedHistory[date] = {
        "youtube.com": seconds as number,
      };
    }

    console.log(`Migrated ${dates.length} days of data from old format`);
    return migratedHistory;
  }

  console.log("Data already in new multi-site format");
  return oldTimeHistory as TimeHistory;
}

function initDefaultTimeData(): void {
  todaysTotalTimeInActiveDomain = 0;
  timeHistory = {};
  console.log("Initialized with default values");
}

async function saveTimeData(): Promise<void> {
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

async function loadTimeData(): Promise<void> {
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

function incrementTimer(): void {
  todaysTotalTimeInActiveDomain++;
  const newDateStr = getLocalDateStrWithReset();
  if (newDateStr !== currentDateStr) {
    saveTimeData();
    currentDateStr = newDateStr;
    todaysTotalTimeInActiveDomain = 0;
    interventionState = {
      lastNudgeTime: {},
      lastReminderTime: {},
      snoozedUntil: {},
      sessionStartShown: interventionState.sessionStartShown, // preserve across day rollover
      averagePopupShown: {}  // reset average popups on new day
    };
    console.log("New day, reset timer.");
  }
  updateTimerDisplay(todaysTotalTimeInActiveDomain);

  if (todaysTotalTimeInActiveDomain % SAVE_INTERVAL_SECONDS === 0) {
    saveTimeData();
  }

  checkForInterventions();
}

function startTimer(): void {
  if (timerInterval) return;

  timerInterval = setInterval(incrementTimer, 1000);
  console.log("Timer started.");
}

function stopTimer(): void {
  if (!timerInterval) return;

  clearInterval(timerInterval);
  timerInterval = null;
  saveTimeData();
}

function updateTimerDisplay(updatedTime: number): void {
  const message = { type: "TIME_UPDATE", time: updatedTime };
  trackedTabIds.forEach((tabId) => {
    browser.tabs.sendMessage(tabId, message).catch(() => {
      console.warn(`Failed to send TIME_UPDATE to tab ${tabId}. Removing from tracking.`);
      trackedTabIds.delete(tabId);
      delete tabLastActivity[tabId];
    });
  });
}

async function updateTimingState(tabId: number): Promise<void> {
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

function handleDomainSwitch(url: string): void {
  const domain = extractDomain(url);
  if (domain === trackedTabDomain) { return; }

  if (trackedTabDomain) {
    saveTimeData();
    // Reset session-start flag when leaving a domain so it shows again next visit
    delete interventionState.sessionStartShown[trackedTabDomain];
  }

  trackedTabDomain = domain;

  if (!trackedTabDomain) {
    log(`Switched to non-trackable URL: ${url}`);
    todaysTotalTimeInActiveDomain = 0;
    updateTimerDisplay(0);
    return;
  }

  const todayData = timeHistory[currentDateStr] || {};
  todaysTotalTimeInActiveDomain = todayData[trackedTabDomain] || 0;
  console.log(`Switched to domain: ${trackedTabDomain}, time: ${todaysTotalTimeInActiveDomain}`);
  updateTimerDisplay(todaysTotalTimeInActiveDomain);
}

function handleTimerState(activeTab: chrome.tabs.Tab, tabId: number): void {
  const isWebUrl = activeTab.url?.startsWith('http://') || activeTab.url?.startsWith('https://');
  if (!isWebUrl) {
    stopTimer();
    return;
  }

  const lastActivity = tabLastActivity[tabId] || 0;
  const isUserActive = (Date.now() - lastActivity) < inactivityThresholdMs;

  if (activeTab.audible || isUserActive) {
    startTimer();
  } else {
    stopTimer();
  }
}

function handleTabActivated(activeInfo: chrome.tabs.TabActiveInfo): void {
  console.log(`handleTabActivated called for tab ${activeInfo.tabId}`);
  activeTabId = activeInfo.tabId;
  updateTimingState(activeTabId);
}

function handleTabUpdated(
  tabId: number,
  changeInfo: chrome.tabs.TabChangeInfo,
  _tab: chrome.tabs.Tab
): void {
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

function handleTabRemoved(tabId: number, _removeInfo: chrome.tabs.TabRemoveInfo): void {
  if (tabId === activeTabId) {
    stopTimer();
    activeTabId = null;
  }
  trackedTabIds.delete(tabId);
  delete tabLastActivity[tabId];
}

function handleMessageReceived(
  message: ExtensionMessage,
  sender: chrome.runtime.MessageSender,
  _sendResponse: (response?: unknown) => void
): void {
  console.log(`handleMessage()`, message, sender);

  if (message.type === "CONTENT_SCRIPT_READY" && sender.tab?.id) {
    trackedTabIds.add(sender.tab.id);
    updateTimerDisplay(todaysTotalTimeInActiveDomain);
  }

  if (message.type === "USER_ACTIVE" && sender.tab?.id) {
    tabLastActivity[sender.tab.id] = Date.now();
  }

  if (message.type === "SNOOZE_REMINDERS" && sender.tab?.url) {
    const domain = extractDomain(sender.tab.url);
    if (domain) {
      interventionState.snoozedUntil[domain] = message.duration;
      console.log(`Snoozed reminders for ${domain} until`, message.duration);
    }
  }

  if (message.type === "SETTINGS_UPDATED") {
    browser.storage.local.get('webTimeSettings').then(data => {
      const settings: WebTimeSettings = data.webTimeSettings || { global: {}, domains: {} };

      inactivityThresholdMs = (settings.global?.inactivityTimeoutS ?? 30) * 1000;
      reminderDisplayMs = (settings.global?.popupDurationS ?? 10) * 1000;
      console.log(`Inactivity threshold: ${inactivityThresholdMs}ms, Reminder display: ${reminderDisplayMs}ms`);

      const newResetTime = settings.global?.dayResetTime || 0;
      if (newResetTime !== dayResetTime) {
        dayResetTime = newResetTime;
        console.log(`Day reset time updated to: ${dayResetTime}:00`);
        const newDateStr = getLocalDateStrWithReset();
        if (newDateStr !== currentDateStr) {
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

async function checkForInterventions(): Promise<void> {
  if (!trackedTabDomain || !activeTabId) return;

  const isCurrentlyActive = await checkAndClearSnooze();
  if (!isCurrentlyActive) return;

  const settings = await loadInterventionSettings();
  if (!settings) return;

  checkSessionStart(settings);
  checkLinearNudges(settings);
  checkAveragePopup(settings);
  checkTier2Reminders(settings);
}

async function checkAndClearSnooze(): Promise<boolean> {
  if (!trackedTabDomain) return true;

  const snoozeUntil = interventionState.snoozedUntil[trackedTabDomain];
  if (!snoozeUntil) return true;

  const isSnoozedUntilTomorrow = snoozeUntil === 'tomorrow';
  if (isSnoozedUntilTomorrow) return false;

  const isStillSnoozed = Date.now() < (snoozeUntil as number);
  if (isStillSnoozed) return false;

  delete interventionState.snoozedUntil[trackedTabDomain];
  return true;
}

async function loadInterventionSettings(): Promise<InterventionSettings | null> {
  if (!trackedTabDomain) return null;

  const data = await browser.storage.local.get('webTimeSettings');
  const settings: WebTimeSettings = data.webTimeSettings || { global: {}, domains: {} };
  const global = settings.global || {};
  const domainSettings = settings.domains?.[trackedTabDomain] || {};

  const reminderEnabled = domainSettings.reminderEnabled || false;
  if (!reminderEnabled) return null;

  const nudgeIntervalMinutes = domainSettings.nudgeIntervalMinutes ?? Constants.DEFAULT_NUDGE_INTERVAL_MINUTES;
  const { averageSeconds } = compute7DayStats(timeHistory, trackedTabDomain, currentDateStr);

  return {
    global,
    domainSettings,
    reminderEnabled,
    reminderThreshold: (domainSettings.reminderThreshold || 0) * 60,
    reminderInterval: domainSettings.reminderInterval || 15,
    nudgeIntervalMinutes,
    averageSeconds,
    timeInSeconds: todaysTotalTimeInActiveDomain
  };
}

function checkSessionStart(settings: InterventionSettings): void {
  if (!trackedTabDomain) return;
  if (interventionState.sessionStartShown[trackedTabDomain]) return;

  // Only show session start at t=1 (first second of tracking on this domain)
  if (settings.timeInSeconds !== 1) return;

  interventionState.sessionStartShown[trackedTabDomain] = true;

  const stats = compute7DayStats(timeHistory, trackedTabDomain, currentDateStr);
  sendSessionStart(stats);
}

function checkLinearNudges(settings: InterventionSettings): void {
  const { nudgeIntervalMinutes, reminderThreshold, timeInSeconds } = settings;

  if (timeInSeconds >= reminderThreshold) return;

  const nudgeIntervalSeconds = nudgeIntervalMinutes * 60;
  const isOnInterval = timeInSeconds > 0 && timeInSeconds % nudgeIntervalSeconds === 0;
  if (!isOnInterval) return;

  if (!trackedTabDomain) return;

  const lastNudge = interventionState.lastNudgeTime[trackedTabDomain] || -1;
  if (timeInSeconds === lastNudge) return;

  sendNudge();
  interventionState.lastNudgeTime[trackedTabDomain] = timeInSeconds;
  console.log(`Linear nudge at ${Math.round(timeInSeconds / 60)}min`);
}

function checkAveragePopup(settings: InterventionSettings): void {
  const { averageSeconds, nudgeIntervalMinutes, timeInSeconds } = settings;

  if (!trackedTabDomain) return;
  if (averageSeconds === 0) return;
  if (interventionState.averagePopupShown[trackedTabDomain]) return;

  const nudgeIntervalSeconds = nudgeIntervalMinutes * 60;
  const averagePopupThreshold = averageSeconds - nudgeIntervalSeconds;

  if (averagePopupThreshold <= 0) return;
  if (timeInSeconds < averagePopupThreshold) return;

  interventionState.averagePopupShown[trackedTabDomain] = true;

  const minutesLeft = Math.round((averageSeconds - timeInSeconds) / 60);
  sendAveragePopup(Math.max(0, minutesLeft));
  console.log(`Average popup shown at ${Math.round(timeInSeconds / 60)}min (avg: ${Math.round(averageSeconds / 60)}min)`);
}

function checkTier2Reminders(settings: InterventionSettings): void {
  const { reminderEnabled, reminderThreshold, reminderInterval, timeInSeconds, global } = settings;

  if (!reminderEnabled) return;

  const hasReachedReminderThreshold = timeInSeconds >= reminderThreshold;
  if (!hasReachedReminderThreshold) return;

  const timeOverThreshold = timeInSeconds - reminderThreshold;
  const reminderIntervalSeconds = reminderInterval * 60;
  const isOnReminderInterval = timeOverThreshold % reminderIntervalSeconds === 0;
  if (!isOnReminderInterval) return;

  if (!trackedTabDomain) return;

  const lastReminder = interventionState.lastReminderTime[trackedTabDomain] || -1;
  if (timeInSeconds === lastReminder) return;

  showReminder(global.customMessage);
  interventionState.lastReminderTime[trackedTabDomain] = timeInSeconds;
}

function sendNudge(): void {
  if (!activeTabId) return;

  browser.tabs.sendMessage(activeTabId, {
    type: 'NUDGE'
  }).catch(err => console.warn('Failed to send nudge:', err));
}

function sendSessionStart(stats: ReturnType<typeof compute7DayStats>): void {
  if (!activeTabId) return;

  browser.tabs.sendMessage(activeTabId, {
    type: 'SHOW_SESSION_START',
    stats
  }).catch(err => console.warn('Failed to send session start:', err));
}

function sendAveragePopup(minutesLeft: number): void {
  if (!activeTabId) return;

  browser.tabs.sendMessage(activeTabId, {
    type: 'SHOW_AVERAGE_POPUP',
    minutesLeft
  }).catch(err => console.warn('Failed to send average popup:', err));
}

function showReminder(customMessage?: string): void {
  if (!activeTabId) return;

  const totalTime = formatTimeWithSeconds(todaysTotalTimeInActiveDomain);

  browser.tabs.sendMessage(activeTabId, {
    type: 'SHOW_REMINDER',
    customMessage: customMessage,
    totalTime: totalTime,
    duration: reminderDisplayMs
  }).catch(err => console.warn('Failed to show reminder:', err));
}

async function init(): Promise<void> {
  browser.tabs.onActivated.addListener(handleTabActivated);
  browser.tabs.onUpdated.addListener(handleTabUpdated);
  browser.tabs.onRemoved.addListener(handleTabRemoved);
  browser.runtime.onMessage.addListener(handleMessageReceived);

  const settingsData = await browser.storage.local.get('webTimeSettings');
  const settings: WebTimeSettings = settingsData.webTimeSettings || { global: {}, domains: {} };
  dayResetTime = settings.global?.dayResetTime || 0;
  inactivityThresholdMs = (settings.global?.inactivityTimeoutS ?? 30) * 1000;
  reminderDisplayMs = (settings.global?.popupDurationS ?? 10) * 1000;
  console.log(`Day reset time loaded: ${dayResetTime}:00`);
  console.log(`Inactivity threshold: ${inactivityThresholdMs}ms, Reminder display: ${reminderDisplayMs}ms`);

  currentDateStr = getLocalDateStrWithReset();

  await loadTimeData();

  const trackedTabs = await browser.tabs.query({ url: ["http://*/*", "https://*/*"] });
  trackedTabs.forEach((tab) => {
    if (tab.id) trackedTabIds.add(tab.id);
  });

  const activeTabs = await browser.tabs.query({
    active: true,
    currentWindow: true,
  });
  if (activeTabs.length > 0 && activeTabs[0].id) {
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
