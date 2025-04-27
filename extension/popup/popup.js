//{"lastDate":"2025-04-26","timeHistory":{"2025-04-10":16886,"2025-04-11":9240,"2025-04-13":5795,"2025-04-14":4796,"2025-04-15":12082,"2025-04-16":17424,"2025-04-17":4197,"2025-04-18":14616,"2025-04-19":19969,"2025-04-20":11008,"2025-04-21":15467,"2025-04-22":15631,"2025-04-23":18200,"2025-04-24":5225,"2025-04-25":9963,"2025-04-26":12145},"version":1}

const CONFIG = {
  movingAverageDays: 7,  // 7-day moving average
  daysToDisplay: 30,     // Number of days to display
  chartHeight: 400       // Chart height in pixels
};

// This will run when the popup HTML has fully loaded
document.addEventListener('DOMContentLoaded', function() {
  browser.storage.local.get("trackedTime").then(function(storedData) {
  if (!storedData.trackedTime || !storedData.trackedTime.timeHistory) {
    displayNoDataMessage();
    return;
  }
  
  const timeHistory = storedData.trackedTime.timeHistory;
  const processedData = processDataForAnalytics(timeHistory);
  const chartConfig = buildChartConfig(processedData);
  
  const canvasElement = document.getElementById('time-chart');
  const canvasContext = canvasElement.getContext('2d');
  const timeChart = new Chart(canvasContext, chartConfig);
  
  document.getElementById('chart-container').style.height = `${CONFIG.chartHeight}px`;
    
  }).catch(function(error) {
    console.error("Error retrieving time data:", error);
    displayErrorMessage("Could not load your time data.");
  });
});
  
function displayNoDataMessage() {
    const chartContainer = document.getElementById('chart-container');
    chartContainer.innerHTML = '<p class="message">No tracking data available yet. Start using YouTube to collect data.</p>';
}
  
function displayErrorMessage(message) {
    const chartContainer = document.getElementById('chart-container');
    chartContainer.innerHTML = '<p class="message error">' + message + '</p>';
}
  
function buildChartConfig(processedData) {
  const datasets = [
    {
      type: 'bar',
      label: 'Daily Usage',
      data: processedData.dailyData.map(day => day.hours),
      backgroundColor: 'rgba(54, 162, 235, 0.5)',
      borderColor: 'rgba(54, 162, 235, 1)',
      borderWidth: 1,
      // Store formatted times for tooltips
      formattedTimes: processedData.dailyData.map(day => day.formattedTime)
    }
  ];
  
  if (processedData.movingAverageData) {
    datasets.push({
      type: 'line',
      label: `${CONFIG.movingAverageDays}-Day Average`,
      data: processedData.movingAverageData.map(day => day.averageHours),
      formattedTimes: processedData.movingAverageData.map(day => day.formattedTime),
      backgroundColor: 'rgba(25, 80, 135, 0.35)',
      borderColor: 'rgba(25, 80, 135, .75)',
      borderWidth: 2,
      fill: false,
      tension: 0.2,
      pointRadius: 3
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
        y: {
          beginAtZero: true,
          title: {
            display: true,
            text: 'Hours'
          }
        }
      },
      plugins: {
        tooltip: {
          callbacks: {
            label: function(context) {
              const dailyDataset = context.chart.data.datasets[0]; 
              const avgDataset = context.chart.data.datasets[1];  
              
              const dataIndex = context.dataIndex;
              
              const lines = [];
              
              // Add daily usage line
              const dailyLabel = dailyDataset.label || 'Daily Usage';
              const dailyTime = dailyDataset.formattedTimes[dataIndex];
              lines.push(`${dailyLabel}: ${dailyTime}`);
              
              if (avgDataset) {
                const avgLabel = avgDataset.label || '7-Day Average';
                const avgTime = processedData.movingAverageData[dataIndex].formattedTime;
                lines.push(`${avgLabel}: ${avgTime}`);
              }
              
              return lines;
            }
          }
        }
      }
    }
  };
}

function processDataForAnalytics(timeHistory) {
  const sortedDates = Object.keys(timeHistory).sort();
  
  // Convert raw data to structured daily data
  const dailyData = sortedDates.map(date => ({
    date: date,
    seconds: timeHistory[date] || 0,
    hours: (timeHistory[date] || 0) / 3600,
    formattedTime: formatTime(timeHistory[date] || 0)
  }));
  
  const visibleDataset = CONFIG.daysToDisplay > 0 
    ? dailyData.slice(-CONFIG.daysToDisplay)
    : dailyData;
  
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
    
    const totalSeconds = maSlidingWindow.reduce((sum, day) => sum + day.seconds, 0);
    const averageSeconds = maSlidingWindow.length > 0 ? totalSeconds / maSlidingWindow.length : 0;
    
    const roundedAverageSeconds = Math.round(averageSeconds);
    const formattedTime = formatTime(roundedAverageSeconds);
    const averageHours = averageSeconds / 3600;
    
    return {
      date: dayData.date,
      averageSeconds: Math.round(averageSeconds),  // Round to whole seconds
      averageHours: Math.round(averageHours * 10) / 10,  // Round to 1 decimal for display
      formattedTime: formattedTime  // Add formatted time
    };
  });
}

function formatDateForDisplay(dateString) {
  const date = new Date(dateString);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[date.getMonth()]} ${date.getDate()}`;
}

function formatTime(totalTime) {
  const hours = Math.floor(totalTime / 3600);
  const minutes = Math.floor((totalTime % 3600) / 60);
  const seconds = totalTime % 60;
  
  const formattedHours = hours.toString().padStart(2, '0');
  const formattedMinutes = minutes.toString().padStart(2, '0');
  const formattedSeconds = seconds.toString().padStart(2, '0');
  
  return `${formattedHours}:${formattedMinutes}:${formattedSeconds}`;
}