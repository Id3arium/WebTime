import { Constants } from './shared/constants.js';
import { extractDomain, getLocalDateStr, log, compute7DayStats } from './shared/utils.js';
import {
  type ActiveSession,
  startSession,
  displayFor,
  naturalEnd,
  endEarly as computeEndEarly,
  changeLength,
  nextNudgeToFire,
  markNudgeFired,
  windDownState,
} from './shared/session-model.js';
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

// Session limit state.
//
// `sessions[domain]` is the single source of truth for the *current* session of
// that domain: its start anchor (daily seconds when it began), base length,
// carryover, grace, and which nudges have fired. All session math (remaining,
// nudges, wind-down) derives from it via the pure helpers in session-model.ts.
// A domain has no entry until its first session is started (lazily, on the
// first tick / settings change while it's the tracked domain).
const sessions: Record<Domain, ActiveSession> = {};

// Inter-session / UI state — deliberately NOT on the session object, since it
// describes the gap *between* sessions or transient overlay state:
//   cooldownEndTime[domain] = ms epoch when the active cooldown ends (absent = not in cooldown).
//   cooldownTickers[domain] = the 1s setInterval that drives the blocker countdown UI.
//   windDownActive[domain]  = whether the wind-down overlay is currently shown.
const cachedDomainSessionLimit: Record<Domain, { sessionLimitSeconds: number }> = {};
const cooldownEndTime: Record<Domain, number> = {};
const cooldownTickers: Record<Domain, ReturnType<typeof setInterval>> = {};
const windDownActive: Record<Domain, boolean> = {};

// Cache previous intervention settings per domain to detect actual changes
const previousInterventionSettings: Record<Domain, string> = {};

// True while the end-session-early confirmation popup is open on any tab.
// Freezes the timer (no daily increment) so the user has time to decide.
let endSessionConfirmOpen = false;

/**
 * Get the current session for a domain, lazily starting one anchored at the
 * current daily total if none exists yet. Runs on the first tick after a domain
 * switch / extension load / settings change. `baseLength` is the live limit in
 * seconds; callers only invoke this when baseLength > 0.
 */
