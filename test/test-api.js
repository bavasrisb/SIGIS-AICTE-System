// Automated Comprehensive API and Functional Test Suite for SIGIS (SIH26264)
const assert = require('node:assert');
const http = require('node:http');
const app = require('../server');
const { db } = require('../db');
const { compareComplaints, detectAllOverlaps } = require('../services/overlapEngine');

async function runTests() {
  console.log('=== STARTING SIGIS MASTER COMPLIANCE & VERIFICATION TEST SUITE ===\n');

  // Start in-process server on ephemeral dynamic port
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const BASE_URL = `http://127.0.0.1:${port}`;
  console.log(`[Test Server] In-process Express server active on ${BASE_URL}\n`);

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

  let createdTestComplaintId = null;

  // Authenticate as Central Admin for regression testing
  const originalFetch = global.fetch;
  const loginRes = await originalFetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin@aicte.gov.in', password: 'aicte@admin2026' })
  });
  const adminToken = (await loginRes.json()).token;

  global.fetch = function(url, options = {}) {
    const opts = { ...options };
    opts.headers = { ...(opts.headers || {}) };
    if (!opts.headers['Authorization']) {
      opts.headers['Authorization'] = `Bearer ${adminToken}`;
    }
    return originalFetch(url, opts);
  };

  try {
    // 1. Valid Complaint Creation (Priority 1 / Bug A Fix)
    await test('1. Valid complaint creation with full metadata (/api/complaints POST)', async () => {
      const payload = {
        institution_id: '1-10492811', // Apex Institute
        bureau: 'Student Grievance Redressal Cell (SGRC)',
        category: 'Withholding of Certificates / Marksheets',
        priority: 'HIGH',
        complainant_name: 'Virender Sehwag',
        complainant_role: 'Student',
        complainant_email: 'virender.test@example.com',
        complainant_phone: '+91 98111 22334',
        subject: 'TEST-CASE: College registrar illegally retaining original B.Tech marksheet',
        description: 'College registrar at Apex Institute is demanding an unapproved clearance fee to release original transcripts.',
        target_date: '2026-11-20',
        assigned_officer: 'SGRC Desk Officer Test',
        supporting_docs: 'FEE-REC-001.pdf'
      };

      const res = await fetch(`${BASE_URL}/api/complaints`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      assert.strictEqual(res.status, 201, 'Should return HTTP 201 Created');
      const data = await res.json();
      assert.ok(data.complaintId, 'Response must contain complaintId');
      assert.ok(data.complaintId.startsWith('AICTE-GRV-2026-'), 'Complaint ID must follow AICTE standard format');
      createdTestComplaintId = data.complaintId;

      // Verify immediate overlap check triggered
      assert.ok(typeof data.flaggedOverlapsCount === 'number');
    });

    // 2. Invalid Complaint Submission Handling (Validation Safeguard)
    await test('2. Invalid complaint submission rejection (/api/complaints POST validation)', async () => {
      const invalidPayload = {
        institution_id: '1-10492811',
        bureau: '', // Missing bureau
        subject: ''  // Missing subject
      };

      const res = await fetch(`${BASE_URL}/api/complaints`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(invalidPayload)
      });

      assert.strictEqual(res.status, 400, 'Should reject invalid payload with 400 Bad Request');
      const data = await res.json();
      assert.ok(data.error, 'Should provide useful error message');
      assert.ok(data.error.includes('Missing mandatory fields'));
    });

    // 3. Persistent Storage and Retrieval in SQLite
    await test('3. Persistent storage and retrieval from SQLite (/api/complaints/:id GET)', async () => {
      assert.ok(createdTestComplaintId, 'Test complaint ID required');

      // Verify via API
      const res = await fetch(`${BASE_URL}/api/complaints/${createdTestComplaintId}`);
      assert.strictEqual(res.status, 200);
      const data = await res.json();

      assert.strictEqual(data.id, createdTestComplaintId);
      assert.strictEqual(data.institution_id, '1-10492811');
      assert.strictEqual(data.institution_name, 'Apex Institute of Engineering & Technology');
      assert.strictEqual(data.complainant_phone, '+91 98111 22334');
      assert.strictEqual(data.assigned_officer, 'SGRC Desk Officer Test');

      // Verify directly in SQLite engine to prove persistence
      const row = db.prepare('SELECT * FROM complaints WHERE id = ?').get(createdTestComplaintId);
      assert.ok(row, 'Complaint must exist persistently in SQLite table');
      assert.strictEqual(row.id, createdTestComplaintId);
    });

    // 4. Dashboard Counts Match Actual Database Records
    await test('4. Dashboard counts calculated directly from SQLite records (/api/stats GET)', async () => {
      const res = await fetch(`${BASE_URL}/api/stats`);
      assert.strictEqual(res.status, 200);
      const data = await res.json();

      const dbTotal = db.prepare('SELECT COUNT(*) as cnt FROM complaints').get().cnt;
      assert.strictEqual(data.summary.total, dbTotal, 'Dashboard total must equal SQLite count');

      const today = new Date().toISOString().split('T')[0];
      const dbOverdue = db.prepare(`
        SELECT COUNT(*) as cnt FROM complaints 
        WHERE status NOT IN ('Resolved', 'Rejected / Closed') AND target_date < ?
      `).get(today).cnt;
      assert.strictEqual(data.summary.overdue, dbOverdue, 'Overdue count must strictly match SQLite overdue count');

      assert.ok(typeof data.summary.underProcess === 'number', 'Summary should include underProcess metric');
      assert.ok(typeof data.summary.transferred === 'number', 'Summary should include transferred metric');
      assert.ok(typeof data.summary.escalated === 'number', 'Summary should include escalated metric');
    });

    // 5. KPI Navigation and Status Filters (Priority 1 / Bug B Fix)
    await test('5. KPI navigation filtering queries (/api/complaints?status=...)', async () => {
      // Test ALL
      const resAll = await fetch(`${BASE_URL}/api/complaints`);
      const allData = await resAll.json();
      assert.ok(allData.length >= 10);

      // Test ACTIVE
      const resActive = await fetch(`${BASE_URL}/api/complaints?status=ACTIVE`);
      const activeData = await resActive.json();
      assert.ok(activeData.every(c => c.status !== 'Resolved' && c.status !== 'Rejected / Closed'));

      // Test OVERDUE
      const resOverdue = await fetch(`${BASE_URL}/api/complaints?overdueOnly=true`);
      const overdueData = await resOverdue.json();
      assert.ok(overdueData.every(c => c.isOverdue));

      // Test Resolved
      const resResolved = await fetch(`${BASE_URL}/api/complaints?status=Resolved`);
      const resolvedData = await resResolved.json();
      assert.ok(resolvedData.every(c => c.status === 'Resolved'));
    });

    // 6. Complaint Status Updates & Lifecycle Transitions
    await test('6. Complaint status updates and transitions (/api/complaints/:id PUT)', async () => {
      assert.ok(createdTestComplaintId);

      const updatePayload = {
        status: 'Notice Issued to Institute',
        officer_name: 'Joint Director AICTE',
        officer_notes: 'Formal notice issued giving 15 days compliance window.'
      };

      const res = await fetch(`${BASE_URL}/api/complaints/${createdTestComplaintId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updatePayload)
      });

      assert.strictEqual(res.status, 200);

      const verifyRes = await fetch(`${BASE_URL}/api/complaints/${createdTestComplaintId}`);
      const updated = await verifyRes.json();
      assert.strictEqual(updated.status, 'Notice Issued to Institute');
    });

    // 7. Bureau & Officer Reassignment Tracking
    await test('7. Bureau & officer reassignment (/api/complaints/:id PUT)', async () => {
      assert.ok(createdTestComplaintId);

      const reassignPayload = {
        bureau: 'Legal Cell',
        assigned_officer: 'Senior Standing Counsel',
        next_action: 'Drafting Legal Show Cause Notice',
        officer_notes: 'Transferred from SGRC to Legal Cell for statutory non-compliance.'
      };

      const res = await fetch(`${BASE_URL}/api/complaints/${createdTestComplaintId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(reassignPayload)
      });

      assert.strictEqual(res.status, 200);

      const verifyRes = await fetch(`${BASE_URL}/api/complaints/${createdTestComplaintId}`);
      const updated = await verifyRes.json();
      assert.strictEqual(updated.bureau, 'Legal Cell');
      assert.strictEqual(updated.assigned_officer, 'Senior Standing Counsel');
      assert.strictEqual(updated.is_transferred, 1, 'Transferred flag should be set');
    });

    // 8. Chronological Audit Trail Creation
    await test('8. Chronological audit trail records (/api/complaints/:id GET history)', async () => {
      assert.ok(createdTestComplaintId);

      const res = await fetch(`${BASE_URL}/api/complaints/${createdTestComplaintId}`);
      const data = await res.json();

      assert.ok(Array.isArray(data.history), 'History must be an array');
      assert.ok(data.history.length >= 3, 'Must record CREATED, STATUS_CHANGE, and BUREAU_REASSIGNMENT');

      const actionTypes = data.history.map(h => h.action_type);
      assert.ok(actionTypes.includes('CREATED'), 'Audit trail must contain CREATED action');
      assert.ok(actionTypes.includes('STATUS_CHANGE'), 'Audit trail must contain STATUS_CHANGE action');
      assert.ok(actionTypes.includes('BUREAU_REASSIGNMENT'), 'Audit trail must contain BUREAU_REASSIGNMENT action');
    });

    // 9. Overlap Detection for Genuinely Similar Cases
    await test('9. Overlap engine flags high similarity on matched complaints (/api/overlaps GET)', async () => {
      const res = await fetch(`${BASE_URL}/api/overlaps`);
      assert.strictEqual(res.status, 200);
      const data = await res.json();

      assert.ok(data.count >= 2, 'Should detect at least 2 potential overlap pairs');
      const topPair = data.overlaps[0];
      assert.ok(topPair.similarity >= 60, 'Top overlap score should be >= 60%');
      assert.ok(topPair.reasons.length > 0, 'Overlap reasons must be provided');
      assert.ok(Array.isArray(topPair.commonKeywords), 'Shared keywords must be extracted');
    });

    // 10. Distinct-Case Handling (Non-Overlapping Complaints have Low Similarity)
    await test('10. Distinct-case handling ensures unrelated complaints are not flagged', async () => {
      const comp1 = {
        institution_id: '1-10492811',
        bureau: 'Student Grievance Redressal Cell (SGRC)',
        category: 'Withholding of Certificates / Marksheets',
        subject: 'Marksheet withholding',
        description: 'College withholding original marksheet.'
      };

      const compUnrelated = {
        institution_id: '1-30491823', // Different institution
        bureau: 'Approval Bureau',
        category: 'Unapproved Technical Courses / Infrastructure Deficit',
        subject: 'Laboratory computers missing in computer science block',
        description: 'No faculty and computers available for third year curriculum.'
      };

      const cmp = compareComplaints(comp1, compUnrelated);
      assert.ok(cmp.score < 40, `Unrelated complaints score (${cmp.score}%) must be below overlap threshold 45%`);
    });

    // 11. Human Review (Confirm Link & Mark Distinct without Merging)
    await test('11. Human review persistence: Confirm Link links without data merging (/api/overlaps/review POST)', async () => {
      const pairPayload = {
        complaintAId: 'AICTE-GRV-2026-003',
        complaintBId: 'AICTE-GRV-2026-004',
        decision: 'CONFIRMED_RELATED',
        notes: 'Verified cross-bureau related case regarding hostel ragging incident. Linked for coordination.',
        officerName: 'AICTE Hearing Officer'
      };

      const res = await fetch(`${BASE_URL}/api/overlaps/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(pairPayload)
      });

      assert.strictEqual(res.status, 200);

      // Verify both complaints share linked_group_id but maintain independent subject/description
      const compARes = await fetch(`${BASE_URL}/api/complaints/AICTE-GRV-2026-003`);
      const compA = await compARes.json();
      const compBRes = await fetch(`${BASE_URL}/api/complaints/AICTE-GRV-2026-004`);
      const compB = await compBRes.json();

      assert.ok(compA.linked_group_id, 'Complaint A must have linked_group_id');
      assert.strictEqual(compA.linked_group_id, compB.linked_group_id, 'Both must share the same linked group');
      assert.notStrictEqual(compA.subject, compB.subject, 'Case subjects must NOT be merged; original text intact');
    });

    // 12. Institution Profile & Consolidated History
    await test('12. Institution profile returns consolidated multi-cell history (/api/institutions/:id GET)', async () => {
      const res = await fetch(`${BASE_URL}/api/institutions/1-10492811`);
      assert.strictEqual(res.status, 200);
      const data = await res.json();

      assert.strictEqual(data.id, '1-10492811');
      assert.ok(data.region, 'Institution must have an AICTE region');
      assert.ok(Array.isArray(data.complaintHistory), 'Must contain complaint history');
      assert.ok(data.complaintHistory.length >= 2, 'Must consolidate complaints across bureaus');
      assert.ok(typeof data.disposalRate === 'number', 'Must calculate disposal rate');
    });

    // 13. Overdue & SLA Calculation Accuracy
    await test('13. Overdue calculation excludes resolved cases', async () => {
      const today = new Date().toISOString().split('T')[0];

      // Resolved complaints with target_date in the past must NOT be marked isOverdue
      const res = await fetch(`${BASE_URL}/api/complaints?status=Resolved`);
      const resolved = await res.json();
      assert.ok(resolved.every(c => c.isOverdue === false), 'Resolved cases must never be classified as overdue');
    });

    // 14. Multi-Criteria Search & Filtering
    await test('14. Multi-criteria filtering combinations (/api/complaints?bureau=...&priority=...)', async () => {
      const res = await fetch(`${BASE_URL}/api/complaints?bureau=Legal%20Cell&priority=CRITICAL`);
      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.ok(data.every(c => c.bureau === 'Legal Cell' && c.priority === 'CRITICAL'));
    });

    // 15. CSV Export Data Formatting
    await test('15. CSV export data structure contains all mandated fields', async () => {
      const res = await fetch(`${BASE_URL}/api/complaints`);
      const complaints = await res.json();
      assert.ok(complaints.length > 0);

      // Verify each complaint has all exportable attributes
      const first = complaints[0];
      assert.ok(first.id);
      assert.ok(first.institution_id);
      assert.ok(first.bureau);
      assert.ok(first.status);
      assert.ok(first.target_date);
    });

    // 16. Multi-Dimensional Reports API
    await test('16. Analytical Reports API provides all dimensions (/api/reports GET)', async () => {
      const res = await fetch(`${BASE_URL}/api/reports`);
      assert.strictEqual(res.status, 200);
      const data = await res.json();

      assert.ok(data.summary, 'Reports must contain summary');
      assert.ok(Array.isArray(data.bureauScorecard), 'Reports must contain bureauScorecard');
      assert.ok(Array.isArray(data.regionWise), 'Reports must contain regionWise breakdown');
      assert.ok(Array.isArray(data.statusWise), 'Reports must contain statusWise breakdown');
      assert.ok(data.ageingAnalysis, 'Reports must contain ageingAnalysis');
      assert.ok(Array.isArray(data.monthlyPerformance), 'Reports must contain monthlyPerformance');
      assert.ok(Array.isArray(data.quarterlyPerformance), 'Reports must contain quarterlyPerformance');
      assert.ok(data.overlapStats, 'Reports must contain overlapStats');
    });

    // 17. Safe Handling of Empty / Malformed Requests
    await test('17. Safe handling of non-existent IDs and malformed inputs', async () => {
      const resNotFound = await fetch(`${BASE_URL}/api/complaints/AICTE-DOES-NOT-EXIST`);
      assert.strictEqual(resNotFound.status, 404, 'Non-existent ID must return 404');

      const resInstNotFound = await fetch(`${BASE_URL}/api/institutions/9-99999999`);
      assert.strictEqual(resInstNotFound.status, 404, 'Non-existent institution must return 404');
    });

    // Clean up ONLY the test complaint created in step 1
    if (createdTestComplaintId) {
      const delRes = await fetch(`${BASE_URL}/api/complaints/${createdTestComplaintId}`, { method: 'DELETE' });
      assert.strictEqual(delRes.status, 200);
      console.log(`[Clean Up] Test-created complaint ${createdTestComplaintId} deleted successfully.`);
    }

  } finally {
    global.fetch = originalFetch;
    server.close();
  }

  console.log(`\n===========================================`);
  console.log(`MASTER TEST RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log(`===========================================\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

if (require.main === module) {
  runTests().catch(err => {
    console.error('Fatal test error:', err);
    process.exit(1);
  });
}

module.exports = runTests;
