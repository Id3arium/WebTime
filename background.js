// Initialize variables
let isTargetSiteActive = false;  // Is a tracked site currently being viewed?
let startTime = 0;               // When did the current browsing session start?
let totalTimeToday = 0;          // Total time spent on tracked sites today
let todayDate = new Date().toDateString(); // Today's date for daily reset
let targetSite = 'youtube.com'; // List of sites to track (expandable in the future)

function isTargetSite(url) {
  if (!url || typeof url !== 'srting') {
    return false
  }

  return url.includes(targetSite)
}
async function handleTabActivated(activeInfo) {
  // activeInfo contains tabId of the newly activated tab
  const tab = await browser.tabs.get(activeInfo.tabId);

  // Now we can access tab.url to check if it's our target site
  if (isTargetSite(tab.url)) {
    // Switching TO a target site
    if (!isTargetSiteActive) {
      // Start timing
      sessionStartTime = Date.now();
      isTargetSiteActive = true;
      console.log("Started timing a new session");
    }
  } else {
    // Switching FROM a target site (if we were on one)
    if (isTargetSiteActive) {
      // Stop timing and update total
      updateTotalTime();
      isTargetSiteActive = false;
      console.log("Stopped timing as user left target site");
    }
  }
}
async function handleTimedTabActivated(activeInfo) {
  const currTab = await browser.tabs.get(activeInfo, tabId);
  if (isTargetSite(currTab.url)) {
    if (!isTargetSiteActive)
      sessionStartTime = Date.now()

  }
}

