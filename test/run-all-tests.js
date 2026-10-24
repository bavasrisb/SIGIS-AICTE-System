// Master Comprehensive Test Runner for SIGIS (SIH26264)
const runApiTests = require('./test-api');
const runAuthTests = require('./test-auth');
const runDocsTests = require('./test-docs');
const runRealtimeTests = require('./test-realtime');
const runNotificationTests = require('./test-notifications');

async function main() {
  console.log('###############################################################');
  console.log('#   SIGIS (SIH26264) COMPLETE AUTOMATED VERIFICATION SUITE    #');
  console.log('###############################################################\n');

  try {
    console.log('>>> [1/5] Running Core Complaint & Overlap Workflow Tests...');
    await runApiTests();

    console.log('>>> [2/5] Running Authentication & RBAC Tests (Stage 1)...');
    await runAuthTests();

    console.log('>>> [3/5] Running Supporting Document Management Tests (Stage 2)...');
    await runDocsTests();

    console.log('>>> [4/5] Running Real-Time Multi-User SSE Tests (Stage 3)...');
    await runRealtimeTests();

    console.log('>>> [5/5] Running Configurable Notification Tests (Stage 4)...');
    await runNotificationTests();

    console.log('\n===============================================================');
    console.log('🎉 ALL 5 TEST SUITES PASSED CLEANLY WITH ZERO REGRESSIONS!');
    console.log('===============================================================\n');
  } catch (err) {
    console.error('\n❌ Master test runner failed with error:', err);
    process.exit(1);
  }
}

main();
