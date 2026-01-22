import { Constants } from './constants.js';

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
 * Calculate nudge times using phi-based exponential decay
 */
export function calculatePhiNudgeTimes(
  timeLimitMinutes: number,
  reminderIntervalMinutes: number,
  nudgeCount?: number | null
): number[] {
  const phi = Constants.PHI;
  const timeLimitSeconds = timeLimitMinutes * 60;

  const numNudges = (nudgeCount !== null && nudgeCount !== undefined)
    ? nudgeCount
    : Math.round(phi * Math.sqrt(timeLimitMinutes / reminderIntervalMinutes));

  if (numNudges === 0) return [];

  const nudgeTimes: number[] = [];

  for (let i = 1; i <= numNudges; i++) {
    const timeBeforeLimit = timeLimitSeconds / Math.pow(phi, i);
    const nudgeTime = timeLimitSeconds - timeBeforeLimit;
    const clampedTime = Math.max(60, Math.min(timeLimitSeconds - 60, Math.round(nudgeTime)));
    nudgeTimes.push(clampedTime);
  }

  nudgeTimes.sort((a, b) => a - b);

  return nudgeTimes;
}

/**
 * Format nudge time in seconds to a compact display string
 */
export function formatNudgeTime(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  if (hours > 0) {
    return minutes > 0 ? `${hours}h${minutes}m` : `${hours}h`;
  }
  return `${minutes}m`;
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
  calculatePhiNudgeTimes,
  formatNudgeTime,
  escapeHtml
};

export default Utils;
