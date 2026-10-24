// Automated Test Suite for Stage 1: Real Authentication & Role-Based Access Control (RBAC)
const assert = require('node:assert');
const http = require('node:http');
const app = require('../server');
const { db } = require('../db');

async function runAuthTests() {
  console.log('=== STARTING SIGIS AUTH & RBAC VERIFICATION TEST SUITE ===\n');

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

  let adminToken = null;
  let approvalOfficerToken = null;
  let vigilanceOfficerToken = null;
  let studentToken = null;

  try {
    // 1. Valid Admin Login
    await test('1. Login with valid Admin credentials returns 200, token and sanitized user profile', async () => {
      const res = await fetch(`${BASE_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: 'admin@aicte.gov.in',
          password: 'aicte@admin2026'
        })
      });

      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.ok(data.token, 'Should return session token');
      assert.strictEqual(data.user.role, 'ADMIN');
      assert.strictEqual(data.user.password_hash, undefined, 'Must not expose password_hash');
      assert.strictEqual(data.user.salt, undefined, 'Must not expose salt');
      adminToken = data.token;
    });

    // 2. Bureau Officer and Student Login
    await test('2. Login Bureau Officers and Student accounts', async () => {
      // Approval Officer
      const res1 = await fetch(`${BASE_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'officer.approval@aicte.gov.in', password: 'approval@2026' })
      });
      assert.strictEqual(res1.status, 200);
      const data1 = await res1.json();
      approvalOfficerToken = data1.token;
      assert.strictEqual(data1.user.bureau, 'Approval Bureau');

      // Vigilance Officer
      const res2 = await fetch(`${BASE_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'officer.vigilance@aicte.gov.in', password: 'vigilance@2026' })
      });
      assert.strictEqual(res2.status, 200);
      vigilanceOfficerToken = (await res2.json()).token;

      // Student Complainant
      const res3 = await fetch(`${BASE_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'student.rahul@gmail.com', password: 'student@2026' })
      });
      assert.strictEqual(res3.status, 200);
      const data3 = await res3.json();
      studentToken = data3.token;
      assert.strictEqual(data3.user.role, 'GUEST_STUDENT');
    });

    // 3. Invalid credentials rejection
    await test('3. Invalid password or username rejected with 401', async () => {
      const res = await fetch(`${BASE_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'admin@aicte.gov.in', password: 'wrongpassword' })
      });
      assert.strictEqual(res.status, 401);
    });

    // 4. Protected endpoint denies unauthenticated request
    await test('4. Unauthenticated request to /api/complaints denied with 401', async () => {
      const res = await fetch(`${BASE_URL}/api/complaints`);
      assert.strictEqual(res.status, 401);
    });

    // 5. Central Admin has cross-bureau oversight
    await test('5. Central Admin can query all complaints across bureaus', async () => {
      const res = await fetch(`${BASE_URL}/api/complaints`, {
        headers: { 'Authorization': `Bearer ${adminToken}` }
      });
      assert.strictEqual(res.status, 200);
      const complaints = await res.json();
      assert.ok(complaints.length > 5, 'Admin should see all bureau complaints');
    });

    // 6. Bureau Officer is scoped to assigned bureau
    await test('6. Bureau Officer (Approval Bureau) is strictly scoped to Approval Bureau cases', async () => {
      const res = await fetch(`${BASE_URL}/api/complaints`, {
        headers: { 'Authorization': `Bearer ${approvalOfficerToken}` }
      });
      assert.strictEqual(res.status, 200);
      const complaints = await res.json();
      assert.ok(complaints.length > 0);
      for (const c of complaints) {
        assert.strictEqual(c.bureau, 'Approval Bureau', 'Must only return Approval Bureau cases');
      }
    });

    // 7. Bureau Officer cross-bureau access denial
    await test('7. Bureau Officer denied access when attempting to view or edit another bureau case', async () => {
      // Find a case from SGRC or Vigilance
      const otherCase = db.prepare("SELECT id, bureau FROM complaints WHERE bureau != 'Approval Bureau' LIMIT 1").get();
      assert.ok(otherCase, 'Need non-Approval case for test');

      // GET attempt
      const getRes = await fetch(`${BASE_URL}/api/complaints/${otherCase.id}`, {
        headers: { 'Authorization': `Bearer ${approvalOfficerToken}` }
      });
      assert.strictEqual(getRes.status, 403, 'Should deny viewing other bureau complaint with 403');

      // PUT attempt
      const putRes = await fetch(`${BASE_URL}/api/complaints/${otherCase.id}`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${approvalOfficerToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ status: 'Under Bureau Scrutiny' })
      });
      assert.strictEqual(putRes.status, 403, 'Should deny editing other bureau complaint with 403');
    });

    // 8. Student access restriction
    await test('8. Student cannot access analytical reports or overlap review', async () => {
      const resReport = await fetch(`${BASE_URL}/api/reports`, {
        headers: { 'Authorization': `Bearer ${studentToken}` }
      });
      assert.strictEqual(resReport.status, 403, 'Student should be denied from reports');

      const resOverlap = await fetch(`${BASE_URL}/api/overlaps/review`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${studentToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          complaintAId: 'AICTE-GRV-2026-001',
          complaintBId: 'AICTE-GRV-2026-002',
          decision: 'CONFIRMED_RELATED'
        })
      });
      assert.strictEqual(resOverlap.status, 403, 'Student should be denied from overlap adjudication');
    });

    // 9. Session invalidation on Logout
    await test('9. Logout invalidates session token immediately', async () => {
      const logoutRes = await fetch(`${BASE_URL}/api/auth/logout`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${adminToken}` }
      });
      assert.strictEqual(logoutRes.status, 200);

      // Subsequent request using invalidated token should fail
      const testRes = await fetch(`${BASE_URL}/api/complaints`, {
        headers: { 'Authorization': `Bearer ${adminToken}` }
      });
      assert.strictEqual(testRes.status, 401, 'Invalidated session token must be rejected with 401');
    });

  } finally {
    server.close();
  }

  console.log('\n===========================================');
  console.log(`AUTH & RBAC TEST RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log('===========================================\n');

  if (failed > 0) process.exit(1);
}

if (require.main === module) {
  runAuthTests();
}

module.exports = runAuthTests;
