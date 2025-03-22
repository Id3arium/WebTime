// Initialize variables
let isTargetSiteActive = false;  // Is a tracked site currently being viewed?
let startTime = 0;               // When did the current browsing session start?
let totalTimeToday = 0;          // Total time spent on tracked sites today
let todayDate = new Date().toDateString(); // Today's date for daily reset
let targetSites = ['youtube.com']; // List of sites to track (expandable in the future)

// Load previously saved data when extension starts
browser.storage.local.get(['date', 'totalTime']).then((result) => {
  // Check if saved date is today
  if (result.date === todayDate) {
    // Continue counting from previous session today
    totalTimeToday = result.totalTime || 0;
  } else {
    // It's a new day, reset the counter
    browser.storage.local.set({
      date: todayDate,
      totalTime: 0
    });
  }
});

// Function to check if a URL is a tracked site
function isTrackedSite(url) {
  if (!url) return false;
  return targetSites.some(site => url.includes(site));
}

// Function to detect when a tracked site is opened in any tab
browser.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  // Check if the tab has completed loading and contains a tracked site URL
  if (changeInfo.status === 'complete' && tab.url && isTrackedSite(tab.url)) {
    // If we weren't already on a tracked site, start the timer
    if (!isTargetSiteActive) {
      startTime = Date.now();
      isTargetSiteActive = true;
    }
  }
});

// Function to detect when user switches between tabs
browser.tabs.onActivated.addListener(async (activeInfo) => {
  // Get information about the newly activated tab
  const tab = await browser.tabs.get(activeInfo.tabId);
  
  // Check if the newly activated tab is a tracked site
  if (tab.url && isTrackedSite(tab.url)) {
    // If we weren't already on a tracked site, start the timer
    if (!isTargetSiteActive) {
      startTime = Date.now();
      isTargetSiteActive = true;
    }
  } else {
    // If we were on a tracked site but now switched away, update the total time
    if (isTargetSiteActive) {
      const timeSpent = Math.floor((Date.now() - startTime) / 1000);
      totalTimeToday += timeSpent;
      isTargetSiteActive = false;
      
      // Save the updated time
      browser.storage.local.set({
        date: tod

        