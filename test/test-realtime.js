// Automated Test Suite for Stage 3: Real-Time Multi-User Updates (SSE)
const assert = require('node:assert');
const http = require('node:http');
const app = require('../server');
const { broadcastEvent, isAuthorizedForEvent } = require('../services/realtimeService');

async function runRealtimeTests() {
  console.log('=== STARTING SIGIS REAL-TIME SSE TEST SUITE ===\n');

  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const BASE_URL = `http://127.0.0.1:${port}`;
  console.log(`[Test Server] Active on ${BASE_URL}\n`);

  let passed = 0;
  let failed = 0;

  async function test(name, fn) {
    try {
      process.stdout.write(`• Testing: ${name}... `);
      await fn();
      console.log('✅ PASS');
      passed++;
    } catch (err) {
      console.log('❌ FAIL');
      console.error('  Error:', err.message);
      failed++;
    }
  }

  // Admin login
  const adminRes = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin@aicte.gov.in', password: 'aicte@admin2026' })
  });
  const adminToken = (await adminRes.json()).token;

  try {
    // 1. Unauthenticated SSE rejection
    await test('1. Connecting to /api/events without authentication rejected with 401', async () => {
      const res = await fetch(`${BASE_URL}/api/events`);
      assert.strictEqual(res.status, 401);
    });

    // 2. Authenticated SSE connection and handshake
    await test('2. Connect to /api/events with valid token receives 200 and text/event-stream headers', async () => {
      const controller = new AbortController();
      const res = await fetch(`${BASE_URL}/api/events`, {
        headers: { 'Authorization': `Bearer ${adminToken}` },
        signal: controller.signal
      });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.headers.get('content-type'), 'text/event-stream');

      // Read initial chunk (connected handshake)
      const reader = res.body.getReader();
      const { value } = await reader.read();
      const text = new TextDecoder().decode(value);

      assert.ok(text.includes('event: connected'));
      assert.ok(text.includes('SIGIS Live Event Stream'));

      controller.abort();
    });

    // 3. Granular Event Authorization Rules
    await test('3. Event delivery boundaries: Bureau Officer only authorized for assigned bureau events', async () => {
      const approvalUser = { role: 'BUREAU_OFFICER', bureau: 'Approval Bureau', email: 'officer.approval@aicte.gov.in' };
      const vigilanceUser = { role: 'BUREAU_OFFICER', bureau: 'Vigilance Cell', email: 'officer.vigilance@aicte.gov.in' };
      const studentUser = { role: 'GUEST_STUDENT', email: 'student.rahul@gmail.com', username: 'student.rahul@gmail.com' };
      const adminUser = { role: 'ADMIN', bureau: null };

      // Case in Approval Bureau
      const approvalEvent = { bureau: 'Approval Bureau', id: 'AICTE-GRV-2026-001', subject: 'Lab infrastructure' };

      // Admin always authorized
      assert.strictEqual(isAuthorizedForEvent(adminUser, 'COMPLAINT_UPDATED', approvalEvent), true);

      // Approval officer is authorized
      assert.strictEqual(isAuthorizedForEvent(approvalUser, 'COMPLAINT_UPDATED', approvalEvent), true);

      // Vigilance officer is NOT authorized for Approval Bureau case
      assert.strictEqual(isAuthorizedForEvent(vigilanceUser, 'COMPLAINT_UPDATED', approvalEvent), false);

      // Student is NOT authorized for someone else's case
      assert.strictEqual(isAuthorizedForEvent(studentUser, 'COMPLAINT_UPDATED', approvalEvent), false);

      // Student IS authorized for their own case
      const studentEvent = { bureau: 'Approval Bureau', complainant_email: 'student.rahul@gmail.com', id: 'AICTE-GRV-2026-999' };
      assert.strictEqual(isAuthorizedForEvent(studentUser, 'COMPLAINT_UPDATED', studentEvent), true);
    });

  } finally {
    server.close();
  }

  console.log('\n===========================================');
  console.log(`REAL-TIME SSE TEST RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log('===========================================\n');

  if (failed > 0) process.exit(1);
}

if (require.main === module) {
  runRealtimeTests();
}

module.exports = runRealtimeTests;