function getOrStartSession(domain: Domain, dailyTotal: number, baseLength: number): ActiveSession {
  let s = sessions[domain];
  if (!s) {
    s = startSession({ dailyTotal, baseLength });
    sessions[domain] = s;
    saveSessionState(); // persist the freshly-started session (incl. its sessionNum)
  }
  return s;
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

// --- Session-state persistence -------------------------------------------
//
// In MV3 the background is a service worker that is killed on idle (and
// definitely on browser close), wiping all in-memory state. Without this,
// closing the browser (or just walking away during a cooldown) loses the
// session number, carryover, grace, and any in-progress cooldown — so the
// next visit starts at "session 1" again mid-day. We persist the current
// day's session objects + active cooldowns to storage.local and rehydrate on
// startup. Only the current day is stored (keyed by date); it's a few KB at
// most and is discarded automatically when the date no longer matches.
const SESSION_STATE_KEY = 'webTimeSessionState';

function saveSessionState(): void {
  // Only persist domains that actually have a session or a live cooldown.
  const activeCooldowns: Record<Domain, number> = {};
  for (const domain of Object.keys(cooldownEndTime)) {
    if ((cooldownEndTime[domain] || 0) > Date.now()) activeCooldowns[domain] = cooldownEndTime[domain];
  }
  browser.storage.local.set({
    [SESSION_STATE_KEY]: {
      date: currentDateStr,
      sessions,
      cooldownEndTime: activeCooldowns,
    },
  }).catch(err => console.warn('Failed to persist session state:', err));
}

async function loadSessionState(): Promise<void> {
  try {
    const data = await browser.storage.local.get(SESSION_STATE_KEY);
    const stored = data[SESSION_STATE_KEY];
    if (!stored || stored.date !== currentDateStr) return; // absent or stale (new day)

    if (stored.sessions) {
      for (const [domain, session] of Object.entries(stored.sessions)) {
        sessions[domain] = session as ActiveSession;
      }
    }

    // Re-arm any cooldown still in the future; drop expired ones.
    const settingsData = await browser.storage.local.get('webTimeSettings');
    const settings: WebTimeSettings = settingsData.webTimeSettings || { global: {}, domains: {} };
    for (const [domain, endTime] of Object.entries(stored.cooldownEndTime || {})) {
      if ((endTime as number) <= Date.now()) continue; // expired during downtime
      cooldownEndTime[domain] = endTime as number;
      // Reconstruct the blocker-UI args. The session stored for this domain is
      // the NEXT session (created when the cooldown fired), so the session that
      // is cooling down is sessionNum - 1.
      const nextSession = sessions[domain];
      const endedSessionNum = nextSession ? Math.max(1, nextSession.sessionNum - 1) : 1;
      const incrementSec = (settings.domains?.[domain]?.cooldownIncrement || 0) * 60;
      const totalCooldownSec = Math.ceil(((endTime as number) - Date.now()) / 1000);
      startCooldownTicker(domain, totalCooldownSec, endedSessionNum, incrementSec);
      console.log(`Rehydrated active cooldown for ${domain}: ${totalCooldownSec}s left`);
    }
    console.log(`Session state rehydrated for ${currentDateStr} (${Object.keys(sessions).length} domains)`);
  } catch (err) {
    console.warn('Failed to load session state:', err);
  }
}

function clearSessionState(): void {
  browser.storage.local.remove(SESSION_STATE_KEY).catch(() => {});
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
    // Reset session limit state on day rollover. The session object collapses
    // what used to be seven parallel maps into one delete.
    clearAllCooldowns();
    for (const domain of Object.keys(sessions)) delete sessions[domain];
    for (const domain of Object.keys(windDownActive)) delete windDownActive[domain];
    clearSessionState(); // drop persisted state for the old day
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
      const session = getOrStartSession(trackedTabDomain, updatedTime, baseLimitSec);
      const display = displayFor(session, updatedTime);
      message.sessionTime = display.sessionTime;
      message.sessionLimitSeconds = display.sessionLimitSeconds;
      message.sessionNum = session.sessionNum;
      console.log(
        `[timer] domain=${trackedTabDomain} daily=${updatedTime}s ` +
        `start=${session.startDaily}s base=${session.baseLength}s ` +
        `carryover=${session.carryover}s grace=${session.graceSeconds}s ` +
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
  // NOTE: We deliberately do NOT clear the session for this domain here. An
  // earlier version reset session state on every domain switch to handle
  // settings changes made for an inactive domain — but that wiped legitimate
  // mid-cooldown carryover/grace state when the user briefly switched away and
  // back. Settings changes are handled in the SETTINGS_UPDATED handler, which
  // touches only the changed domain. So domain switches safely preserve the
  // session object across tabs of the same domain.
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
            cooldownIncrementSeconds: 0
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
          cooldownIncrementSeconds: 0
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

        const slEnabled = domainCfg?.sessionLimitEnabled || false;
        const newLimitSeconds = slEnabled ? (domainCfg?.sessionLimit || 0) * 60 : 0;
        const cooldownIncrementSeconds = slEnabled ? (domainCfg?.cooldownIncrement || 0) * 60 : 0;
        cachedDomainSessionLimit[domain] = { sessionLimitSeconds: newLimitSeconds };

        if (newLimitSeconds <= 0) {
          // Session limit turned off — drop the session entirely.
          delete sessions[domain];
          delete windDownActive[domain];
          saveSessionState();
          continue;
        }

        if (domain !== trackedTabDomain) {
          // Inactive domain: don't mutate a live session it isn't running. Its
          // session (if any) re-derives lazily next time it becomes tracked.
          continue;
        }

        const existing = sessions[domain];
        if (!existing) {
          // No session yet — it'll start lazily on the next tick at the new limit.
          continue;
        }

        // Live length change. Anchored to startDaily, so elapsed time is
        // preserved: shrinking the limit by N shrinks remaining by N.
        const { session: updated, expired } = changeLength(existing, {
          dailyTotal: todaysTotalTimeInActiveDomain,
          newBaseLength: newLimitSeconds,
        });
        sessions[domain] = updated;

        if (expired) {
          // The new (shorter) limit puts the user at/past the end → end now.
          // Treat it as a natural end of the (now-expired) session.
          const result = naturalEnd(updated, {
            dailyTotal: todaysTotalTimeInActiveDomain,
            cooldownIncrement: cooldownIncrementSeconds,
          });
          fireCooldown(domain, result.nextSession, result.cooldownSeconds, cooldownIncrementSeconds, updated.sessionNum);
          console.log(
            `Session limit shrunk past elapsed for ${domain}: session ended immediately ` +
            `(daily=${todaysTotalTimeInActiveDomain}s, newLimit=${newLimitSeconds}s)`
          );
        } else {
          saveSessionState(); // persist the live-resized session
          const display = displayFor(updated, todaysTotalTimeInActiveDomain);
          updateTimerDisplay(todaysTotalTimeInActiveDomain);
          console.log(
            `Session limit changed for ${domain}: ` +
            `effLimit=${display.sessionLimitSeconds}s remaining=${display.remaining}s ` +
            `(daily=${todaysTotalTimeInActiveDomain}s, base=${newLimitSeconds}s, ` +
            `carryover=${updated.carryover}s, grace=${updated.graceSeconds}s)`
          );
        }
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
  const session = getOrStartSession(domain, todaysTotalTimeInActiveDomain, sessionLimitSeconds);

  // Catch-up selection: the latest unfired nudge at/before now. Robust to both
  // skipped ticks and live length changes — a nudge that moved behind us after a
  // shrink just fires once here.
  const nudgeTime = nextNudgeToFire(session, todaysTotalTimeInActiveDomain, settings.domainSettings.nudgeCount);
  if (nudgeTime !== null) {
    sendNudge();
    sessions[domain] = markNudgeFired(session, nudgeTime);
    saveSessionState(); // persist firedNudges so a restart doesn't re-fire
    const remaining = displayFor(sessions[domain], todaysTotalTimeInActiveDomain).remaining;
    console.log(`φ-nudge at ${Math.round(nudgeTime / 60)}min into session (${remaining}s remaining)`);
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
  const { averageSeconds, daysWithData, timeInSeconds, sessionLimitSeconds } = settings;

  if (!trackedTabDomain) return;
  if (sessionLimitSeconds <= 0) return;
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

  const session = getOrStartSession(domain, todaysTotalTimeInActiveDomain, sessionLimitSeconds);
  const wd = windDownState(session, todaysTotalTimeInActiveDomain);

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


function sendBlockerToAllTabsOfDomain(domain: Domain, remainingSeconds: number, totalSeconds: number, cooldownCount: number, cooldownIncrementSeconds: number): void {
  const message = {
    type: 'SHOW_BLOCKER' as const,
    cooldownRemainingSeconds: remainingSeconds,
    totalCooldownSeconds: totalSeconds,
    cooldownCount,
    cooldownIncrementSeconds
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

function startCooldownTicker(domain: Domain, totalCooldownSeconds: number, sessionNum: number, cooldownIncrementSeconds: number): void {
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
      delete windDownActive[domain];
      saveSessionState(); // cooldown cleared — persist so a restart doesn't re-arm it
      // The next session was already created when the cooldown was fired and
      // anchored at the daily total of that moment — nothing to start here.
      sendHideBlockerToAllTabsOfDomain(domain);
      sendMessageToAllTabsOfDomain(domain, { type: 'HIDE_WIND_DOWN' });
      // Push a fresh timer update so all tabs of this domain immediately show
      // the new session's full extended length (sessionTime=0, limit=base+carry).
      if (trackedTabDomain === domain) {
        updateTimerDisplay(todaysTotalTimeInActiveDomain);
      }
      console.log(`Cooldown expired for ${domain}`);
    } else {
      sendBlockerToAllTabsOfDomain(domain, remaining, totalCooldownSeconds, sessionNum, cooldownIncrementSeconds);
    }
  }, 1000);
}

/**
 * Begin a cooldown for `domain`: store the next session, start the blocker UI
 * countdown, and notify all tabs. `nextSession` is the session the user enters
 * once the cooldown expires (already anchored at the current daily total).
 * `endedSessionNum` is the number of the session that just ended — it drives the
 * blocker's displayed count. Shared by natural end, early end, and shrink-past.
 */
function fireCooldown(
  domain: Domain,
  nextSession: ActiveSession,
  cooldownSeconds: number,
  cooldownIncrementSeconds: number,
  endedSessionNum: number
): void {
  cooldownEndTime[domain] = Date.now() + cooldownSeconds * 1000;
  sessions[domain] = nextSession;
  delete windDownActive[domain];
  saveSessionState(); // persist new session number + active cooldown

  sendMessageToAllTabsOfDomain(domain, { type: 'HIDE_WIND_DOWN' });
  sendBlockerToAllTabsOfDomain(domain, cooldownSeconds, cooldownSeconds, endedSessionNum, cooldownIncrementSeconds);
  startCooldownTicker(domain, cooldownSeconds, endedSessionNum, cooldownIncrementSeconds);
  updateTimerDisplay(todaysTotalTimeInActiveDomain);
}

/**
 * End the current session early. The unused time is "carried over" so the next
 * session lasts (limit + carryover), and 10% of it is earned as grace baked
 * into that next session. The cooldown is for the session that just ended.
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

  const session = getOrStartSession(domain, todaysTotalTimeInActiveDomain, sessionLimitSeconds);

  const result = computeEndEarly(session, {
    dailyTotal: todaysTotalTimeInActiveDomain,
    cooldownIncrement: cooldownIncrementSeconds,
  });
  if (!result) return; // no time left to claim — normal cooldown will fire on its own

  fireCooldown(domain, result.nextSession, result.cooldownSeconds, cooldownIncrementSeconds, session.sessionNum);
  console.log(
    `Session ${session.sessionNum} ended early for ${domain} ` +
    `(daily=${todaysTotalTimeInActiveDomain}s, carryoverToNext=${result.nextSession.carryover}s, ` +
    `graceEarned=${result.graceEarned}s, cooldown=${result.cooldownSeconds}s)`
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

  // Lazily start the session for this domain. Runs once on the first tick after
  // a domain switch / extension load / settings change.
  const session = getOrStartSession(domain, todaysTotalTimeInActiveDomain, sessionLimitSeconds);

  // Not at the end yet → session continues. Grace and carryover are already
  // baked into the session's effective length, so there's no mid-session
  // "extend the boundary" step anymore.
  if (displayFor(session, todaysTotalTimeInActiveDomain).remaining > 0) return false;

  // Reached the end — natural cooldown. Carryover is consumed; next session is
  // a clean baseLength session anchored at the current daily total.
  const result = naturalEnd(session, {
    dailyTotal: todaysTotalTimeInActiveDomain,
    cooldownIncrement: cooldownIncrementSeconds,
  });

  fireCooldown(domain, result.nextSession, result.cooldownSeconds, cooldownIncrementSeconds, session.sessionNum);
  console.log(
    `Session ${session.sessionNum} limit reached for ${domain} ` +
    `(daily=${todaysTotalTimeInActiveDomain}s, cooldown=${result.cooldownSeconds}s, ` +
    `nextSession=${result.nextSession.sessionNum})`
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
  await loadSessionState(); // rehydrate session numbers / cooldowns after a worker restart

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
