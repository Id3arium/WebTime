const Constants = {
  // Mathematical constants
  PHI: (1 + Math.sqrt(5)) / 2,  // Golden ratio ≈ 1.618

  // Timing thresholds
  INACTIVITY_THRESHOLD_MS: 30000,
  ACTIVITY_CHECK_INTERVAL_MS: 1000,
  SAVE_INTERVAL_SECONDS: 30,

  // Nudge and reminder system
  OVERLAY_DURATIONS: {
    NUDGE_MS: 1000,         // How long the nudge blur lasts
    REMINDER_DISPLAY_MS: 7000  // How long the reminder stays visible
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
