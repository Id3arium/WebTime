//{"lastDate":"2025-04-21","timeHistory":{"2025-04-10":16886,"2025-04-11":9240,"2025-04-13":5795,"2025-04-14":4796,"2025-04-15":12082,"2025-04-16":17424,"2025-04-17":4197,"2025-04-18":14616,"2025-04-19":19969,"2025-04-20":11008,"2025-04-21":15467},"version":1}

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
  
  // Convert the time history object into chart data
  const chartData = processTimeDataForChart(timeHistory);
  
  // Create the chart with custom tooltip
  const timeChart = new Chart(canvasContext, {
    type: 'bar',
    data: {
      labels: chartData.dates,
      datasets: [{
        label: 'Time Spent',
        data: chartData.hours,
        backgroundColor: 'rgba(54, 162, 235, 0.5)',
        borderColor: 'rgba(54, 162, 235, 1)',
        borderWidth: 1,
        // Store the original seconds for tooltip use
        seconds: chartData.seconds  
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
      maintainAspectRatio: false,
      plugins: {
        tooltip: {
          callbacks: {
            // Customize the tooltip display
            label: function(context) {
              const seconds = context.dataset.seconds[context.dataIndex];
              return formatTime(seconds);
            }
          }
        }
      }
    }
  });
}

function processTimeDataForChart(timeHistory) {
  const sortedDates = Object.keys(timeHistory).sort();
  
  // Convert seconds to hours for chart display
  const hours = sortedDates.map(date => {
    const seconds = timeHistory[date] || 0;
    const hours = seconds / 3600; // Convert seconds to hours
    return Math.round(hours * 10) / 10; // Round to 1 decimal place
  });
  
  const seconds = sortedDates.map(date => timeHistory[date] || 0);
  const formattedDates = sortedDates.map(formatDateForDisplay);
  
  return {
    dates: formattedDates,
    hours: hours,
    seconds: seconds  // Added to preserve original data
  };
}

function formatDateForDisplay(dateString) {
  const date = new Date(dateString);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[date.getMonth()]} ${date.getDate()}`;
}

function formatTime(seconds) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  
  const formattedHours = hours.toString().padStart(2, '0');
  const formattedMinutes = minutes.toString().padStart(2, '0');
  
  return `${formattedHours}:${formattedMinutes}`;
}