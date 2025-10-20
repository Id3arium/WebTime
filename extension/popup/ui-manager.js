const UIManager = {
  showGeneralView() {
    AppState.setView(ViewState.GENERAL);
    const container = document.querySelector('.pages-container');
    container.className = 'pages-container show-general';
    
    if (!AppState.generalChartCreated) {
      this.renderGeneralView();
      AppState.markGeneralChartCreated();
    }
  },

  showDetailView() {
    AppState.setView(ViewState.DETAIL);
    const container = document.querySelector('.pages-container');
    container.className = 'pages-container show-detail';
  },

  showSettingsView() {
    AppState.setView(ViewState.SETTINGS);
    const container = document.querySelector('.pages-container');
    container.className = 'pages-container show-settings';
    
    // Update the domain name in settings header and inline
    if (AppState.selectedDomain) {
      const settingsDomain = document.getElementById('settings-domain');
      const settingsDomainInline = document.getElementById('settings-domain-inline');
      
      if (settingsDomain) {
        settingsDomain.textContent = AppState.selectedDomain;
      }
      if (settingsDomainInline) {
        settingsDomainInline.textContent = AppState.selectedDomain;
      }
    }
    
    // Load settings for selected domain
    this.loadSettings();
  },

  async loadSettings() {
    try {
      const data = await browser.storage.local.get('webTimeSettings');
      const settings = data.webTimeSettings || { global: {}, domains: {} };
      
      // Load global settings (only message and reset time)
      const global = settings.global || {};
      document.getElementById('day-reset-time').value = global.dayResetTime || 0;
      document.getElementById('custom-message').value = global.customMessage || '';
      
      // Load domain-specific settings
      const domainSettings = settings.domains?.[AppState.selectedDomain] || {};
      
      // Nudge settings
      const nudgeEnabled = domainSettings.nudgeEnabled || false;
      const nudgeThreshold = domainSettings.nudgeThreshold || 150; // default 2h30m
      const nudgeInterval = domainSettings.nudgeInterval || 5;
      
      document.getElementById('nudge-enabled').checked = nudgeEnabled;
      document.getElementById('nudge-hours').value = Math.floor(nudgeThreshold / 60);
      document.getElementById('nudge-minutes').value = nudgeThreshold % 60;
      document.getElementById('nudge-interval').value = nudgeInterval;
      
      // Reminder settings
      const reminderEnabled = domainSettings.reminderEnabled || false;
      const reminderThreshold = domainSettings.reminderThreshold || 180; // default 3h
      const reminderInterval = domainSettings.reminderInterval || 15;
      
      document.getElementById('reminder-enabled').checked = reminderEnabled;
      document.getElementById('reminder-hours').value = Math.floor(reminderThreshold / 60);
      document.getElementById('reminder-minutes').value = reminderThreshold % 60;
      document.getElementById('reminder-interval').value = reminderInterval;
      
    } catch (error) {
      console.error('Error loading settings:', error);
    }
  },

  async saveSettings() {
    try {
      // Get current settings from storage
      const data = await browser.storage.local.get('webTimeSettings');
      const settings = data.webTimeSettings || { global: {}, domains: {} };
      
      // Update global settings (only message and reset time)
      settings.global = {
        dayResetTime: parseInt(document.getElementById('day-reset-time').value),
        customMessage: document.getElementById('custom-message').value
      };
      
      // Update domain-specific settings
      if (!settings.domains) settings.domains = {};
      
      // Nudge settings
      const nudgeEnabled = document.getElementById('nudge-enabled').checked;
      const nudgeHours = parseInt(document.getElementById('nudge-hours').value) || 0;
      const nudgeMinutes = parseInt(document.getElementById('nudge-minutes').value) || 0;
      const nudgeThreshold = (nudgeHours * 60) + nudgeMinutes;
      const nudgeInterval = parseInt(document.getElementById('nudge-interval').value) || 5;
      
      // Reminder settings
      const reminderEnabled = document.getElementById('reminder-enabled').checked;
      const reminderHours = parseInt(document.getElementById('reminder-hours').value) || 0;
      const reminderMinutes = parseInt(document.getElementById('reminder-minutes').value) || 0;
      const reminderThreshold = (reminderHours * 60) + reminderMinutes;
      const reminderInterval = parseInt(document.getElementById('reminder-interval').value) || 15;
      
      // Save domain settings if either intervention is enabled
      if (nudgeEnabled || reminderEnabled) {
        settings.domains[AppState.selectedDomain] = {
          nudgeEnabled: nudgeEnabled,
          nudgeThreshold: nudgeThreshold,
          nudgeInterval: nudgeInterval,
          reminderEnabled: reminderEnabled,
          reminderThreshold: reminderThreshold,
          reminderInterval: reminderInterval
        };
      } else {
        // Remove domain if both are disabled
        if (settings.domains[AppState.selectedDomain]) {
          delete settings.domains[AppState.selectedDomain];
        }
      }
      
      // Save to storage
      await browser.storage.local.set({ webTimeSettings: settings });
      
      // Notify background script that settings changed
      browser.runtime.sendMessage({ type: 'SETTINGS_UPDATED' });
      
      // Visual feedback
      const saveBtn = document.getElementById('save-settings-btn');
      const originalText = saveBtn.textContent;
      saveBtn.textContent = 'Saved!';
      saveBtn.style.background = '#4ade80';
      
      setTimeout(() => {
        saveBtn.textContent = originalText;
        saveBtn.style.background = '';
      }, 1500);
      
    } catch (error) {
      console.error('Error saving settings:', error);
    }
  },

  renderGeneralView() {
    try {
      const totalTimeData = DataProcessor.processGeneralViewData(AppState.allTimeHistory);
      
      if (totalTimeData.dailyData.length === 0) {
        this.displayMessage('#general-page .page-content', 'No time data available.');
        return;
      }
      
      const chartConfig = ChartBuilder.buildGeneralViewChart(totalTimeData);
      const canvasElement = document.getElementById('total-time-chart');
      
      if (!canvasElement) {
        console.error('Canvas element not found!');
        return;
      }
      
      const chart = new Chart(canvasElement.getContext('2d'), chartConfig);
      chart.totalTimeData = totalTimeData;
      
      // Store chart instance for scroll updates
      AppState.setChartInstance(chart);
      
      // Highlight today by default (but not locked)
      const todayIndex = totalTimeData.dailyData.length - 1;
      ChartBuilder.highlightBar(chart, todayIndex);
      UIManager.updateDailyBreakdown(totalTimeData, todayIndex);
      
      // Add scroll event handling to the chart container
      this.setupScrollHandling(canvasElement, totalTimeData);
      
      // Add invisible hitbox over x-axis labels to handle dead zone
      this.createDeadZoneHitbox(canvasElement, chart);
      
      // Add explicit mouse leave handler for more reliable behavior
      canvasElement.addEventListener('mouseleave', () => {
        if (AppState.isLocked()) {
          // Return to locked day
          ChartBuilder.highlightBar(chart, AppState.lockedDayIndex);
          UIManager.updateDailyBreakdown(chart.totalTimeData, AppState.lockedDayIndex);
        } else {
          // Return to today if not locked
          const todayIndex = chart.totalTimeData.dailyData.length - 1;
          ChartBuilder.highlightBar(chart, todayIndex);
          UIManager.updateDailyBreakdown(chart.totalTimeData, todayIndex);
        }
      });
      
    } catch (error) {
      console.error('Error creating general view chart:', error);
      this.displayMessage('#general-page .page-content', 
        `Error creating chart: ${error.message}`, 'error');
    }
  },

  renderDetailView(domain) {
    if (!domain) {
      this.displayMessage('#detail-page .page-content', 
        "Cannot detect current domain. Make sure you're on a web page.", 'error');
      return;
    }
    
    // Update header
    this.updateDetailHeader(domain);
    
    // Update content
    const detailContent = document.querySelector('#detail-page .page-content');
    detailContent.innerHTML = '<canvas id="time-chart"></canvas>';
    
    // Build and display chart
    const processedData = DataProcessor.processDetailViewData(AppState.allTimeHistory, domain);
    const chartConfig = ChartBuilder.buildDetailViewChart(processedData);
    
    const canvasElement = document.getElementById('time-chart');
    const chart = new Chart(canvasElement.getContext('2d'), chartConfig);
    
    // Add scrolling support if there's enough data
    if (processedData.dailyData.length > CONFIG.daysToDisplay) {
      this.setupDetailViewScrolling(canvasElement, chart, processedData);
    }
  },

  updateDetailHeader(domain) {
    const currentDate = PopUpUtils.getLocalDateStr();
    const todaysTime = DataProcessor.calculateTodaysTotals(
      AppState.allTimeHistory, currentDate, domain
    );
    
    const headerText = document.querySelector('#detail-page .header-text');
    const summary = document.querySelector('#detail-page .time-summary');
    
    headerText.textContent = domain;
    summary.textContent = `${PopUpUtils.formatTime(todaysTime.domain)} / ${PopUpUtils.formatTime(todaysTime.total)}`;
  },

  displayMessage(selector, message, type = '') {
    const element = document.querySelector(selector);
    const cssClass = type ? `message ${type}` : 'message';
    element.innerHTML = `<p class="${cssClass}">${message}</p>`;
  },

  updateDailyBreakdown(totalTimeData, dataIndex) {
    const dayData = totalTimeData.dailyData[dataIndex];
    const breakdownTitle = document.querySelector('.breakdown-title');
    const breakdownBars = document.querySelector('.breakdown-bars');
    
    if (!breakdownTitle || !breakdownBars) return;
    
    breakdownTitle.style.display = 'none';
    
    // Get ALL domains for this specific day from the raw time history
    const allDomainsForDay = totalTimeData.allDomains || [];
    const domainData = this.calculateDomainBreakdown(dayData, allDomainsForDay);
    this.renderBreakdownBars(breakdownBars, domainData);
    
    // Update the header to show which day we're viewing
    this.updateGeneralViewHeader(dayData.date);
  },
  
  updateGeneralViewHeader(dateString) {
    const headerSummary = document.querySelector('#general-page .time-summary');
    if (!headerSummary) return;
    
    const today = PopUpUtils.getLocalDateStr();
    
    const formattedDate = PopUpUtils.formatDateWithDayOfWeek(dateString);
    if (dateString === today) {
      headerSummary.textContent =  "Today - " + formattedDate;
    } else {
      // Format as "Sep 18 (Thu)"
      headerSummary.textContent = formattedDate;
    }
  },

  calculateDomainBreakdown(dayData, allDomains) {
    const domainData = [];
    
    // Get all domains that actually have data for this day
    Object.keys(dayData).forEach(domain => {
      // Skip metadata fields
      if (domain.startsWith('_') || domain === 'date' || domain === 'totalSeconds' || 
          domain === 'totalHours' || domain === 'formattedTime' || domain === 'Others') {
        return;
      }
      
      const hours = dayData[domain] || 0;
      const seconds = Math.round(hours * 3600);
      
      if (seconds > 0) {
        // Find the color for this domain
        const domainIndex = allDomains.indexOf(domain);
        const color = COLORS.domains[domainIndex % COLORS.domains.length];
        
        domainData.push({
          domain,
          seconds,
          hours,
          color,
          percentage: Math.round((seconds / dayData.totalSeconds) * 100)
        });
      }
    });
    
    return domainData.sort((a, b) => b.seconds - a.seconds);
  },

  renderBreakdownBars(container, domainData) {
    if (domainData.length === 0) {
      container.innerHTML = '<div style="color: #888; font-style: italic;">No data for this day</div>';
      return;
    }
    
    const maxSeconds = domainData[0].seconds;
    
    container.innerHTML = domainData.map(item => {
      const widthPercent = Math.max((item.seconds / maxSeconds) * 100, 2);
      const formattedTime = PopUpUtils.formatTime(item.seconds);

      return `
        <div class="breakdown-bar">
          <div class="breakdown-color" style="background: ${item.color};"></div>
          <div class="breakdown-label" title="${item.domain}">${item.domain}</div>
          <div class="breakdown-fill">
            <div class="breakdown-fill-inner" style="background: ${item.color}; width: ${widthPercent}%;"></div>
          </div>
          <div class="breakdown-time">${formattedTime} (${item.percentage}%)</div>
        </div>
      `;
    }).join('');

    container.onclick = (e) => {
      const bar = e.target.closest('.breakdown-bar');
      if (bar) {
        const domain = bar.querySelector('.breakdown-label').textContent;
        AppState.setSelectedDomain(domain);  // Update which domain is selected
        this.renderDetailView(domain);
        this.showDetailView();
      }
    };
  },
  
  setupScrollHandling(canvasElement, totalTimeData) {
    const totalDays = totalTimeData.dailyData.length;
    const windowSize = CONFIG.daysToDisplay;
    
    // Only enable scrolling if we have more data than the window size
    if (totalDays <= windowSize) {
      return;
    }
    
    // Add wheel event listener to the canvas
    canvasElement.addEventListener('wheel', (event) => {
      event.preventDefault(); // Prevent page scrolling
      
      // Determine scroll direction (positive = scroll back in time)
      const scrollDelta = Math.sign(event.deltaY) * 3; // Scroll 3 days at a time
      
      // Update scroll position
      const newPosition = AppState.updateScrollPosition(scrollDelta);
      
      // Update chart viewport
      this.updateChartViewport(totalDays, windowSize, newPosition);
    });
    
    // Optional: Add keyboard navigation
    canvasElement.addEventListener('keydown', (event) => {
      let scrollDelta = 0;
      
      switch (event.key) {
        case 'ArrowLeft':
          scrollDelta = 5; // Scroll back in time
          break;
        case 'ArrowRight':
          scrollDelta = -5; // Scroll forward in time
          break;
        default:
          return;
      }
      
      event.preventDefault();
      const newPosition = AppState.updateScrollPosition(scrollDelta);
      this.updateChartViewport(totalDays, windowSize, newPosition);
    });
    
    // Make canvas focusable for keyboard events
    canvasElement.tabIndex = 0;
  },
  
  updateChartViewport(totalDays, windowSize, scrollPosition) {
    const chart = AppState.chartInstance;
    if (!chart) return;
    
    // Calculate new min/max indices
    const maxIndex = totalDays - 1 - scrollPosition;
    const minIndex = Math.max(0, maxIndex - windowSize + 1);
    
    // Update chart scales
    chart.options.scales.x.min = minIndex;
    chart.options.scales.x.max = maxIndex;
    
    // Redraw chart with new viewport
    chart.update('none'); // Use 'none' mode for instant update without animation
    
    // Restore highlight if a day is locked and visible
    if (AppState.isLocked() && AppState.lockedDayIndex >= minIndex && AppState.lockedDayIndex <= maxIndex) {
      ChartBuilder.highlightBar(chart, AppState.lockedDayIndex);
    }
    
    // Update breakdown to show the locked day if locked, otherwise the last visible day
    const visibleIndex = AppState.isLocked() ? AppState.lockedDayIndex : maxIndex;
    this.updateDailyBreakdown(chart.totalTimeData, visibleIndex);
  },
  
  createDeadZoneHitbox(canvasElement, chart) {
    // Create invisible div that covers the x-axis labels area
    const hitbox = document.createElement('div');
    hitbox.style.position = 'absolute';
    hitbox.style.pointerEvents = 'auto';
    hitbox.style.backgroundColor = 'transparent';
    hitbox.style.zIndex = '10';
    
    // Position it over the x-axis labels area
    const updateHitboxPosition = () => {
      const rect = canvasElement.getBoundingClientRect();
      const chartArea = chart.chartArea;
      
      // Position hitbox to cover x-axis labels (below chart area)
      hitbox.style.left = `${chartArea.left}px`;
      hitbox.style.top = `${chartArea.bottom}px`;
      hitbox.style.width = `${chartArea.right - chartArea.left}px`;
      hitbox.style.height = `${rect.height - chartArea.bottom}px`;
    };
    
    // Add mouseenter listener to restore locked selection
    hitbox.addEventListener('mouseenter', () => {
      if (AppState.isLocked()) {
        ChartBuilder.highlightBar(chart, AppState.lockedDayIndex);
        UIManager.updateDailyBreakdown(chart.totalTimeData, AppState.lockedDayIndex);
      } else {
        const todayIndex = chart.totalTimeData.dailyData.length - 1;
        ChartBuilder.highlightBar(chart, todayIndex);
        UIManager.updateDailyBreakdown(chart.totalTimeData, todayIndex);
      }
    });
    
    // Position the hitbox initially
    updateHitboxPosition();
    
    // Add hitbox to the canvas container
    const container = canvasElement.parentElement;
    container.style.position = 'relative'; // Ensure container can position children
    container.appendChild(hitbox);
    
    // Store reference for cleanup if needed
    chart._deadZoneHitbox = hitbox;
  },
  
  setupDetailViewScrolling(canvasElement, chart, processedData) {
    const totalDays = processedData.dailyData.length;
    const windowSize = CONFIG.daysToDisplay;
    
    // Use a separate scroll state for detail view
    let detailScrollPosition = 0;
    
    // Add wheel event listener
    canvasElement.addEventListener('wheel', (event) => {
      event.preventDefault();
      
      const scrollDelta = Math.sign(event.deltaY) * 3;
      const maxScroll = Math.max(0, totalDays - windowSize);
      detailScrollPosition = Math.max(0, Math.min(maxScroll, detailScrollPosition + scrollDelta));
      
      // Update viewport
      const maxIndex = totalDays - 1 - detailScrollPosition;
      const minIndex = Math.max(0, maxIndex - windowSize + 1);
      
      chart.options.scales.x.min = minIndex;
      chart.options.scales.x.max = maxIndex;
      chart.update('none');
    });
    
    // Add keyboard navigation
    canvasElement.addEventListener('keydown', (event) => {
      let scrollDelta = 0;
      
      switch (event.key) {
        case 'ArrowLeft':
          scrollDelta = 5;
          break;
        case 'ArrowRight':
          scrollDelta = -5;
          break;
        default:
          return;
      }
      
      event.preventDefault();
      const maxScroll = Math.max(0, totalDays - windowSize);
      detailScrollPosition = Math.max(0, Math.min(maxScroll, detailScrollPosition + scrollDelta));
      
      const maxIndex = totalDays - 1 - detailScrollPosition;
      const minIndex = Math.max(0, maxIndex - windowSize + 1);
      
      chart.options.scales.x.min = minIndex;
      chart.options.scales.x.max = maxIndex;
      chart.update('none');
    });
    
    canvasElement.tabIndex = 0;
  }
};
