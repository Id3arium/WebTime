export function extractDomain(url: string): string | null {
  try {
    const parsedUrl = new URL(url);
    let hostname = parsedUrl.hostname;
    return hostname.startsWith('www.') ? hostname.substring(4) : hostname;
  } catch (error) {
    console.error("Error parsing URL:", error);
    return null;
  }
}

export function getLocalDateStr(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function formatTime(totalTime: number): string {
  const hours = Math.floor(totalTime / 3600);
  const minutes = Math.floor((totalTime % 3600) / 60);
  const formattedHours = hours.toString().padStart(2, '0');
  const formattedMinutes = minutes.toString().padStart(2, '0');
  return `${formattedHours}:${formattedMinutes}`;
}

export function formatDateForDisplay(dateString: string): string {
  const [year, month, day] = dateString.split('-').map(num => parseInt(num, 10));
  const date = new Date(year, month - 1, day);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[date.getMonth()]} ${date.getDate()}`;
}

export function getDayOfWeek(dateString: string): string {
  const [year, month, day] = dateString.split('-').map(num => parseInt(num, 10));
  const date = new Date(year, month - 1, day);
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return days[date.getDay()];
}

export function formatDateWithDayOfWeek(dateString: string): string {
  const formattedDate = formatDateForDisplay(dateString);
  const dayOfWeek = getDayOfWeek(dateString);
  return `${formattedDate} (${dayOfWeek})`;
}

export const PopUpUtils = {
  extractDomain,
  getLocalDateStr,
  formatTime,
  formatDateForDisplay,
  getDayOfWeek,
  formatDateWithDayOfWeek
};

export default PopUpUtils;
