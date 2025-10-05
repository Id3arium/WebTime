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
    // General -> Detail
    document.getElementById('forward-btn').addEventListener('click', () => {
      UIManager.showDetailView();
    });
    
    // Detail -> General
    document.getElementById('back-btn').addEventListener('click', () => {
      UIManager.showGeneralView();
    });
    
    // Detail -> Settings
    document.getElementById('settings-btn').addEventListener('click', () => {
      UIManager.showSettingsView();
    });
    
    // Settings -> Detail
    document.getElementById('settings-back-btn').addEventListener('click', () => {
      UIManager.showDetailView();
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
        `No tracking data available yet for ${AppState.currentDomain || "any site"}. Start browsing to collect data.`);
      return;
    }
    
    UIManager.renderDetailView(AppState.currentDomain);
    UIManager.showDetailView();
  }
};

document.addEventListener('DOMContentLoaded', () => App.initialize());
