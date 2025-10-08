const Constants = {
  // Timing thresholds
  INACTIVITY_THRESHOLD_MS: 6000,
  ACTIVITY_CHECK_INTERVAL_MS: 1000,
  SAVE_INTERVAL_SECONDS: 60,

  // Nudge system
  OVERLAY_DURATIONS: {
    NUDGE_MS: 1500,      // How long the blur flash lasts
    POPUP_DISPLAY_MS: 10000      // How long the popup stays visible
  },

  // UI Configuration  
  CHART_CONFIG: {
    movingAverageDays: 7,
    daysToDisplay: 30,
    initAnimationDuration: 600,
    topDomainsLimit: 7
  },

  // Colors for charts and UI
  COLORS: {
    domains: [
      'rgba(69, 113, 231, 0.7)',   // Blue
      'rgba(255, 99, 132, 0.7)',   // Red
      'rgba(255, 205, 86, 0.7)',   // Yellow
      'rgba(75, 192, 192, 0.7)',   // Teal
      'rgba(153, 102, 255, 0.7)',  // Purple
      'rgba(255, 159, 64, 0.7)',   // Orange
      'rgba(199, 199, 199, 0.7)',  // Grey
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
  }
};
