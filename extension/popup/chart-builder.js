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

  createRankBasedDatasets(dailyData) {
    const numRanks = CONFIG.topDomainsLimit + 1; // 7 ranks + Others
    const datasets = [];
    
    // Create one dataset per rank position
    // Reverse order so Rank 1 (biggest) is at bottom
    for (let rankIndex = numRanks - 1; rankIndex >= 0; rankIndex--) {
      const isOthers = rankIndex === CONFIG.topDomainsLimit;
      const color = isOthers ? COLORS.others : COLORS.domains[rankIndex % COLORS.domains.length];
      const borderColor = color.replace('0.7', '1').replace('0.6', '0.8');
      
      const dataset = {
        type: 'bar',
        label: isOthers ? 'Others' : `Rank ${rankIndex + 1}`,
        data: [],
        domainNames: [], // Store which domain is in this position each day
        backgroundColor: [],
        borderColor: [],
        borderWidth: [],
        order: rankIndex // Lower rank number = drawn first (at bottom)
      };
      
      // Fill data for each day
      dailyData.forEach(dayData => {
        const rankData = dayData.ranks[rankIndex];
        dataset.data.push(rankData ? rankData.hours : 0);
        dataset.domainNames.push(rankData ? rankData.domain : null);
        dataset.backgroundColor.push(color);
        dataset.borderColor.push(borderColor);
        dataset.borderWidth.push(1);
      });
      
      datasets.push(dataset);
    }
    
    return datasets;
  },

  createSingleDomainDataset(dailyData, label = 'This Day') {
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

  getBaseChartOptions(isGeneralView = false) {
    return {
      animation: { duration: CONFIG.initAnimationDuration },
      responsive: true, // General view is NOT responsive
      maintainAspectRatio: false,
      scales: {
        y: {
          grid: { color: this.getGridColor() },
          beginAtZero: true,
          ticks: {
            color: '#aaa',
            font: {
              size: 11,
              weight: '500'
            }
          },
          title: { 
            display: true, 
            text: 'Hours',
            color: '#ccc',
            font: {
              size: 12,
              weight: '600'
            }
          }
        },
        x: {
          ticks: {
            color: '#888',
            font: {
              size: 10
            }
          }
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

    // Transform moving average to sqrt scale
    if (totalTimeData.movingAverageData) {
      const avgDataset = this.createMovingAverageDataset(
        totalTimeData.movingAverageData,
        `${CONFIG.movingAverageDays}-Day Average`
      );
      avgDataset.data = avgDataset.data.map(val => Math.sqrt(val));
      avgDataset.originalData = totalTimeData.movingAverageData.map(day => day.averageHours);
      datasets.push(avgDataset);
    }

    // Create bars dataset with sqrt-transformed data
    const totalBarsDataset = {
      type: 'bar',
      label: 'Total Time',
      data: totalTimeData.dailyData.map(day => Math.sqrt(day.totalHours)),
      originalData: totalTimeData.dailyData.map(day => day.totalHours),
      formattedTimes: totalTimeData.dailyData.map(day => day.formattedTime),
      backgroundColor: COLORS.currentDomain.background,
      borderColor: COLORS.currentDomain.border,
      borderWidth: 1,
      order: 1
    };
    datasets.push(totalBarsDataset);

    const totalDays = totalTimeData.dailyData.length;
    const windowSize = CONFIG.daysToDisplay;

    // Calculate initial viewport - show most recent days
    const maxIndex = totalDays - 1;
    const minIndex = Math.max(0, totalDays - windowSize);

    // Calculate y-axis max from sqrt-transformed values
    const allTotalHours = totalTimeData.dailyData.map(day => day.totalHours);
    const allSqrtHours = allTotalHours.map(h => Math.sqrt(h));
    const maxSqrt = Math.max(...allSqrtHours);
    // Round up to next nice number for y-axis (e.g., 3.2 -> 3.5, 3.6 -> 4.0)
    const yAxisMax = Math.ceil(maxSqrt * 2) / 2; // Round to nearest 0.5

    const options = {
      ...this.getBaseChartOptions(true),
      scales: {
        ...this.getBaseChartOptions(true).scales,
        x: {
          min: minIndex,
          max: maxIndex,
          display: true
        },
        y: {
          ...this.getBaseChartOptions().scales.y,
          max: yAxisMax,
          ticks: {
            ...this.getBaseChartOptions().scales.y.ticks,
            callback: function(value) {
              // Chart shows sqrt values, but labels show real hours
              const realHours = Math.pow(value, 2);
              return realHours.toFixed(1);
            }
          },
          title: {
            display: true,
            text: 'Hours (√ scale)',
            color: '#ccc',
            font: {
              size: 12,
              weight: '600'
            }
          }
        }
      },
      plugins: {
        legend: { display: false },
        tooltip: this.getGeneralViewTooltipConfig(totalTimeData)
      },
      onHover: (event, elements, chart) => {
        if (elements.length > 0) {
          const dataIndex = elements[0].index;

          // Always update breakdown on hover
          UIManager.updateDailyBreakdown(chart.totalTimeData, dataIndex);
          UIManager.updatePieChart(chart.totalTimeData, dataIndex);

          // Always show hover preview (even when locked)
          ChartBuilder.showHoverPreview(chart, dataIndex);
        } else {
          // No elements detected - treat as "left bars area" even if still on canvas
          if (AppState.isLocked()) {
            // Return to locked day
            ChartBuilder.highlightBar(chart, AppState.lockedDayIndex);
            UIManager.updateDailyBreakdown(chart.totalTimeData, AppState.lockedDayIndex);
            UIManager.updatePieChart(chart.totalTimeData, AppState.lockedDayIndex);
          } else {
            // Return to today if not locked
            const todayIndex = chart.totalTimeData.dailyData.length - 1;
            ChartBuilder.highlightBar(chart, todayIndex);
            UIManager.updateDailyBreakdown(chart.totalTimeData, todayIndex);
            UIManager.updatePieChart(chart.totalTimeData, todayIndex);
          }
        }
      },
      onClick: (event, elements, chart) => {
        if (elements.length > 0) {
          const clickedIndex = elements[0].index;

          if (AppState.lockedDayIndex === clickedIndex) {
            // Clicking the same day unlocks it
            AppState.unlockDay();
            ChartBuilder.removeBarHighlight(chart);
          } else {
            // Lock to new day
            AppState.lockDay(clickedIndex);
            UIManager.updateDailyBreakdown(chart.totalTimeData, clickedIndex);
            UIManager.updatePieChart(chart.totalTimeData, clickedIndex);
            ChartBuilder.highlightBar(chart, clickedIndex);
          }
        } else {
          // Clicked empty area - unlock
          AppState.unlockDay();
          ChartBuilder.removeBarHighlight(chart);
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

    // Transform moving average to sqrt scale
    if (processedData.movingAverageData) {
      const avgDataset = this.createMovingAverageDataset(
        processedData.movingAverageData,
        `${CONFIG.movingAverageDays}-Day Average`
      );
      avgDataset.data = avgDataset.data.map(val => Math.sqrt(val));
      avgDataset.originalData = processedData.movingAverageData.map(day => day.averageHours);
      datasets.push(avgDataset);
    }

    const domainDataset = this.createSingleDomainDataset(processedData.dailyData);
    // Transform domain data to sqrt scale
    domainDataset.data = domainDataset.data.map(val => Math.sqrt(val));
    domainDataset.originalData = processedData.dailyData.map(day => day.domainHours);
    datasets.push(domainDataset);

    const totalDays = processedData.dailyData.length;
    const windowSize = CONFIG.daysToDisplay;

    // Calculate initial viewport - show most recent days
    const maxIndex = totalDays - 1;
    const minIndex = Math.max(0, totalDays - windowSize);

    // Calculate y-axis max from sqrt-transformed values
    const allDomainHours = processedData.dailyData.map(day => day.domainHours);
    const allSqrtHours = allDomainHours.map(h => Math.sqrt(h));
    const maxSqrt = Math.max(...allSqrtHours);
    // Round up to next nice number for y-axis (e.g., 3.2 -> 3.5, 3.6 -> 4.0)
    const yAxisMax = Math.ceil(maxSqrt * 2) / 2; // Round to nearest 0.5

    const options = {
      ...this.getBaseChartOptions(),
      scales: {
        ...this.getBaseChartOptions().scales,
        x: {
          min: minIndex,
          max: maxIndex,
          display: true
        },
        y: {
          ...this.getBaseChartOptions().scales.y,
          max: yAxisMax,
          ticks: {
            ...this.getBaseChartOptions().scales.y.ticks,
            callback: function(value) {
              // Chart shows sqrt values, but labels show real hours
              const realHours = Math.pow(value, 2);
              return realHours.toFixed(1);
            }
          },
          title: {
            display: true,
            text: 'Hours (√ scale)',
            color: '#ccc',
            font: {
              size: 12,
              weight: '600'
            }
          }
        }
      },
      plugins: { tooltip: this.getDetailViewTooltipConfig(processedData) }
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
      backgroundColor: COLORS.tooltipBackground,
      callbacks: {
        title: (context) => {
          const dateString = totalTimeData.dailyData[context[0].dataIndex].date;
          return PopUpUtils.formatDateWithDayOfWeek(dateString);
        },
        label: (context) => {
          const dataIndex = context.dataIndex;
          const dataset = context.dataset;

          // Show total first (bar chart)
          if (dataset.type === 'bar') {
            const dayData = totalTimeData.dailyData[dataIndex];
            return `Total: ${dayData.formattedTime}`;
          }

          // Show average second (line chart)
          if (dataset.label && dataset.label.includes('Average')) {
            const time = dataset.formattedTimes[dataIndex];
            return `${dataset.label}: ${time}`;
          }

          return null;
        }
      }
    };
  },
  
  highlightBar(chart, barIndex) {
    // Add visual highlight to the clicked bar
    chart.data.datasets.forEach((dataset, datasetIndex) => {
      if (dataset.type === 'bar') {
        // Store original colors if not already stored
        if (!dataset._originalBackgroundColor) {
          dataset._originalBackgroundColor = Array.isArray(dataset.backgroundColor)
            ? [...dataset.backgroundColor]
            : dataset.backgroundColor;
          dataset._originalBorderColor = Array.isArray(dataset.borderColor)
            ? [...dataset.borderColor]
            : dataset.borderColor;
          dataset._originalBorderWidth = Array.isArray(dataset.borderWidth)
            ? [...dataset.borderWidth]
            : dataset.borderWidth;
        }

        // Convert to arrays if needed for per-bar styling
        const numBars = dataset.data.length;
        if (!Array.isArray(dataset.backgroundColor)) {
          dataset.backgroundColor = Array(numBars).fill(dataset.backgroundColor);
        }
        if (!Array.isArray(dataset.borderColor)) {
          dataset.borderColor = Array(numBars).fill(dataset.borderColor);
        }
        if (!Array.isArray(dataset.borderWidth)) {
          dataset.borderWidth = Array(numBars).fill(dataset.borderWidth);
        }

        // Reset all bars to original colors first
        const origBg = dataset._originalBackgroundColor;
        const origBorder = dataset._originalBorderColor;
        const origWidth = dataset._originalBorderWidth;

        dataset.backgroundColor = Array.isArray(origBg) ? [...origBg] : Array(numBars).fill(origBg);
        dataset.borderColor = Array.isArray(origBorder) ? [...origBorder] : Array(numBars).fill(origBorder);
        dataset.borderWidth = Array.isArray(origWidth) ? [...origWidth] : Array(numBars).fill(origWidth);

        // Highlight the selected bar
        dataset.borderColor[barIndex] = 'white'; // White border
        dataset.borderWidth[barIndex] = 2;
      }
    });

    chart.update('none'); // Update without animation
  },
  
  removeBarHighlight(chart) {
    // Remove highlight from all bars
    chart.data.datasets.forEach((dataset) => {
      if (dataset.type === 'bar' && dataset._originalBackgroundColor) {
        const numBars = dataset.data.length;
        const origBg = dataset._originalBackgroundColor;
        const origBorder = dataset._originalBorderColor;
        const origWidth = dataset._originalBorderWidth;

        dataset.backgroundColor = Array.isArray(origBg) ? [...origBg] : Array(numBars).fill(origBg);
        dataset.borderColor = Array.isArray(origBorder) ? [...origBorder] : Array(numBars).fill(origBorder);
        dataset.borderWidth = Array.isArray(origWidth) ? [...origWidth] : Array(numBars).fill(origWidth);
      }
    });

    chart.update('none'); // Update without animation
  },
  
  showHoverPreview(chart, barIndex) {
    // Temporarily highlight the hovered bar while preserving locked state
    chart.data.datasets.forEach((dataset) => {
      if (dataset.type === 'bar') {
        // Store original colors if not already stored
        if (!dataset._originalBackgroundColor) {
          dataset._originalBackgroundColor = Array.isArray(dataset.backgroundColor)
            ? [...dataset.backgroundColor]
            : dataset.backgroundColor;
          dataset._originalBorderColor = Array.isArray(dataset.borderColor)
            ? [...dataset.borderColor]
            : dataset.borderColor;
          dataset._originalBorderWidth = Array.isArray(dataset.borderWidth)
            ? [...dataset.borderWidth]
            : dataset.borderWidth;
        }

        // Convert to arrays if needed for per-bar styling
        const numBars = dataset.data.length;
        if (!Array.isArray(dataset.backgroundColor)) {
          dataset.backgroundColor = Array(numBars).fill(dataset.backgroundColor);
        }
        if (!Array.isArray(dataset.borderColor)) {
          dataset.borderColor = Array(numBars).fill(dataset.borderColor);
        }
        if (!Array.isArray(dataset.borderWidth)) {
          dataset.borderWidth = Array(numBars).fill(dataset.borderWidth);
        }

        // Reset all bars to original colors first
        const origBg = dataset._originalBackgroundColor;
        const origBorder = dataset._originalBorderColor;
        const origWidth = dataset._originalBorderWidth;

        dataset.backgroundColor = Array.isArray(origBg) ? [...origBg] : Array(numBars).fill(origBg);
        dataset.borderColor = Array.isArray(origBorder) ? [...origBorder] : Array(numBars).fill(origBorder);
        dataset.borderWidth = Array.isArray(origWidth) ? [...origWidth] : Array(numBars).fill(origWidth);

        // Restore locked highlight if there is one
        if (AppState.isLocked()) {
          dataset.borderColor[AppState.lockedDayIndex] = 'white'; // Solid white for locked
          dataset.borderWidth[AppState.lockedDayIndex] = 2;
        }

        // Show preview highlight (only if different from locked bar)
        if (barIndex !== AppState.lockedDayIndex) {
          dataset.borderColor[barIndex] = 'rgba(255, 255, 255, 0.8)'; // Semi-transparent white for preview
          dataset.borderWidth[barIndex] = 2;
        }
      }
    });

    chart.update('none'); // Update without animation
  },

  getDetailViewTooltipConfig(processedData) {
    return {
      animation: { duration: 200 },
      backgroundColor: COLORS.tooltipBackground,
      callbacks: {
        title: (context) => {
          const dateString = processedData.dailyData[context[0].dataIndex].date;
          return PopUpUtils.formatDateWithDayOfWeek(dateString);
        },
        label: (context) => {
          const dataset = context.chart.data.datasets[context.datasetIndex];
          const dataIndex = context.dataIndex;
          const dayData = processedData.dailyData[dataIndex];
          const time = dataset.formattedTimes[dataIndex];

          // Check if this bar is capped
          if (dataset.type === 'bar' && dayData.domainHours > processedData._yAxisMax) {
            const actualTime = dayData.domainFormattedTime;
            const cappedTime = PopUpUtils.formatTime(processedData._yAxisMax * 3600);
            return `${dataset.label}: ${actualTime} (capped at ${cappedTime} for scale)`;
          }

          return `${dataset.label}: ${time}`;
        }
      }
    };
  },

  buildPieChart(domainData) {
    const labels = domainData.map(item => item.domain);
    const data = domainData.map(item => item.seconds / 3600); // Convert to hours
    const colors = domainData.map(item => item.color);

    return {
      type: 'pie',
      data: {
        labels: labels,
        datasets: [{
          data: data,
          backgroundColor: colors,
          borderColor: colors.map(c => c.replace('0.7', '1')),
          borderWidth: 1
        }]
      },
      options: {
        responsive: false,
        maintainAspectRatio: true,
        plugins: {
          legend: {
            display: false
          },
          tooltip: {
            backgroundColor: COLORS.tooltipBackground,
            callbacks: {
              label: (context) => {
                const domain = context.label;
                const seconds = domainData[context.dataIndex].seconds;
                const percentage = domainData[context.dataIndex].percentage;
                const formattedTime = PopUpUtils.formatTime(seconds);
                return `${domain}: ${formattedTime} (${percentage}%)`;
              }
            }
          }
        },
        onClick: (event, elements, chart) => {
          if (elements.length > 0) {
            const index = elements[0].index;
            const domain = chart.data.labels[index];
            AppState.setSelectedDomain(domain);
            UIManager.renderDetailView(domain);
            UIManager.showDetailView();
          }
        }
      }
    };
  }
};
