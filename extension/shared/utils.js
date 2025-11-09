const Utils = {
  /**
   * Extract domain from URL, removing www. prefix
   * @param {string} url - The URL to extract domain from
   * @returns {string|null} Domain name or null if invalid URL
   */
  extractDomain(url) {
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
  },

  /**
   * Format time in seconds to HH:MM format
   * @param {number} totalTime - Time in seconds
   * @returns {string} Formatted time string (HH:MM)
   */
  formatTime(totalTime) {
    const hours = Math.floor(totalTime / 3600);
    const minutes = Math.floor((totalTime % 3600) / 60);
    
    const formattedHours = hours.toString().padStart(2, '0');
    const formattedMinutes = minutes.toString().padStart(2, '0');
    
    return `${formattedHours}:${formattedMinutes}`;
  },

  /**
   * Format time in seconds to HH:MM:SS format (for content script timer)
   * @param {number} timeInSeconds - Time in seconds
   * @returns {string} Formatted time string (HH:MM:SS)
   */
  formatTimeWithSeconds(timeInSeconds) {
    timeInSeconds = Math.max(0, Math.floor(timeInSeconds));
    
    const hours = Math.floor(timeInSeconds / 3600);
    const minutes = Math.floor((timeInSeconds % 3600) / 60);
    const seconds = timeInSeconds % 60;
    
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  },

  /**
   * Get current date as YYYY-MM-DD string in local timezone,
   * adjusted for custom day reset time
   * @param {number} resetHour - Hour when day resets (0-23), defaults to 0 (midnight)
   * @returns {string} Date string in YYYY-MM-DD format
   */
  getLocalDateStr(resetHour = 0) {
    const now = new Date();
    
    // If current hour is before reset hour, use previous day
    if (now.getHours() < resetHour) {
      now.setDate(now.getDate() - 1);
    }
    
    const monthNum = now.getMonth() + 1;
    const yyyy = now.getFullYear();
    const mm = String(monthNum).padStart(2, "0");
    const dd = String(now.getDate()).padStart(2, "0");

    return `${yyyy}-${mm}-${dd}`;
  },

  /**
   * Format date string for display (e.g., "2025-01-15" -> "Jan 15")
   * @param {string} dateString - Date in YYYY-MM-DD format
   * @returns {string} Formatted date for display
   */
  formatDateForDisplay(dateString) {
    const [year, month, day] = dateString.split('-').map(num => parseInt(num, 10));
    
    // Create date using local timezone (months are 0-indexed in JS)
    const date = new Date(year, month - 1, day); 
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${months[date.getMonth()]} ${date.getDate()}`;
  },

  /**
   * Debug logging that can be easily toggled
   * @param {...any} args - Arguments to log
   */
  log(...args) {
    // Set this to false to disable debug logs in production
    const DEBUG_ENABLED = true;
    if (DEBUG_ENABLED) {
      console.log('[WebTime Debug]:', ...args);
    }
  },

  /**
   * Calculate nudge times using φ-based exponential decay
   * @param {number} timeLimitMinutes - When reminders start (in minutes)
   * @param {number} reminderIntervalMinutes - How often reminders repeat (in minutes)
   * @returns {Array<number>} Array of nudge times in seconds, sorted ascending
   */
  calculatePhiNudgeTimes(timeLimitMinutes, reminderIntervalMinutes) {
    const φ = Constants.PHI;
    const timeLimitSeconds = timeLimitMinutes * 60;
    
    // Calculate number of nudges: round(φ × sqrt(timeLimit / reminderInterval))
    const numNudges = Math.round(φ * Math.sqrt(timeLimitMinutes / reminderIntervalMinutes));
    
    if (numNudges === 0) return [];
    
    const nudgeTimes = [];
    
    for (let i = 1; i <= numNudges; i++) {
      // Calculate time remaining before limit using φ^i decay
      const timeBeforeLimit = timeLimitSeconds / Math.pow(φ, i);
      
      const nudgeTime = timeLimitSeconds - timeBeforeLimit;
      const clampedTime = Math.max(60, Math.min(timeLimitSeconds - 60, Math.round(nudgeTime)));
      nudgeTimes.push(clampedTime);
    }
    
    // Sort ascending (earliest first)
    nudgeTimes.sort((a, b) => a - b);
    
    return nudgeTimes;
  },

  /**
   * Format nudge time in seconds to a compact display string
   * @param {number} seconds - Time in seconds
   * @returns {string} Formatted string like "15m" or "1h23m"
   */
  formatNudgeTime(seconds) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    
    if (hours > 0) {
      return minutes > 0 ? `${hours}h${minutes}m` : `${hours}h`;
    }
    return `${minutes}m`;
  }
};
