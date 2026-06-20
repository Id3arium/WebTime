import { extractDomain } from '../shared/utils.js';
import { AppState } from './state.js';
import { UIManager } from './ui-manager.js';
import { CONFIG, ViewState } from './config.js';

declare const browser: typeof chrome;

// Expose UIManager globally for chart-builder callbacks
(window as unknown as { UIManager: typeof UIManager }).UIManager = UIManager;

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
    // Merged topbar: one nav button toggles between the two carousel pages.
    const navToggleBtn = document.getElementById('nav-toggle-btn');
    const settingsToggleBtn = document.getElementById('settings-toggle-btn');
    const saveSettingsBtn = document.getElementById('save-settings-btn');

    if (navToggleBtn) {
      navToggleBtn.addEventListener('click', () => {
        if (AppState.currentView === ViewState.DETAIL) {
          UIManager.showGeneralView();
        } else {
          UIManager.renderDetailView(AppState.selectedDomain);
          UIManager.showDetailView();
        }
      });
    }

    // One button toggles the right-half settings overlay; it morphs hamburger→✕.
    if (settingsToggleBtn) {
      settingsToggleBtn.addEventListener('click', () => UIManager.toggleSettings());
    }

    if (saveSettingsBtn) {
      saveSettingsBtn.addEventListener('click', () => {
        UIManager.saveSettings();
        UIManager.closeSettings();
      });
    }
  },

  async loadData(): Promise<void> {
    const activeTabs = await browser.tabs.query({ active: true, currentWindow: true });
    const currentDomain = activeTabs.length > 0 && activeTabs[0].url
      ? extractDomain(activeTabs[0].url)
      : null;

    const storedData = await browser.storage.local.get(["trackedTime", "webTimeSettings"]);
    const timeHistory = storedData.trackedTime?.timeHistory || {};
    const settings = storedData.webTimeSettings || { global: {}, domains: {} };

    if (settings.global?.scalingPower !== undefined) {
      CONFIG.scalingPower = Math.max(0.3, Math.min(1.0, settings.global.scalingPower));
    }

    // Mirror the background's day-reset hour so the popup's "today" agrees with
    // tracked time between midnight and the reset hour.
    AppState.dayResetTime = settings.global?.dayResetTime || 0;

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
