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
      
      // Create arrays for colors to enable per-bar highlighting
      const dataLength = dailyData.length;
      const borderColor = color.replace('0.7', '1').replace('0.5', '0.8');
      
      return {
        type: 'bar',
        label: domain,
        data: dailyData.map(day => day[domain] || 0),
        backgroundColor: new Array(dataLength).fill(color),
        borderColor: new Array(dataLength).fill(borderColor),
        borderWidth: new Array(dataLength).fill(1),
        order: 1
      };
    });
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
    
    const totalDays = totalTimeData.dailyData.length;
    const windowSize = CONFIG.daysToDisplay;
    
    // Calculate initial viewport - show most recent days
    const maxIndex = totalDays - 1;
    const minIndex = Math.max(0, totalDays - windowSize);
    
    // Calculate global max for y-axis (across ALL data, not just visible)
    const globalMaxHours = Math.max(...totalTimeData.dailyData.map(day => day.totalHours));
    const yAxisMax = Math.ceil(globalMaxHours);
    
    const options = {
      ...this.getBaseChartOptions(),
      scales: {
        ...this.getBaseChartOptions().scales,
        x: { 
          stacked: true,
          min: minIndex,
          max: maxIndex,
          display: true
        },
        y: { 
          ...this.getBaseChartOptions().scales.y, 
          stacked: true,
          max: yAxisMax // Lock y-axis to global max
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
          
          // Always show hover preview (even when locked)
          ChartBuilder.showHoverPreview(chart, dataIndex);
        } else {
          // No elements detected - treat as "left bars area" even if still on canvas
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
    
    if (processedData.movingAverageData) {
      const avgDataset = this.createMovingAverageDataset(
        processedData.movingAverageData,
        `${CONFIG.movingAverageDays}-Day Average`
      );
      datasets.push(avgDataset);
    }
    
    const domainDataset = this.createSingleDomainDataset(processedData.dailyData);
    datasets.push(domainDataset);
    
    const totalDays = processedData.dailyData.length;
    const windowSize = CONFIG.daysToDisplay;
    
    // Calculate initial viewport - show most recent days
    const maxIndex = totalDays - 1;
    const minIndex = Math.max(0, totalDays - windowSize);
    
    // Calculate global max for y-axis (across ALL data, not just visible)
    const globalMaxHours = Math.max(...processedData.dailyData.map(day => day.domainHours));
    const yAxisMax = Math.ceil(globalMaxHours);
    
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
          max: yAxisMax // Lock y-axis to global max
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
  
  highlightBar(chart, barIndex) {
    // Add visual highlight to the clicked bar
    chart.data.datasets.forEach((dataset, datasetIndex) => {
      if (dataset.type === 'bar') {
        // Store original colors if not already stored
        if (!dataset._originalBackgroundColor) {
          dataset._originalBackgroundColor = [...dataset.backgroundColor];
          dataset._originalBorderColor = [...dataset.borderColor];
          dataset._originalBorderWidth = [...dataset.borderWidth];
        }
        
        // Reset all bars to original colors first
        dataset.backgroundColor = [...dataset._originalBackgroundColor];
        dataset.borderColor = [...dataset._originalBorderColor];
        dataset.borderWidth = [...dataset._originalBorderWidth];
        
        // Highlight the selected bar
        if (Array.isArray(dataset.borderColor)) {
          dataset.borderColor[barIndex] = 'white'; // White border
          dataset.borderWidth[barIndex] = 1;
        }
      }
    });
    
    chart.update('none'); // Update without animation
  },
  
  removeBarHighlight(chart) {
    // Remove highlight from all bars
    chart.data.datasets.forEach((dataset) => {
      if (dataset.type === 'bar' && dataset._originalBackgroundColor) {
        dataset.backgroundColor = [...dataset._originalBackgroundColor];
        dataset.borderColor = [...dataset._originalBorderColor];
        dataset.borderWidth = [...dataset._originalBorderWidth];
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
          dataset._originalBackgroundColor = [...dataset.backgroundColor];
          dataset._originalBorderColor = [...dataset.borderColor];
          dataset._originalBorderWidth = [...dataset.borderWidth];
        }
        
        // Reset all bars to original colors first
        dataset.backgroundColor = [...dataset._originalBackgroundColor];
        dataset.borderColor = [...dataset._originalBorderColor];
        dataset.borderWidth = [...dataset._originalBorderWidth];
        
        // Restore locked highlight if there is one
        if (AppState.isLocked() && Array.isArray(dataset.borderColor)) {
          dataset.borderColor[AppState.lockedDayIndex] = 'white'; // Solid white for locked
          dataset.borderWidth[AppState.lockedDayIndex] = 1;
        }
        
        // Show preview highlight (only if different from locked bar)
        if (Array.isArray(dataset.borderColor) && barIndex !== AppState.lockedDayIndex) {
          dataset.borderColor[barIndex] = 'rgba(255, 255, 255, 0.8)'; // Semi-transparent white for preview
          dataset.borderWidth[barIndex] = 1;
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
          const time = dataset.formattedTimes[context.dataIndex];
          return `${dataset.label}: ${time}`;
        }
      }
    };
  }
};
