const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { db, initSchema } = require('./db');
const { detectAllOverlaps, compareComplaints } = require('./services/overlapEngine');
const { seedDatabase } = require('./seed');
const {
  seedUsers,
  authenticateUser,
  validateSession,
  invalidateSession
} = require('./services/authService');
const {
  upload,
  validateMagicBytes,
  saveDocumentRecord,
  getDocumentsForComplaint,
  getDocumentRecord,
  getDocumentFilePath
} = require('./services/documentService');
const {
  registerClient,
  broadcastEvent
} = require('./services/realtimeService');
const {
  sendNotification,
  checkAndDispatchSLAAlerts,
  dispatchEscalationAlert,
  dispatchOverlapAlert,
  getNotificationLogs
} = require('./services/notificationService');

const app = express();
const PORT = process.env.PORT || 3000;

// Initialize Database schema and demo accounts
initSchema();
seedUsers();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Cookie parsing helper
function parseCookies(req) {
  const list = {};
  const rc = req.headers.cookie;
  if (rc) {
    rc.split(';').forEach(cookie => {
      const parts = cookie.split('=');
      list[parts.shift().trim()] = decodeURI(parts.join('='));
    });
  }
  return list;
}

// Authentication Middleware
function authenticateRequest(req, res, next) {
  let token = null;
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.slice(7).trim();
  } else {
    const cookies = parseCookies(req);
    token = cookies['sigis_session'] || null;
  }

  if (token) {
    req.user = validateSession(token);
  } else {
    req.user = null;
  }
  next();
}

app.use(authenticateRequest);

// Route Guards
function requireAuth(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: 'Authentication required. Please log in.' });
  }
  next();
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required. Please log in.' });
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        error: `Forbidden: Action requires role [${roles.join(', ')}] but user has role '${req.user.role}'.`
      });
    }
    next();
  };
}

// Helper: Check if target date is overdue (relative to current date)
function isOverdue(targetDate, status) {
  if (status === 'Resolved' || status === 'Rejected / Closed') return false;
  const today = new Date().toISOString().split('T')[0];
  return targetDate < today;
}

// -------------------------------------------------------------
// 0. AUTHENTICATION & SESSION MANAGEMENT APIS
// -------------------------------------------------------------
app.post('/api/auth/login', (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required.' });
    }

    const session = authenticateUser(username, password);
    if (!session) {
      return res.status(401).json({ error: 'Invalid username or password.' });
    }

    // Secure HttpOnly session cookie
    res.setHeader('Set-Cookie', `sigis_session=${session.token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400`);

    res.json({
      message: 'Login successful',
      token: session.token,
      user: session.user,
      expiresAt: session.expiresAt
    });
  } catch (err) {
    console.error('Error during login:', err);
    res.status(500).json({ error: 'Internal login error' });
  }
});

app.post('/api/auth/logout', (req, res) => {
  try {
    let token = null;
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.slice(7).trim();
    } else {
      const cookies = parseCookies(req);
      token = cookies['sigis_session'] || null;
    }

    if (token) {
      invalidateSession(token);
    }

    res.setHeader('Set-Cookie', 'sigis_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
    res.json({ message: 'Logged out successfully' });
  } catch (err) {
    console.error('Error during logout:', err);
    res.status(500).json({ error: 'Failed to logout' });
  }
});

app.get('/api/auth/me', (req, res) => {
  if (!req.user) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  res.json({ user: req.user });
});

app.get('/api/auth/demo-accounts', (req, res) => {
  res.json([
    {
      role: 'ADMIN',
      username: 'admin@aicte.gov.in',
      title: 'Central Admin (AICTE Headquarters)',
      bureau: 'All AICTE Bureaus',
      fullName: 'Dr. Ramesh Sharma (Central Grievance Director)',
      description: 'Full cross-bureau oversight, transfers, escalations, overlap review, reports'
    },
    {
      role: 'BUREAU_OFFICER',
      username: 'officer.approval@aicte.gov.in',
      title: 'Approval Bureau Officer',
      bureau: 'Approval Bureau',
      fullName: 'Prof. Meenakshi Sundaram (Approval Bureau Officer)',
      description: 'Access restricted to Approval Bureau institution compliance cases'
    },
    {
      role: 'BUREAU_OFFICER',
      username: 'officer.sgrc@aicte.gov.in',
      title: 'SGRC Desk Officer',
      bureau: 'Student Grievance Redressal Cell (SGRC)',
      fullName: 'Er. Amitav Sen (SGRC Desk Officer)',
      description: 'Access restricted to Student Grievance Redressal Cell cases'
    },
    {
      role: 'BUREAU_OFFICER',
      username: 'officer.vigilance@aicte.gov.in',
      title: 'Chief Vigilance Officer',
      bureau: 'Vigilance Cell',
      fullName: 'Shri R. K. Verma (Chief Vigilance Officer)',
      description: 'Access restricted to Vigilance Cell investigation cases'
    },
    {
      role: 'BUREAU_OFFICER',
      username: 'officer.antiragging@aicte.gov.in',
      title: 'Anti-Ragging Cell Officer',
      bureau: 'Anti-Ragging Cell',
      fullName: 'Dr. K. S. Rao (Anti-Ragging Cell Officer)',
      description: 'Access restricted to Anti-Ragging Cell cases'
    },
    {
      role: 'BUREAU_OFFICER',
      username: 'officer.faculty@aicte.gov.in',
      title: 'Faculty Grievance Officer',
      bureau: 'Faculty & Staff Grievance Cell',
      fullName: 'Dr. Ananya Roy (Faculty Grievance Officer)',
      description: 'Access restricted to Faculty & Staff Grievance cases'
    },
    {
      role: 'BUREAU_OFFICER',
      username: 'officer.regional@aicte.gov.in',
      title: 'Regional Bureau Officer',
      bureau: 'Regional Bureau / Regional Office (RB)',
      fullName: 'Er. Pradeep Nair (Regional Bureau Officer)',
      description: 'Access restricted to Regional Bureau cases'
    },
    {
      role: 'BUREAU_OFFICER',
      username: 'officer.pgrc@aicte.gov.in',
      title: 'Public Grievance Officer',
      bureau: 'Public Grievance Redressal Cell (PGRC)',
      fullName: 'Smt. Geeta Mathur (Public Grievance Officer)',
      description: 'Access restricted to Public Grievance Redressal Cell cases'
    },
    {
      role: 'GUEST_STUDENT',
      username: 'student.rahul@gmail.com',
      title: 'Student Complainant',
      bureau: 'Complainant Portal',
      fullName: 'Rahul Verma (B.Tech Complainant)',
      description: 'Can lodge grievances and track only their own registered case history'
    }
  ]);
});

// -------------------------------------------------------------
// 0.1 OFFICERS DIRECTORY API (Authorized Officer Assignment)
// -------------------------------------------------------------
app.get('/api/officers', requireAuth, (req, res) => {
  try {
    const { bureau } = req.query;
    let query = `
      SELECT id, username, full_name, role, bureau, email
      FROM users
      WHERE role IN ('ADMIN', 'BUREAU_OFFICER')
    `;
    const params = [];
    if (bureau && bureau !== 'ALL') {
      query += ` AND (bureau = ? OR role = 'ADMIN')`;
      params.push(bureau);
    }
    query += ` ORDER BY role ASC, full_name ASC`;
    const officers = db.prepare(query).all(...params);
    res.json(officers);
  } catch (err) {
    console.error('Error fetching officers:', err);
    res.status(500).json({ error: 'Failed to fetch officers' });
  }
});

