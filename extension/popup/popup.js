const CONFIG = {
  movingAverageDays: 7,  // 7-day moving average
  daysToDisplay: 30,     // Number of days to display
  chartHeight: 400       // Chart height in pixels
};

const ViewState = {
  GENERAL: 'general',
  DETAIL: 'detail'
};

const gridColor = getComputedStyle(document.documentElement).getPropertyValue('--dark-bg').trim();

// Global state
let currentView = ViewState.DETAIL; // Default to detail view (existing behavior)
let currentDomain = null;
let allTimeHistory = null;

document.addEventListener('DOMContentLoaded', initializePopup);

function extractDomain(url) {
  try {
    const parsedUrl = new URL(url);
    let hostname = parsedUrl.hostname;
    
    if (hostname.startsWith('www.')) {
      hostname = hostname.substring(4);
    }
    
    return hostname;
  } catch (error) {
    console.error("Error parsing URL:", error);
    return null;
  }
}

function getLocalDateStr() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}

async function initializePopup() {
  try {
    setupNavigationListeners();
    
    const activeTabs = await browser.tabs.query({active: true, currentWindow: true});
    currentDomain = activeTabs.length > 0 ? extractDomain(activeTabs[0].url) : null;
    
    const storedData = await browser.storage.local.get("trackedTime");
    allTimeHistory = storedData.trackedTime?.timeHistory || {};
    
    if (Object.keys(allTimeHistory).length === 0) {
      displayNoDataMessage(currentDomain || "any site");
      return;
    }
    
    if (currentView === ViewState.GENERAL) {
      renderGeneralView();
    } else {
      renderDomainDetailView(currentDomain);
    }
      
  } catch (error) {
    console.error("Error initializing popup:", error);
    displayErrorMessage("Could not load your time data.");
  }
}
  
function setupNavigationListeners() {
  document.getElementById('back-btn').addEventListener('click', showGeneralView);
  document.getElementById('forward-btn').addEventListener('click', showDetailView);
}

function showGeneralView() {
  currentView = ViewState.GENERAL;
  const pagesContainer = document.querySelector('.pages-container');
  pagesContainer.className = 'pages-container show-general';
}

function showDetailView() {
  currentView = ViewState.DETAIL;
  const pagesContainer = document.querySelector('.pages-container');
  pagesContainer.className = 'pages-container show-detail';
}

// View rendering functions
function renderGeneralView() {
  // Update general page content
  const generalContent = document.querySelector('#general-page .page-content');
  generalContent.innerHTML = '<p class="message">General view coming soon! This will show pie chart and top domains.</p>';
  
  // Show general view
  showGeneralView();
}

function renderDomainDetailView(domain) {
  if (!domain) {
    displayErrorMessage("Cannot detect current domain. Make sure you're on a web page.");
    return;
  }
  
  const currentDate = getLocalDateStr();
  const todaysTime = calculateTodaysTotals(allTimeHistory, currentDate, domain);
  
  // Update detail page header
  const detailHeaderText = document.querySelector('#detail-page .header-text');
  const detailSummary = document.querySelector('#detail-page .time-summary');
  detailHeaderText.textContent = domain;
  detailSummary.textContent = `${formatTime(todaysTime.domain)} / ${formatTime(todaysTime.total)}`;
  
  // Update detail page content with chart
  const detailContent = document.querySelector('#detail-page .page-content');
  detailContent.innerHTML = '<canvas id="time-chart"></canvas>';
  
  // Build and display chart
  const processedData = processDataForAnalytics(allTimeHistory, domain);
  const chartConfig = buildChartConfig(processedData);
  
  const canvasElement = document.getElementById('time-chart');
  const canvasContext = canvasElement.getContext('2d');
  const _timeChart = new Chart(canvasContext, chartConfig);
  
  // Show detail view
  showDetailView();
}

function displayNoDataMessage(siteName) {
    const detailContent = document.querySelector('#detail-page .page-content');
    detailContent.innerHTML = `<p class="message">No tracking data available yet for ${siteName}. Start browsing to collect data.</p>`;
}
  
function displayErrorMessage(message) {
    const detailContent = document.querySelector('#detail-page .page-content');
    detailContent.innerHTML = '<p class="message error">' + message + '</p>';
}

function calculateTodaysTotals(timeHistory, currentDate, currentDomain) {
  const todaysData = timeHistory[currentDate] || {};
  
  const todaysTotalTime = Object.values(todaysData).reduce((sum, time) => sum + time, 0);
  
  const todaysDomainTime = todaysData[currentDomain] || 0;

  console.log("Current date:", currentDate);
  console.log("Today's data:", todaysData);
  console.log("Current domain:", currentDomain);
  console.log("Domain time:", todaysDomainTime);
  console.log("Total time:", todaysTotalTime);
  
  return {
    domain: todaysDomainTime,
    total: todaysTotalTime
  };
}
  
