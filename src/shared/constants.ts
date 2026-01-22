import type { ConstantsType, OverlayDurations, ChartConfig, Colors } from '../types.js';

const OVERLAY_DURATIONS: OverlayDurations = {
  NUDGE_MS: 1000,
  REMINDER_DISPLAY_MS: 21000
};

const CHART_CONFIG: ChartConfig = {
  movingAverageDays: 7,
  daysToDisplay: 30,
  initAnimationDuration: 600,
  topDomainsLimit: 7
};

const COLORS: Colors = {
  domains: [
    'rgba(69, 113, 231, 0.7)',
    'rgba(255, 99, 132, 0.7)',
    'rgba(255, 205, 86, 0.7)',
    'rgba(75, 192, 192, 0.7)',
    'rgba(153, 102, 255, 0.7)',
    'rgba(255, 159, 64, 0.7)',
    'rgba(199, 199, 199, 0.7)',
  ],
  others: 'rgba(150, 150, 150, 0.5)',
  movingAverage: {
    background: 'rgba(50, 100, 255, 0.7)',
    border: 'rgba(75, 150, 255, 0.7)',
    width: 2
  },
  currentDomain: {
    background: 'rgba(69, 113, 231, 0.7)',
    border: 'rgba(69, 113, 231)'
  }
};

export const Constants: ConstantsType = {
  PHI: (1 + Math.sqrt(5)) / 2,
  INACTIVITY_THRESHOLD_MS: 10000,
  ACTIVITY_CHECK_INTERVAL_MS: 1000,
  SAVE_INTERVAL_SECONDS: 30,
  OVERLAY_DURATIONS,
  CHART_CONFIG,
  COLORS
};

export default Constants;