// -------------------------------------------------------------
// 1. STATS & ANALYTICS API (Single-Window Dashboard Compliance)
// -------------------------------------------------------------
app.get('/api/stats', (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];

    let complaints = db.prepare(`
      SELECT c.*, i.name as institution_name, i.region as institution_region
      FROM complaints c 
      JOIN institutions i ON c.institution_id = i.id
    `).all();

    // If Student is requesting stats, scope exclusively to their personal complaints
    if (req.user && req.user.role === 'GUEST_STUDENT') {
      complaints = complaints.filter(c =>
        c.complainant_email === req.user.email || c.complainant_name === req.user.fullName
      );
    }

    const total = complaints.length;
    let pending = 0;          // Total active/unresolved
    let pendingInitial = 0;   // Status: Submitted
    let underProcess = 0;     // Status: Under Bureau Scrutiny, Notice Issued, Hearing Scheduled
    let transferred = 0;      // Status: Transferred or is_transferred = 1
    let escalated = 0;        // Status: Escalated or is_escalated = 1
    let resolved = 0;         // Status: Resolved or Rejected / Closed
    let overdue = 0;          // Active cases past deadline
    let critical = 0;         // Active CRITICAL priority cases

    const bureauCounts = {};
    const categoryCounts = {};
    const statusCounts = {};

    for (const c of complaints) {
      const isClosed = c.status === 'Resolved' || c.status === 'Rejected / Closed';

      if (isClosed) {
        resolved++;
      } else {
        pending++;
        if (c.target_date < today) {
          overdue++;
        }
        if (c.status === 'Submitted') {
          pendingInitial++;
        }
        if (['Under Bureau Scrutiny', 'Notice Issued to Institute', 'Hearing / Inquiry Scheduled'].includes(c.status)) {
          underProcess++;
        }
      }

      if (c.status === 'Transferred' || c.is_transferred === 1) {
        transferred++;
      }

      if (c.status === 'Escalated' || c.is_escalated === 1) {
        escalated++;
      }

      if (c.priority === 'CRITICAL' && !isClosed) {
        critical++;
      }

      bureauCounts[c.bureau] = (bureauCounts[c.bureau] || 0) + 1;
      categoryCounts[c.category] = (categoryCounts[c.category] || 0) + 1;
      statusCounts[c.status] = (statusCounts[c.status] || 0) + 1;
    }

    // Overdue items sorted by days overdue descending
    const overdueList = complaints
      .filter(c => c.status !== 'Resolved' && c.status !== 'Rejected / Closed' && c.target_date < today)
      .map(c => {
        const diffTime = Math.abs(new Date(today) - new Date(c.target_date));
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        return {
          ...c,
          daysOverdue: diffDays
        };
      })
      .sort((a, b) => b.daysOverdue - a.daysOverdue);

    // Overlap count pending review
    const allOverlaps = detectAllOverlaps(complaints, db.prepare('SELECT * FROM overlap_reviews').all());
    const pendingOverlapReviews = allOverlaps.filter(o => o.reviewStatus === 'PENDING_REVIEW').length;

    // Recent activity audit
    const recentActivity = db.prepare(`
      SELECT h.*, c.subject, c.bureau 
      FROM complaint_history h 
      JOIN complaints c ON h.complaint_id = c.id 
      ORDER BY h.timestamp DESC 
      LIMIT 8
    `).all();

    res.json({
      summary: {
        total,
        pending,
        pendingInitial,
        underProcess,
        transferred,
        escalated,
        resolved,
        overdue,
        critical,
        pendingOverlapReviews
      },
      bureauCounts,
      categoryCounts,
      statusCounts,
      overdueList,
      recentActivity
    });
  } catch (err) {
    console.error('Error fetching stats:', err);
    res.status(500).json({ error: 'Failed to fetch dashboard statistics' });
  }
});

// -------------------------------------------------------------
// 2. COMPLAINT MANAGEMENT (CRUD & MULTI-FILTERING WITH RBAC)
// -------------------------------------------------------------
app.get('/api/complaints', requireAuth, (req, res) => {
  try {
    const {
      search,
      bureau,
      status,
      priority,
      category,
      region,
      institution_id,
      overdueOnly,
      dateFrom,
      dateTo
    } = req.query;

    const today = new Date().toISOString().split('T')[0];

    let query = `
      SELECT c.*, 
             i.name as institution_name, 
             i.state as institution_state, 
             i.district as institution_district,
             i.region as institution_region,
             i.address as institution_address
      FROM complaints c
      JOIN institutions i ON c.institution_id = i.id
      WHERE 1=1
    `;
    const params = [];

    // Enforce server-side role boundaries
    if (req.user.role === 'BUREAU_OFFICER') {
      // Bureau Officer cannot view complaints of other bureaus
      query += ` AND c.bureau = ?`;
      params.push(req.user.bureau);
    } else if (req.user.role === 'GUEST_STUDENT') {
      // Student can only view their own complaints
      query += ` AND (c.complainant_email = ? OR c.complainant_name = ?)`;
      params.push(req.user.email, req.user.fullName);
    } else if (bureau && bureau !== 'ALL') {
      query += ` AND c.bureau = ?`;
      params.push(bureau);
    }

    if (category && category !== 'ALL') {
      query += ` AND c.category = ?`;
      params.push(category);
    }

    if (region && region !== 'ALL') {
      query += ` AND i.region = ?`;
      params.push(region);
    }

    if (priority && priority !== 'ALL') {
      query += ` AND c.priority = ?`;
      params.push(priority);
    }

    if (institution_id) {
      query += ` AND c.institution_id = ?`;
      params.push(institution_id);
    }

    // Status filtering including high-level categorizations
    if (status && status !== 'ALL') {
      if (status === 'ACTIVE') {
        query += ` AND c.status NOT IN ('Resolved', 'Rejected / Closed')`;
      } else if (status === 'UNDER_PROCESS') {
        query += ` AND c.status IN ('Under Bureau Scrutiny', 'Notice Issued to Institute', 'Hearing / Inquiry Scheduled')`;
      } else if (status === 'TRANSFERRED') {
        query += ` AND (c.status = 'Transferred' OR c.is_transferred = 1)`;
      } else if (status === 'ESCALATED') {
        query += ` AND (c.status = 'Escalated' OR c.is_escalated = 1)`;
      } else {
        query += ` AND c.status = ?`;
        params.push(status);
      }
    }

    if (overdueOnly === 'true') {
      query += ` AND c.target_date < ? AND c.status NOT IN ('Resolved', 'Rejected / Closed')`;
      params.push(today);
    }

    if (dateFrom) {
      query += ` AND c.created_at >= ?`;
      params.push(dateFrom);
    }

    if (dateTo) {
      query += ` AND c.created_at <= ?`;
      params.push(`${dateTo} 23:59:59`);
    }

    if (search && search.trim()) {
      const term = `%${search.trim()}%`;
      query += ` AND (
        c.id LIKE ? OR 
        c.subject LIKE ? OR 
        c.description LIKE ? OR 
        c.complainant_name LIKE ? OR 
        i.name LIKE ? OR 
        c.institution_id LIKE ? OR
        i.region LIKE ?
      )`;
      params.push(term, term, term, term, term, term, term);
    }

    query += ` ORDER BY c.created_at DESC`;

    const complaints = db.prepare(query).all(...params);

    const enriched = complaints.map(c => {
      const isOver = c.status !== 'Resolved' && c.status !== 'Rejected / Closed' && c.target_date < today;
      let daysDiff = 0;
      if (c.target_date) {
        const diffTime = new Date(c.target_date) - new Date(today);
        daysDiff = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      }
      return {
        ...c,
        isOverdue: isOver,
        daysToDeadline: daysDiff
      };
    });

    res.json(enriched);
  } catch (err) {
    console.error('Error fetching complaints:', err);
    res.status(500).json({ error: 'Failed to fetch complaints' });
  }
});

