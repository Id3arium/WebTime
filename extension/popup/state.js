// =============================================================================
// STATE MANAGEMENT
// =============================================================================

const AppState = {
  currentView: ViewState.DETAIL,
  activeTabDomain: null,    // Domain of the currently active browser tab
  selectedDomain: null,     // Domain selected to view/configure in the popup UI
  allTimeHistory: null,
  generalChartCreated: false,
  
  // Scroll state for general view
  scrollPosition: 0,  // 0 = most recent days, positive = scroll back in time
  totalDays: 0,       // Total number of days available
  chartInstance: null, // Reference to the Chart.js instance
  
  // Click-to-lock state
  lockedDayIndex: null,  // null = hover mode, number = locked to specific day

  setCurrentDomain(domain) {
    this.activeTabDomain = domain;
    this.selectedDomain = domain;  // By default, select the active tab's domain
  },

  setSelectedDomain(domain) {
    this.selectedDomain = domain;
  },

  setTimeHistory(history) {
    this.allTimeHistory = history;
    this.totalDays = Object.keys(history).length;
    this.scrollPosition = 0; // Reset to most recent when data changes
    this.lockedDayIndex = null; // Reset lock when data changes
  },

  setView(view) {
    this.currentView = view;
  },

  markGeneralChartCreated() {
    this.generalChartCreated = true;
  },
  
  setChartInstance(chart) {
    this.chartInstance = chart;
  },
  
  lockDay(dayIndex) {
    this.lockedDayIndex = dayIndex;
  },
  
  unlockDay() {
    this.lockedDayIndex = null;
  },
  
  isLocked() {
    return this.lockedDayIndex !== null;
  },
  
  updateScrollPosition(delta) {
    const maxScroll = Math.max(0, this.totalDays - CONFIG.daysToDisplay);
    this.scrollPosition = Math.max(0, Math.min(maxScroll, this.scrollPosition + delta));
    return this.scrollPosition;
  },
  
  getVisibleDateRange() {
    const startIndex = this.totalDays - CONFIG.daysToDisplay - this.scrollPosition;
    const endIndex = this.totalDays - this.scrollPosition;
    return { startIndex: Math.max(0, startIndex), endIndex };
  }
};
