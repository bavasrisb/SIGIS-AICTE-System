const https = require('node:https');
const http = require('node:http');
const { db } = require('../db');

// Environment configurations
const config = {
  emailProvider: process.env.EMAIL_PROVIDER || 'none', // 'none' | 'webhook' | 'smtp'
  emailFrom: process.env.EMAIL_FROM || 'grievance-alerts@aicte-india.org',
  webhookUrl: process.env.NOTIFICATION_WEBHOOK_URL || null,
  smsProvider: process.env.SMS_PROVIDER || 'none', // 'none' | 'webhook' | 'twilio'
  twilioSid: process.env.TWILIO_ACCOUNT_SID || null,
  twilioToken: process.env.TWILIO_AUTH_TOKEN || null,
  twilioFrom: process.env.TWILIO_FROM || null
};

// Dispatch generic HTTP webhook notification
function dispatchWebhook(url, payload) {
  return new Promise((resolve, reject) => {
    try {
      const parsedUrl = new URL(url);
      const isHttps = parsedUrl.protocol === 'https:';
      const transport = isHttps ? https : http;

      const dataString = JSON.stringify(payload);
      const req = transport.request(parsedUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(dataString)
        },
        timeout: 5000
      }, (res) => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => resolve({ statusCode: res.statusCode, body }));
      });

      req.on('error', err => reject(err));
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Webhook request timed out'));
      });

      req.write(dataString);
      req.end();
    } catch (err) {
      reject(err);
    }
  });
}

// Core notification dispatcher with idempotency check
async function sendNotification({
  complaintId,
  eventType,
  recipientEmail,
  recipientPhone,
  subject,
  message,
  channel = 'EMAIL'
}) {
  const today = new Date().toISOString().split('T')[0];
  const idempotencyKey = `${complaintId}:${eventType}:${channel}:${today}`;

  // Check if identical notification was already sent today
  const existing = db.prepare('SELECT id, status FROM notification_logs WHERE idempotency_key = ?').get(idempotencyKey);
  if (existing) {
    return { skipped: true, reason: 'Duplicate notification suppressed by idempotency guard', existingId: existing.id, idempotencyKey };
  }

  let status = 'SIMULATED_LOCAL';
  let providerResponse = 'No external gateway configured. Logged for in-app alert delivery.';

  // Attempt external dispatch if configured
  if (channel === 'EMAIL' && config.webhookUrl && config.emailProvider === 'webhook') {
    try {
      const res = await dispatchWebhook(config.webhookUrl, {
        type: 'EMAIL',
        complaintId,
        eventType,
        to: recipientEmail,
        from: config.emailFrom,
        subject,
        message
      });
      status = 'DELIVERED';
      providerResponse = `Webhook accepted: HTTP ${res.statusCode}`;
    } catch (err) {
      status = 'FAILED';
      providerResponse = `Webhook error: ${err.message}`;
    }
  } else if (channel === 'SMS' && config.webhookUrl && config.smsProvider === 'webhook') {
    try {
      const res = await dispatchWebhook(config.webhookUrl, {
        type: 'SMS',
        complaintId,
        eventType,
        to: recipientPhone,
        message
      });
      status = 'DELIVERED';
      providerResponse = `SMS Webhook accepted: HTTP ${res.statusCode}`;
    } catch (err) {
      status = 'FAILED';
      providerResponse = `SMS Webhook error: ${err.message}`;
    }
  }

  // Insert into notification audit log
  const insert = db.prepare(`
    INSERT INTO notification_logs (
      complaint_id, event_type, recipient_email, recipient_phone,
      channel, status, provider_response, idempotency_key
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  insert.run(
    complaintId,
    eventType,
    recipientEmail || null,
    recipientPhone || null,
    channel,
    status,
    providerResponse,
    idempotencyKey
  );

  return {
    success: status !== 'FAILED',
    status,
    idempotencyKey,
    providerResponse
  };
}

// Check and trigger SLA warnings and overdue alerts across all active complaints
async function checkAndDispatchSLAAlerts() {
  const today = new Date().toISOString().split('T')[0];
  const complaints = db.prepare(`
    SELECT * FROM complaints 
    WHERE status NOT IN ('Resolved', 'Rejected / Closed')
  `).all();

  const results = [];

  for (const c of complaints) {
    const diffDays = Math.ceil((new Date(c.target_date) - new Date(today)) / (1000 * 60 * 60 * 24));

    if (diffDays < 0) {
      // Complaint is Overdue
      const res = await sendNotification({
        complaintId: c.id,
        eventType: 'COMPLAINT_OVERDUE',
        recipientEmail: c.complainant_email || 'officer@aicte.gov.in',
        recipientPhone: c.complainant_phone,
        subject: `[OVERDUE ALERT] Case ${c.id} exceeded resolution SLA`,
        message: `Complaint ${c.id} (${c.subject}) assigned to ${c.bureau} is overdue by ${Math.abs(diffDays)} days. Target resolution was ${c.target_date}.`,
        channel: 'EMAIL'
      });
      results.push({ id: c.id, type: 'OVERDUE', ...res });
    } else if (diffDays <= 5) {
      // SLA deadline approaching within 5 days
      const res = await sendNotification({
        complaintId: c.id,
        eventType: 'SLA_DEADLINE_APPROACHING',
        recipientEmail: c.complainant_email || 'officer@aicte.gov.in',
        recipientPhone: c.complainant_phone,
        subject: `[SLA REMINDER] Case ${c.id} due in ${diffDays} days`,
        message: `Complaint ${c.id} assigned to ${c.bureau} is nearing its resolution deadline on ${c.target_date}.`,
        channel: 'EMAIL'
      });
      results.push({ id: c.id, type: 'APPROACHING_SLA', ...res });
    }
  }

  return results;
}

// Dispatch alert when a case is escalated
async function dispatchEscalationAlert(complaint, officerRemarks) {
  return sendNotification({
    complaintId: complaint.id,
    eventType: 'CASE_ESCALATED',
    recipientEmail: 'central.admin@aicte.gov.in',
    recipientPhone: complaint.complainant_phone,
    subject: `[CASE ESCALATED] Immediate Attention: Case ${complaint.id}`,
    message: `Case ${complaint.id} (${complaint.subject}) has been escalated to Apex Vigilance Desk. Remarks: ${officerRemarks || 'Escalated by reviewing officer'}.`,
    channel: 'EMAIL'
  });
}

// Dispatch alert when high-confidence overlap is detected
async function dispatchOverlapAlert(complaintA, complaintB, similarityScore) {
  return sendNotification({
    complaintId: complaintA.id,
    eventType: 'OVERLAP_DETECTED',
    recipientEmail: 'central.admin@aicte.gov.in',
    subject: `[OVERLAP DETECTED] Potential duplicate found between ${complaintA.id} and ${complaintB.id}`,
    message: `Cross-bureau overlap detected with ${similarityScore}% confidence between ${complaintA.bureau} and ${complaintB.bureau} for Institution ID ${complaintA.institution_id}.`,
    channel: 'EMAIL'
  });
}

function getNotificationLogs(limit = 50) {
  return db.prepare(`
    SELECT * FROM notification_logs 
    ORDER BY created_at DESC 
    LIMIT ?
  `).all(limit);
}

module.exports = {
  config,
  sendNotification,
  checkAndDispatchSLAAlerts,
  dispatchEscalationAlert,
  dispatchOverlapAlert,
  getNotificationLogs
};