app.get('/api/complaints/:id', requireAuth, (req, res) => {
  try {
    const { id } = req.params;
    const today = new Date().toISOString().split('T')[0];

    const complaint = db.prepare(`
      SELECT c.*, 
             i.name as institution_name, 
             i.state as institution_state, 
             i.district as institution_district, 
             i.region as institution_region,
             i.address as institution_address,
             i.type as institution_type, 
             i.risk_score as institution_risk_score
      FROM complaints c
      JOIN institutions i ON c.institution_id = i.id
      WHERE c.id = ?
    `).get(id);

    if (!complaint) {
      return res.status(404).json({ error: 'Complaint not found' });
    }

    // Role-based access validation
    if (req.user.role === 'BUREAU_OFFICER' && complaint.bureau !== req.user.bureau) {
      return res.status(403).json({
        error: `Access denied: Case ${id} is assigned to ${complaint.bureau}, outside your assigned bureau (${req.user.bureau}).`
      });
    }

    if (req.user.role === 'GUEST_STUDENT' && complaint.complainant_email !== req.user.email && complaint.complainant_name !== req.user.fullName) {
      return res.status(403).json({
        error: 'Access denied: You may only view complaints you personally submitted.'
      });
    }

    const history = db.prepare(`
      SELECT * FROM complaint_history 
      WHERE complaint_id = ? 
      ORDER BY timestamp DESC
    `).all(id);

    // Linked complaints if part of linked group
    let linkedCases = [];
    if (complaint.linked_group_id) {
      linkedCases = db.prepare(`
        SELECT id, subject, bureau, status, priority, created_at 
        FROM complaints 
        WHERE linked_group_id = ? AND id != ?
      `).all(complaint.linked_group_id, id);
    }

    // Check potential overlaps with this complaint
    const allOtherComplaints = db.prepare(`SELECT * FROM complaints WHERE id != ?`).all(id);
    const relatedOverlaps = [];
    for (const other of allOtherComplaints) {
      const cmp = compareComplaints(complaint, other);
      if (cmp.score >= 45) {
        relatedOverlaps.push({
          complaint: other,
          similarity: cmp.score,
          severity: cmp.severity,
          reasons: cmp.reasons,
          commonKeywords: cmp.commonKeywords
        });
      }
    }

    // Fetch attached supporting documents
    const attachedDocuments = getDocumentsForComplaint(id);

    const isOver = complaint.status !== 'Resolved' && complaint.status !== 'Rejected / Closed' && complaint.target_date < today;

    // Student Privacy & Internal Note Isolation Guard
    if (req.user.role === 'GUEST_STUDENT') {
      delete complaint.investigation_notes;
      const publicHistory = history.filter(h =>
        ['CREATED', 'STATUS_CHANGE', 'DOCUMENT_UPLOADED', 'RESOLVED', 'REMARK_ADDED'].includes(h.action_type)
      );

      return res.json({
        ...complaint,
        isOverdue: isOver,
        history: publicHistory,
        linkedCases: [],
        potentialOverlaps: [],
        attachedDocuments
      });
    }

    res.json({
      ...complaint,
      isOverdue: isOver,
      history,
      linkedCases,
      potentialOverlaps: relatedOverlaps,
      attachedDocuments
    });
  } catch (err) {
    console.error('Error getting complaint details:', err);
    res.status(500).json({ error: 'Failed to get complaint details' });
  }
});

