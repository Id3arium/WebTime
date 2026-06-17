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
 * Parse a YYYY-MM-DD date string safely in local time (avoids UTC midnight timezone issues).
 */
function parseDateLocal(dateStr: DateString): Date {
  const [year, month, day] = dateStr.split('-').map(Number);
  return new Date(year, month - 1, day, 12, 0, 0); // noon local time
}

/**
 * Format date string for display (e.g., "2025-01-15" -> "Jan 15")
 */
export function formatDateForDisplay(dateString: string): string {
  const date = parseDateLocal(dateString);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[date.getMonth()]} ${date.getDate()}`;
}

/**
 * Day-of-week abbreviation (e.g. "2025-01-15" -> "Wed") for a YYYY-MM-DD string.
 */
export function getDayOfWeek(dateString: string): string {
  const date = parseDateLocal(dateString);
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return days[date.getDay()];
}

/**
 * Format a date string with its weekday (e.g. "2025-01-15" -> "Jan 15 (Wed)").
 */
export function formatDateWithDayOfWeek(dateString: string): string {
  return `${formatDateForDisplay(dateString)} (${getDayOfWeek(dateString)})`;
}

/**
 * Debug logging, off in production. Flip DEBUG_ENABLED to true to get the full
 * trace (tab switches, saves, ticks, session/cooldown lifecycle) back.
 */
const DEBUG_ENABLED = false;
export function log(...args: unknown[]): void {
  if (DEBUG_ENABLED) {
    console.log('[WebTime Debug]:', ...args);
  }
}

/**
 * Format time in seconds to a compact human-readable string (e.g. "1h 23m", "45m")
 */
export function formatTimeCompact(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  if (hours > 0 && minutes > 0) return `${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h`;
  return `${minutes}m`;
}

/**
 * Compute 7-day stats for a domain, excluding today.
 * Returns per-day breakdown, mean seconds over days with data, and count of days with data.
 * averageSeconds = 0 and daysWithData = 0 if no history exists.
 *
 * Uses local-time date arithmetic to avoid UTC midnight timezone issues.
 */
export function compute7DayStats(
  timeHistory: TimeHistory,
  domain: Domain,
  currentDateStr: DateString
): SessionStartStats {
  const days: SessionDayStat[] = [];
  const baseDate = parseDateLocal(currentDateStr);

  for (let i = 1; i <= 7; i++) {
    const date = new Date(baseDate);
    date.setDate(date.getDate() - i);
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    const dateStr: DateString = `${yyyy}-${mm}-${dd}`;

    const seconds = timeHistory[dateStr]?.[domain] ?? 0;
    days.unshift({ date: dateStr, seconds });
  }

  const daysWithDataArr = days.filter(d => d.seconds > 0);
  const daysWithData = daysWithDataArr.length;
  const averageSeconds = daysWithData > 0
    ? Math.round(daysWithDataArr.reduce((sum, d) => sum + d.seconds, 0) / daysWithData)
    : 0;

  return { days, averageSeconds, daysWithData };
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
  getDayOfWeek,
  formatDateWithDayOfWeek,
  log,
  formatTimeCompact,
  compute7DayStats,
  escapeHtml
};

export default Utils;
