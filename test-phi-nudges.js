// Test file for φ-based nudge calculations
// Run with: node test-phi-nudges.js

const PHI = (1 + Math.sqrt(5)) / 2;

function calculatePhiNudgeTimes(timeLimitMinutes, reminderIntervalMinutes) {
    const φ = PHI;
    const timeLimitSeconds = timeLimitMinutes * 60;
    
    // Calculate number of nudges: round(φ × sqrt(timeLimit / reminderInterval))
    const numNudges = Math.round(φ * Math.sqrt(timeLimitMinutes / reminderIntervalMinutes));
    
    if (numNudges === 0) return [];
    
    const nudgeTimes = [];
    
    for (let i = 1; i <= numNudges; i++) {
        // Calculate time remaining before limit using φ^i decay
        const timeBeforeLimit = timeLimitSeconds / Math.pow(φ, i);
        
        // Convert to time from start (invert: limit - timeBeforeLimit)
        const baseTimeSeconds = timeLimitSeconds - timeBeforeLimit;
        
        // Add ±2 minute jitter for unpredictability
        const jitterSeconds = (Math.floor(Math.random() * 5) - 2) * 60;
        
        // Ensure nudge is at least 1 minute in and before time limit
        const nudgeTime = Math.max(60, Math.min(timeLimitSeconds - 60, Math.round(baseTimeSeconds + jitterSeconds)));
        
        nudgeTimes.push(nudgeTime);
    }
    
    // Sort ascending (earliest first)
    nudgeTimes.sort((a, b) => a - b);
    
    return nudgeTimes;
}

function formatTime(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}m${secs > 0 ? secs + 's' : ''}`;
}

function testConfiguration(timeLimit, reminderInterval) {
    console.log(`\n${'='.repeat(70)}`);
    console.log(`Time Limit: ${timeLimit}min, Reminder Interval: ${reminderInterval}min`);
    console.log(`${'='.repeat(70)}`);
    
    const nudgeTimes = calculatePhiNudgeTimes(timeLimit, reminderInterval);
    
    console.log(`Number of nudges: ${nudgeTimes.length}`);
    console.log(`\nNudge schedule:`);
    
    let prevTime = 0;
    nudgeTimes.forEach((time, idx) => {
        const interval = time - prevTime;
        const remaining = timeLimit * 60 - time;
        console.log(`  ${idx + 1}. At ${formatTime(time).padEnd(6)} | Gap: ${formatTime(interval).padEnd(6)} | ${formatTime(remaining)} until reminders`);
        prevTime = time;
    });
    
    const gaps = nudgeTimes.map((t, i) => i === 0 ? t : t - nudgeTimes[i-1]).slice(1);
    console.log(`\n  Gap sequence: ${gaps.map(g => formatTime(g)).join(' → ')}`);
    console.log(`  ✓ Gaps ${gaps.every((g, i, arr) => i === 0 || g <= arr[i-1]) ? 'SHRINK' : 'GROW'} (${gaps.every((g, i, arr) => i === 0 || g <= arr[i-1]) ? 'correct! ✅' : 'ERROR ❌'})`);
}

// Test cases
console.log('\n🧪 TESTING φ-BASED NUDGE SYSTEM\n');
console.log('Philosophy: Gaps SHRINK as time passes (sparse early → frequent late)');
console.log('This mirrors natural engagement decay\n');

testConfiguration(150, 12);  // 2.5h limit, 12min reminders → 6 nudges
testConfiguration(60, 15);   // 1h limit, 15min reminders → 3 nudges
testConfiguration(180, 15);  // 3h limit, 15min reminders → 7 nudges
testConfiguration(120, 10);  // 2h limit, 10min reminders → 7 nudges
testConfiguration(30, 5);    // 30min limit, 5min reminders → 4 nudges

console.log('\n' + '='.repeat(70));
console.log('✅ Test complete! Verify that gaps shrink for all configurations.');
console.log('='.repeat(70) + '\n');