// CREATE COMPLAINT
app.post('/api/complaints', requireAuth, (req, res) => {
  try {
    const {
      institution_id,
      bureau,
      category,
      priority,
      complainant_name,
      complainant_role,
      complainant_email,
      complainant_phone,
      subject,
      description,
      target_date,
      officer_name,
      assigned_officer,
      supporting_docs
    } = req.body;

    if (!institution_id || !bureau || !category || !priority || !complainant_name || !subject || !description) {
      return res.status(400).json({ error: 'Missing mandatory fields: institution_id, bureau, category, priority, complainant_name, subject, and description are required.' });
    }

    // Ensure institution exists
    const inst = db.prepare('SELECT id FROM institutions WHERE id = ?').get(institution_id);
    if (!inst) {
      return res.status(400).json({ error: `Institution ID ${institution_id} does not exist in registry` });
    }

    // Identity validation for student role
    let finalComplainantName = complainant_name;
    let finalComplainantEmail = complainant_email;
    let finalComplainantRole = complainant_role || 'Student';

    if (req.user.role === 'GUEST_STUDENT') {
      finalComplainantName = req.user.fullName;
      finalComplainantEmail = req.user.email;
      finalComplainantRole = 'Student';
    }

    // Generate unique complaint ID: AICTE-GRV-2026-XXX
    const countRow = db.prepare("SELECT COUNT(*) as cnt FROM complaints WHERE id LIKE 'AICTE-GRV-2026-%'").get();
    const nextSeq = String(countRow.cnt + 1).padStart(3, '0');
    let newId = `AICTE-GRV-2026-${nextSeq}`;

    // Collision fallback
    while (db.prepare('SELECT id FROM complaints WHERE id = ?').get(newId)) {
      const rand = Math.floor(100 + Math.random() * 900);
      newId = `AICTE-GRV-2026-${rand}`;
    }

    // Default SLA Target Date: 30 days if not given
    const calculatedTargetDate = target_date || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    let officer = assigned_officer || officer_name;
    let officerId = req.body.assigned_officer_id || null;

    if (officerId) {
      const match = db.prepare('SELECT id, full_name FROM users WHERE id = ?').get(officerId);
      if (match) {
        officer = match.full_name;
      }
    } else if (officer) {
      const match = db.prepare('SELECT id, full_name FROM users WHERE full_name = ? OR username = ?').get(officer, officer);
      if (match) {
        officerId = match.id;
        officer = match.full_name;
      }
    } else if (bureau) {
      const match = db.prepare('SELECT id, full_name FROM users WHERE bureau = ? AND role = ? LIMIT 1').get(bureau, 'BUREAU_OFFICER');
      if (match) {
        officerId = match.id;
        officer = match.full_name;
      }
    }

    if (!officer) {
      officer = (req.user.role === 'ADMIN' || req.user.role === 'BUREAU_OFFICER')
        ? (req.user.fullName || 'AICTE Grievance Desk Officer')
        : 'AICTE Central Ingestion Desk';
      officerId = (req.user.role === 'ADMIN' || req.user.role === 'BUREAU_OFFICER') ? req.user.id : 'USR-ADMIN-01';
    }

    const insert = db.prepare(`
      INSERT INTO complaints (
        id, institution_id, bureau, category, priority, status,
        complainant_name, complainant_role, complainant_email, complainant_phone,
        subject, description, target_date, assigned_officer, assigned_officer_id, last_action, next_action,
        last_action_date, supporting_docs, created_at, updated_at
      ) VALUES (
        ?, ?, ?, ?, ?, 'Submitted',
        ?, ?, ?, ?,
        ?, ?, ?, ?, ?, 'Complaint Registered into Central Repository', 'Initial Scrutiny by Bureau Desk',
        datetime('now'), ?, datetime('now'), datetime('now')
      )
    `);

    insert.run(
      newId,
      institution_id,
      bureau,
      category,
      priority,
      finalComplainantName,
      finalComplainantRole,
      finalComplainantEmail || '',
      complainant_phone || '',
      subject,
      description,
      calculatedTargetDate,
      officer,
      officerId,
      supporting_docs || null
    );

    // Audit trail log
    const insertHistory = db.prepare(`
      INSERT INTO complaint_history (complaint_id, action_type, old_value, new_value, remarks, actor)
      VALUES (?, 'CREATED', NULL, 'Submitted', 'Grievance registered through AICTE Central Ingestion Portal.', ?)
    `);
    insertHistory.run(newId, req.user.fullName || officer);

    // Run overlap check against existing complaints to flag immediate matches
    const newCompObj = {
      id: newId,
      institution_id,
      bureau,
      category,
      subject,
      description
    };
    const otherComplaints = db.prepare('SELECT * FROM complaints WHERE id != ?').all(newId);
    const flaggedOverlaps = [];
    for (const other of otherComplaints) {
      const cmp = compareComplaints(newCompObj, other);
      if (cmp.score >= 45) {
        flaggedOverlaps.push({
          targetComplaintId: other.id,
          targetBureau: other.bureau,
          targetSubject: other.subject,
          similarity: cmp.score,
          severity: cmp.severity,
          reasons: cmp.reasons
        });

        // Trigger overlap alert if similarity is critical
        if (cmp.score >= 70) {
          dispatchOverlapAlert(newCompObj, other, cmp.score).catch(() => {});
        }
      }
    }

    // Broadcast Real-Time SSE Event
    broadcastEvent('COMPLAINT_CREATED', {
      id: newId,
      bureau,
      category,
      priority,
      subject,
      institution_id,
      complainant_name: finalComplainantName,
      complainant_email: finalComplainantEmail,
      created_at: new Date().toISOString()
    });

    res.status(201).json({
      message: 'Complaint successfully registered',
      complaintId: newId,
      flaggedOverlapsCount: flaggedOverlaps.length,
      flaggedOverlaps
    });
  } catch (err) {
    console.error('Error creating complaint:', err);
    res.status(500).json({ error: 'Failed to create complaint: ' + err.message });
  }
});

