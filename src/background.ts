import { Constants } from './shared/constants.js';
import { extractDomain, getLocalDateStr, log, compute7DayStats } from './shared/utils.js';
import {
  nextBoundary,
  computeTimerDisplay,
  endSessionEarly as computeEndSessionEarly,
  naturalCooldown,
  computePhiNudgeTimes,
  computeGraceSeconds,
  isInWindDown,
} from './shared/session-math.js';
import type {
  TimeHistory,
  Domain,
  DateString,
  InterventionState,
  InterventionSettings,
  WebTimeSettings,
  ExtensionMessage,
  SessionStartStats
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
const ACTIVITY_CHECK_INTERVAL_MS = Constants.ACTIVITY_CHECK_INTERVAL_MS;

let currentDateStr: DateString = getLocalDateStr();
let timeHistory: TimeHistory = {};
let dayResetTime = 0;
let isSaving = false;

let interventionState: InterventionState = {
  lastNudgeTime: {},
  averagePopupShown: {}
};

// Session limit state — derived from todaysTotalTimeInActiveDomain, not a parallel counter.
// nextSessionBoundary[domain] = the absolute daily-seconds threshold at which the next
// session boundary will fire for that domain. Trigger is `>=` so missed ticks are safe.
// cooldownEndTime[domain] = ms epoch when the active cooldown ends (absent = not in cooldown).
// cooldownTickers[domain] = the 1s setInterval that drives the blocker countdown UI.
const nextSessionBoundary: Record<Domain, number> = {};
// Extra seconds added to the *current* session because the previous session
// ended early. The current session's effective length is (baseLimit + carryover).
// Cleared when a normal cooldown fires (next session is aligned again) or on
// day rollover / domain switch / settings change.
const carryoverSeconds: Record<Domain, number> = {};
const cachedDomainSessionLimit: Record<Domain, { sessionLimitSeconds: number }> = {};
const cooldownEndTime: Record<Domain, number> = {};
const cooldownTickers: Record<Domain, ReturnType<typeof setInterval>> = {};

// Grace period: seconds earned from ending a session early, used at the next boundary
const graceSeconds: Record<Domain, number> = {};
// Whether grace was auto-applied to the current session (prevents compounding)
const graceAppliedThisSession: Record<Domain, boolean> = {};
// Which phi nudge times (session-relative) have already fired this session
const phiNudgeFired: Record<Domain, Set<number>> = {};
// Whether the wind-down overlay is currently active for a domain
const windDownActive: Record<Domain, boolean> = {};

// Cache previous intervention settings per domain to detect actual changes
const previousInterventionSettings: Record<Domain, string> = {};

// True while the end-session-early confirmation popup is open on any tab.
// Freezes the timer (no daily increment) so the user has time to decide.
let endSessionConfirmOpen = false;

// nextBoundary moved to shared/session-math.ts as `nextBoundary`

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

  // End-session confirmation popup is open — freeze daily count so the
  // displayed remaining/elapsed time stays put while the user decides.
  if (endSessionConfirmOpen) return;

  todaysTotalTimeInActiveDomain++;

  const newDateStr = getLocalDateStrWithReset();
  if (newDateStr !== currentDateStr) {
    saveTimeData();
    currentDateStr = newDateStr;
    todaysTotalTimeInActiveDomain = 0;
    interventionState = {
      lastNudgeTime: {},
      averagePopupShown: {}
    };
    // Reset session limit state on day rollover
    clearAllCooldowns();
    for (const domain of Object.keys(nextSessionBoundary)) delete nextSessionBoundary[domain];
    for (const domain of Object.keys(carryoverSeconds)) delete carryoverSeconds[domain];
    for (const domain of Object.keys(graceSeconds)) delete graceSeconds[domain];
    for (const domain of Object.keys(phiNudgeFired)) delete phiNudgeFired[domain];
    for (const domain of Object.keys(windDownActive)) delete windDownActive[domain];
    for (const domain of Object.keys(graceAppliedThisSession)) delete graceAppliedThisSession[domain];
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
  const message: { type: string; time: number; sessionTime?: number; sessionLimitSeconds?: number; sessionNum?: number } = {
    type: "TIME_UPDATE",
    time: updatedTime
  };

  if (trackedTabDomain) {
    const data = cachedDomainSessionLimit[trackedTabDomain];
    const baseLimitSec = data?.sessionLimitSeconds || 0;
    if (baseLimitSec > 0) {
      const boundary = nextSessionBoundary[trackedTabDomain] ?? nextBoundary(updatedTime, baseLimitSec);
      const carryover = carryoverSeconds[trackedTabDomain] || 0;
      const display = computeTimerDisplay({
        dailyTotal: updatedTime,
        baseLimit: baseLimitSec,
        boundary,
        carryover,
      });
      message.sessionTime = display.sessionTime;
      message.sessionLimitSeconds = display.sessionLimitSeconds;
      message.sessionNum = Math.round((boundary - carryover) / baseLimitSec);
      console.log(
        `[timer] domain=${trackedTabDomain} daily=${updatedTime}s ` +
        `boundary=${boundary}s base=${baseLimitSec}s carryover=${carryover}s ` +
        `effLimit=${display.sessionLimitSeconds}s sessionTime=${display.sessionTime}s ` +
        `→ remaining=${display.remaining}s`
      );
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
  // NOTE: We deliberately do NOT clear nextSessionBoundary or carryoverSeconds
  // here. The previous version cleared them on every domain switch to handle
  // settings changes made for an inactive domain — but that wiped legitimate
  // mid-cooldown carryover state when the user briefly switched away and back.
  // Settings changes are now handled directly in the SETTINGS_UPDATED handler,
  // which clears the relevant state for the changed domain. So domain switches
  // can safely preserve session/cooldown state across tabs of the same domain.
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

  if (message.type === "END_SESSION_EARLY") {
    void endSessionEarly();
  }

  if (message.type === "END_SESSION_CONFIRM_OPEN") {
    endSessionConfirmOpen = true;
  }

  if (message.type === "END_SESSION_CONFIRM_CLOSE") {
    endSessionConfirmOpen = false;
  }

  // A tab is asking for the current blocker state — typically on visibilitychange
  // after waking from a discarded/hidden state. Respond with SHOW or HIDE so the
  // tab's UI matches reality (it may have missed the original HIDE_BLOCKER while
  // suspended).
  if (message.type === "REQUEST_BLOCKER_STATE" && sender.tab?.id && sender.tab?.url) {
    const tabId = sender.tab.id;
    const domain = extractDomain(sender.tab.url);
    if (domain) {
      const endTime = cooldownEndTime[domain] || 0;
      if (endTime > Date.now()) {
        const remaining = Math.ceil((endTime - Date.now()) / 1000);
        browser.tabs.sendMessage(tabId, {
          type: 'SHOW_BLOCKER',
          cooldownRemainingSeconds: remaining,
          totalCooldownSeconds: remaining,
          cooldownCount: 1,
          cooldownIncrementMinutes: 0
        }).catch(() => {});
      } else {
        browser.tabs.sendMessage(tabId, { type: 'HIDE_BLOCKER' }).catch(() => {});
      }
    }
  }


  if (message.type === "SETTINGS_UPDATED") {
    browser.storage.local.get('webTimeSettings').then(data => {
      const settings: WebTimeSettings = data.webTimeSettings || { global: {}, domains: {} };

      inactivityThresholdMs = (settings.global?.inactivityTimeoutS ?? 30) * 1000;
      console.log(`Inactivity threshold: ${inactivityThresholdMs}ms`);

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

      // For every domain that we have prior fingerprints for OR for the
      // currently tracked domain, detect actual changes. Only reset session
      // state for domains whose intervention settings *actually* changed.
      const allDomainsToCheck = new Set<Domain>([
        ...Object.keys(previousInterventionSettings),
        ...(trackedTabDomain ? [trackedTabDomain] : []),
      ]);

      for (const domain of allDomainsToCheck) {
        const domainCfg = settings.domains?.[domain];
        const fingerprint = JSON.stringify({
          sessionLimitEnabled: domainCfg?.sessionLimitEnabled,
          sessionLimit: domainCfg?.sessionLimit,
          cooldownIncrement: domainCfg?.cooldownIncrement
        });
        const prev = previousInterventionSettings[domain];
        const settingsActuallyChanged = prev !== undefined && prev !== fingerprint;
        previousInterventionSettings[domain] = fingerprint;

        if (!settingsActuallyChanged) continue;

        // Recompute boundary anchored to current daily total + new limit.
        // Drop carryover (it was relative to old limit). Only for the active
        // domain do we need the live boundary cached; for inactive domains,
        // wiping the boundary is fine — checkSessionLimit will recompute when
        // the user returns to that domain.
        delete carryoverSeconds[domain];
        const slEnabled = domainCfg?.sessionLimitEnabled || false;
        const newLimitSeconds = slEnabled ? (domainCfg?.sessionLimit || 0) * 60 : 0;
        // Update the cached session limit so updateTimerDisplay uses the new value
        cachedDomainSessionLimit[domain] = { sessionLimitSeconds: newLimitSeconds };
        if (newLimitSeconds > 0 && domain === trackedTabDomain) {
          nextSessionBoundary[domain] = nextBoundary(
            todaysTotalTimeInActiveDomain,
            newLimitSeconds
          );
          console.log(
            `Session boundary recomputed for ${domain}: ` +
            `next trigger at ${nextSessionBoundary[domain]}s ` +
            `(daily=${todaysTotalTimeInActiveDomain}s, limit=${newLimitSeconds}s)`
          );
        } else {
          delete nextSessionBoundary[domain];
        }
        console.log(`Intervention settings changed for ${domain}, session state reset`);
      }
    });
  }
}

async function checkForInterventions(): Promise<void> {
  if (!trackedTabDomain || !activeTabId) return;

  const settings = await loadInterventionSettings();
  if (!settings) return;

  checkWindDown(settings);
  if (checkSessionLimit(settings)) return;

  checkPhiNudges(settings);
  checkAveragePopup(settings);
}

async function loadInterventionSettings(): Promise<InterventionSettings | null> {
  if (!trackedTabDomain) return null;

  const data = await browser.storage.local.get('webTimeSettings');
  const settings: WebTimeSettings = data.webTimeSettings || { global: {}, domains: {} };
  const global = settings.global || {};
  const domainSettings = settings.domains?.[trackedTabDomain] || {};

  const sessionLimitEnabled = domainSettings.sessionLimitEnabled || false;
  const hasSessionLimit = sessionLimitEnabled && (domainSettings.sessionLimit || 0) > 0;

  // Cache session limit for timer display (even when returning null)
  cachedDomainSessionLimit[trackedTabDomain] = {
    sessionLimitSeconds: hasSessionLimit ? (domainSettings.sessionLimit || 0) * 60 : 0
  };

  const { averageSeconds, daysWithData } = compute7DayStats(timeHistory, trackedTabDomain, currentDateStr);

  return {
    global,
    domainSettings,
    averageSeconds,
    daysWithData,
    timeInSeconds: todaysTotalTimeInActiveDomain,
    sessionLimitSeconds: hasSessionLimit ? (domainSettings.sessionLimit || 0) * 60 : 0,
    cooldownIncrementSeconds: hasSessionLimit ? (domainSettings.cooldownIncrement || 0) * 60 : 0
  };
}

function checkPhiNudges(settings: InterventionSettings): void {
  const { sessionLimitSeconds } = settings;
  if (sessionLimitSeconds <= 0 || !trackedTabDomain) return;

  const domain = trackedTabDomain;
  const boundary = nextSessionBoundary[domain] ?? nextBoundary(todaysTotalTimeInActiveDomain, sessionLimitSeconds);
  const carryover = carryoverSeconds[domain] || 0;
  const display = computeTimerDisplay({
    dailyTotal: todaysTotalTimeInActiveDomain,
    baseLimit: sessionLimitSeconds,
    boundary,
    carryover,
  });

  const nudgeTimes = computePhiNudgeTimes(display.sessionLimitSeconds, settings.domainSettings.nudgeCount);
  if (!phiNudgeFired[domain]) phiNudgeFired[domain] = new Set();

  for (const nudgeTime of nudgeTimes) {
    if (display.sessionTime === nudgeTime && !phiNudgeFired[domain].has(nudgeTime)) {
      sendNudge();
      phiNudgeFired[domain].add(nudgeTime);
      console.log(`φ-nudge at ${Math.round(nudgeTime / 60)}min into session (${display.remaining}s remaining)`);
      break;
    }
  }
}

const AVERAGE_POPUP_MIN_DAYS = 4; // require at least this many days of history

function persistAveragePopupShown(): void {
  browser.storage.local.set({
    webTimeAveragePopupShown: {
      date: currentDateStr,
      domains: interventionState.averagePopupShown
    }
  });
}

async function loadAveragePopupShown(): Promise<void> {
  const data = await browser.storage.local.get('webTimeAveragePopupShown');
  const stored = data.webTimeAveragePopupShown;
  if (stored && stored.date === currentDateStr && stored.domains) {
    interventionState.averagePopupShown = stored.domains;
  }
}

function checkAveragePopup(settings: InterventionSettings): void {
  const { averageSeconds, daysWithData, timeInSeconds } = settings;

  if (!trackedTabDomain) return;
  if (averageSeconds === 0) return;
  if (daysWithData < AVERAGE_POPUP_MIN_DAYS) return;
  if (interventionState.averagePopupShown[trackedTabDomain]) return;

  const averagePopupThreshold = Math.round(averageSeconds * 0.8);
  if (timeInSeconds < averagePopupThreshold) return;

  interventionState.averagePopupShown[trackedTabDomain] = true;
  persistAveragePopupShown();

  const minutesLeft = Math.round((averageSeconds - timeInSeconds) / 60);
  const averageMinutes = Math.round(averageSeconds / 60);
  const stats = compute7DayStats(timeHistory, trackedTabDomain, currentDateStr);
  sendAveragePopup(Math.max(0, minutesLeft), averageMinutes, stats);
  console.log(`Average popup shown at ${Math.round(timeInSeconds / 60)}min (80% of avg: ${Math.round(averageSeconds / 60)}min)`);
}

function sendMessageToAllTabsOfDomain(domain: Domain, message: Record<string, unknown>): void {
  trackedTabIds.forEach(tabId => {
    browser.tabs.get(tabId).then(tab => {
      if (tab.url && extractDomain(tab.url) === domain) {
        browser.tabs.sendMessage(tabId, message).catch(() => {});
      }
    }).catch(() => {});
  });
}

function checkWindDown(settings: InterventionSettings): void {
  const { sessionLimitSeconds } = settings;
  if (sessionLimitSeconds <= 0 || !trackedTabDomain) return;

  const domain = trackedTabDomain;
  if ((cooldownEndTime[domain] || 0) > Date.now()) return;

  const boundary = nextSessionBoundary[domain] ?? nextBoundary(todaysTotalTimeInActiveDomain, sessionLimitSeconds);
  const carryover = carryoverSeconds[domain] || 0;
  const display = computeTimerDisplay({
    dailyTotal: todaysTotalTimeInActiveDomain,
    baseLimit: sessionLimitSeconds,
    boundary,
    carryover,
  });

  const wd = isInWindDown(display.sessionTime, display.sessionLimitSeconds);

  if (wd.active && !windDownActive[domain]) {
    windDownActive[domain] = true;
    console.log(`Wind-down started for ${domain} (${wd.remaining}s remaining)`);
  }

  if (wd.active) {
    sendMessageToAllTabsOfDomain(domain, {
      type: 'SHOW_WIND_DOWN',
      progress: wd.progress,
      remainingSeconds: wd.remaining
    });
  } else if (windDownActive[domain]) {
    windDownActive[domain] = false;
    sendMessageToAllTabsOfDomain(domain, { type: 'HIDE_WIND_DOWN' });
  }
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
      delete phiNudgeFired[domain];
      delete windDownActive[domain];
      delete graceAppliedThisSession[domain];
      sendHideBlockerToAllTabsOfDomain(domain);
      sendMessageToAllTabsOfDomain(domain, { type: 'HIDE_WIND_DOWN' });
      // Push a fresh timer update so all tabs of this domain immediately show
      // the new session's full extended length (sessionTime=0, limit=base+carry).
      if (trackedTabDomain === domain) {
        updateTimerDisplay(todaysTotalTimeInActiveDomain);
      }
      console.log(`Cooldown expired for ${domain}`);
    } else {
      sendBlockerToAllTabsOfDomain(domain, remaining, totalCooldownSeconds, sessionNum, cooldownIncrementMinutes);
    }
  }, 1000);
}