function buildChartConfig(processedData) {
  const datasets = [
    // Bottom segment - Current domain usage
    {
      type: 'bar',
      label: 'Current Domain',
      data: processedData.dailyData.map(day => day.domainHours),
      backgroundColor: 'rgba(69, 113, 231, 0.7)',
      borderColor: 'rgba(69, 113, 231)',
      borderWidth: 1,
      formattedTimes: processedData.dailyData.map(day => day.domainFormattedTime)
    },
    // Top segment - Other sites (Total - Domain)
    {
      type: 'bar',
      label: 'Other Sites',
      data: processedData.dailyData.map(day => day.totalHours - day.domainHours),
      backgroundColor: 'rgba(125, 125, 125, 0.4)',
      borderColor: 'rgba(125, 125, 125, 0.6)',
      borderWidth: 1,
      formattedTimes: processedData.dailyData.map(day => {
        const otherSeconds = day.totalSeconds - day.domainSeconds;
        return formatTime(otherSeconds);
      })
    }
  ];
  
  if (processedData.movingAverageData) {
    datasets.push({
      type: 'line',
      label: `${CONFIG.movingAverageDays}-Day Average`,
      data: processedData.movingAverageData.map(day => day.averageHours),
      formattedTimes: processedData.movingAverageData.map(day => day.formattedTime),
      backgroundColor: 'rgb(88, 90, 224, 0.2)',
      borderColor: 'rgb(88, 90, 224)', 
      borderWidth: 2,
      fill: false,
      tension: 0.2,
      pointRadius: 3,
      order: 1 // Top layer
    });
  }
  
  return {
    type: 'bar',  // Default type (for backward compatibility)
    data: {
      labels: processedData.dailyData.map(day => formatDateForDisplay(day.date)),
      datasets: datasets
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: {
          stacked: true
        },
        y: {
          grid: {
            color: gridColor
          },
          beginAtZero: true,
          title: {
            display: true,
            text: 'Hours'
          },
          stacked: true
        }
      },
      interaction: {
        intersect: false,
        mode: 'index'
      },
      elements: {
        bar: {
          barPercentage: 1.0,
          categoryPercentage: 1.0
        }
      },
      plugins: {
        tooltip: {
          callbacks: {
            label: function(context) {
              const datasetIndex = context.datasetIndex;
              const dataIndex = context.dataIndex;
              const lines = [];
              
              // Get the dataset being hovered
              const dataset = context.chart.data.datasets[datasetIndex];
              const label = dataset.label;
              const time = dataset.formattedTimes[dataIndex];
              
              lines.push(`${label}: ${time}`);
              
              // If hovering over domain usage, also show total usage
              if (datasetIndex === 1) { // Domain usage dataset
                const totalDataset = context.chart.data.datasets[0];
                const totalTime = totalDataset.formattedTimes[dataIndex];
                lines.push(`${totalDataset.label}: ${totalTime}`);
              }
              
              return lines;
            }
          }
        }
      }
    }
  };
}

function processDataForAnalytics(timeHistory, targetDomain) {
  const sortedDates = Object.keys(timeHistory).sort();
  
  const dailyData = sortedDates.map(date => {
    const dayData = timeHistory[date];
    
    let domainSeconds = 0;
    let totalSeconds = 0;
    
    if (typeof dayData === 'number') {
      // Old format (shouldn't happen after migration, but just in case)
      domainSeconds = dayData;
      totalSeconds = dayData;
    } else if (typeof dayData === 'object' && dayData) {
      // New format - calculate both domain and total
      domainSeconds = dayData[targetDomain] || 0;
      totalSeconds = Object.values(dayData).reduce((sum, time) => sum + time, 0);
    }
    
    return {
      date: date,
      domainSeconds: domainSeconds,
      totalSeconds: totalSeconds,
      domainHours: domainSeconds / 3600,
      totalHours: totalSeconds / 3600,
      domainFormattedTime: formatTime(domainSeconds),
      totalFormattedTime: formatTime(totalSeconds)
    };
  });
  
  const visibleDataset = CONFIG.daysToDisplay > 0 ? dailyData.slice(-CONFIG.daysToDisplay) : dailyData;
  let movingAverageData = calculateMovingAverage(visibleDataset, CONFIG.movingAverageDays);

  return {
    dailyData: visibleDataset,
    movingAverageData
  };
}

function calculateMovingAverage(dailyData, windowSize) {
  return dailyData.map((dayData, index) => {
    const startIndex = Math.max(0, index - windowSize + 1);
    const maSlidingWindow = dailyData.slice(startIndex, index + 1);
    
    const totalDomainSeconds = maSlidingWindow.reduce((sum, day) => sum + day.domainSeconds, 0);
    const averageDomainSeconds = maSlidingWindow.length > 0 ? totalDomainSeconds / maSlidingWindow.length : 0;
    
    const roundedAverageDomainSeconds = Math.round(averageDomainSeconds);
    const formattedTime = formatTime(roundedAverageDomainSeconds);
    const averageHours = averageDomainSeconds / 3600;
    
    return {
      date: dayData.date,
      averageSeconds: roundedAverageDomainSeconds,
      averageHours: Math.round(averageHours * 10) / 10,  // Round to 1 decimal for display
      formattedTime: formattedTime  
    };
  });
}

function formatDateForDisplay(dateString) {
  const [year, month, day] = dateString.split('-').map(num => parseInt(num, 10));
  
  // Create date using local timezone (months are 0-indexed in JS)
  const date = new Date(year, month - 1, day); 
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[date.getMonth()]} ${date.getDate()}`;
}

function formatTime(totalTime) {
  const hours = Math.floor(totalTime / 3600);
  const minutes = Math.floor((totalTime % 3600) / 60);
  const seconds = totalTime % 60;
  
  const formattedHours = hours.toString().padStart(2, '0');
  const formattedMinutes = minutes.toString().padStart(2, '0');

  return `${formattedHours}:${formattedMinutes}`;
}