// UPDATE COMPLAINT (Status, Bureau, Priority, Remarks, Officer, Next Action)
app.put('/api/complaints/:id', requireAuth, (req, res) => {
  try {
    const { id } = req.params;
    const {
      status,
      bureau,
      priority,
      target_date,
      resolution_remarks,
      officer_name,
      officer_notes,
      assigned_officer,
      assigned_officer_id,
      investigation_notes,
      next_action,
      supporting_docs
    } = req.body;

    const current = db.prepare('SELECT * FROM complaints WHERE id = ?').get(id);
    if (!current) {
      return res.status(404).json({ error: 'Complaint not found' });
    }

    // Role-based authorization
    if (req.user.role === 'GUEST_STUDENT') {
      return res.status(403).json({ error: 'Complainants are not authorized to modify official case details.' });
    }

    if (req.user.role === 'BUREAU_OFFICER') {
      if (current.bureau !== req.user.bureau) {
        return res.status(403).json({
          error: `Access denied: Case belongs to ${current.bureau}, outside your assigned bureau (${req.user.bureau}).`
        });
      }
      if (status === 'Escalated') {
        return res.status(403).json({
          error: 'Formal escalation to Apex Vigilance requires Central Admin authorization.'
        });
      }
    }

    // Resolution & Closure validation
    if (status === 'Resolved' || status === 'Rejected / Closed') {
      const effectiveRemarks = resolution_remarks || officer_notes || current.resolution_remarks;
      if (!effectiveRemarks || effectiveRemarks.trim().length < 5) {
        return res.status(400).json({
          error: 'Resolution remarks (minimum 5 characters) are mandatory when marking a case Resolved or Rejected / Closed.'
        });
      }
    }

    const updates = [];
    const params = [];
    const historyLogs = [];

    if (status && status !== current.status) {
      updates.push('status = ?');
      params.push(status);
      historyLogs.push({
        action: 'STATUS_CHANGE',
        oldVal: current.status,
        newVal: status,
        remarks: officer_notes || `Status transitioned to ${status}`
      });

      updates.push('last_action = ?');
      params.push(`Status updated to ${status}`);

      if (status === 'Transferred') {
        updates.push('is_transferred = 1');
      }
      if (status === 'Escalated') {
        updates.push('is_escalated = 1');
      }
      if (status === 'Resolved' || status === 'Rejected / Closed') {
        updates.push("resolved_at = datetime('now')");
      }
    }

    if (bureau && bureau !== current.bureau) {
      updates.push('bureau = ?');
      params.push(bureau);
      updates.push('is_transferred = 1');
      historyLogs.push({
        action: 'BUREAU_REASSIGNMENT',
        oldVal: current.bureau,
        newVal: bureau,
        remarks: officer_notes || `Case reassigned from ${current.bureau} to ${bureau}`
      });
      updates.push('last_action = ?');
      params.push(`Reassigned from ${current.bureau} to ${bureau}`);
    }

    if (priority && priority !== current.priority) {
      updates.push('priority = ?');
      params.push(priority);
      historyLogs.push({
        action: 'PRIORITY_CHANGE',
        oldVal: current.priority,
        newVal: priority,
        remarks: officer_notes || `Priority modified from ${current.priority} to ${priority}`
      });
    }

    if (target_date && target_date !== current.target_date) {
      updates.push('target_date = ?');
      params.push(target_date);
      historyLogs.push({
        action: 'DEADLINE_EXTENSION',
        oldVal: current.target_date,
        newVal: target_date,
        remarks: officer_notes || `Target resolution deadline updated to ${target_date}`
      });
    }

    // Officer Assignment & Reassignment Handling
    const targetBureau = bureau || current.bureau;
    if (assigned_officer_id && assigned_officer_id !== current.assigned_officer_id) {
      const officerUser = db.prepare('SELECT id, full_name, bureau, role, email, phone FROM users WHERE id = ?').get(assigned_officer_id);
      if (!officerUser) {
        return res.status(400).json({ error: 'Assigned officer does not exist in the users directory.' });
      }
      if (!['ADMIN', 'BUREAU_OFFICER'].includes(officerUser.role)) {
        return res.status(400).json({ error: 'Assigned user must be an Admin or Bureau Officer.' });
      }
      if (officerUser.role === 'BUREAU_OFFICER' && officerUser.bureau !== targetBureau) {
        return res.status(400).json({
          error: `Officer ${officerUser.full_name} belongs to ${officerUser.bureau}, which does not match case bureau (${targetBureau}).`
        });
      }

      updates.push('assigned_officer_id = ?');
      params.push(officerUser.id);
      updates.push('assigned_officer = ?');
      params.push(officerUser.full_name);

      historyLogs.push({
        action: 'OFFICER_REASSIGNMENT',
        oldVal: current.assigned_officer,
        newVal: officerUser.full_name,
        remarks: officer_notes || `Case reassigned to ${officerUser.full_name} (${officerUser.role})`
      });

      if (officerUser.email) {
        sendNotification({
          complaintId: id,
          eventType: 'CASE_ASSIGNMENT',
          recipientEmail: officerUser.email,
          recipientPhone: officerUser.phone,
          channel: 'EMAIL',
          subject: `Case Assignment: Grievance ${id} Assigned to You`,
          body: `Dear ${officerUser.full_name},\n\nGrievance case ${id} (${targetBureau}) has been assigned to you for investigation and resolution.`
        }).catch(() => {});
      }
    } else if (assigned_officer && assigned_officer !== current.assigned_officer) {
      const match = db.prepare('SELECT id, full_name, bureau, role FROM users WHERE full_name = ? OR username = ?').get(assigned_officer, assigned_officer);
      if (match) {
        updates.push('assigned_officer_id = ?');
        params.push(match.id);
      }
      updates.push('assigned_officer = ?');
      params.push(assigned_officer);
      historyLogs.push({
        action: 'OFFICER_REASSIGNMENT',
        oldVal: current.assigned_officer,
        newVal: assigned_officer,
        remarks: officer_notes || `Case reassigned to officer ${assigned_officer}`
      });
    }

    if (investigation_notes !== undefined) {
      updates.push('investigation_notes = ?');
      params.push(investigation_notes);
      historyLogs.push({
        action: 'INVESTIGATION_NOTE_ADDED',
        oldVal: null,
        newVal: null,
        remarks: 'Confidential investigation note updated by officer'
      });
    }

    if (next_action) {
      updates.push('next_action = ?');
      params.push(next_action);
    }

    if (supporting_docs !== undefined) {
      updates.push('supporting_docs = ?');
      params.push(supporting_docs);
    }

    if (resolution_remarks !== undefined) {
      updates.push('resolution_remarks = ?');
      params.push(resolution_remarks);
      if (resolution_remarks && !historyLogs.some(h => h.action === 'REMARK_ADDED')) {
        historyLogs.push({
          action: 'REMARK_ADDED',
          oldVal: null,
          newVal: null,
          remarks: resolution_remarks
        });
      }
    }

    if (updates.length === 0) {
      return res.json({ message: 'No changes detected' });
    }

    updates.push("updated_at = datetime('now')");
    updates.push("last_action_date = datetime('now')");
    params.push(id);

    const updateSql = `UPDATE complaints SET ${updates.join(', ')} WHERE id = ?`;
    db.prepare(updateSql).run(...params);

    const insertHist = db.prepare(`
      INSERT INTO complaint_history (complaint_id, action_type, old_value, new_value, remarks, actor)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    const actorName = req.user.fullName || officer_name || 'AICTE Desk Officer';

    for (const h of historyLogs) {
      insertHist.run(id, h.action, h.oldVal, h.newVal, h.remarks, actorName);
    }

    // Real-Time Broadcast
    broadcastEvent('COMPLAINT_UPDATED', {
      id,
      bureau: bureau || current.bureau,
      status: status || current.status,
      priority: priority || current.priority,
      actor: actorName,
      last_action: `Updated by ${actorName}`,
      updated_at: new Date().toISOString()
    });

    // Escalation notification trigger
    if (status === 'Escalated') {
      dispatchEscalationAlert(current, officer_notes).catch(() => {});
    }

    res.json({ message: 'Complaint successfully updated' });
  } catch (err) {
    console.error('Error updating complaint:', err);
    res.status(500).json({ error: 'Failed to update complaint: ' + err.message });
  }
});

// DELETE COMPLAINT (Admin Only)
app.delete('/api/complaints/:id', requireRole('ADMIN'), (req, res) => {
  try {
    const { id } = req.params;
    const current = db.prepare('SELECT id FROM complaints WHERE id = ?').get(id);
    if (!current) {
      return res.status(404).json({ error: 'Complaint not found' });
    }

    db.prepare('DELETE FROM complaints WHERE id = ?').run(id);
    db.prepare('DELETE FROM complaint_history WHERE complaint_id = ?').run(id);

    broadcastEvent('COMPLAINT_DELETED', { id });

    res.json({ message: `Complaint ${id} removed successfully` });
  } catch (err) {
    console.error('Error deleting complaint:', err);
    res.status(500).json({ error: 'Failed to delete complaint' });
  }
});

// -------------------------------------------------------------
// 3. SUPPORTING DOCUMENT UPLOAD & MANAGEMENT APIS
// -------------------------------------------------------------
// Helper middleware for upload error handling
function handleDocumentUpload(req, res, next) {
  upload.single('document')(req, res, (err) => {
    if (err) {
      return res.status(400).json({ error: err.message });
    }
    next();
  });
}

app.post('/api/complaints/:id/documents', requireAuth, handleDocumentUpload, (req, res) => {
  try {
    const { id } = req.params;
    if (!req.file) {
      return res.status(400).json({ error: 'No file provided. Please upload a PDF, PNG, or JPG document.' });
    }

    const complaint = db.prepare('SELECT * FROM complaints WHERE id = ?').get(id);
    if (!complaint) {
      if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
      return res.status(404).json({ error: 'Complaint not found.' });
    }

    // Role check
    if (req.user.role === 'BUREAU_OFFICER' && complaint.bureau !== req.user.bureau) {
      if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
      return res.status(403).json({ error: `Access denied: Complaint belongs to ${complaint.bureau}, outside your assigned bureau.` });
    }
    if (req.user.role === 'GUEST_STUDENT' && complaint.complainant_email !== req.user.email && complaint.complainant_name !== req.user.fullName) {
      if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
      return res.status(403).json({ error: 'Access denied: You may only upload documents to your own complaint.' });
    }

    // Validate magic bytes
    const isValidContent = validateMagicBytes(req.file.path, req.file.mimetype);
    if (!isValidContent) {
      if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
      return res.status(400).json({ error: 'Security verification failed: File content does not match declared MIME signature.' });
    }

    const docRecord = saveDocumentRecord(id, req.file, req.user.fullName);

    // Audit log
    db.prepare(`
      INSERT INTO complaint_history (complaint_id, action_type, old_value, new_value, remarks, actor)
      VALUES (?, 'DOCUMENT_UPLOADED', NULL, ?, ?, ?)
    `).run(
      id,
      docRecord.original_filename,
      `Attached supporting evidence document: ${docRecord.original_filename} (${Math.round(docRecord.file_size / 1024)} KB)`,
      req.user.fullName
    );

    broadcastEvent('DOCUMENT_UPLOADED', {
      complaintId: id,
      documentId: docRecord.id,
      filename: docRecord.original_filename,
      bureau: complaint.bureau
    });

    res.status(201).json({
      message: 'Document successfully uploaded and verified.',
      document: docRecord
    });
  } catch (err) {
    if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    console.error('Error uploading document:', err);
    res.status(500).json({ error: 'Failed to upload document: ' + err.message });
  }
});

app.get('/api/complaints/:id/documents', requireAuth, (req, res) => {
  try {
    const { id } = req.params;
    const complaint = db.prepare('SELECT * FROM complaints WHERE id = ?').get(id);
    if (!complaint) {
      return res.status(404).json({ error: 'Complaint not found.' });
    }

    if (req.user.role === 'BUREAU_OFFICER' && complaint.bureau !== req.user.bureau) {
      return res.status(403).json({ error: 'Access restricted to assigned bureau cases.' });
    }
    if (req.user.role === 'GUEST_STUDENT' && complaint.complainant_email !== req.user.email && complaint.complainant_name !== req.user.fullName) {
      return res.status(403).json({ error: 'Access restricted to your own complaints.' });
    }

    const docs = getDocumentsForComplaint(id);
    res.json(docs);
  } catch (err) {
    console.error('Error fetching documents:', err);
    res.status(500).json({ error: 'Failed to fetch documents' });
  }
});

app.get('/api/documents/:docId/view', requireAuth, (req, res) => {
  try {
    const { docId } = req.params;
    const doc = getDocumentRecord(docId);
    if (!doc) {
      return res.status(404).json({ error: 'Document not found.' });
    }

    const complaint = db.prepare('SELECT * FROM complaints WHERE id = ?').get(doc.complaint_id);
    if (!complaint) {
      return res.status(404).json({ error: 'Associated complaint not found.' });
    }

    if (req.user.role === 'BUREAU_OFFICER' && complaint.bureau !== req.user.bureau) {
      return res.status(403).json({ error: 'Access restricted.' });
    }
    if (req.user.role === 'GUEST_STUDENT' && complaint.complainant_email !== req.user.email && complaint.complainant_name !== req.user.fullName) {
      return res.status(403).json({ error: 'Access restricted.' });
    }

    const filePath = getDocumentFilePath(doc.stored_filename);
    if (!filePath || !fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Document file not found on disk.' });
    }

    res.setHeader('Content-Type', doc.mime_type);
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(doc.original_filename)}"`);
    fs.createReadStream(filePath).pipe(res);
  } catch (err) {
    console.error('Error viewing document:', err);
    res.status(500).json({ error: 'Failed to view document' });
  }
});

