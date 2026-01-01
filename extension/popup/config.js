const CONFIG = {
  movingAverageDays: 7,
  daysToDisplay: 30,  // Window size - how many days to show at once
  initAnimationDuration: 600,
  topDomainsLimit: 6
};

const COLORS = {
  domains: [
    'rgba(69, 113, 231, 0.7)',   // Blue
    'rgba(255, 159, 64, 0.7)',   // Orange
    'rgba(255, 99, 132, 0.7)',   // Red
    'rgba(75, 192, 192, 0.7)',   // Teal
    'rgba(153, 102, 255, 0.7)',  // Purple
    'rgba(255, 205, 86, 0.7)',   // Yellow
  ],
  others: 'rgba(199, 199, 199, 0.7)',  // Light Grey
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
};

const ViewState = {
  GENERAL: 'general',
  DETAIL: 'detail'
};
