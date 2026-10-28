// Master Comprehensive Test Runner for SIGIS (SIH26264)
const runApiTests = require('./test-api');
const runAuthTests = require('./test-auth');
const runDocsTests = require('./test-docs');
const runRealtimeTests = require('./test-realtime');
const runNotificationTests = require('./test-notifications');
const runResolutionWorkflowTests = require('./test-resolution-workflow');
const runSecurityTests = require('./test-security');
const runImportTests = require('./test-import');
const runCoordinationWorkloadTests = require('./test-coordination-workload');

async function main() {
  console.log('###############################################################');
  console.log('#   SIGIS (SIH26264) COMPLETE AUTOMATED VERIFICATION SUITE    #');
  console.log('###############################################################\n');

  try {
    console.log('>>> [1/9] Running Core Complaint & Overlap Workflow Tests...');
    await runApiTests();

    console.log('>>> [2/9] Running Authentication & RBAC Tests (Stage 1)...');
    await runAuthTests();

    console.log('>>> [3/9] Running Supporting Document Management Tests (Stage 2)...');
    await runDocsTests();

    console.log('>>> [4/9] Running Real-Time Multi-User SSE Tests (Stage 3)...');
    await runRealtimeTests();

    console.log('>>> [5/9] Running Configurable Notification Tests (Stage 4)...');
    await runNotificationTests();

    console.log('>>> [6/9] Running Connected Resolution Workflow & Governance Tests (Stage 5)...');
    await runResolutionWorkflowTests();

    console.log('>>> [7/9] Running Security Hardening Tests (Access Control, XSS, Brute-Force, Path Traversal)...');
    await runSecurityTests();

    console.log('>>> [8/9] Running Validated CSV Import & Source Reference Tests...');
    await runImportTests();

    console.log('>>> [9/9] Running Officer Workload & Cross-Bureau Coordination Tests...');
    await runCoordinationWorkloadTests();

    console.log('\n===============================================================');
    console.log('🎉 ALL 9 TEST SUITES PASSED CLEANLY WITH ZERO REGRESSIONS!');
    console.log('===============================================================\n');
  } catch (err) {
    console.error('\n❌ Master test runner failed with error:', err);
    process.exit(1);
  }
}

main();
