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
    
    // Return ALL data - no slicing here, window will be handled by Chart.js viewport
    const visibleData = allDailyData;
    
    const finalDomains = [...topDomains];
    if (otherDomains.length > 0) {
      finalDomains.push('Others');
    }
    
    return {
      dailyData: visibleData,
      allData: allDailyData,  // Keep this for compatibility
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
    
    // Return ALL data - scrolling will be handled by Chart.js viewport (like general view)
    const visibleData = dailyData;
    
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