/**
 * End the current session early. The unused time in the current session is
 * "carried over" so the next session lasts (limit + carryover) instead of
 * just limit. The cooldown that triggers now is for the current session
 * number — sessionNum doesn't change as a result of ending early.
 */
async function endSessionEarly(): Promise<void> {
  if (!trackedTabDomain) return;
  const domain = trackedTabDomain;

  // Don't end if already in cooldown
  if ((cooldownEndTime[domain] || 0) > Date.now()) return;

  const settings = await loadInterventionSettings();
  if (!settings) return;
  const { sessionLimitSeconds, cooldownIncrementSeconds } = settings;
  if (sessionLimitSeconds <= 0) return;

  if (nextSessionBoundary[domain] === undefined) {
    nextSessionBoundary[domain] = nextBoundary(todaysTotalTimeInActiveDomain, sessionLimitSeconds);
  }
  const priorCarryover = carryoverSeconds[domain] || 0;

  const result = computeEndSessionEarly({
    dailyTotal: todaysTotalTimeInActiveDomain,
    baseLimit: sessionLimitSeconds,
    boundary: nextSessionBoundary[domain],
    priorCarryover,
    cooldownIncrement: cooldownIncrementSeconds,
  });
  if (!result) return; // no carryover to claim — normal cooldown will fire

  const incrementMinutes = Math.round(cooldownIncrementSeconds / 60);

  cooldownEndTime[domain] = Date.now() + result.cooldownSeconds * 1000;
  nextSessionBoundary[domain] = result.newBoundary;
  carryoverSeconds[domain] = result.newCarryover;

  // Earn grace for the next session (only from ending early, not during a grace-extended session).
  // Grace scales with remaining time given up — ending early with 5 min left earns more than 10s left.
  if (!graceAppliedThisSession[domain]) {
    graceSeconds[domain] = computeGraceSeconds(result.newCarryover);
    console.log(`Grace earned for next session: ${graceSeconds[domain]}s (gave up ${result.newCarryover}s)`);
  }

  delete phiNudgeFired[domain];
  delete windDownActive[domain];
  delete graceAppliedThisSession[domain];

  sendMessageToAllTabsOfDomain(domain, { type: 'HIDE_WIND_DOWN' });
  sendBlockerToAllTabsOfDomain(domain, result.cooldownSeconds, result.cooldownSeconds, result.sessionNum, incrementMinutes);
  startCooldownTicker(domain, result.cooldownSeconds, result.sessionNum, incrementMinutes);
  updateTimerDisplay(todaysTotalTimeInActiveDomain);
  console.log(
    `Session ${result.sessionNum} ended early for ${domain} ` +
    `(daily=${todaysTotalTimeInActiveDomain}s, carryoverToNext=${result.newCarryover}s, ` +
    `cooldown=${result.cooldownSeconds}s, nextBoundary=${result.newBoundary}s)`
  );
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
    nextSessionBoundary[domain] = nextBoundary(todaysTotalTimeInActiveDomain, sessionLimitSeconds);
  }

  if (todaysTotalTimeInActiveDomain < nextSessionBoundary[domain]) return false;

  // Check if user has earned grace from a previous early end — auto-apply it
  // by silently extending the boundary. No prompt, no extra session.
  const grace = graceSeconds[domain] || 0;
  if (grace > 0) {
    nextSessionBoundary[domain] += grace;
    delete graceSeconds[domain];
    graceAppliedThisSession[domain] = true;
    // Hide wind-down since we're extending
    delete windDownActive[domain];
    sendMessageToAllTabsOfDomain(domain, { type: 'HIDE_WIND_DOWN' });
    updateTimerDisplay(todaysTotalTimeInActiveDomain);
    console.log(`Grace auto-applied for ${domain}: boundary extended by ${grace}s`);
    return false; // session continues — not at boundary yet
  }

  // No grace available — normal cooldown
  const priorCarryover = carryoverSeconds[domain] || 0;
  const result = naturalCooldown({
    baseLimit: sessionLimitSeconds,
    boundary: nextSessionBoundary[domain],
    priorCarryover,
    cooldownIncrement: cooldownIncrementSeconds,
  });
  const incrementMinutes = Math.round(cooldownIncrementSeconds / 60);

  cooldownEndTime[domain] = Date.now() + result.cooldownSeconds * 1000;
  delete carryoverSeconds[domain];
  delete phiNudgeFired[domain];
  delete windDownActive[domain];
  delete graceAppliedThisSession[domain];
  nextSessionBoundary[domain] = result.newBoundary;

  sendMessageToAllTabsOfDomain(domain, { type: 'HIDE_WIND_DOWN' });
  sendBlockerToAllTabsOfDomain(domain, result.cooldownSeconds, result.cooldownSeconds, result.sessionNum, incrementMinutes);
  startCooldownTicker(domain, result.cooldownSeconds, result.sessionNum, incrementMinutes);
  updateTimerDisplay(todaysTotalTimeInActiveDomain);
  console.log(
    `Session ${result.sessionNum} limit reached for ${domain} ` +
    `(daily=${todaysTotalTimeInActiveDomain}s, cooldown=${result.cooldownSeconds}s, ` +
    `nextBoundary=${result.newBoundary}s)`
  );
  return true;
}

function sendNudge(): void {
  if (!activeTabId) return;

  browser.tabs.sendMessage(activeTabId, {
    type: 'NUDGE'
  }).catch(err => console.warn('Failed to send nudge:', err));
}

function sendAveragePopup(minutesLeft: number, averageMinutes: number, stats: SessionStartStats): void {
  if (!activeTabId) return;

  browser.tabs.sendMessage(activeTabId, {
    type: 'SHOW_AVERAGE_POPUP',
    minutesLeft,
    averageMinutes,
    stats
  }).catch(err => console.warn('Failed to send average popup:', err));
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
  console.log(`Day reset time loaded: ${dayResetTime}:00`);
  console.log(`Inactivity threshold: ${inactivityThresholdMs}ms`);

  currentDateStr = getLocalDateStrWithReset();

  await loadTimeData();
  await loadAveragePopupShown();

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
