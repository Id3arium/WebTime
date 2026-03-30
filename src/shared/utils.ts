import type { TimeHistory, Domain, DateString, SessionDayStat, SessionStartStats } from '../types.js';

/**
 * Extract domain from URL, removing www. prefix
 */
export function extractDomain(url: string): string | null {
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
}

/**
 * Format time in seconds to HH:MM format
 */
export function formatTime(totalTime: number): string {
  const hours = Math.floor(totalTime / 3600);
  const minutes = Math.floor((totalTime % 3600) / 60);

  const formattedHours = hours.toString().padStart(2, '0');
  const formattedMinutes = minutes.toString().padStart(2, '0');

  return `${formattedHours}:${formattedMinutes}`;
}

/**
 * Format time in seconds to HH:MM:SS format (for content script timer)
 */
export function formatTimeWithSeconds(timeInSeconds: number): string {
  timeInSeconds = Math.max(0, Math.floor(timeInSeconds));

  const hours = Math.floor(timeInSeconds / 3600);
  const minutes = Math.floor((timeInSeconds % 3600) / 60);
  const seconds = timeInSeconds % 60;

  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

/**
 * Get current date as YYYY-MM-DD string in local timezone,
 * adjusted for custom day reset time
 */
export function getLocalDateStr(resetHour: number = 0): string {
  const now = new Date();

  if (now.getHours() < resetHour) {
    now.setDate(now.getDate() - 1);
  }

  const monthNum = now.getMonth() + 1;
  const yyyy = now.getFullYear();
  const mm = String(monthNum).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");

  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Format date string for display (e.g., "2025-01-15" -> "Jan 15")
 */
export function formatDateForDisplay(dateString: string): string {
  const [year, month, day] = dateString.split('-').map(num => parseInt(num, 10));

  const date = new Date(year, month - 1, day);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[date.getMonth()]} ${date.getDate()}`;
}

/**
 * Debug logging that can be easily toggled
 */
export function log(...args: unknown[]): void {
  const DEBUG_ENABLED = true;
  if (DEBUG_ENABLED) {
    console.log('[WebTime Debug]:', ...args);
  }
}

/**
 * Format time in seconds to a compact human-readable string (e.g. "1h 23min", "45min")
 */
export function formatTimeCompact(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  if (hours > 0 && minutes > 0) return `${hours}h ${minutes}min`;
  if (hours > 0) return `${hours}h`;
  return `${minutes}min`;
}

/**
 * Compute 7-day moving average for a domain, excluding today.
 * Returns { days, averageSeconds } where days is the per-day breakdown
 * for the last 7 days (ascending), and averageSeconds is the mean.
 * Returns averageSeconds = 0 if no data exists.
 */
export function compute7DayStats(
  timeHistory: TimeHistory,
  domain: Domain,
  currentDateStr: DateString
): SessionStartStats {
  const days: SessionDayStat[] = [];

  for (let i = 1; i <= 7; i++) {
    const date = new Date(currentDateStr);
    date.setDate(date.getDate() - i);
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    const dateStr: DateString = `${yyyy}-${mm}-${dd}`;

    const seconds = timeHistory[dateStr]?.[domain] ?? 0;
    days.unshift({ date: dateStr, seconds });
  }

  const daysWithData = days.filter(d => d.seconds > 0);
  const averageSeconds = daysWithData.length > 0
    ? Math.round(daysWithData.reduce((sum, d) => sum + d.seconds, 0) / daysWithData.length)
    : 0;

  return { days, averageSeconds };
}

/**
 * Escape HTML special characters to prevent XSS attacks
 */
export function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Export as Utils object for backwards compatibility
export const Utils = {
  extractDomain,
  formatTime,
  formatTimeWithSeconds,
  getLocalDateStr,
  formatDateForDisplay,
  log,
  formatTimeCompact,
  compute7DayStats,
  escapeHtml
};

export default Utils;