app.get('/api/documents/:docId/download', requireAuth, (req, res) => {
  try {
    const { docId } = req.params;
    const doc = getDocumentRecord(docId);
    if (!doc) {
      return res.status(404).json({ error: 'Document not found.' });
    }

    const complaint = db.prepare('SELECT * FROM complaints WHERE id = ?').get(doc.complaint_id);
    if (!complaint) {
      return res.status(404).json({ error: 'Associated complaint not found.' });
    }

    if (req.user.role === 'BUREAU_OFFICER' && complaint.bureau !== req.user.bureau) {
      return res.status(403).json({ error: 'Access restricted.' });
    }
    if (req.user.role === 'GUEST_STUDENT' && complaint.complainant_email !== req.user.email && complaint.complainant_name !== req.user.fullName) {
      return res.status(403).json({ error: 'Access restricted.' });
    }

    const filePath = getDocumentFilePath(doc.stored_filename);
    if (!filePath || !fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Document file not found on disk.' });
    }

    res.download(filePath, doc.original_filename);
  } catch (err) {
    console.error('Error downloading document:', err);
    res.status(500).json({ error: 'Failed to download document' });
  }
});

// -------------------------------------------------------------
// 4. REAL-TIME SERVER-SENT EVENTS (SSE) STREAM
// -------------------------------------------------------------
app.get('/api/events', requireAuth, (req, res) => {
  registerClient(req, res);
});

// -------------------------------------------------------------
// 5. NOTIFICATION AUDIT & DISPATCH APIS
// -------------------------------------------------------------
app.get('/api/notifications', requireRole('ADMIN'), (req, res) => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit, 10) : 50;
    const logs = getNotificationLogs(limit);
    res.json(logs);
  } catch (err) {
    console.error('Error fetching notification logs:', err);
    res.status(500).json({ error: 'Failed to fetch notification logs' });
  }
});

app.post('/api/notifications/check-sla', requireRole('ADMIN'), async (req, res) => {
  try {
    const results = await checkAndDispatchSLAAlerts();
    res.json({
      message: 'SLA alert triggers evaluated successfully.',
      triggeredCount: results.length,
      details: results
    });
  } catch (err) {
    console.error('Error checking SLA triggers:', err);
    res.status(500).json({ error: 'Failed to check SLA triggers: ' + err.message });
  }
});

// -------------------------------------------------------------
// 6. INSTITUTION PROFILES & HISTORY
// -------------------------------------------------------------
app.get('/api/institutions', (req, res) => {
  try {
    const institutions = db.prepare('SELECT * FROM institutions ORDER BY name ASC').all();
    const statsQuery = db.prepare(`
      SELECT 
        institution_id,
        COUNT(*) as total_cases,
        SUM(CASE WHEN status NOT IN ('Resolved', 'Rejected / Closed') THEN 1 ELSE 0 END) as active_cases,
        SUM(CASE WHEN status = 'Resolved' THEN 1 ELSE 0 END) as resolved_cases,
        SUM(CASE WHEN priority = 'CRITICAL' THEN 1 ELSE 0 END) as critical_cases
      FROM complaints
      GROUP BY institution_id
    `).all();

    const statsMap = new Map();
    for (const s of statsQuery) {
      statsMap.set(s.institution_id, s);
    }

    const result = institutions.map(inst => {
      const s = statsMap.get(inst.id) || { total_cases: 0, active_cases: 0, resolved_cases: 0, critical_cases: 0 };
      // Dynamic Risk Rating Calculation
      const dynamicRisk = Math.min(100, Math.max(10, (s.active_cases * 15) + (s.critical_cases * 20)));
      return {
        ...inst,
        ...s,
        calculatedRisk: dynamicRisk
      };
    });

    res.json(result);
  } catch (err) {
    console.error('Error fetching institutions:', err);
    res.status(500).json({ error: 'Failed to fetch institutions' });
  }
});

app.get('/api/institutions/:id', (req, res) => {
  try {
    const { id } = req.params;
    const inst = db.prepare('SELECT * FROM institutions WHERE id = ?').get(id);
    if (!inst) {
      return res.status(404).json({ error: 'Institution not found' });
    }

    const complaints = db.prepare(`
      SELECT * FROM complaints 
      WHERE institution_id = ? 
      ORDER BY created_at DESC
    `).all(id);

    const today = new Date().toISOString().split('T')[0];
    const totalGrievances = complaints.length;
    const activeGrievances = complaints.filter(c => c.status !== 'Resolved' && c.status !== 'Rejected / Closed').length;
    const resolvedGrievances = complaints.filter(c => c.status === 'Resolved' || c.status === 'Rejected / Closed').length;
    const overdueGrievances = complaints.filter(c => c.status !== 'Resolved' && c.status !== 'Rejected / Closed' && c.target_date < today).length;
    const criticalGrievances = complaints.filter(c => c.priority === 'CRITICAL').length;
    const disposalRate = totalGrievances > 0 ? Math.round((resolvedGrievances / totalGrievances) * 100) : 0;

    // Related overlaps for this institution
    const allOverlaps = detectAllOverlaps(db.prepare('SELECT * FROM complaints').all(), db.prepare('SELECT * FROM overlap_reviews').all());
    const institutionOverlaps = allOverlaps.filter(o => o.complaintA.institution_id === id || o.complaintB.institution_id === id);

    res.json({
      ...inst,
      complaintHistory: complaints,
      totalGrievances,
      activeGrievances,
      resolvedGrievances,
      overdueGrievances,
      criticalGrievances,
      disposalRate,
      relatedOverlaps: institutionOverlaps
    });
  } catch (err) {
    console.error('Error getting institution profile:', err);
    res.status(500).json({ error: 'Failed to get institution profile' });
  }
});

