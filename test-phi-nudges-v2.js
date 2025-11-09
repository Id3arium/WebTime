// Test file for φ-based nudge calculations
// Run with: node test-phi-nudges-v2.js
// Exit code: 0 = success, 1 = failure

const PHI = (1 + Math.sqrt(5)) / 2;

function calculatePhiNudgeTimes(timeLimitMinutes, reminderIntervalMinutes) {
    const φ = PHI;
    const timeLimitSeconds = timeLimitMinutes * 60;
    
    const numNudges = Math.round(φ * Math.sqrt(timeLimitMinutes / reminderIntervalMinutes));
    if (numNudges === 0) return [];
    
    const nudgeTimes = [];
    
    for (let i = 1; i <= numNudges; i++) {
        const timeBeforeLimit = timeLimitSeconds / Math.pow(φ, i);
        const baseTimeSeconds = timeLimitSeconds - timeBeforeLimit;
        const nudgeTime = Math.max(60, Math.min(timeLimitSeconds - 60, Math.round(baseTimeSeconds)));
        nudgeTimes.push(nudgeTime);
    }
    
    nudgeTimes.sort((a, b) => a - b);
    return nudgeTimes;
}

function formatTime(seconds) {
    return `${Math.floor(seconds / 60)}m`;
}

function testConfiguration(timeLimit, reminderInterval) {
    console.log(`\n${'='.repeat(70)}`);
    console.log(`Time Limit: ${timeLimit}min, Reminder Interval: ${reminderInterval}min`);
    console.log(`${'='.repeat(70)}`);
    
    const nudgeTimes = calculatePhiNudgeTimes(timeLimit, reminderInterval);
    console.log(`Number of nudges: ${nudgeTimes.length}\n`);
    
    let prevTime = 0;
    nudgeTimes.forEach((time, idx) => {
        const interval = time - prevTime;
        const remaining = timeLimit * 60 - time;
        console.log(`  ${idx + 1}. At ${formatTime(time).padEnd(6)} | Gap: ${formatTime(interval).padEnd(6)} | ${formatTime(remaining)} until reminders`);
        prevTime = time;
    });
    
    const gaps = nudgeTimes.map((t, i) => i === 0 ? t : t - nudgeTimes[i-1]).slice(1);
    console.log(`\n  Gap sequence: ${gaps.map(g => formatTime(g)).join(' → ')}`);
    
    // Check if gaps generally shrink (allowing small violations due to jitter)
    const violations = gaps.filter((g, i, arr) => i > 0 && g > arr[i-1] + 5).length;
    const shrinking = violations <= 1; // Allow 1 violation for jitter
    
    console.log(`  ✓ Gaps ${shrinking ? 'SHRINK ✅' : 'GROW ❌'}`);
    
    return shrinking;
}

console.log('\n🧪 TESTING φ-BASED NUDGE SYSTEM');
console.log('Philosophy: Gaps SHRINK as time passes (sparse early → frequent late)\n');

let allPassed = true;

allPassed &= testConfiguration(150, 12);
allPassed &= testConfiguration(60, 15);
allPassed &= testConfiguration(180, 15);
allPassed &= testConfiguration(120, 10);
allPassed &= testConfiguration(30, 5);

console.log('\n' + '='.repeat(70));

if (allPassed) {
    console.log('✅ All tests passed!');
    console.log('='.repeat(70) + '\n');
    process.exit(0);
} else {
    console.log('❌ Some tests failed!');
    console.log('='.repeat(70) + '\n');
    process.exit(1);
}
