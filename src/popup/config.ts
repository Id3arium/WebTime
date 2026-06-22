export const CONFIG = {
  movingAverageDays: 7,
  daysToDisplay: 30,
  initAnimationDuration: 600,
  topDomainsLimit: 6,
  scalingPower: 1.0  // x^1.0 — linear bars; decrease toward 0.5 to compress tall bars
};

// Redesign palette. Bars use a top→bottom gradient (lighter #5e8efb → deeper
// #3f6fe0); the moving-average line is a thin, light periwinkle so it reads as
// the same blue family but clearly stands apart from the bars.
export const CHART_COLORS = {
  barTop:    '#5e8efb',
  barBottom: '#3f6fe0',
  avgLine:   '#bcd2ff',
  grid:      'rgba(255, 255, 255, 0.05)',  // faint, matches the design's gridlines
  axisText:  '#5d646f',
  axisTitle: '#9aa1ac',
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
    background: CHART_COLORS.avgLine,
    border: CHART_COLORS.avgLine,
    width: 1.6
  },
  currentDomain: {
    // background is set per-build as a scriptable gradient (see chart-builder);
    // this flat value is only a pre-paint fallback before the chart area exists.
    background: CHART_COLORS.barTop,
    border: 'transparent'
  },
  tooltipBackground: 'rgba(0, 0, 0, 0.55)',
} as const;

export const ViewState = {
  GENERAL: 'general',
  DETAIL: 'detail'
} as const;

export type ViewStateType = typeof ViewState[keyof typeof ViewState];
