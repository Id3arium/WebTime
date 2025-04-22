//{"lastDate":"2025-04-20","timeHistory":{"2025-04-10":16886,"2025-04-11":9240,"2025-04-13":5795,"2025-04-14":4796,"2025-04-15":12082,"2025-04-16":17424,"2025-04-17":4197,"2025-04-18":14616,"2025-04-19":19969,"2025-04-20":10923},"version":1}

// This will run when the popup HTML has fully loaded
document.addEventListener('DOMContentLoaded', function() {
    // First, let's get our tracked time data
    browser.storage.local.get("trackedTime").then(function(storedData) {
      console.log("Retrieved data:", storedData); // For debugging
      
      // Check if we have any data
      if (!storedData.trackedTime || !storedData.trackedTime.timeHistory) {
        displayNoDataMessage();
        return;
      }
      
      // Process the data for our chart
      const timeHistory = storedData.trackedTime.timeHistory;
      
      // Now we can work with this data to create our chart
      createTimeChart(timeHistory);
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
  
function createTimeChart(timeHistory) {
  // Get the canvas element
  const canvasElement = document.getElementById('time-chart');
  const canvasContext = canvasElement.getContext('2d');
  
  // Convert the time history object into arrays of dates and hours
  const chartData = processTimeDataForChart(timeHistory);
  
  // Create the chart
  const timeChart = new Chart(canvasContext, {
    type: 'bar',
    data: {
      labels: chartData.dates,
      datasets: [{
        label: 'Hours Spent',
        data: chartData.hours,
        backgroundColor: 'rgba(54, 162, 235, 0.5)',
        borderColor: 'rgba(54, 162, 235, 1)',
        borderWidth: 1
      }]
    },
    options: {
      scales: {
        y: {
          beginAtZero: true,
          title: {
            display: true,
            text: 'Hours'
          }
        }
      },
      responsive: true,
      maintainAspectRatio: false
    }
  });
}

function processTimeDataForChart(timeHistory) {
  // Get dates from the time history object and sort them chronologically
  const dates = Object.keys(timeHistory).sort();
  
  // Convert seconds to hours for each date
  const hours = dates.map(date => {
    const seconds = timeHistory[date] || 0;
    const hours = seconds / 3600; // Convert seconds to hours
    return Math.round(hours * 10) / 10; // Round to 1 decimal place
  });
  
  // Format dates to be more readable (e.g., "Apr 20" instead of "2025-04-20")
  const formattedDates = dates.map(formatDateForDisplay);
  
  return {
    dates: formattedDates,
    hours: hours
  };
}

function formatDateForDisplay(dateString) {
  const date = new Date(dateString);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[date.getMonth()]} ${date.getDate()}`;
}