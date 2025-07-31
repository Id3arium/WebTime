const CONFIG = {
  movingAverageDays: 7,
  daysToDisplay: 30,
  initAnimationDuration: 600,
  topDomainsLimit: 7
};

const COLORS = {
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
};

const ViewState = {
  GENERAL: 'general',
  DETAIL: 'detail'
};

// =============================================================================
// STATE MANAGEMENT
// =============================================================================

const AppState = {
  currentView: ViewState.DETAIL,
  currentDomain: null,
  allTimeHistory: null,
  generalChartCreated: false,

  setCurrentDomain(domain) {
    this.currentDomain = domain;
  },

  setTimeHistory(history) {
    this.allTimeHistory = history;
  },

  setView(view) {
    this.currentView = view;
  },

  markGeneralChartCreated() {
    this.generalChartCreated = true;
  }
};

const PopUpUtils = {
  extractDomain(url) {
    try {
      const parsedUrl = new URL(url);
      let hostname = parsedUrl.hostname;
      return hostname.startsWith('www.') ? hostname.substring(4) : hostname;
    } catch (error) {
      console.error("Error parsing URL:", error);
      return null;
    }
  },

  getLocalDateStr() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  },

  formatTime(totalTime) {
    const hours = Math.floor(totalTime / 3600);
    const minutes = Math.floor((totalTime % 3600) / 60);
    const formattedHours = hours.toString().padStart(2, '0');
    const formattedMinutes = minutes.toString().padStart(2, '0');
    return `${formattedHours}:${formattedMinutes}`;
  },

  formatDateForDisplay(dateString) {
    const [year, month, day] = dateString.split('-').map(num => parseInt(num, 10));
    const date = new Date(year, month - 1, day);
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${months[date.getMonth()]} ${date.getDate()}`;
  }
};

const DataProcessor = {
  getAllDomains(timeHistory) {
    const allDomains = new Set();
    Object.keys(timeHistory).forEach(date => {
      const dayData = timeHistory[date];
      if (typeof dayData === 'object' && dayData) {
        Object.keys(dayData).forEach(domain => allDomains.add(domain));
      }
    });
    return Array.from(allDomains);
  },

  calculateDomainTotals(domains, timeHistory) {
    const sortedDates = Object.keys(timeHistory).sort();
    const domainTotals = {};
    
    domains.forEach(domain => {
      domainTotals[domain] = sortedDates.reduce((total, date) => {
        const dayData = timeHistory[date];
        if (typeof dayData === 'object' && dayData) {
          return total + (dayData[domain] || 0);
        }
        return total;
      }, 0);
    });
    
    return domainTotals;
  },

  rankDomainsByUsage(domains, timeHistory) {
    const domainTotals = this.calculateDomainTotals(domains, timeHistory);
    const sorted = domains.sort((a, b) => domainTotals[b] - domainTotals[a]);
    
    return {
      topDomains: sorted.slice(0, CONFIG.topDomainsLimit),
      otherDomains: sorted.slice(CONFIG.topDomainsLimit),
      totals: domainTotals
    };
  },

  transformDayData(dayData, topDomains, otherDomains) {
    let totalSeconds = 0;
    const result = {};

    if (typeof dayData === 'number') {
      // Legacy format
      totalSeconds = dayData;
      topDomains.forEach(domain => result[domain] = 0);
      if (otherDomains.length > 0) {
        result['Others'] = dayData / 3600;
      }
    } else if (typeof dayData === 'object' && dayData) {
      // Current format
      totalSeconds = Object.values(dayData).reduce((sum, time) => sum + time, 0);
      
      topDomains.forEach(domain => {
        const seconds = dayData[domain] || 0;
        result[domain] = seconds / 3600;
      });
      
      const othersSeconds = otherDomains.reduce((total, domain) => {
        return total + (dayData[domain] || 0);
      }, 0);
      
      if (othersSeconds > 0) {
        result['Others'] = othersSeconds / 3600;
      }
    }

    return {
      ...result,
      totalSeconds,
      totalHours: totalSeconds / 3600,
      formattedTime: PopUpUtils.formatTime(totalSeconds)
    };
  },

  processGeneralViewData(timeHistory) {
    const sortedDates = Object.keys(timeHistory).sort();
    const allDomains = this.getAllDomains(timeHistory);
    const {topDomains, otherDomains} = this.rankDomainsByUsage(allDomains, timeHistory);
    
    const allDailyData = sortedDates.map(date => {
      const dayData = timeHistory[date];
      const transformed = this.transformDayData(dayData, topDomains, otherDomains);
      return { date, ...transformed };
    });
    
    const visibleData = CONFIG.daysToDisplay > 0 ? 
      allDailyData.slice(-CONFIG.daysToDisplay) : allDailyData;
    
    const finalDomains = [...topDomains];
    if (otherDomains.length > 0) {
      finalDomains.push('Others');
    }
    
    return {
      dailyData: visibleData,
      allData: allDailyData,
      domains: finalDomains,
      movingAverageData: this.calculateMovingAverageTotal(visibleData)
    };
  },

  processDetailViewData(timeHistory, targetDomain) {
    const sortedDates = Object.keys(timeHistory).sort();
    
    const dailyData = sortedDates.map(date => {
      const dayData = timeHistory[date];
      let domainSeconds = 0;
      let totalSeconds = 0;
      
      if (typeof dayData === 'number') {
        domainSeconds = dayData;
        totalSeconds = dayData;
      } else if (typeof dayData === 'object' && dayData) {
        domainSeconds = dayData[targetDomain] || 0;
        totalSeconds = Object.values(dayData).reduce((sum, time) => sum + time, 0);
      }
      
      return {
        date,
        domainSeconds,
        totalSeconds,
        domainHours: domainSeconds / 3600,
        totalHours: totalSeconds / 3600,
        domainFormattedTime: PopUpUtils.formatTime(domainSeconds),
        totalFormattedTime: PopUpUtils.formatTime(totalSeconds)
      };
    });
    
    const visibleData = CONFIG.daysToDisplay > 0 ? 
      dailyData.slice(-CONFIG.daysToDisplay) : dailyData;
    
    return {
      dailyData: visibleData,
      movingAverageData: this.calculateMovingAverage(visibleData)
    };
  },

  calculateMovingAverage(dailyData) {
    return dailyData.map((dayData, index) => {
      const startIndex = Math.max(0, index - CONFIG.movingAverageDays + 1);
      const window = dailyData.slice(startIndex, index + 1);
      
      const totalSeconds = window.reduce((sum, day) => sum + day.domainSeconds, 0);
      const averageSeconds = window.length > 0 ? totalSeconds / window.length : 0;
      const roundedAverage = Math.round(averageSeconds);
      
      return {
        date: dayData.date,
        averageSeconds: roundedAverage,
        averageHours: Math.round((averageSeconds / 3600) * 10) / 10,
        formattedTime: PopUpUtils.formatTime(roundedAverage)
      };
    });
  },

  calculateMovingAverageTotal(dailyData) {
    return dailyData.map((dayData, index) => {
      const startIndex = Math.max(0, index - CONFIG.movingAverageDays + 1);
      const window = dailyData.slice(startIndex, index + 1);
      
      const totalSeconds = window.reduce((sum, day) => sum + day.totalSeconds, 0);
      const averageSeconds = window.length > 0 ? totalSeconds / window.length : 0;
      const roundedAverage = Math.round(averageSeconds);
      
      return {
        date: dayData.date,
        averageSeconds: roundedAverage,
        averageHours: Math.round((averageSeconds / 3600) * 10) / 10,
        formattedTime: PopUpUtils.formatTime(roundedAverage)
      };
    });
  },

  calculateTodaysTotals(timeHistory, currentDate, currentDomain) {
    const todaysData = timeHistory[currentDate] || {};
    const todaysTotalTime = Object.values(todaysData).reduce((sum, time) => sum + time, 0);
    const todaysDomainTime = todaysData[currentDomain] || 0;
    
    return {
      domain: todaysDomainTime,
      total: todaysTotalTime
    };
  }
};

const ChartBuilder = {
  getGridColor() {
    return getComputedStyle(document.documentElement)
      .getPropertyValue('--dark-bg').trim();
  },

  createMovingAverageDataset(movingAverageData, label = 'Average') {
    return {
      type: 'line',
      label: label,
      data: movingAverageData.map(day => day.averageHours),
      formattedTimes: movingAverageData.map(day => day.formattedTime),
      backgroundColor: COLORS.movingAverage.background,
      borderColor: COLORS.movingAverage.border,
      borderWidth: COLORS.movingAverage.width,
      fill: false,
      tension: 0.2,
      pointRadius: 3,
      order: -1
    };
  },

  createDomainDatasets(domains, dailyData) {
    return domains.map((domain, index) => {
      const color = domain === 'Others' ? COLORS.others : 
        COLORS.domains[index % COLORS.domains.length];
      
      return {
        type: 'bar',
        label: domain,
        data: dailyData.map(day => day[domain] || 0),
        backgroundColor: color,
        borderColor: color.replace('0.7', '1').replace('0.5', '0.8'),
        borderWidth: 1,
        order: 1
      };
    });
  },

  createSingleDomainDataset(dailyData, label = 'Current Domain') {
    return {
      type: 'bar',
      label: label,
      data: dailyData.map(day => day.domainHours),
      backgroundColor: COLORS.currentDomain.background,
      borderColor: COLORS.currentDomain.border,
      borderWidth: 1,
      formattedTimes: dailyData.map(day => day.domainFormattedTime),
      order: 1
    };
  },

  getBaseChartOptions() {
    return {
      animation: { duration: CONFIG.initAnimationDuration },
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        y: {
          grid: { color: this.getGridColor() },
          beginAtZero: true,
          title: { display: true, text: 'Hours' }
        }
      },
      interaction: { intersect: false, mode: 'index' },
      elements: {
        bar: { barPercentage: 0.8, categoryPercentage: 0.9 }
      }
    };
  },

  buildGeneralViewChart(totalTimeData) {
    const datasets = [];
    
    if (totalTimeData.movingAverageData) {
      const avgDataset = this.createMovingAverageDataset(
        totalTimeData.movingAverageData, 
        `${CONFIG.movingAverageDays}-Day Average`
      );
      datasets.push(avgDataset);
    }
    
    const domainDatasets = this.createDomainDatasets(
      totalTimeData.domains, 
      totalTimeData.dailyData
    );
    datasets.push(...domainDatasets);
    
    const options = {
      ...this.getBaseChartOptions(),
      scales: {
        ...this.getBaseChartOptions().scales,
        x: { stacked: true },
        y: { ...this.getBaseChartOptions().scales.y, stacked: true }
      },
      plugins: {
        legend: { display: false },
        tooltip: this.getGeneralViewTooltipConfig(totalTimeData)
      },
      onHover: (event, elements, chart) => {
        if (elements.length > 0) {
          const dataIndex = elements[0].index;
          UIManager.updateDailyBreakdown(chart.totalTimeData, dataIndex);
        }
      }
    };
    
    return {
      type: 'bar',
      data: {
        labels: totalTimeData.dailyData.map(day => PopUpUtils.formatDateForDisplay(day.date)),
        datasets: datasets
      },
      options: options
    };
  },

  buildDetailViewChart(processedData) {
    const datasets = [];
    
    if (processedData.movingAverageData) {
      const avgDataset = this.createMovingAverageDataset(
        processedData.movingAverageData,
        `${CONFIG.movingAverageDays}-Day Average`
      );
      datasets.push(avgDataset);
    }
    
    const domainDataset = this.createSingleDomainDataset(processedData.dailyData);
    datasets.push(domainDataset);
    
    const options = {
      ...this.getBaseChartOptions(),
      plugins: { tooltip: this.getDetailViewTooltipConfig() }
    };
    
    return {
      type: 'bar',
      data: {
        labels: processedData.dailyData.map(day => PopUpUtils.formatDateForDisplay(day.date)),
        datasets: datasets
      },
      options: options
    };
  },

  getGeneralViewTooltipConfig(totalTimeData) {
    return {
      animation: { duration: 200 },
      backgroundColor: 'rgba(0, 0, 0, 0.5)',
      callbacks: {
        title: (context) => {
          return PopUpUtils.formatDateForDisplay(totalTimeData.dailyData[context[0].dataIndex].date);
        },
        label: (context) => {
          const dataIndex = context.dataIndex;
          const dayData = totalTimeData.dailyData[dataIndex];
          
          if (context.dataset.label.includes('Average')) {
            const time = context.dataset.formattedTimes[dataIndex];
            return `${context.dataset.label}: ${time}`;
          }
          return null;
        },
        afterLabel: (context) => {
          if (context.datasetIndex === 0) {
            const dataIndex = context.dataIndex;
            const dayData = totalTimeData.dailyData[dataIndex];
            return `Total: ${dayData.formattedTime}`;
          }
          return null;
        }
      }
    };
  },

  getDetailViewTooltipConfig() {
    return {
      animation: { duration: 200 },
      backgroundColor: 'rgba(0, 0, 0, 0.5)',
      callbacks: {
        label: (context) => {
          const dataset = context.chart.data.datasets[context.datasetIndex];
          const time = dataset.formattedTimes[context.dataIndex];
          return `${dataset.label}: ${time}`;
        }
      }
    };
  }
};

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
    new Chart(canvasElement.getContext('2d'), chartConfig);
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
    
    const domainData = this.calculateDomainBreakdown(dayData, totalTimeData.domains);
    this.renderBreakdownBars(breakdownBars, domainData);
  },

  calculateDomainBreakdown(dayData, domains) {
    const domainData = [];
    
    domains.forEach((domain, index) => {
      const hours = dayData[domain] || 0;
      const seconds = Math.round(hours * 3600);
      
      if (seconds > 0) {
        const color = domain === 'Others' ? COLORS.others : 
          COLORS.domains[index % COLORS.domains.length];
        
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

    container.onclick = (e) => {
      const bar = e.target.closest('.breakdown-bar');
      if (bar) {
        const domain = bar.querySelector('.breakdown-label').textContent;
        this.renderDetailView(domain);
        this.showDetailView();
      }
    };
      
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
  }
};

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
    document.getElementById('back-btn').addEventListener('click', () => {
      UIManager.showGeneralView();
    });
    
    document.getElementById('forward-btn').addEventListener('click', () => {
      UIManager.showDetailView();
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