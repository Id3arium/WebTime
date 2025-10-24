const App = {
  async initialize() {
    try {
      this.setupEventListeners();
      await this.loadData();
      this.renderInitialView();
    } catch (error) {
      console.error("Error initializing popup:", error);
      UIManager.displayMessage('#detail-page .page-content', 
        "Could not load your time data.", 'error');
    }
  },

  setupEventListeners() {
    // Navigation between views
    document.getElementById('general-detail-btn').addEventListener('click', () => {
      UIManager.showDetailView();
    });
    
    document.getElementById('general-settings-btn').addEventListener('click', () => {
      UIManager.showSettingsView();
    });
    
    document.getElementById('detail-general-btn').addEventListener('click', () => {
      UIManager.showGeneralView();
    });
    
    document.getElementById('detail-settings-btn').addEventListener('click', () => {
      UIManager.showSettingsView();
    });
    
    document.getElementById('settings-back-btn').addEventListener('click', () => {
      // Return to the view before settings
      if (AppState.currentView === ViewState.SETTINGS) {
        // Default to detail view
        UIManager.showDetailView();
      }
    });
    
    // Save settings button
    document.getElementById('save-settings-btn').addEventListener('click', () => {
      UIManager.saveSettings();
    });
  },

  async loadData() {
    const activeTabs = await browser.tabs.query({active: true, currentWindow: true});
    const currentDomain = activeTabs.length > 0 ? 
      PopUpUtils.extractDomain(activeTabs[0].url) : null;
    
    const storedData = await browser.storage.local.get("trackedTime");
    const timeHistory = storedData.trackedTime?.timeHistory || {};
    
    AppState.setCurrentDomain(currentDomain);
    AppState.setTimeHistory(timeHistory);
  },

  renderInitialView() {
    if (Object.keys(AppState.allTimeHistory).length === 0) {
      UIManager.displayMessage('#detail-page .page-content', 
        `No tracking data available yet for ${AppState.activeTabDomain || "any site"}. Start browsing to collect data.`);
      return;
    }
    
    UIManager.renderDetailView(AppState.selectedDomain);
    UIManager.showDetailView();
  }
};

document.addEventListener('DOMContentLoaded', () => App.initialize());
