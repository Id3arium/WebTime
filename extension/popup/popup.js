//{"lastDate":"2025-04-20","timeHistory":{"2025-04-10":16886,"2025-04-11":9240,"2025-04-13":5795,"2025-04-14":4796,"2025-04-15":12082,"2025-04-16":17424,"2025-04-17":4197,"2025-04-18":14616,"2025-04-19":19969,"2025-04-20":10903},"version":1}

// Fetch data and initialize the popup
async function initPopup() {
    // Get the time data from storage
    const data = await browser.storage.local.get("trackedTime");
    
    if (!data.trackedTime) {
      displayNoDataMessage();
      return;
    }
    
    const timeHistory = data.trackedTime.timeHistory;
    const currentDate = data.trackedTime.lastDate;
    
    // Display today's time
    updateTodayDisplay(timeHistory[currentDate] || 0);
    
    // Process the data and show the default view (week)
    processAndDisplayData("week", timeHistory, currentDate);
    
    // Set up tab buttons
    setupTabButtons(timeHistory, currentDate);
  }
  
  // Calculate moving averages and prepare chart data
  function processAndDisplayData(period, timeHistory, currentDate) {
    // Get date ranges based on the selected period
    const dates = getDateRange(period, currentDate);
    
    // Extract the relevant data points
    const dataPoints = extractDataPoints(dates, timeHistory);
    
    // Calculate moving averages
    const movingAvg = calculateMovingAverage(dataPoints);
    
    // Update summary statistics
    updateStatistics(dataPoints);
    
    // Draw the chart
    drawTimeChart(dates, dataPoints, movingAvg);
  }
  
  // Helper to calculate moving average
  function calculateMovingAverage(dataPoints, windowSize = 7) {
    // Implementation of moving average calculation
    // ...
  }
  
  // Draw chart using chart.js or similar
  function drawTimeChart(dates, dataPoints, movingAvg) {
    const ctx = document.getElementById('timeChart').getContext('2d');
    
    // Chart configuration with daily data and moving average line
    // ...
  }
  
  // Initialize when popup is loaded
  document.addEventListener('DOMContentLoaded', initPopup);