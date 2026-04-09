// ============================================
// WebTime Type Definitions
// ============================================

// Browser API types (Firefox WebExtensions)
declare const browser: typeof chrome;

// ============================================
// Time Tracking Data Structures
// ============================================

/** Date string in YYYY-MM-DD format */
export type DateString = string;

/** Domain name (e.g., "youtube.com") */
export type Domain = string;

/** Time history: date -> domain -> seconds */
export type TimeHistory = Record<DateString, Record<Domain, number>>;

/** Stored time data format */
export interface TrackedTimeData {
  lastDate: DateString;
  timeHistory: TimeHistory;
  version: number;
}

/** Storage format for trackedTime key */
export interface StorageData {
  trackedTime?: TrackedTimeData;
  webTimeSettings?: WebTimeSettings;
}

// ============================================
// Settings
// ============================================

export interface GlobalSettings {
  dayResetTime?: number; // Hour when day resets (0-23)
  customMessage?: string; // Custom reminder message
  inactivityTimeoutS?: number; // Seconds before tab considered inactive (default: 30)
  popupDurationS?: number; // Seconds reminder popup stays visible (default: 10)
  scalingPower?: number; // Chart bar scaling power (default: 0.8, range 0.3-1.0)
}

export interface DomainSettings {
  reminderEnabled?: boolean;
  reminderThreshold?: number; // Minutes
  reminderInterval?: number; // Minutes
  nudgeIntervalMinutes?: number; // Minutes between linear nudges (default: 15)
  sessionLimit?: number; // Minutes — continuous usage before cooldown triggers
  cooldownIncrement?: number; // Minutes — each successive cooldown grows by this amount
}

export interface WebTimeSettings {
  global: GlobalSettings;
  domains: Record<Domain, DomainSettings>;
}

// ============================================
// Intervention System
// ============================================

export interface InterventionState {
  lastNudgeTime: Record<Domain, number>;
  lastReminderTime: Record<Domain, number>;
  snoozedUntil: Record<Domain, number | 'tomorrow'>;
  sessionStartShown: Record<Domain, boolean>; // reset on day rollover
  averagePopupShown: Record<Domain, boolean>;  // reset on day rollover
}

export interface SessionDayStat {
  date: DateString;
  seconds: number;
}

export interface SessionStartStats {
  days: SessionDayStat[];
  averageSeconds: number;
  daysWithData: number; // how many of the last 7 days had any usage
}

export interface InterventionSettings {
  global: GlobalSettings;
  domainSettings: DomainSettings;
  reminderEnabled: boolean;
  reminderThreshold: number; // In seconds
  reminderInterval: number; // In minutes
  nudgeIntervalMinutes: number;
  averageSeconds: number; // 7-day moving average in seconds (0 if no history)
  daysWithData: number; // days with usage in last 7 days
  timeInSeconds: number;
  sessionLimitSeconds: number; // 0 = disabled
  cooldownIncrementSeconds: number;
}

/** Tracks session limit cooldown state per domain (in-memory only, resets on restart) */
export interface SessionLimitState {
  /** Seconds of continuous usage in current session */
  continuousUsage: Record<Domain, number>;
  /** Timestamp (ms) when cooldown ends — 0 = not in cooldown */
  cooldownEndTime: Record<Domain, number>;
  /** Number of cooldowns triggered today (for escalation) */
  cooldownCount: Record<Domain, number>;
  /** Active setInterval IDs for cooldown countdown updates */
  cooldownIntervals: Record<Domain, ReturnType<typeof setInterval>>;
}

// ============================================
// Message Types (Background <-> Content Script)
// ============================================

export interface TimeUpdateMessage {
  type: 'TIME_UPDATE';
  time: number;
}

export interface ContentScriptReadyMessage {
  type: 'CONTENT_SCRIPT_READY';
}

export interface UserActiveMessage {
  type: 'USER_ACTIVE';
}

export interface SnoozeRemindersMessage {
  type: 'SNOOZE_REMINDERS';
  duration: number | 'tomorrow';
}

export interface SettingsUpdatedMessage {
  type: 'SETTINGS_UPDATED';
}

export interface NudgeMessage {
  type: 'NUDGE';
}

export interface ShowReminderMessage {
  type: 'SHOW_REMINDER';
  customMessage?: string;
  totalTime: string;
  duration: number;
}

export interface ShowSessionStartMessage {
  type: 'SHOW_SESSION_START';
  stats: SessionStartStats;
}

export interface ShowAveragePopupMessage {
  type: 'SHOW_AVERAGE_POPUP';
  minutesLeft: number;
  averageMinutes: number; // the actual 7-day average, for display
}

export interface ShowBlockerMessage {
  type: 'SHOW_BLOCKER';
  cooldownRemainingSeconds: number;
  totalCooldownSeconds: number;
  cooldownCount: number; // how many cooldowns triggered today
  cooldownIncrementMinutes: number; // the per-cooldown increment in minutes
}

export interface HideBlockerMessage {
  type: 'HIDE_BLOCKER';
}

export interface BlockerContinueMessage {
  type: 'BLOCKER_CONTINUE';
}

export type ExtensionMessage =
  | TimeUpdateMessage
  | ContentScriptReadyMessage
  | UserActiveMessage
  | SnoozeRemindersMessage
  | SettingsUpdatedMessage
  | NudgeMessage
  | ShowReminderMessage
  | ShowSessionStartMessage
  | ShowAveragePopupMessage
  | ShowBlockerMessage
  | HideBlockerMessage
  | BlockerContinueMessage;

// ============================================
// Chart Types
// ============================================

export interface DomainDataset {
  label: string;
  data: number[];
  backgroundColor: string;
  borderColor?: string;
  borderWidth?: number;
  borderRadius?: number;
}

export interface ChartDataset {
  labels: string[];
  datasets: DomainDataset[];
}

export interface ProcessedDayData {
  date: DateString;
  domains: Record<Domain, number>;
  total: number;
}

export interface DomainRanking {
  domain: Domain;
  totalSeconds: number;
  color: string;
}

// ============================================
// UI State
// ============================================

export type ViewMode = 'general' | 'detail';

export interface PopupState {
  currentView: ViewMode;
  selectedDomain: Domain | null;
  chartInstance: unknown | null; // Chart.js instance
}

// ============================================
// Constants Types
// ============================================

export interface OverlayDurations {
  NUDGE_MS: number;
  REMINDER_DISPLAY_MS: number;
}

export interface ChartConfig {
  movingAverageDays: number;
  daysToDisplay: number;
  initAnimationDuration: number;
  topDomainsLimit: number;
}

export interface MovingAverageColors {
  background: string;
  border: string;
  width: number;
}

export interface CurrentDomainColors {
  background: string;
  border: string;
}

export interface Colors {
  domains: string[];
  others: string;
  movingAverage: MovingAverageColors;
  currentDomain: CurrentDomainColors;
}

export interface ConstantsType {
  DEFAULT_NUDGE_INTERVAL_MINUTES: number;
  INACTIVITY_THRESHOLD_MS: number;
  ACTIVITY_CHECK_INTERVAL_MS: number;
  SAVE_INTERVAL_SECONDS: number;
  OVERLAY_DURATIONS: OverlayDurations;
  CHART_CONFIG: ChartConfig;
  COLORS: Colors;
}

// Chart.js types (simplified for this project)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ChartInstance = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ChartConfiguration = any;
