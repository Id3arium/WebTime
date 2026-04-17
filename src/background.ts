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

// Session limit state — derived from todaysTotalTimeInActiveDomain, not a parallel counter.
// nextSessionBoundary[domain] = the absolute daily-seconds threshold at which the next
// session boundary will fire for that domain. Trigger is `>=` so missed ticks are safe.
// cooldownEndTime[domain] = ms epoch when the active cooldown ends (absent = not in cooldown).
// cooldownTickers[domain] = the 1s setInterval that drives the blocker countdown UI.
const nextSessionBoundary: Record<Domain, number> = {};
const cachedDomainSessionLimit: Record<Domain, { sessionLimitSeconds: number }> = {};
const cooldownEndTime: Record<Domain, number> = {};
const cooldownTickers: Record<Domain, ReturnType<typeof setInterval>> = {};

// Cache previous intervention settings per domain to detect actual changes
const previousInterventionSettings: Record<Domain, string> = {};

function computeNextBoundary(totalSeconds: number, limitSeconds: number): number {
  return (Math.floor(totalSeconds / limitSeconds) + 1) * limitSeconds;
}

function clearAllCooldowns(): void {
  for (const domain of Object.keys(cooldownTickers)) {
    clearInterval(cooldownTickers[domain]);
    delete cooldownTickers[domain];
  }
  for (const domain of Object.keys(cooldownEndTime)) {
    delete cooldownEndTime[domain];
  }
}


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
  // Cooldown gate: if the current domain is in an active cooldown, freeze the
  // timer entirely. No daily increment, no interventions, nothing. The
  // cooldown ticker (startCooldownTicker) handles the blocker UI countdown.
  if (trackedTabDomain && (cooldownEndTime[trackedTabDomain] || 0) > Date.now()) {
    return;
  }

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
      sessionStartShown: {},  // reset all intervention state on new day
      averagePopupShown: {}
    };
    // Reset session limit state on day rollover
    clearAllCooldowns();
    for (const domain of Object.keys(nextSessionBoundary)) {
      delete nextSessionBoundary[domain];
    }
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
  // Include session time info if a session limit is configured for this domain
  const message: { type: string; time: number; sessionTime?: number; sessionLimitSeconds?: number } = {
    type: "TIME_UPDATE",
    time: updatedTime
  };

  if (trackedTabDomain) {
    const data = cachedDomainSessionLimit[trackedTabDomain];
    if (data && data.sessionLimitSeconds > 0) {
      const limitSec = data.sessionLimitSeconds;
      const sessionTime = updatedTime % limitSec;
      message.sessionTime = sessionTime;
      message.sessionLimitSeconds = limitSec;
    }
  }

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
    // sessionStartShown is NOT reset here — it resets only on day rollover.
    // This means the session start popup fires once per day per domain,
    // regardless of tab switching or how many tabs of the same domain are open.
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
  // Clear cached boundary for this domain so checkSessionLimit recomputes it
  // from the current daily total + current settings on the next tick. This
  // covers the case where the user changed the session limit for this domain
  // while tracking a different one.
  delete nextSessionBoundary[trackedTabDomain];
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
  // When audio stops, treat it as a fresh activity event so the inactivity
  // timeout starts from now rather than cutting off immediately.
  if (changeInfo.audible === false) {
    tabLastActivity[tabId] = Date.now();
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

    // If the domain is currently in cooldown, immediately show blocker on this new tab.
    // We don't know the session number or increment minutes from here — the active
    // cooldown ticker will send a full-fidelity SHOW_BLOCKER on its next tick anyway.
    if (sender.tab.url) {
      const domain = extractDomain(sender.tab.url);
      if (domain) {
        const endTime = cooldownEndTime[domain] || 0;
        if (endTime > Date.now()) {
          const remaining = Math.ceil((endTime - Date.now()) / 1000);
          browser.tabs.sendMessage(sender.tab.id, {
            type: 'SHOW_BLOCKER',
            cooldownRemainingSeconds: remaining,
            totalCooldownSeconds: remaining,
            cooldownCount: 1,
            cooldownIncrementMinutes: 0
          }).catch(() => {});
        }
      }
    }
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

      // Re-show session start popup only when intervention settings actually change
      // (not on every save). Compare a fingerprint of relevant settings.
      if (trackedTabDomain) {
        const domainCfg = settings.domains?.[trackedTabDomain];
        const fingerprint = JSON.stringify({
          reminderEnabled: domainCfg?.reminderEnabled,
          reminderThreshold: domainCfg?.reminderThreshold,
          reminderInterval: domainCfg?.reminderInterval,
          nudgeIntervalMinutes: domainCfg?.nudgeIntervalMinutes,
          sessionLimitEnabled: domainCfg?.sessionLimitEnabled,
          sessionLimit: domainCfg?.sessionLimit,
          cooldownIncrement: domainCfg?.cooldownIncrement
        });
        const prev = previousInterventionSettings[trackedTabDomain];
        if (prev !== undefined && prev !== fingerprint) {
          // Settings actually changed — reset so popup re-fires
          delete interventionState.sessionStartShown[trackedTabDomain];
          console.log(`Intervention settings changed for ${trackedTabDomain}, session start popup reset`);
        }
        previousInterventionSettings[trackedTabDomain] = fingerprint;
      }

      // Recompute the next session boundary for the tracked domain whenever
      // settings change. This handles mid-day changes to sessionLimit so the
      // next trigger is anchored to the new limit, not the old one.
      if (trackedTabDomain) {
        const domainCfg = settings.domains?.[trackedTabDomain];
        const slEnabled = domainCfg?.sessionLimitEnabled || false;
        const newLimitSeconds = slEnabled ? (domainCfg?.sessionLimit || 0) * 60 : 0;
        if (newLimitSeconds > 0) {
          nextSessionBoundary[trackedTabDomain] = computeNextBoundary(
            todaysTotalTimeInActiveDomain,
            newLimitSeconds
          );
          console.log(
            `Session boundary recomputed for ${trackedTabDomain}: ` +
            `next trigger at ${nextSessionBoundary[trackedTabDomain]}s ` +
            `(daily=${todaysTotalTimeInActiveDomain}s, limit=${newLimitSeconds}s)`
          );
        } else {
          delete nextSessionBoundary[trackedTabDomain];
        }
      }
    });
  }
}

