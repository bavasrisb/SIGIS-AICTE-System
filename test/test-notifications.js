// Automated Test Suite for Stage 4: Configurable Email/SMS Notifications
const assert = require('node:assert');
const http = require('node:http');
const app = require('../server');
const { db } = require('../db');
const {
  sendNotification,
  checkAndDispatchSLAAlerts,
  dispatchEscalationAlert,
  dispatchOverlapAlert
} = require('../services/notificationService');

async function runNotificationTests() {
  console.log('=== STARTING SIGIS NOTIFICATION SYSTEM TEST SUITE ===\n');

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

  // Admin and Officer login
  const adminRes = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin@aicte.gov.in', password: 'aicte@admin2026' })
  });
  const adminToken = (await adminRes.json()).token;

  const officerRes = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'officer.approval@aicte.gov.in', password: 'approval@2026' })
  });
  const officerToken = (await officerRes.json()).token;

  const testComplaint = db.prepare('SELECT * FROM complaints LIMIT 1').get();

  try {
    // 1. In-App fallback when external provider is not configured
    await test('1. Dispatch notification without external credentials falls back to SIMULATED_LOCAL', async () => {
      const res = await sendNotification({
        complaintId: testComplaint.id,
        eventType: 'TEST_ALERT',
        recipientEmail: 'test.recipient@example.com',
        subject: 'Test Notification Subject',
        message: 'This is a test notification payload',
        channel: 'EMAIL'
      });

      assert.strictEqual(res.success, true);
      assert.strictEqual(res.status, 'SIMULATED_LOCAL');
      assert.ok(res.idempotencyKey);

      // Verify row in database
      const row = db.prepare('SELECT * FROM notification_logs WHERE idempotency_key = ?').get(res.idempotencyKey);
      assert.ok(row, 'Notification must be recorded in notification_logs');
      assert.strictEqual(row.status, 'SIMULATED_LOCAL');
    });

    // 2. Idempotency Guard (Suppresses duplicate notifications)
    await test('2. Duplicate notification on same day is suppressed by idempotency guard', async () => {
      const res2 = await sendNotification({
        complaintId: testComplaint.id,
        eventType: 'TEST_ALERT',
        recipientEmail: 'test.recipient@example.com',
        subject: 'Test Notification Subject',
        message: 'This is a test notification payload',
        channel: 'EMAIL'
      });

      assert.strictEqual(res2.skipped, true);
      assert.ok(res2.reason.includes('idempotency guard'));
    });

    // 3. Automated SLA Alerts scan
    await test('3. Automated SLA check evaluates active complaints and records logs (/api/notifications/check-sla)', async () => {
      const res = await fetch(`${BASE_URL}/api/notifications/check-sla`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${adminToken}` }
      });

      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.ok(typeof data.triggeredCount === 'number');
      assert.ok(Array.isArray(data.details));
    });

    // 4. Escalation Alert Dispatch
    await test('4. Escalation trigger logs CASE_ESCALATED alert', async () => {
      const res = await dispatchEscalationAlert(testComplaint, 'Urgent inquiry ordered by Director');
      assert.ok(res);
      assert.ok(res.idempotencyKey);
      assert.ok(res.idempotencyKey.includes('CASE_ESCALATED'));
    });

    // 5. Overlap Alert Dispatch
    await test('5. Cross-bureau overlap alert logs OVERLAP_DETECTED event', async () => {
      const otherComplaint = db.prepare('SELECT * FROM complaints WHERE id != ? LIMIT 1').get(testComplaint.id);
      const res = await dispatchOverlapAlert(testComplaint, otherComplaint, 85);
      assert.ok(res);
      assert.ok(res.idempotencyKey);
      assert.ok(res.idempotencyKey.includes('OVERLAP_DETECTED'));
    });

    // 6. Notifications API endpoint authorization
    await test('6. /api/notifications allows Admin access and denies non-Admin with 403', async () => {
      // Admin request
      const adminReq = await fetch(`${BASE_URL}/api/notifications`, {
        headers: { 'Authorization': `Bearer ${adminToken}` }
      });
      assert.strictEqual(adminReq.status, 200);
      const logs = await adminReq.json();
      assert.ok(Array.isArray(logs));
      assert.ok(logs.length > 0);

      // Officer request
      const officerReq = await fetch(`${BASE_URL}/api/notifications`, {
        headers: { 'Authorization': `Bearer ${officerToken}` }
      });
      assert.strictEqual(officerReq.status, 403, 'Non-admin officer must be denied with 403');
    });

  } finally {
    // Clean up test notification entries
    db.prepare("DELETE FROM notification_logs WHERE event_type LIKE 'TEST_%'").run();
    server.close();
  }

  console.log('\n===========================================');
  console.log(`NOTIFICATION SYSTEM TEST RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log('===========================================\n');

  if (failed > 0) process.exit(1);
}

if (require.main === module) {
  runNotificationTests();
}

module.exports = runNotificationTests;