// -------------------------------------------------------------
// 7. OVERLAP DETECTION CENTRE & HUMAN REVIEW
// -------------------------------------------------------------
app.get('/api/overlaps', requireRole('ADMIN', 'BUREAU_OFFICER'), (req, res) => {
  try {
    const complaints = db.prepare(`
      SELECT c.*, i.name as institution_name, i.region as institution_region
      FROM complaints c 
      JOIN institutions i ON c.institution_id = i.id
    `).all();

    const reviews = db.prepare('SELECT * FROM overlap_reviews').all();
    const overlaps = detectAllOverlaps(complaints, reviews);

    res.json({
      count: overlaps.length,
      overlaps
    });
  } catch (err) {
    console.error('Error detecting overlaps:', err);
    res.status(500).json({ error: 'Failed to run overlap detection engine' });
  }
});

// Human Review Submission (Strict Guardrail: Admin Only, Never merges data automatically)
app.post('/api/overlaps/review', requireRole('ADMIN'), (req, res) => {
  try {
    const { complaintAId, complaintBId, decision, notes, officerName } = req.body;

    if (!complaintAId || !complaintBId || !decision) {
      return res.status(400).json({ error: 'complaintAId, complaintBId, and decision are required' });
    }

    if (!['CONFIRMED_RELATED', 'DISMISSED_DISTINCT'].includes(decision)) {
      return res.status(400).json({ error: 'Invalid decision type. Must be CONFIRMED_RELATED or DISMISSED_DISTINCT' });
    }

    // Ensure order for unique pair constraint
    const [idA, idB] = [complaintAId, complaintBId].sort();

    // Check if review record exists
    const existing = db.prepare(`
      SELECT id FROM overlap_reviews 
      WHERE complaint_a_id = ? AND complaint_b_id = ?
    `).get(idA, idB);

    const compA = db.prepare('SELECT * FROM complaints WHERE id = ?').get(idA);
    const compB = db.prepare('SELECT * FROM complaints WHERE id = ?').get(idB);

    if (!compA || !compB) {
      return res.status(404).json({ error: 'One or both complaints not found' });
    }

    const cmp = compareComplaints(compA, compB);

    const reviewer = req.user.fullName || officerName || 'AICTE Review Officer';

    if (existing) {
      db.prepare(`
        UPDATE overlap_reviews 
        SET review_status = ?, reviewer_notes = ?, reviewed_by = ?, reviewed_at = datetime('now')
        WHERE id = ?
      `).run(decision, notes || '', reviewer, existing.id);
    } else {
      db.prepare(`
        INSERT INTO overlap_reviews (complaint_a_id, complaint_b_id, similarity_score, match_reasons, review_status, reviewer_notes, reviewed_by, reviewed_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
      `).run(
        idA,
        idB,
        cmp.score,
        JSON.stringify(cmp.reasons),
        decision,
        notes || '',
        reviewer
      );
    }

    // Strict Guardrail: Link cases for coordination, never merge files
    if (decision === 'CONFIRMED_RELATED') {
      const groupId = compA.linked_group_id || compB.linked_group_id || `GRP-LINK-${Date.now().toString().slice(-6)}`;
      db.prepare('UPDATE complaints SET linked_group_id = ? WHERE id IN (?, ?)').run(groupId, idA, idB);

      const histStmt = db.prepare(`
        INSERT INTO complaint_history (complaint_id, action_type, old_value, new_value, remarks, actor)
        VALUES (?, 'OVERLAP_LINKED', NULL, ?, ?, ?)
      `);

      histStmt.run(idA, groupId, `Human Review: Flagged as related cross-bureau case of ${idB}. Kept independent (not merged). Officer notes: ${notes || 'Verified cross-bureau overlap'}`, reviewer);
      histStmt.run(idB, groupId, `Human Review: Flagged as related cross-bureau case of ${idA}. Kept independent (not merged). Officer notes: ${notes || 'Verified cross-bureau overlap'}`, reviewer);
    } else if (decision === 'DISMISSED_DISTINCT') {
      // If previously linked solely between these two, remove group id
      if (compA.linked_group_id && compA.linked_group_id === compB.linked_group_id) {
        const otherMembers = db.prepare('SELECT COUNT(*) as cnt FROM complaints WHERE linked_group_id = ? AND id NOT IN (?, ?)').get(compA.linked_group_id, idA, idB);
        if (otherMembers.cnt === 0) {
          db.prepare('UPDATE complaints SET linked_group_id = NULL WHERE id IN (?, ?)').run(idA, idB);
        }
      }

      const histStmt = db.prepare(`
        INSERT INTO complaint_history (complaint_id, action_type, old_value, new_value, remarks, actor)
        VALUES (?, 'OVERLAP_DISMISSED', NULL, 'Distinct', ?, ?)
      `);
      histStmt.run(idA, `Officer evaluated potential similarity with ${idB} and marked as distinct. Notes: ${notes || 'False positive'}`, reviewer);
      histStmt.run(idB, `Officer evaluated potential similarity with ${idA} and marked as distinct. Notes: ${notes || 'False positive'}`, reviewer);
    }

    broadcastEvent('OVERLAP_REVIEWED', {
      pair: [idA, idB],
      decision,
      reviewer,
      timestamp: new Date().toISOString()
    });

    res.json({
      message: `Human review recorded successfully: ${decision}`,
      pair: [idA, idB],
      decision
    });
  } catch (err) {
    console.error('Error submitting overlap review:', err);
    res.status(500).json({ error: 'Failed to record overlap review: ' + err.message });
  }
});

