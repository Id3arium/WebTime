// test-interventions.js
// Tests for the linear nudge + 7-day average intervention system
// Run with: node test-interventions.js

// ── Replicated logic from src/shared/utils.ts ─────────────────────────────

function compute7DayStats(timeHistory, domain, currentDateStr) {
  const days = [];

  for (let i = 1; i <= 7; i++) {
    const date = new Date(currentDateStr);
    date.setDate(date.getDate() - i);
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    const dateStr = `${yyyy}-${mm}-${dd}`;

    const seconds = timeHistory[dateStr]?.[domain] ?? 0;
    days.unshift({ date: dateStr, seconds });
  }

  const daysWithData = days.filter(d => d.seconds > 0);
  const averageSeconds = daysWithData.length > 0
    ? Math.round(daysWithData.reduce((sum, d) => sum + d.seconds, 0) / daysWithData.length)
    : 0;

  return { days, averageSeconds };
}

// ── Test helpers ──────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) {
    console.log(`  ✅ ${label}`);
    passed++;
  } else {
    console.error(`  ❌ ${label}`);
    failed++;
  }
}

function section(title) {
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`  ${title}`);
  console.log('─'.repeat(60));
}

// ── Linear nudge timing ───────────────────────────────────────────────────

section('Linear nudge timing');

function nudgesShouldFire(nudgeIntervalMinutes, timeLimitMinutes) {
  const nudgeIntervalSeconds = nudgeIntervalMinutes * 60;
  const timeLimitSeconds = timeLimitMinutes * 60;
  const fires = [];
  for (let t = 1; t <= timeLimitSeconds; t++) {
    if (t % nudgeIntervalSeconds === 0) fires.push(t);
  }
  return fires;
}

const nudges15 = nudgesShouldFire(15, 60);
assert(nudges15.length === 4, '15min interval over 60min limit fires 4 nudges');
assert(nudges15[0] === 900, 'First nudge at 15min (900s)');
assert(nudges15[3] === 3600, 'Last nudge at 60min (at the limit itself)');

const nudges10 = nudgesShouldFire(10, 45);
assert(nudges10.length === 4, '10min interval over 45min fires 4 nudges');

const nudgesEvenly = nudgesShouldFire(15, 150);
const gaps = nudgesEvenly.map((t, i) => i === 0 ? t : t - nudgesEvenly[i - 1]);
const allEqual = gaps.every(g => g === gaps[0]);
assert(allEqual, 'All gaps are equal (linear, not decaying)');

// ── 7-day average computation ─────────────────────────────────────────────

section('7-day average: compute7DayStats()');

const today = '2025-03-15';
const domain = 'youtube.com';

// Full week of data
const fullWeekHistory = {};
for (let i = 1; i <= 7; i++) {
  const d = new Date(today);
  d.setDate(d.getDate() - i);
  const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  fullWeekHistory[key] = { [domain]: 3600 }; // 1hr every day
}

const fullStats = compute7DayStats(fullWeekHistory, domain, today);
assert(fullStats.averageSeconds === 3600, 'Full week of 1hr/day → average is 3600s');
assert(fullStats.days.length === 7, 'Returns exactly 7 day entries');

// Partial week (3 of 7 days have data)
const partialHistory = {};
const dates = Object.keys(fullWeekHistory);
[dates[0], dates[2], dates[5]].forEach(k => { partialHistory[k] = { [domain]: 7200 }; });

const partialStats = compute7DayStats(partialHistory, domain, today);
assert(partialStats.averageSeconds === 7200, 'Partial week averages only over days with data');

// No data
const emptyStats = compute7DayStats({}, domain, today);
assert(emptyStats.averageSeconds === 0, 'No history → averageSeconds is 0');
assert(emptyStats.days.every(d => d.seconds === 0), 'All days show 0 seconds when no history');

// Today is excluded
const historyWithToday = { ...fullWeekHistory, [today]: { [domain]: 99999 } };
const statsExcludingToday = compute7DayStats(historyWithToday, domain, today);
assert(statsExcludingToday.averageSeconds === 3600, "Today's data is excluded from the average");

// ── Average popup threshold (80% of average) ──────────────────────────────

section('Average popup threshold: 80% of 7-day average');

function averagePopupThreshold(averageSeconds) {
  return Math.round(averageSeconds * 0.8);
}

assert(averagePopupThreshold(3600) === 2880, '1hr avg → popup at 48min (2880s = 80%)');
assert(averagePopupThreshold(1800) === 1440, '30min avg → popup at 24min (1440s = 80%)');
assert(averagePopupThreshold(14400) === 11520, '4hr avg → popup at 3h12m (11520s = 80%)');
assert(averagePopupThreshold(0) === 0, 'No data → threshold is 0 (popup skipped by guard)');

// Verify the minutesLeft calculation at threshold
const avg = 3600;
const threshold = averagePopupThreshold(avg);
const minutesLeftAtThreshold = Math.round((avg - threshold) / 60);
assert(minutesLeftAtThreshold === 12, '1hr avg: ~12min left shown when popup fires at 80%');

// ── Summary ───────────────────────────────────────────────────────────────

console.log(`\n${'='.repeat(60)}`);
if (failed === 0) {
  console.log(`✅ All ${passed} tests passed!`);
  console.log('='.repeat(60) + '\n');
  process.exit(0);
} else {
  console.log(`❌ ${failed} test(s) failed, ${passed} passed.`);
  console.log('='.repeat(60) + '\n');
  process.exit(1);
}
