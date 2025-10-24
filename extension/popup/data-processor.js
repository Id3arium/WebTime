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
    
    // Process each day independently
    const dailyRankedData = sortedDates.map(date => {
      const rawDayData = timeHistory[date];
      
      // Build domain list for this day
      const domains = [];
      let totalSeconds = 0;
      
      Object.keys(rawDayData).forEach(domain => {
        const seconds = rawDayData[domain] || 0;
        totalSeconds += seconds;
        if (seconds > 0) {
          domains.push({ domain, seconds });
        }
      });
      
      // Sort by seconds descending (rank by usage for this day)
      domains.sort((a, b) => b.seconds - a.seconds);
      
      // Split into top 7 and others
      const topDomains = domains.slice(0, CONFIG.topDomainsLimit);
      const otherDomains = domains.slice(CONFIG.topDomainsLimit);
      
      // Calculate others total
      const othersSeconds = otherDomains.reduce((sum, d) => sum + d.seconds, 0);
      
      // Build ranked structure
      const ranked = {
        date,
        totalSeconds,
        totalHours: totalSeconds / 3600,
        formattedTime: PopUpUtils.formatTime(totalSeconds),
        ranks: [] // Will hold {domain, hours} for each rank position
      };
      
      // Fill rank positions 0-6 (top 7)
      for (let i = 0; i < CONFIG.topDomainsLimit; i++) {
        if (i < topDomains.length) {
          ranked.ranks[i] = {
            domain: topDomains[i].domain,
            hours: topDomains[i].seconds / 3600
          };
        } else {
          ranked.ranks[i] = { domain: null, hours: 0 };
        }
      }
      
      // Add "Others" as rank position 7
      ranked.ranks[CONFIG.topDomainsLimit] = {
        domain: 'Others',
        hours: othersSeconds / 3600,
        count: otherDomains.length
      };
      
      return ranked;
    });
    
    return {
      dailyData: dailyRankedData,
      movingAverageData: this.calculateMovingAverageTotal(dailyRankedData)
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
      
      const totalSeconds = window.reduce((sum, day) => sum + (day.totalSeconds || 0), 0);
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