// -------------------------------------------------------------
// 8. COMPREHENSIVE REPORTS API (SIH26264 Multi-Dimensional Audits)
// -------------------------------------------------------------
app.get('/api/reports', requireRole('ADMIN', 'BUREAU_OFFICER'), (req, res) => {
  try {
    const { dateFrom, dateTo } = req.query;
    const today = new Date().toISOString().split('T')[0];

    let query = `
      SELECT c.*, 
             i.name as institution_name, 
             i.state as institution_state, 
             i.region as institution_region
      FROM complaints c
      JOIN institutions i ON c.institution_id = i.id
      WHERE 1=1
    `;
    const params = [];

    if (dateFrom) {
      query += ` AND c.created_at >= ?`;
      params.push(dateFrom);
    }
    if (dateTo) {
      query += ` AND c.created_at <= ?`;
      params.push(`${dateTo} 23:59:59`);
    }

    query += ` ORDER BY c.created_at DESC`;

    const complaints = db.prepare(query).all(...params);

    // 1. Bureau-wise Breakdown
    const bureaus = [
      'Student Grievance Redressal Cell (SGRC)',
      'Approval Bureau',
      'Anti-Ragging Cell',
      'Faculty & Staff Grievance Cell',
      'Vigilance Cell',
      'Legal Cell',
      'Regional Bureau / Regional Office (RB)',
      'Public Grievance Redressal Cell (PGRC)'
    ];

    const bureauScorecard = bureaus.map(b => {
      const bComplaints = complaints.filter(c => c.bureau === b);
      const total = bComplaints.length;
      const resolved = bComplaints.filter(c => c.status === 'Resolved' || c.status === 'Rejected / Closed').length;
      const active = total - resolved;
      const overdue = bComplaints.filter(c => c.status !== 'Resolved' && c.status !== 'Rejected / Closed' && c.target_date < today).length;
      const rate = total > 0 ? Math.round((resolved / total) * 100) : 0;
      return {
        bureau: b,
        total,
        resolved,
        active,
        overdue,
        disposalRate: rate
      };
    });

    // 2. Region-wise Breakdown
    const regionMap = {};
    for (const c of complaints) {
      const reg = c.institution_region || 'Unassigned';
      if (!regionMap[reg]) {
        regionMap[reg] = { region: reg, total: 0, resolved: 0, active: 0, overdue: 0 };
      }
      regionMap[reg].total++;
      if (c.status === 'Resolved' || c.status === 'Rejected / Closed') {
        regionMap[reg].resolved++;
      } else {
        regionMap[reg].active++;
        if (c.target_date < today) {
          regionMap[reg].overdue++;
        }
      }
    }

    const regionWise = Object.values(regionMap).map(r => ({
      ...r,
      disposalRate: r.total > 0 ? Math.round((r.resolved / r.total) * 100) : 0
    })).sort((a, b) => b.total - a.total);

    // 3. Status-wise Breakdown
    const statusMap = {};
    for (const c of complaints) {
      statusMap[c.status] = (statusMap[c.status] || 0) + 1;
    }
    const statusWise = Object.entries(statusMap).map(([status, count]) => ({
      status,
      count,
      percentage: complaints.length > 0 ? Math.round((count / complaints.length) * 100) : 0
    }));

    // 4. Pending Case Ageing Analysis
    let under15Days = 0;
    let days15to30 = 0;
    let days30to60 = 0;
    let over60Days = 0;

    for (const c of complaints) {
      if (c.status !== 'Resolved' && c.status !== 'Rejected / Closed') {
        const createDate = new Date(c.created_at.slice(0, 10));
        const ageDays = Math.max(0, Math.ceil((new Date(today) - createDate) / (1000 * 60 * 60 * 24)));
        if (ageDays <= 15) under15Days++;
        else if (ageDays <= 30) days15to30++;
        else if (ageDays <= 60) days30to60++;
        else over60Days++;
      }
    }

    const ageingAnalysis = {
      under15Days,
      days15to30,
      days30to60,
      over60Days,
      totalActive: under15Days + days15to30 + days30to60 + over60Days
    };

    // 5. Monthly & Quarterly Performance
    const monthMap = {};
    const quarterMap = {};

    for (const c of complaints) {
      const monthKey = c.created_at.slice(0, 7); // e.g. "2026-10"
      const m = parseInt(monthKey.slice(5, 7), 10);
      const q = Math.ceil(m / 3);
      const quarterKey = `${monthKey.slice(0, 4)}-Q${q}`;

      if (!monthMap[monthKey]) monthMap[monthKey] = { period: monthKey, received: 0, resolved: 0 };
      if (!quarterMap[quarterKey]) quarterMap[quarterKey] = { period: quarterKey, received: 0, resolved: 0 };

      monthMap[monthKey].received++;
      quarterMap[quarterKey].received++;

      if (c.status === 'Resolved' || c.status === 'Rejected / Closed') {
        monthMap[monthKey].resolved++;
        quarterMap[quarterKey].resolved++;
      }
    }

    const monthlyPerformance = Object.values(monthMap).map(m => ({
      ...m,
      disposalRate: m.received > 0 ? Math.round((m.resolved / m.received) * 100) : 0
    })).sort((a, b) => b.period.localeCompare(a.period));

    const quarterlyPerformance = Object.values(quarterMap).map(q => ({
      ...q,
      disposalRate: q.received > 0 ? Math.round((q.resolved / q.received) * 100) : 0
    })).sort((a, b) => b.period.localeCompare(a.period));

    // 6. Overlap Case Statistics
    const allOverlaps = detectAllOverlaps(complaints, db.prepare('SELECT * FROM overlap_reviews').all());
    const totalFlagged = allOverlaps.length;
    const confirmedLinked = allOverlaps.filter(o => o.reviewStatus === 'CONFIRMED_RELATED').length;
    const dismissedDistinct = allOverlaps.filter(o => o.reviewStatus === 'DISMISSED_DISTINCT').length;
    const pendingReview = allOverlaps.filter(o => o.reviewStatus === 'PENDING_REVIEW').length;

    // Summary totals
    const totalReceived = complaints.length;
    const totalResolved = complaints.filter(c => c.status === 'Resolved' || c.status === 'Rejected / Closed').length;
    const totalActive = totalReceived - totalResolved;
    const totalOverdue = complaints.filter(c => c.status !== 'Resolved' && c.status !== 'Rejected / Closed' && c.target_date < today).length;
    const overallDisposalRate = totalReceived > 0 ? Math.round((totalResolved / totalReceived) * 100) : 0;

    res.json({
      summary: {
        totalReceived,
        totalResolved,
        totalActive,
        totalOverdue,
        overallDisposalRate
      },
      bureauScorecard,
      regionWise,
      statusWise,
      ageingAnalysis,
      monthlyPerformance,
      quarterlyPerformance,
      overlapStats: {
        totalFlagged,
        confirmedLinked,
        dismissedDistinct,
        pendingReview
      }
    });
  } catch (err) {
    console.error('Error generating reports:', err);
    res.status(500).json({ error: 'Failed to generate analytical reports: ' + err.message });
  }
});

// -------------------------------------------------------------
// 9. RESET DEMO DATA (Admin Only)
// -------------------------------------------------------------
app.post('/api/reset-demo', requireRole('ADMIN'), (req, res) => {
  try {
    seedDatabase();
    seedUsers();
    res.json({ message: 'Synthetic demo dataset successfully restored!' });
  } catch (err) {
    console.error('Error resetting demo data:', err);
    res.status(500).json({ error: 'Failed to reset demo dataset' });
  }
});

// Fallback to index.html for SPA
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start Server if executed directly
if (require.main === module) {
  app.listen(PORT, '127.0.0.1', () => {
    console.log(`=======================================================`);
    console.log(` AICTE Smart Institution Grievance Intelligence System`);
    console.log(` Problem Statement: SIH26264 | SIH 2026 Working Demo`);
    console.log(` Server active on: http://localhost:${PORT}`);
    console.log(` Database: Persistent SQLite (grievance_system.db)`);
    console.log(`=======================================================`);
  });
}

module.exports = app;