async function checkForInterventions(): Promise<void> {
  if (!trackedTabDomain || !activeTabId) return;

  const settings = await loadInterventionSettings();
  if (!settings) return;

  // Session limit always runs — independent of snooze state
  if (checkSessionLimit(settings)) return;

  const isCurrentlyActive = await checkAndClearSnooze();
  if (!isCurrentlyActive) return;

  if (settings.reminderEnabled) {
    checkSessionStart(settings);
    checkLinearNudges(settings);
    checkAveragePopup(settings);
    checkTier2Reminders(settings);
  }
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
  const sessionLimitEnabled = domainSettings.sessionLimitEnabled || false;
  const hasSessionLimit = sessionLimitEnabled && (domainSettings.sessionLimit || 0) > 0;

  // Cache session limit for timer display (even when returning null)
  cachedDomainSessionLimit[trackedTabDomain] = {
    sessionLimitSeconds: hasSessionLimit ? (domainSettings.sessionLimit || 0) * 60 : 0
  };

  // Need either reminders or session limit enabled to proceed
  if (!reminderEnabled && !hasSessionLimit) return null;

  const nudgeIntervalMinutes = domainSettings.nudgeIntervalMinutes ?? Constants.DEFAULT_NUDGE_INTERVAL_MINUTES;
  const { averageSeconds, daysWithData } = compute7DayStats(timeHistory, trackedTabDomain, currentDateStr);

  return {
    global,
    domainSettings,
    reminderEnabled,
    reminderThreshold: (domainSettings.reminderThreshold || 0) * 60,
    reminderInterval: domainSettings.reminderInterval || 15,
    nudgeIntervalMinutes,
    averageSeconds,
    daysWithData,
    timeInSeconds: todaysTotalTimeInActiveDomain,
    sessionLimitSeconds: hasSessionLimit ? (domainSettings.sessionLimit || 0) * 60 : 0,
    cooldownIncrementSeconds: hasSessionLimit ? (domainSettings.cooldownIncrement || 0) * 60 : 0
  };
}

