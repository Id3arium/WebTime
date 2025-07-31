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
   * Get current date as YYYY-MM-DD string in local timezone
   * @returns {string} Date string in YYYY-MM-DD format
   */
  getLocalDateStr() {
    const now = new Date();
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
  }
};
