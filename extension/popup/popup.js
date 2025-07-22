const CONFIG = {
  movingAverageDays: 7,  // 7-day moving average
  daysToDisplay: 30,     // Number of days to display
};

const COLORS = {
  // Domain colors for charts
  domains: [
    'rgba(69, 113, 231, 0.7)',   // Blue
    'rgba(255, 99, 132, 0.7)',   // Red
    'rgba(255, 205, 86, 0.7)',   // Yellow
    'rgba(75, 192, 192, 0.7)',   // Teal
    'rgba(153, 102, 255, 0.7)',  // Purple
    'rgba(255, 159, 64, 0.7)',   // Orange
    'rgba(199, 199, 199, 0.7)',  // Grey
  ],
  others: 'rgba(150, 150, 150, 0.5)',  // Darker grey for "Others"
  
movingAverage: {
    background: 'rgba(50, 100, 255, .7',
    border: 'rgba(75, 150, 255, .7)',
    width: 2
  },
  currentDomain: {
    background: 'rgba(69, 113, 231, .7)',
    border: 'rgba(69, 113, 231)'
  }
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
  
  // Build total daily time chart
  const totalTimeData = processDataForTotalTime(allTimeHistory);
  console.log('totalTimeData:', totalTimeData);
  
  if (totalTimeData.dailyData.length === 0) {
    generalContent.innerHTML = '<p class="message">No time data available.</p>';
    return;
  }
  
  // Always set up the HTML structure
  generalContent.innerHTML = `
    <canvas id="total-time-chart"></canvas>
    <div id="daily-breakdown" class="daily-breakdown">
      <div class="breakdown-title">Hover over a day to see breakdown</div>
      <div class="breakdown-bars"></div>
    </div>
  `;
  
  console.log('HTML structure created');
  
  const chartConfig = buildTotalTimeChartConfig(totalTimeData);
  console.log('chartConfig:', chartConfig);
  
  const canvasElement = document.getElementById('total-time-chart');
  console.log('canvasElement found:', !!canvasElement);
  
  if (!canvasElement) {
    console.error('Canvas element not found!');
    return;
  }
  
  const canvasContext = canvasElement.getContext('2d');
  console.log('About to create Chart...');
  
  try {
    const chart = new Chart(canvasContext, chartConfig);
    
    // Store reference to data for hover functionality
    chart.totalTimeData = totalTimeData;
    
    console.log('Chart created successfully');
    
    // Verify breakdown elements exist
    const breakdownElement = document.getElementById('daily-breakdown');
    console.log('Breakdown element found:', !!breakdownElement);
    
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

function processDataForTotalTime(timeHistory) {
  const sortedDates = Object.keys(timeHistory).sort();
  
  // Get all unique domains across all days
  const allDomains = new Set();
  sortedDates.forEach(date => {
    const dayData = timeHistory[date];
    if (typeof dayData === 'object' && dayData) {
      Object.keys(dayData).forEach(domain => allDomains.add(domain));
    }
  });
  
  // Convert to array and sort by total usage (biggest domains first)
  const domainsArray = Array.from(allDomains);
  const domainTotals = {};
  
  domainsArray.forEach(domain => {
    domainTotals[domain] = sortedDates.reduce((total, date) => {
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
  
  // Process daily data for ALL dates
  const allDailyData = sortedDates.map(date => {
    const dayData = timeHistory[date];
    let totalSeconds = 0;
    const result = { date };
    
    if (typeof dayData === 'number') {
      // Old format (shouldn't happen after migration, but just in case)
      totalSeconds = dayData;
      // Can't break down by domain in old format
      topDomains.forEach(domain => {
        result[domain] = 0;
      });
      if (otherDomains.length > 0) {
        result['Others'] = dayData / 3600;
      }
    } else if (typeof dayData === 'object' && dayData) {
      // New format - calculate both total and domain breakdown
      totalSeconds = Object.values(dayData).reduce((sum, time) => sum + time, 0);
      
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
    }
    
    result.totalSeconds = totalSeconds;
    result.totalHours = totalSeconds / 3600;
    result.formattedTime = formatTime(totalSeconds);
    
    return result;
  });
  
  // For display: show last 30 days by default, but keep all data available
  const visibleData = CONFIG.daysToDisplay > 0 ? 
    allDailyData.slice(-CONFIG.daysToDisplay) : allDailyData;
  
  // Final domains list: top domains + "Others" if needed
  const finalDomains = [...topDomains];
  if (otherDomains.length > 0) {
    finalDomains.push('Others');
  }
  
  // Calculate moving average for visible data
  const movingAverageData = calculateMovingAverageTotal(visibleData, CONFIG.movingAverageDays);
  
  return {
    dailyData: visibleData,
    allData: allDailyData, // Keep reference to all data for future panning
    domains: finalDomains,
    movingAverageData: movingAverageData
  };
}

function buildTotalTimeChartConfig(totalTimeData) {
  const datasets = [];
  
  // Add moving average FIRST if available - this ensures it's on top
  if (totalTimeData.movingAverageData) {
    datasets.push({
      type: 'line',
      label: `${CONFIG.movingAverageDays}-Day Average`,
      data: totalTimeData.movingAverageData.map(day => day.averageHours),
      formattedTimes: totalTimeData.movingAverageData.map(day => day.formattedTime),
      backgroundColor: COLORS.movingAverage.background,
      borderColor: COLORS.movingAverage.border,
      borderWidth: COLORS.movingAverage.width,
      fill: false,
      tension: 0.2,
      pointRadius: 3,
      order: -1 // Very low order to ensure it's on top
    });
  }
  
  // Then add stacked bar datasets for each domain
  totalTimeData.domains.forEach((domain, index) => {
    // Use special color for "Others" category
    const color = domain === 'Others' ? COLORS.others : COLORS.domains[index % COLORS.domains.length];
    
    datasets.push({
      type: 'bar',
      label: domain,
      data: totalTimeData.dailyData.map(day => day[domain] || 0),
      backgroundColor: color,
      borderColor: color.replace('0.7', '1').replace('0.5', '0.8'),
      borderWidth: 1,
      order: 1 // Higher order for bars
    });
  });
  
  return {
    type: 'bar',
    data: {
      labels: totalTimeData.dailyData.map(day => formatDateForDisplay(day.date)),
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
      interaction: {
        intersect: false,
        mode: 'index'
      },
      elements: {
        bar: {
          barPercentage: 0.8,
          categoryPercentage: 0.9
        }
      },
      plugins: {
        legend: {
          display: false
        },
        tooltip: {
          animation: {
            duration: 200
          },
          backgroundColor: 'rgba(0, 0, 0, 0.5)',
          callbacks: {
            title: function(context) {
              return formatDateForDisplay(totalTimeData.dailyData[context[0].dataIndex].date);
            },
            label: function(context) {
              const dataIndex = context.dataIndex;
              const dayData = totalTimeData.dailyData[dataIndex];
              
              // Check if this is the moving average line
              if (context.dataset.label.includes('Average')) {
                const time = context.dataset.formattedTimes[dataIndex];
                return `${context.dataset.label}: ${time}`;
              }
              
              // For stacked bars, don't show individual domain labels
              return null;
            },
            afterLabel: function(context) {
              // Only show total for the first item to avoid repetition
              if (context.datasetIndex === 0) {
                const dataIndex = context.dataIndex;
                const dayData = totalTimeData.dailyData[dataIndex];
                return `Total: ${dayData.formattedTime}`;
              }
              return null;
            }
          }
        }
      },
      onHover: function(event, elements, chart) {
        console.log('Chart hover detected, elements:', elements.length);
        if (elements.length > 0) {
          const dataIndex = elements[0].index;
          console.log('Hovering over day index:', dataIndex);
          updateDailyBreakdown(chart.totalTimeData, dataIndex);
        }
      }
    }
  };
}
  
function buildChartConfig(processedData) {
  const datasets = [];
  
  // Add moving average FIRST if available - this ensures it's on top
  if (processedData.movingAverageData) {
    datasets.push({
      type: 'line',
      label: `${CONFIG.movingAverageDays}-Day Average`,
      data: processedData.movingAverageData.map(day => day.averageHours),
      formattedTimes: processedData.movingAverageData.map(day => day.formattedTime),
      backgroundColor: COLORS.movingAverage.background,
      borderColor: COLORS.movingAverage.border,
      borderWidth: COLORS.movingAverage.width,
      fill: false,
      tension: 0.2,
      pointRadius: 3,
      order: -1 // Very low order to ensure it's on top
    });
  }
  
  // Then add the domain bar dataset
  datasets.push({
    type: 'bar',
    label: 'Current Domain',
    data: processedData.dailyData.map(day => day.domainHours),
    backgroundColor: COLORS.currentDomain.background,
    borderColor: COLORS.currentDomain.border,
    borderWidth: 1,
    formattedTimes: processedData.dailyData.map(day => day.domainFormattedTime),
    order: 1 // Higher order for bars
  });
  
  return {
    type: 'bar',
    data: {
      labels: processedData.dailyData.map(day => formatDateForDisplay(day.date)),
      datasets: datasets
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        y: {
          grid: {
            color: gridColor
          },
          beginAtZero: true,
          title: {
            display: true,
            text: 'Hours'
          }
        }
      },
      interaction: {
        intersect: false,
        mode: 'index'
      },
      elements: {
        bar: {
          barPercentage: 0.8,
          categoryPercentage: 0.9
        }
      },
      plugins: {
        tooltip: {
          animation: {
            duration: 200
          },
          backgroundColor: 'rgba(0, 0, 0, 0.5)',
          callbacks: {
            label: function(context) {
              const dataset = context.chart.data.datasets[context.datasetIndex];
              const time = dataset.formattedTimes[context.dataIndex];
              return `${dataset.label}: ${time}`;
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

function calculateMovingAverageTotal(dailyData, windowSize) {
  return dailyData.map((dayData, index) => {
    const startIndex = Math.max(0, index - windowSize + 1);
    const maSlidingWindow = dailyData.slice(startIndex, index + 1);
    
    const totalSeconds = maSlidingWindow.reduce((sum, day) => sum + day.totalSeconds, 0);
    const averageSeconds = maSlidingWindow.length > 0 ? totalSeconds / maSlidingWindow.length : 0;
    
    const roundedAverageSeconds = Math.round(averageSeconds);
    const formattedTime = formatTime(roundedAverageSeconds);
    const averageHours = averageSeconds / 3600;
    
    return {
      date: dayData.date,
      averageSeconds: roundedAverageSeconds,
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

function updateDailyBreakdown(totalTimeData, dataIndex) {
  const dayData = totalTimeData.dailyData[dataIndex];
  const breakdownTitle = document.querySelector('.breakdown-title');
  const breakdownBars = document.querySelector('.breakdown-bars');
  
  if (!breakdownTitle || !breakdownBars) return;
  
  // Hide the title since it's redundant with tooltip
  breakdownTitle.style.display = 'none';
  
  // Calculate domain breakdown for this day
  const domainData = [];
  totalTimeData.domains.forEach((domain, index) => {
    const hours = dayData[domain] || 0;
    const seconds = Math.round(hours * 3600);
    if (seconds > 0) {
      const color = domain === 'Others' ? COLORS.others : COLORS.domains[index % COLORS.domains.length];
      domainData.push({
        domain,
        seconds,
        hours,
        color,
        percentage: Math.round((seconds / dayData.totalSeconds) * 100)
      });
    }
  });
  
  // Sort by seconds (descending)
  domainData.sort((a, b) => b.seconds - a.seconds);
  
  // Generate HTML for breakdown bars
  const maxSeconds = domainData.length > 0 ? domainData[0].seconds : 1;
  console.log('Max seconds for bars:', maxSeconds, 'Domain data:', domainData);
  
  breakdownBars.innerHTML = domainData.map(item => {
    // Make bars proportional to longest domain time (maxSeconds = 100%)
    const widthPercent = Math.max((item.seconds / maxSeconds) * 100, 2);
    const formattedTime = formatTime(item.seconds);
    
    console.log(`${item.domain}: ${item.seconds}s / ${maxSeconds}s = ${widthPercent}%`);
    
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
  
  // If no data, show message
  if (domainData.length === 0) {
    breakdownBars.innerHTML = '<div style="color: #888; font-style: italic;">No data for this day</div>';
  }
}

function formatTime(totalTime) {
  const hours = Math.floor(totalTime / 3600);
  const minutes = Math.floor((totalTime % 3600) / 60);
  const seconds = totalTime % 60;
  
  const formattedHours = hours.toString().padStart(2, '0');
  const formattedMinutes = minutes.toString().padStart(2, '0');

  return `${formattedHours}:${formattedMinutes}`;
}