function checkSessionStart(_settings: InterventionSettings): void {
  if (!trackedTabDomain) return;
  if (interventionState.sessionStartShown[trackedTabDomain]) return;

  // Fire on the first tick where sessionStartShown is unset for this domain.
  // Resets only on day rollover — so once per day per domain, not once per tab switch.
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

const AVERAGE_POPUP_MIN_DAYS = 4; // require at least this many days of history

function checkAveragePopup(settings: InterventionSettings): void {
  const { averageSeconds, daysWithData, timeInSeconds } = settings;

  if (!trackedTabDomain) return;
  if (averageSeconds === 0) return;
  if (daysWithData < AVERAGE_POPUP_MIN_DAYS) return;
  if (interventionState.averagePopupShown[trackedTabDomain]) return;

  const averagePopupThreshold = Math.round(averageSeconds * 0.8);
  if (timeInSeconds < averagePopupThreshold) return;

  interventionState.averagePopupShown[trackedTabDomain] = true;

  const minutesLeft = Math.round((averageSeconds - timeInSeconds) / 60);
  const averageMinutes = Math.round(averageSeconds / 60);
  sendAveragePopup(Math.max(0, minutesLeft), averageMinutes);
  console.log(`Average popup shown at ${Math.round(timeInSeconds / 60)}min (80% of avg: ${Math.round(averageSeconds / 60)}min)`);
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

function sendBlockerToAllTabsOfDomain(domain: Domain, remainingSeconds: number, totalSeconds: number, cooldownCount: number, cooldownIncrementMinutes: number): void {
  const message = {
    type: 'SHOW_BLOCKER' as const,
    cooldownRemainingSeconds: remainingSeconds,
    totalCooldownSeconds: totalSeconds,
    cooldownCount,
    cooldownIncrementMinutes
  };

  trackedTabIds.forEach(tabId => {
    browser.tabs.get(tabId).then(tab => {
      if (tab.url && extractDomain(tab.url) === domain) {
        browser.tabs.sendMessage(tabId, message).catch(() => {});
      }
    }).catch(() => {});
  });
}

function sendHideBlockerToAllTabsOfDomain(domain: Domain): void {
  const message = { type: 'HIDE_BLOCKER' as const };

  trackedTabIds.forEach(tabId => {
    browser.tabs.get(tabId).then(tab => {
      if (tab.url && extractDomain(tab.url) === domain) {
        browser.tabs.sendMessage(tabId, message).catch(() => {});
      }
    }).catch(() => {});
  });
}

function startCooldownTicker(domain: Domain, totalCooldownSeconds: number, sessionNum: number, cooldownIncrementMinutes: number): void {
  if (cooldownTickers[domain]) {
    clearInterval(cooldownTickers[domain]);
  }

  cooldownTickers[domain] = setInterval(() => {
    const endTime = cooldownEndTime[domain] || 0;
    const remaining = Math.ceil((endTime - Date.now()) / 1000);

    if (remaining <= 0) {
      clearInterval(cooldownTickers[domain]);
      delete cooldownTickers[domain];
      delete cooldownEndTime[domain];
      sendHideBlockerToAllTabsOfDomain(domain);
      console.log(`Cooldown expired for ${domain}`);
    } else {
      sendBlockerToAllTabsOfDomain(domain, remaining, totalCooldownSeconds, sessionNum, cooldownIncrementMinutes);
    }
  }, 1000);
}

function checkSessionLimit(settings: InterventionSettings): boolean {
  const { sessionLimitSeconds, cooldownIncrementSeconds } = settings;
  if (sessionLimitSeconds <= 0 || !trackedTabDomain) return false;

  const domain = trackedTabDomain;

  // Defensive: if a cooldown is already active, the incrementTimer() gate
  // should have prevented us from getting here at all, but return true to
  // short-circuit any other intervention work just in case.
  if ((cooldownEndTime[domain] || 0) > Date.now()) return true;

  // Lazily initialize the next boundary for this domain. This runs once on
  // the first tick after a domain switch / extension load / settings change.
  if (nextSessionBoundary[domain] === undefined) {
    nextSessionBoundary[domain] = computeNextBoundary(todaysTotalTimeInActiveDomain, sessionLimitSeconds);
  }

  if (todaysTotalTimeInActiveDomain < nextSessionBoundary[domain]) return false;

  const sessionNum = Math.round(nextSessionBoundary[domain] / sessionLimitSeconds);
  // Escalating cooldown: session 1 = 1× increment, session 2 = 2×, etc.
  // Fallback to sessionLimitSeconds only if no increment is configured at all.
  const cooldownSeconds = cooldownIncrementSeconds > 0
    ? sessionNum * cooldownIncrementSeconds
    : sessionLimitSeconds;
  const incrementMinutes = Math.round(cooldownIncrementSeconds / 60);

  cooldownEndTime[domain] = Date.now() + cooldownSeconds * 1000;
  nextSessionBoundary[domain] += sessionLimitSeconds;

  sendBlockerToAllTabsOfDomain(domain, cooldownSeconds, cooldownSeconds, sessionNum, incrementMinutes);
  startCooldownTicker(domain, cooldownSeconds, sessionNum, incrementMinutes);
  console.log(
    `Session ${sessionNum} limit reached for ${domain} ` +
    `(daily=${todaysTotalTimeInActiveDomain}s, cooldown=${cooldownSeconds}s, ` +
    `nextBoundary=${nextSessionBoundary[domain]}s)`
  );
  return true;
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

function sendAveragePopup(minutesLeft: number, averageMinutes: number): void {
  if (!activeTabId) return;

  browser.tabs.sendMessage(activeTabId, {
    type: 'SHOW_AVERAGE_POPUP',
    minutesLeft,
    averageMinutes
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
