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
}

export interface DomainSettings {
  reminderEnabled?: boolean;
  reminderThreshold?: number; // Minutes
  reminderInterval?: number; // Minutes
  nudgeCount?: number; // Number of nudges before reminder
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
}

export interface InterventionSettings {
  global: GlobalSettings;
  domainSettings: DomainSettings;
  reminderEnabled: boolean;
  reminderThreshold: number; // In seconds
  reminderInterval: number; // In minutes
  timeInSeconds: number;
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

export type ExtensionMessage =
  | TimeUpdateMessage
  | ContentScriptReadyMessage
  | UserActiveMessage
  | SnoozeRemindersMessage
  | SettingsUpdatedMessage
  | NudgeMessage
  | ShowReminderMessage;

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
  PHI: number;
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
