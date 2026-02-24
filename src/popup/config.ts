export const CONFIG = {
  movingAverageDays: 7,
  daysToDisplay: 30,
  initAnimationDuration: 600,
  topDomainsLimit: 6,
  scalingPower: 0.7  // x^0.7 — increase toward 1.0 for more linear, decrease toward 0.5 for more compression
} as const;

export const COLORS = {
  domains: [
    'rgba(69, 113, 231, 0.7)',
    'rgba(255, 159, 64, 0.7)',
    'rgba(255, 99, 132, 0.7)',
    'rgba(75, 192, 192, 0.7)',
    'rgba(153, 102, 255, 0.7)',
    'rgba(255, 205, 86, 0.7)',
  ],
  others: 'rgba(199, 199, 199, 0.7)',
  movingAverage: {
    background: 'rgba(50, 100, 255, 0.7)',
    border: 'rgba(75, 150, 255, 0.7)',
    width: 2
  },
  currentDomain: {
    background: 'rgba(69, 113, 231, 0.7)',
    border: 'rgba(69, 113, 231)'
  },
  tooltipBackground: 'rgba(0, 0, 0, 0.35)',
} as const;

export const ViewState = {
  GENERAL: 'general',
  DETAIL: 'detail'
} as const;

export type ViewStateType = typeof ViewState[keyof typeof ViewState];
