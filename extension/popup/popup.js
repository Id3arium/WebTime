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
  // Actually render the content
  renderGeneralView();
}

function showDetailView() {
  currentView = ViewState.DETAIL;
  const pagesContainer = document.querySelector('.pages-container');
  pagesContainer.className = 'pages-container show-detail';
}

// View rendering functions
function renderGeneralView() {
  console.log('renderGeneralView called');
  console.log('allTimeHistory:', allTimeHistory);
  
  // Update general page content
  const generalContent = document.querySelector('#general-page .page-content');
  console.log('generalContent found:', !!generalContent);
  
  // Build stacked area chart
  const stackedData = processDataForStackedArea(allTimeHistory);
  console.log('stackedData:', stackedData);
  
  if (stackedData.domains.length === 0) {
    generalContent.innerHTML = '<p class="message">No domain data available for stacked chart.</p>';
    return;
  }
  
  const stackedConfig = buildStackedAreaConfig(stackedData);
  console.log('stackedConfig:', stackedConfig);
  
  generalContent.innerHTML = '<canvas id="stacked-chart"></canvas>';
  
  const canvasElement = document.getElementById('stacked-chart');
  console.log('canvasElement found:', !!canvasElement);
  
  if (!canvasElement) {
    console.error('Canvas element not found!');
    return;
  }
  
  const canvasContext = canvasElement.getContext('2d');
  console.log('About to create Chart...');
  
  try {
    const _stackedChart = new Chart(canvasContext, stackedConfig);
    console.log('Chart created successfully');
  } catch (error) {
    console.error('Error creating chart:', error);
    generalContent.innerHTML = '<p class="message error">Error creating chart: ' + error.message + '</p>';
  }
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

function processDataForStackedArea(timeHistory) {
  const sortedDates = Object.keys(timeHistory).sort();
  const visibleDates = CONFIG.daysToDisplay > 0 ? sortedDates.slice(-CONFIG.daysToDisplay) : sortedDates;
  
  // Get all unique domains across all days
  const allDomains = new Set();
  visibleDates.forEach(date => {
    const dayData = timeHistory[date];
    if (typeof dayData === 'object' && dayData) {
      Object.keys(dayData).forEach(domain => allDomains.add(domain));
    }
  });
  
  // Convert to array and sort by total usage (biggest domains first)
  const domainsArray = Array.from(allDomains);
  const domainTotals = {};
  
  domainsArray.forEach(domain => {
    domainTotals[domain] = visibleDates.reduce((total, date) => {
      const dayData = timeHistory[date];
      if (typeof dayData === 'object' && dayData) {
        return total + (dayData[domain] || 0);
      }
      return total;
    }, 0);
  });
  
  // Sort domains by total usage (descending) and take top 7
  const sortedDomains = domainsArray.sort((a, b) => domainTotals[b] - domainTotals[a]);
  const topDomains = sortedDomains.slice(0, 7);
  const otherDomains = sortedDomains.slice(7);
  
  console.log('Top domains:', topDomains);
  console.log('Other domains:', otherDomains);
  
  // Process daily data for each domain
  const dailyData = visibleDates.map(date => {
    const dayData = timeHistory[date];
    const result = { date };
    
    if (typeof dayData === 'object' && dayData) {
      // Add top domains
      topDomains.forEach(domain => {
        const seconds = dayData[domain] || 0;
        result[domain] = seconds / 3600; // Convert to hours
      });
      
      // Calculate "Others" total
      const othersSeconds = otherDomains.reduce((total, domain) => {
        return total + (dayData[domain] || 0);
      }, 0);
      
      if (othersSeconds > 0) {
        result['Others'] = othersSeconds / 3600;
      }
    } else {
      // Handle old format - no domain breakdown available
      topDomains.forEach(domain => {
        result[domain] = 0;
      });
      if (otherDomains.length > 0) {
        result['Others'] = 0;
      }
    }
    
    return result;
  });
  
  // Final domains list: top domains + "Others" if needed
  const finalDomains = [...topDomains];
  if (otherDomains.length > 0) {
    finalDomains.push('Others');
  }
  
  return {
    dates: visibleDates,
    domains: finalDomains,
    dailyData: dailyData
  };
}

function buildStackedAreaConfig(stackedData) {
  // Generate colors for each domain
  const colors = [
    'rgba(69, 113, 231, 0.7)',   // Blue
    'rgba(255, 99, 132, 0.7)',   // Red
    'rgba(255, 205, 86, 0.7)',   // Yellow
    'rgba(75, 192, 192, 0.7)',   // Teal
    'rgba(153, 102, 255, 0.7)',  // Purple
    'rgba(255, 159, 64, 0.7)',   // Orange
    'rgba(199, 199, 199, 0.7)',  // Grey
    'rgba(150, 150, 150, 0.5)',  // Darker grey for "Others"
  ];
  
  // Create datasets for each domain
  const datasets = stackedData.domains.map((domain, index) => {
    // Use darker grey for "Others" category
    const colorIndex = domain === 'Others' ? 7 : index;
    
    return {
      label: domain,
      data: stackedData.dailyData.map(day => day[domain] || 0),
      backgroundColor: colors[colorIndex % colors.length],
      borderColor: colors[colorIndex % colors.length].replace('0.7', '1').replace('0.5', '0.8'),
      borderWidth: 1,
      fill: true
    };
  });
  
  return {
    type: 'line',
    data: {
      labels: stackedData.dates.map(date => formatDateForDisplay(date)),
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
          stacked: true,
          title: {
            display: true,
            text: 'Hours'
          }
        }
      },
      elements: {
        line: {
          tension: 0.2
        },
        point: {
          radius: 0
        }
      },
      plugins: {
        tooltip: {
          mode: 'index',
          intersect: false,
          animation: {
            duration: 200  // Fast but smooth animation
          },
          backgroundColor: 'rgba(0, 0, 0, 0.6)',  // More transparent background
          callbacks: {
            title: function(context) {
              return formatDateForDisplay(stackedData.dates[context[0].dataIndex]);
            },
            label: function(context) {
              const domain = context.dataset.label;
              const hours = context.parsed.y;
              const minutes = Math.round((hours % 1) * 60);
              const hoursInt = Math.floor(hours);
              
              // Shorten long domain names
              const shortDomain = domain.length > 15 ? domain.substring(0, 12) + '...' : domain;
              
              if (hoursInt === 0 && minutes === 0) {
                return null; // Don't show domains with 0 time
              }
              
              return `${shortDomain}: ${hoursInt}h ${minutes}m`;
            },
            filter: function(tooltipItem) {
              return tooltipItem.parsed.y > 0; // Only show non-zero values
            }
          },
          displayColors: true,
          cornerRadius: 6,
          bodySpacing: 2,
          titleSpacing: 6,
          caretPadding: 8
        }
      }
    }
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
          animation: {
            duration: 200 // Fast but smooth animation
          },
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