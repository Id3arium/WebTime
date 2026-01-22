import { extractDomain } from './popup-utils.js';
import { AppState } from './state.js';
import { UIManager } from './ui-manager.js';

declare const browser: typeof chrome;

export const App = {
  async initialize(): Promise<void> {
    try {
      this.setupEventListeners();
      await this.loadData();
      this.renderInitialView();
    } catch (error) {
      console.error("Error initializing popup:", error);
      UIManager.displayMessage('#detail-page .left-panel',
        "Could not load your time data.", 'error');
    }
  },

  setupEventListeners(): void {
    const generalDetailBtn = document.getElementById('general-detail-btn');
    const detailGeneralBtn = document.getElementById('detail-general-btn');
    const saveSettingsBtn = document.getElementById('save-settings-btn');

    if (generalDetailBtn) {
      generalDetailBtn.addEventListener('click', () => {
        UIManager.renderDetailView(AppState.selectedDomain);
        UIManager.showDetailView();
      });
    }

    if (detailGeneralBtn) {
      detailGeneralBtn.addEventListener('click', () => {
        UIManager.showGeneralView();
      });
    }

    if (saveSettingsBtn) {
      saveSettingsBtn.addEventListener('click', () => {
        UIManager.saveSettings();
      });
    }
  },

  async loadData(): Promise<void> {
    const activeTabs = await browser.tabs.query({ active: true, currentWindow: true });
    const currentDomain = activeTabs.length > 0 && activeTabs[0].url
      ? extractDomain(activeTabs[0].url)
      : null;

    const storedData = await browser.storage.local.get("trackedTime");
    const timeHistory = storedData.trackedTime?.timeHistory || {};

    AppState.setCurrentDomain(currentDomain);
    AppState.setTimeHistory(timeHistory);
  },

  renderInitialView(): void {
    if (!AppState.allTimeHistory || Object.keys(AppState.allTimeHistory).length === 0) {
      UIManager.displayMessage('#detail-page .left-panel',
        `No tracking data available yet for ${AppState.activeTabDomain || "any site"}. Start browsing to collect data.`);
      return;
    }

    UIManager.renderDetailView(AppState.selectedDomain);
    UIManager.showDetailView();
  }
};

document.addEventListener('DOMContentLoaded', () => App.initialize());

export default App;
