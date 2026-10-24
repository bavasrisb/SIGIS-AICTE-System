// Automated Test Suite for Stage 2: Supporting Document Upload & Management
const assert = require('node:assert');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const app = require('../server');
const { db } = require('../db');

async function runDocsTests() {
  console.log('=== STARTING SIGIS DOCUMENT UPLOAD & MANAGEMENT TEST SUITE ===\n');

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

  // Obtain Admin & Officer auth tokens
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
  const approvalOfficerToken = (await officerRes.json()).token;

  // Find target complaints
  const approvalCase = db.prepare("SELECT id FROM complaints WHERE bureau = 'Approval Bureau' LIMIT 1").get();
  const nonApprovalCase = db.prepare("SELECT id FROM complaints WHERE bureau != 'Approval Bureau' LIMIT 1").get();

  let uploadedDocId = null;

  try {
    // 1. Valid PDF Upload
    await test('1. Upload genuine PDF file via multipart/form-data (/api/complaints/:id/documents)', async () => {
      // Create valid PDF buffer with %PDF header
      const validPdfBuffer = Buffer.concat([
        Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF'),
        Buffer.from('\nSynthetic AICTE Evidence File')
      ]);

      const form = new FormData();
      const blob = new Blob([validPdfBuffer], { type: 'application/pdf' });
      form.append('document', blob, 'Fee_Receipt_Affidavit.pdf');

      const res = await fetch(`${BASE_URL}/api/complaints/${approvalCase.id}/documents`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${adminToken}`
        },
        body: form
      });

      assert.strictEqual(res.status, 201);
      const data = await res.json();
      assert.ok(data.document);
      assert.strictEqual(data.document.original_filename, 'Fee_Receipt_Affidavit.pdf');
      assert.strictEqual(data.document.mime_type, 'application/pdf');
      uploadedDocId = data.document.id;

      // Verify audit history was recorded
      const hist = db.prepare("SELECT * FROM complaint_history WHERE complaint_id = ? AND action_type = 'DOCUMENT_UPLOADED'").all(approvalCase.id);
      assert.ok(hist.length > 0, 'Audit history must record document upload');
    });

    // 2. Reject Disallowed File Extension
    await test('2. Reject disallowed file format (.sh / .exe) with 400 Bad Request', async () => {
      const form = new FormData();
      const blob = new Blob([Buffer.from('#!/bin/bash\necho exploit')], { type: 'application/x-sh' });
      form.append('document', blob, 'malicious_script.sh');

      const res = await fetch(`${BASE_URL}/api/complaints/${approvalCase.id}/documents`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${adminToken}` },
        body: form
      });

      assert.strictEqual(res.status, 400);
      const data = await res.json();
      assert.ok(data.error);
    });

    // 3. Reject Spoofed File (Extension is .pdf but content magic bytes are text)
    await test('3. Reject spoofed document where extension is .pdf but magic bytes fail validation', async () => {
      const form = new FormData();
      // Content has NO %PDF header
      const blob = new Blob([Buffer.from('THIS IS PLAIN TEXT NOT A REAL PDF FILE')], { type: 'application/pdf' });
      form.append('document', blob, 'spoofed_document.pdf');

      const res = await fetch(`${BASE_URL}/api/complaints/${approvalCase.id}/documents`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${adminToken}` },
        body: form
      });

      assert.strictEqual(res.status, 400);
      const data = await res.json();
      assert.ok(data.error.includes('Security verification failed'));
    });

    // 4. Unauthorized upload rejection
    await test('4. Deny document upload by Bureau Officer to another bureau case (403 Forbidden)', async () => {
      const validPdfBuffer = Buffer.from('%PDF-1.4\nTest PDF');
      const form = new FormData();
      const blob = new Blob([validPdfBuffer], { type: 'application/pdf' });
      form.append('document', blob, 'evidence.pdf');

      const res = await fetch(`${BASE_URL}/api/complaints/${nonApprovalCase.id}/documents`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${approvalOfficerToken}` },
        body: form
      });

      assert.strictEqual(res.status, 403);
    });

    // 5. Document Inline View
    await test('5. View uploaded document inline (/api/documents/:id/view)', async () => {
      assert.ok(uploadedDocId, 'Need uploaded document ID');

      const res = await fetch(`${BASE_URL}/api/documents/${uploadedDocId}/view`, {
        headers: { 'Authorization': `Bearer ${adminToken}` }
      });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.headers.get('content-type'), 'application/pdf');
      const disposition = res.headers.get('content-disposition');
      assert.ok(disposition.includes('inline'));
    });

    // 6. Document Download
    await test('6. Download uploaded document (/api/documents/:id/download)', async () => {
      assert.ok(uploadedDocId, 'Need uploaded document ID');

      const res = await fetch(`${BASE_URL}/api/documents/${uploadedDocId}/download`, {
        headers: { 'Authorization': `Bearer ${adminToken}` }
      });

      assert.strictEqual(res.status, 200);
      const disposition = res.headers.get('content-disposition');
      assert.ok(disposition.includes('attachment'));
      assert.ok(disposition.includes('Fee_Receipt_Affidavit.pdf'));
    });

  } finally {
    // Cleanup test document record and file
    if (uploadedDocId) {
      const record = db.prepare('SELECT stored_filename FROM complaint_documents WHERE id = ?').get(uploadedDocId);
      if (record) {
        const filePath = path.join(__dirname, '..', 'uploads', 'documents', record.stored_filename);
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        db.prepare('DELETE FROM complaint_documents WHERE id = ?').run(uploadedDocId);
      }
    }
    server.close();
  }

  console.log('\n===========================================');
  console.log(`DOCUMENT MANAGEMENT TEST RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log('===========================================\n');

  if (failed > 0) process.exit(1);
}

if (require.main === module) {
  runDocsTests();
}

module.exports = runDocsTests;
