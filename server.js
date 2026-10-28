const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { db, initSchema } = require('./db');
const { detectAllOverlaps, compareComplaints } = require('./services/overlapEngine');
const { parseCsv, normalizeHeader } = require('./services/csvService');
const { seedDatabase } = require('./seed');
const {
  seedUsers,
  authenticateUser,
  validateSession,
  invalidateSession,
  getLoginThrottleStatus,
  recordFailedLogin,
  recordSuccessfulLogin,
  hashPassword
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
// CSV import accepts the documented 2 MB raw-CSV maximum (plus JSON escaping
// overhead, hence 8 MB at the transport layer; the handler enforces the exact
// 2 MB raw-text limit and returns 413 for anything larger). Scoped to this
// route ONLY so every other endpoint keeps the default ~100 KB body limit.
app.use('/api/complaints/import', express.json({ limit: '8mb' }));
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

// Helper: Query-string values arrive as arrays when a key is repeated in the
// URL (e.g. "?status=ACTIVE&status=ACTIVE"). SQLite parameter binding only
// accepts scalars, so binding an array crashes the statement with
// ERR_INVALID_ARG_TYPE / ERR_INVALID_STATE (500 on the endpoint). Coerce every
// query value to a scalar (last occurrence wins) before building SQL params.
function queryScalar(value) {
  if (Array.isArray(value)) return value[value.length - 1];
  return value;
}

function queryScalars(query) {
  const out = {};
  for (const [key, value] of Object.entries(query || {})) {
    out[key] = queryScalar(value);
  }
  return out;
}

// Helper: Case/whitespace-insensitive bureau comparison (used to scope CSV
// import rows to an importing officer's bureau). Stored bureau values are
// never altered — this only normalises the comparison.
function bureauMatches(a, b) {
  return String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
}

// Helper: Next complaint case ID (AICTE-GRV-2026-XXX).
// MAX(sequence)-based instead of COUNT(*)+1, so deletions can never make the
// counter reissue an ID that still exists. Loops past any existing ID as a
// defensive backstop. Shared by manual registration and CSV import.
function generateComplaintId() {
  const row = db.prepare(
    "SELECT MAX(CAST(SUBSTR(id, 16) AS INTEGER)) AS mx FROM complaints WHERE id LIKE 'AICTE-GRV-2026-%'"
  ).get();
  let seq = row && row.mx ? row.mx : 0;
  let candidate;
  do {
    seq += 1;
    candidate = `AICTE-GRV-2026-${String(seq).padStart(3, '0')}`;
  } while (db.prepare('SELECT 1 FROM complaints WHERE id = ?').get(candidate));
  return candidate;
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

    // Brute-force protection: reject outright if this account/IP pair is locked.
    const clientIp = req.ip || (req.socket && req.socket.remoteAddress) || 'unknown';
    const throttle = getLoginThrottleStatus(username, clientIp);
    if (throttle.locked) {
      const retrySeconds = Math.max(1, Math.ceil(throttle.retryAfterMs / 1000));
      return res.status(429).json({
        error: `Too many failed login attempts. This account is temporarily locked. Try again in ${retrySeconds} second(s).`,
        retryAfterSeconds: retrySeconds
      });
    }

    const session = authenticateUser(username, password);
    if (!session) {
      const result = recordFailedLogin(username, clientIp);
      if (result.locked) {
        return res.status(429).json({
          error: 'Too many failed login attempts. This account is temporarily locked for 60 seconds.',
          retryAfterSeconds: 60
        });
      }
      return res.status(401).json({ error: 'Invalid username or password.' });
    }

    // Successful login resets the failure counter for this account/IP pair.
    recordSuccessfulLogin(username, clientIp);

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
// USER MANAGEMENT (Admin only) — list and create user accounts.
// Additive admin capability: existing seeded accounts and all other
// behaviour are untouched. Passwords are hashed with the same
// scrypt + per-user salt scheme as authentication.
// -------------------------------------------------------------
const ALLOWED_USER_ROLES = ['ADMIN', 'BUREAU_OFFICER', 'GUEST_STUDENT'];
const ALLOWED_USER_BUREAUS = [
  'Student Grievance Redressal Cell (SGRC)',
  'Approval Bureau',
  'Anti-Ragging Cell',
  'Faculty & Staff Grievance Cell',
  'Vigilance Cell',
  'Legal Cell',
  'Regional Bureau / Regional Office (RB)',
  'Public Grievance Redressal Cell (PGRC)'
];

app.get('/api/users', requireRole('ADMIN'), (req, res) => {
  try {
    const rows = db.prepare(`
      SELECT id, username, full_name, role, bureau, email, created_at
      FROM users
      ORDER BY role ASC, bureau ASC, full_name ASC
    `).all();
    res.json(rows);
  } catch (err) {
    console.error('Error listing users:', err);
    res.status(500).json({ error: 'Failed to list users' });
  }
});

app.post('/api/users', requireRole('ADMIN'), (req, res) => {
  try {
    const { username, password, fullName, role, bureau, email } = req.body || {};

    const cleanUsername = String(username || '').trim().toLowerCase();
    const cleanFullName = String(fullName || '').trim();
    const cleanRole = String(role || '').trim().toUpperCase();
    const cleanBureau = bureau ? String(bureau).trim() : null;
    const cleanEmail = email ? String(email).trim().toLowerCase() : cleanUsername;

    if (!cleanUsername || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanUsername)) {
      return res.status(400).json({ error: 'A valid username (email format) is required.' });
    }
    if (!cleanFullName || cleanFullName.length < 3) {
      return res.status(400).json({ error: 'Full name (minimum 3 characters) is required.' });
    }
    if (!ALLOWED_USER_ROLES.includes(cleanRole)) {
      return res.status(400).json({ error: `Invalid role. Must be one of: ${ALLOWED_USER_ROLES.join(', ')}.` });
    }
    if (!password || String(password).length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters long.' });
    }
    if (cleanRole === 'BUREAU_OFFICER') {
      if (!cleanBureau) {
        return res.status(400).json({ error: 'A bureau must be selected for Bureau Officer accounts.' });
      }
      if (!ALLOWED_USER_BUREAUS.includes(cleanBureau)) {
        return res.status(400).json({ error: `Unknown bureau. Must be one of the ${ALLOWED_USER_BUREAUS.length} recognised AICTE bureaus.` });
      }
    }
    if (cleanRole !== 'BUREAU_OFFICER' && cleanBureau && !ALLOWED_USER_BUREAUS.includes(cleanBureau)) {
      return res.status(400).json({ error: `Unknown bureau. Must be one of the ${ALLOWED_USER_BUREAUS.length} recognised AICTE bureaus.` });
    }

    const dup = db.prepare('SELECT id FROM users WHERE LOWER(username) = ?').get(cleanUsername);
    if (dup) {
      return res.status(409).json({ error: `A user with username "${cleanUsername}" already exists.`, existing_user_id: dup.id });
    }

    const { hash, salt } = hashPassword(String(password));
    const newId = `USR-MAN-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
    db.prepare(`
      INSERT INTO users (id, username, password_hash, salt, full_name, role, bureau, email)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(newId, cleanUsername, hash, salt, cleanFullName, cleanRole, cleanRole === 'BUREAU_OFFICER' ? cleanBureau : (cleanBureau || null), cleanEmail);

    const created = db.prepare(
      'SELECT id, username, full_name, role, bureau, email, created_at FROM users WHERE id = ?'
    ).get(newId);
    res.status(201).json({ message: 'User account created.', user: created });
  } catch (err) {
    console.error('Error creating user:', err);
    res.status(500).json({ error: 'Failed to create user: ' + err.message });
  }
});

// Deactivate (delete) a user account. Admin only, with safety guards:
//   - cannot delete your own account (avoids locking yourself out)
//   - cannot delete the last remaining ADMIN
//   - cannot delete an officer who still has active assigned cases
//     (they must reassign those cases first — protects case ownership)
// Sessions cascade via FK ON DELETE CASCADE, so the login dies instantly.
// complaint_history keeps the actor's name string, so the audit trail
// of past actions remains fully intact.
app.delete('/api/users/:id', requireRole('ADMIN'), (req, res) => {
  try {
    const { id } = req.params;
    const target = db.prepare('SELECT id, username, full_name, role FROM users WHERE id = ?').get(id);
    if (!target) {
      return res.status(404).json({ error: 'User not found.' });
    }

    if (target.id === req.user.id) {
      return res.status(400).json({ error: 'You cannot deactivate your own account while signed in.' });
    }

    if (target.role === 'ADMIN') {
      const remainingAdmins = db.prepare(
        "SELECT COUNT(*) AS c FROM users WHERE role = 'ADMIN' AND id != ?"
      ).get(id).c;
      if (remainingAdmins === 0) {
        return res.status(400).json({ error: 'Cannot deactivate the last remaining Administrator account.' });
      }
    }

    const activeCases = db.prepare(`
      SELECT COUNT(*) AS c FROM complaints
      WHERE assigned_officer_id = ?
        AND status NOT IN ('Resolved', 'Rejected / Closed')
    `).get(id).c;
    if (activeCases > 0) {
      return res.status(409).json({
        error: `${target.full_name} still has ${activeCases} active case(s) assigned. Reassign those cases before deactivating the account.`,
        active_case_count: activeCases
      });
    }

    // Clear any stale (closed-case) assignment pointers so the officer list
    // stays accurate, then remove the account (sessions cascade).
    db.prepare('UPDATE complaints SET assigned_officer_id = NULL, assigned_officer = ? WHERE assigned_officer_id = ?')
      .run('AICTE Grievance Desk Officer', id);
    db.prepare('DELETE FROM users WHERE id = ?').run(id);

    res.json({ message: `Account ${target.full_name} (${target.username}) deactivated.`, deleted_user_id: id });
  } catch (err) {
    console.error('Error deactivating user:', err);
    res.status(500).json({ error: 'Failed to deactivate user: ' + err.message });
  }
});

// -------------------------------------------------------------
// 0.1 OFFICERS DIRECTORY API (Authorized Officer Assignment)
// -------------------------------------------------------------
app.get('/api/officers', requireAuth, (req, res) => {
  try {
    const bureau = queryScalar(req.query.bureau);
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
app.get('/api/stats', requireAuth, (req, res) => {
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
    let pendingAdminReview = 0; // Status: Pending Admin Review
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
        if (c.status === 'Pending Admin Review') {
          pendingAdminReview++;
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

    // Overlap count pending review (staff only; hidden for student)
    let pendingOverlapReviews = 0;
    if (!req.user || req.user.role !== 'GUEST_STUDENT') {
      const allOverlaps = detectAllOverlaps(complaints, db.prepare('SELECT * FROM overlap_reviews').all());
      pendingOverlapReviews = allOverlaps.filter(o => o.reviewStatus === 'PENDING_REVIEW').length;
    }

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
        pendingAdminReview,
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
    } = queryScalars(req.query);

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
      } else if (status === 'PENDING_REVIEW' || status === 'Pending Admin Review') {
        query += ` AND c.status = 'Pending Admin Review'`;
      } else if (status === 'TRANSFERRED') {
        query += ` AND (c.status = 'Transferred' OR c.is_transferred = 1)`;
      } else if (status === 'ESCALATED') {
        query += ` AND (c.status = 'Escalated' OR c.is_escalated = 1)`;
      } else {
        query += ` AND c.status = ?`;
        params.push(status);
      }
    }

    if (req.query.assigned_to_me === 'true' && req.user) {
      query += ` AND (c.assigned_officer_id = ? OR c.assigned_officer = ?)`;
      params.push(req.user.id, req.user.fullName);
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

    // -------------------------------------------------------------
    // OPTIONAL server-side pagination. Backward compatible: when no
    // page/page_size params are supplied (the existing UI and every
    // existing test), the full result array is returned exactly as
    // before. When supplied, the response is the sliced page and the
    // total counts are exposed via X-Total-Count / X-Total-Pages
    // headers (never inside the body, so the body stays a plain
    // array of complaints for every caller).
    // -------------------------------------------------------------
    const rawPageSize = parseInt(req.query.page_size, 10);
    const rawPage = parseInt(req.query.page, 10);
    const wantsPagination = Number.isFinite(rawPageSize) && rawPageSize > 0;

    let totalRows = null;
    let totalPages = null;
    let pagedQuery = query;
    const pagedParams = [...params];

    if (wantsPagination) {
      const pageSize = Math.min(rawPageSize, 500); // hard cap per page
      const page = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1;

      // Total count over the exact same filters (before LIMIT/OFFSET)
      const countQuery = query
        .replace(/SELECT[\s\S]*?FROM/, 'SELECT COUNT(*) AS total FROM')
        .replace(/ORDER BY[\s\S]*$/, '');
      totalRows = db.prepare(countQuery).get(...params).total;
      totalPages = Math.max(1, Math.ceil(totalRows / pageSize));

      pagedQuery += ` LIMIT ? OFFSET ?`;
      pagedParams.push(pageSize, (page - 1) * pageSize);
    }

    const complaints = db.prepare(pagedQuery).all(...pagedParams);

    if (wantsPagination) {
      res.set('X-Total-Count', String(totalRows));
      res.set('X-Total-Pages', String(totalPages));
    }

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
    if (req.user.role === 'BUREAU_OFFICER') {
      // Bureau officers may open cases from their OWN bureau, or — when a
      // live cross-bureau coordination request exists for this case — from a
      // bureau they participate in (receiving side acts on the request; the
      // action itself stays gated by the coordination permission matrix).
      // Unrelated bureaus remain blocked.
      if (complaint.bureau !== req.user.bureau) {
        const coord = db.prepare(`
          SELECT id FROM coordination_requests
          WHERE source_complaint_id = ?
            AND status IN ('PENDING', 'ACCEPTED')
            AND (LOWER(TRIM(requesting_bureau)) = LOWER(?) OR LOWER(TRIM(requested_bureau)) = LOWER(?))
          LIMIT 1
        `).get(id, req.user.bureau, req.user.bureau);
        if (!coord) {
          return res.status(403).json({
            error: `Access denied: Case ${id} is assigned to ${complaint.bureau}, outside your assigned bureau (${req.user.bureau}).`
          });
        }
      }
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
      delete complaint.admin_notes;
      const publicHistory = history.filter(h =>
        ['CREATED', 'STATUS_CHANGE', 'DOCUMENT_UPLOADED', 'RESOLUTION_APPROVED', 'REMARK_ADDED'].includes(h.action_type)
      );

      // Only expose resolution remarks if officially resolved
      if (complaint.status !== 'Resolved') {
        delete complaint.resolution_remarks;
        delete complaint.final_resolution_report;
      }

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
      supporting_docs,
      source_reference
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

    // Optional external source reference (portal ticket, physical letter no, etc.)
    // Stored separately from the internal case ID; unique when present.
    // Officer/admin metadata only: a GUEST_STUDENT cannot set a source
    // reference through ordinary complaint creation — the authorised channels
    // for source references are officer registration and the CSV import API.
    const requestedSourceRef = (typeof source_reference === 'string') ? source_reference.trim() : '';
    const cleanSourceRef = (req.user.role === 'GUEST_STUDENT') ? '' : requestedSourceRef;
    if (cleanSourceRef) {
      const existingRef = db.prepare('SELECT id FROM complaints WHERE source_reference = ?').get(cleanSourceRef);
      if (existingRef) {
        return res.status(409).json({
          error: `Source reference "${cleanSourceRef}" is already linked to case ${existingRef.id}.`,
          existing_case_id: existingRef.id
        });
      }
    }

    // Generate unique complaint ID: AICTE-GRV-2026-XXX (MAX-based; safe after deletions)
    const newId = generateComplaintId();

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
        last_action_date, supporting_docs, source_reference, created_at, updated_at
      ) VALUES (
        ?, ?, ?, ?, ?, 'Submitted',
        ?, ?, ?, ?,
        ?, ?, ?, ?, ?, 'Complaint Registered into Central Repository', 'Initial Scrutiny by Bureau Desk',
        datetime('now'), ?, ?, datetime('now'), datetime('now')
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
      supporting_docs || null,
      cleanSourceRef || null
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

// -------------------------------------------------------------
// VALIDATED CSV IMPORT (SIH26264 - complaint data management)
// POST /api/complaints/import  { csv: "source_reference,institution_id,..." }
//
// - Row-level validation errors (line numbers, per-field messages)
// - Duplicate-safe & repeat-safe via the source_reference column:
//   re-importing the same file reports every row as a duplicate and
//   creates nothing; source information of the original case is preserved.
// - Imported cases always start at status 'Submitted' and keep an audit
//   trail entry naming the importer and source reference.
// - BUREAU_OFFICER callers may only import rows for their own bureau.
// NOTE: CSV ingestion is a simulated internal AICTE ingestion channel for
// this demo; no external AICTE system is contacted.
// -------------------------------------------------------------
app.post('/api/complaints/import', requireRole('ADMIN', 'BUREAU_OFFICER'), (req, res) => {
  try {
    const { csv } = req.body || {};
    if (typeof csv !== 'string' || csv.trim().length === 0) {
      return res.status(400).json({ error: 'Request body must include a non-empty "csv" string.' });
    }

    // Documented maximum: 2 MB of raw CSV text per import (matches the UI
    // file cap). Enforced on the raw text so the limit is independent of
    // JSON escaping overhead.
    const IMPORT_MAX_CSV_BYTES = 2 * 1024 * 1024;
    const csvBytes = Buffer.byteLength(csv, 'utf8');
    if (csvBytes > IMPORT_MAX_CSV_BYTES) {
      return res.status(413).json({
        error: `CSV content is too large (${(csvBytes / (1024 * 1024)).toFixed(2)} MB). The maximum supported import size is 2 MB — please split the file into smaller imports.`
      });
    }

    const parsed = parseCsv(csv);
    if (parsed.error) {
      return res.status(400).json({ error: parsed.error });
    }
    if (parsed.rows.length === 0) {
      return res.status(400).json({ error: 'CSV contains no data rows.' });
    }

    const headerRow = parsed.rows[0];
    const columns = headerRow.cells.map(normalizeHeader);

    const requiredColumns = [
      'source_reference', 'institution_id', 'bureau', 'category', 'priority',
      'complainant_name', 'subject', 'description'
    ];
    const missingColumns = requiredColumns.filter(c => !columns.includes(c));
    if (missingColumns.length > 0) {
      return res.status(400).json({
        error: `Missing required CSV column(s): ${missingColumns.join(', ')} (header line ${headerRow.line}).`,
        missingColumns
      });
    }

    const dataRows = parsed.rows.slice(1);
    if (dataRows.length === 0) {
      return res.status(400).json({ error: 'CSV contains a header row but no data rows.' });
    }

    const isOfficer = req.user.role === 'BUREAU_OFFICER';
    const allowedPriorities = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];
    const instExists = db.prepare('SELECT 1 FROM institutions WHERE id = ?');
    const refExists = db.prepare('SELECT id FROM complaints WHERE source_reference = ?');
    const insertComplaint = db.prepare(`
      INSERT INTO complaints (
        id, institution_id, bureau, category, priority, status,
        complainant_name, complainant_role, complainant_email, complainant_phone,
        subject, description, target_date, assigned_officer, assigned_officer_id,
        last_action, next_action, last_action_date, supporting_docs, source_reference,
        created_at, updated_at
      ) VALUES (
        ?, ?, ?, ?, ?, 'Submitted',
        ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        'Complaint Imported via Validated CSV', 'Initial Scrutiny by Bureau Desk',
        datetime('now'), NULL, ?,
        datetime('now'), datetime('now')
      )
    `);
    const insertHistory = db.prepare(`
      INSERT INTO complaint_history (complaint_id, action_type, old_value, new_value, remarks, actor)
      VALUES (?, 'CREATED', NULL, 'Submitted', ?, ?)
    `);

    const errors = [];     // { line, errors: [{ field, message }] }
    const duplicateRows = []; // { line, source_reference, existing_case_id, reason }
    const created = [];    // { line, source_reference, complaint_id }
    const seenRefsInFile = new Set();

    // Validate one row -> { rec, errors }
    function validateRow(row) {
      const rec = {};
      columns.forEach((col, idx) => {
        if (col) rec[col] = String(row.cells[idx] ?? '').trim();
      });

      const rowErrors = [];

      // Short rows: omitted trailing empty cells are tolerated (padded as
      // empty strings; required-field checks below still catch real gaps).
      // Rows with MORE cells than the header are structurally malformed.
      if (row.cells.length > headerRow.cells.length) {
        rowErrors.push({
          field: '(row)',
          message: `Malformed row: expected ${headerRow.cells.length} columns, found ${row.cells.length} (extra cells).`
        });
        return { rec, errors: rowErrors }; // structural problem: skip field checks
      }

      if (!rec.source_reference) {
        rowErrors.push({ field: 'source_reference', message: 'Source reference is required (identifies the original complaint in its source system).' });
      }
      if (!rec.institution_id) {
        rowErrors.push({ field: 'institution_id', message: 'Institution ID is required.' });
      } else if (!instExists.get(rec.institution_id)) {
        rowErrors.push({ field: 'institution_id', message: `Unknown institution ID "${rec.institution_id}" (not in AICTE registry).` });
      }
      if (!rec.bureau) {
        rowErrors.push({ field: 'bureau', message: 'Bureau is required.' });
      } else if (isOfficer && !bureauMatches(rec.bureau, req.user.bureau)) {
        rowErrors.push({ field: 'bureau', message: `Bureau Officer may only import complaints for their own bureau (${req.user.bureau}).` });
      }
      if (!rec.category) {
        rowErrors.push({ field: 'category', message: 'Category is required.' });
      }
      if (!rec.priority) {
        rowErrors.push({ field: 'priority', message: 'Priority is required.' });
      } else if (!allowedPriorities.includes(rec.priority.toUpperCase())) {
        rowErrors.push({ field: 'priority', message: `Priority must be one of: ${allowedPriorities.join(', ')}.` });
      } else {
        rec.priority = rec.priority.toUpperCase();
      }
      if (!rec.complainant_name) {
        rowErrors.push({ field: 'complainant_name', message: 'Complainant name is required.' });
      }
      if (!rec.subject) {
        rowErrors.push({ field: 'subject', message: 'Subject is required.' });
      }
      if (!rec.description) {
        rowErrors.push({ field: 'description', message: 'Description is required.' });
      }
      if (!rec.complainant_role) {
        rec.complainant_role = 'Student';
      }
      if (rec.target_date && !/^\d{4}-\d{2}-\d{2}$/.test(rec.target_date)) {
        rowErrors.push({ field: 'target_date', message: 'Target date must be in YYYY-MM-DD format.' });
      } else if (!rec.target_date) {
        // Default SLA: 30 days, same policy as manual registration
        rec.target_date = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      }

      return { rec, errors: rowErrors };
    }

    for (const row of dataRows) {
      const { rec, errors: rowErrors } = validateRow(row);

      if (rowErrors.length > 0) {
        errors.push({ line: row.line, source_reference: rec.source_reference || null, errors: rowErrors });
        continue;
      }

      // Duplicate-safe: same reference twice in one file
      if (seenRefsInFile.has(rec.source_reference)) {
        duplicateRows.push({
          line: row.line,
          source_reference: rec.source_reference,
          reason: 'Source reference repeated within the imported file.'
        });
        continue;
      }

      // Duplicate-safe: reference already imported previously
      const existing = refExists.get(rec.source_reference);
      if (existing) {
        duplicateRows.push({
          line: row.line,
          source_reference: rec.source_reference,
          existing_case_id: existing.id,
          reason: 'Source reference already linked to an existing case.'
        });
        continue;
      }

      // Round-trip safety: check if complaint ID from CSV already exists in DB
      // This handles re-importing exported CSVs where source_reference is empty
      const complaintId = row.cells[0]?.trim();
      if (complaintId && /^AICTE-GRV-\d{3}-\d{3}$/.test(complaintId)) {
        const existing = db.prepare('SELECT id FROM complaints WHERE id = ?').get(complaintId);
        if (existing) {
          duplicateRows.push({
            line: row.line,
            source_reference: rec.source_reference,
            existing_case_id: existing.id,
            reason: 'Complaint already exists in the database.'
          });
          continue;
        }
      }

      seenRefsInFile.add(rec.source_reference);

      // Officer resolution (mirrors manual registration defaults)
      let officer = rec.assigned_officer || null;
      let officerId = null;
      if (officer) {
        const match = db.prepare('SELECT id, full_name FROM users WHERE full_name = ? OR username = ?').get(officer, officer);
        if (match) {
          officerId = match.id;
          officer = match.full_name;
        }
      } else {
        const match = db.prepare("SELECT id, full_name FROM users WHERE bureau = ? AND role = 'BUREAU_OFFICER' LIMIT 1").get(rec.bureau);
        if (match) {
          officerId = match.id;
          officer = match.full_name;
        }
      }
      if (!officer) {
        officer = req.user.fullName || 'AICTE Grievance Desk Officer';
        officerId = req.user.id;
      }

      const newId = generateComplaintId();
      try {
        insertComplaint.run(
          newId,
          rec.institution_id,
          rec.bureau,
          rec.category,
          rec.priority,
          rec.complainant_name,
          rec.complainant_role,
          rec.complainant_email || '',
          rec.complainant_phone || '',
          rec.subject,
          rec.description,
          rec.target_date,
          officer,
          officerId,
          rec.source_reference
        );
        insertHistory.run(
          newId,
          `Complaint imported via validated CSV by ${req.user.fullName}. Source reference: ${rec.source_reference}.`,
          req.user.fullName || 'System Import'
        );

        broadcastEvent('COMPLAINT_CREATED', {
          id: newId,
          bureau: rec.bureau,
          category: rec.category,
          priority: rec.priority,
          subject: rec.subject,
          institution_id: rec.institution_id,
          complainant_name: rec.complainant_name,
          created_at: new Date().toISOString()
        });

        created.push({ line: row.line, source_reference: rec.source_reference, complaint_id: newId });
      } catch (insertErr) {
        const insertErrMsg = String(insertErr.message || '');
        // Unique index on source_reference is the final backstop against races.
        // Only a source_reference violation is classified as a duplicate; any
        // other UNIQUE failure (e.g. a hypothetical case-ID collision) or DB
        // error is reported as a failed row, never as a duplicate.
        if (insertErrMsg.includes('UNIQUE constraint failed: complaints.source_reference')) {
          const raced = refExists.get(rec.source_reference);
          duplicateRows.push({
            line: row.line,
            source_reference: rec.source_reference,
            existing_case_id: raced ? raced.id : null,
            reason: 'Source reference already linked to an existing case.'
          });
        } else {
          errors.push({
            line: row.line,
            source_reference: rec.source_reference,
            errors: [{ field: '(row)', message: `Import failed: ${insertErrMsg}` }]
          });
        }
      }
    }

    res.status(201).json({
      message: 'CSV import processed',
      total_rows: dataRows.length,
      imported: created.length,
      duplicates: duplicateRows.length,
      failed: errors.length,
      created,
      duplicate_rows: duplicateRows,
      errors
    });
  } catch (err) {
    console.error('Error importing complaints CSV:', err);
    res.status(500).json({ error: 'Failed to import complaints CSV: ' + err.message });
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
      if (bureau && bureau !== current.bureau) {
        return res.status(403).json({
          error: 'Bureau reassignment requires Central Admin authorization.'
        });
      }
      if ((assigned_officer_id && assigned_officer_id !== current.assigned_officer_id) || (assigned_officer && assigned_officer !== current.assigned_officer)) {
        return res.status(403).json({
          error: 'Officer reassignment requires Central Admin authorization.'
        });
      }
      if (status === 'Resolved' || status === 'Rejected / Closed') {
        return res.status(403).json({
          error: 'Only Central Admin is authorized to issue final closure and approve resolution reports. Please submit the case for Admin review.'
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
      const officerUser = db.prepare('SELECT id, full_name, bureau, role, email FROM users WHERE id = ?').get(assigned_officer_id);
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

// SUBMIT RESOLUTION FOR ADMIN REVIEW (Officer / Staff)
app.post('/api/complaints/:id/submit-resolution', requireRole('ADMIN', 'BUREAU_OFFICER'), (req, res) => {
  try {
    const { id } = req.params;
    const { resolution_summary, supporting_docs } = req.body;

    if (!resolution_summary || resolution_summary.trim().length < 10) {
      return res.status(400).json({ error: 'A detailed resolution summary (minimum 10 characters) is mandatory.' });
    }

    const current = db.prepare('SELECT * FROM complaints WHERE id = ?').get(id);
    if (!current) {
      return res.status(404).json({ error: 'Complaint not found.' });
    }

    if (req.user.role === 'BUREAU_OFFICER' && current.bureau !== req.user.bureau) {
      return res.status(403).json({
        error: `Access denied: Case belongs to ${current.bureau}, outside your assigned bureau (${req.user.bureau}).`
      });
    }

    if (current.status === 'Resolved' || current.status === 'Rejected / Closed') {
      return res.status(400).json({ error: 'This complaint is already resolved and closed.' });
    }

    const actor = req.user.fullName || 'Bureau Officer';
    const cleanSummary = resolution_summary.trim();

    db.prepare(`
      UPDATE complaints
      SET status = 'Pending Admin Review',
          investigation_notes = ?,
          last_action = ?,
          next_action = 'Awaiting Central Admin Resolution Review & Closure Order',
          last_action_date = datetime('now'),
          updated_at = datetime('now'),
          supporting_docs = COALESCE(?, supporting_docs)
      WHERE id = ?
    `).run(cleanSummary, `Resolution Submitted by ${actor}`, supporting_docs || null, id);

    db.prepare(`
      INSERT INTO complaint_history (complaint_id, action_type, old_value, new_value, remarks, actor)
      VALUES (?, 'RESOLUTION_SUBMITTED', ?, 'Pending Admin Review', ?, ?)
    `).run(id, current.status, cleanSummary, actor);

    broadcastEvent('COMPLAINT_UPDATED', {
      id,
      bureau: current.bureau,
      status: 'Pending Admin Review',
      priority: current.priority,
      actor,
      last_action: `Resolution submitted by ${actor}`,
      updated_at: new Date().toISOString()
    });

    res.json({
      message: 'Resolution report submitted successfully. Case is now awaiting Central Admin review and approval.',
      complaintId: id,
      status: 'Pending Admin Review'
    });
  } catch (err) {
    console.error('Error submitting resolution:', err);
    res.status(500).json({ error: 'Failed to submit resolution: ' + err.message });
  }
});

// REVIEW RESOLUTION (Central Admin Only: Approve & Close, Return for Action, Reassign Officer)
app.post('/api/complaints/:id/review-resolution', requireRole('ADMIN'), (req, res) => {
  try {
    const { id } = req.params;
    const {
      decision, // 'APPROVE' | 'RETURN' | 'REASSIGN'
      admin_notes,
      final_report,
      new_officer_id,
      reassignment_reason
    } = req.body;

    if (!['APPROVE', 'RETURN', 'REASSIGN'].includes(decision)) {
      return res.status(400).json({ error: "Invalid review decision. Must be 'APPROVE', 'RETURN', or 'REASSIGN'." });
    }

    const current = db.prepare('SELECT * FROM complaints WHERE id = ?').get(id);
    if (!current) {
      return res.status(404).json({ error: 'Complaint not found.' });
    }

    const adminActor = req.user.fullName || 'Central Admin';

    if (decision === 'APPROVE') {
      const remarks = (final_report || admin_notes || '').trim();
      if (remarks.length < 5) {
        return res.status(400).json({ error: 'Official approval remarks / resolution order (minimum 5 characters) are required to approve and close.' });
      }

      db.prepare(`
        UPDATE complaints
        SET status = 'Resolved',
            resolved_at = datetime('now'),
            admin_notes = ?,
            final_resolution_report = ?,
            resolution_remarks = ?,
            last_action = ?,
            next_action = 'Case Closed - Official Resolution Order Dispatched',
            last_action_date = datetime('now'),
            updated_at = datetime('now')
        WHERE id = ?
      `).run(
        remarks,
        remarks,
        remarks,
        `Approved & Closed by Central Admin (${adminActor})`,
        id
      );

      db.prepare(`
        INSERT INTO complaint_history (complaint_id, action_type, old_value, new_value, remarks, actor)
        VALUES (?, 'RESOLUTION_APPROVED', ?, 'Resolved', ?, ?)
      `).run(id, current.status, remarks, adminActor);

      // Notification log to complainant
      if (current.complainant_email) {
        sendNotification({
          complaintId: id,
          eventType: 'CASE_RESOLVED',
          recipientEmail: current.complainant_email,
          recipientPhone: current.complainant_phone,
          channel: 'EMAIL',
          subject: `Grievance Resolved: Case ${id} Disposed with Official Order`,
          body: `Dear ${current.complainant_name},\n\nYour grievance case ${id} has been formally approved and resolved by AICTE Central Administration.\n\nFinal Resolution Order:\n${remarks}`
        }).catch(() => {});
      }

      broadcastEvent('COMPLAINT_UPDATED', {
        id,
        bureau: current.bureau,
        status: 'Resolved',
        priority: current.priority,
        actor: adminActor,
        last_action: 'Approved & Closed by Central Admin',
        updated_at: new Date().toISOString()
      });

      return res.json({
        message: 'Resolution successfully approved and complaint officially closed.',
        complaintId: id,
        status: 'Resolved',
        finalReport: remarks
      });
    }

    if (decision === 'RETURN') {
      const returnReason = (admin_notes || '').trim();
      if (returnReason.length < 5) {
        return res.status(400).json({ error: 'A specific return reason / instructions for further inquiry (minimum 5 characters) are required.' });
      }

      db.prepare(`
        UPDATE complaints
        SET status = 'Under Bureau Scrutiny',
            admin_notes = ?,
            next_action = ?,
            last_action = ?,
            return_count = COALESCE(return_count, 0) + 1,
            last_action_date = datetime('now'),
            updated_at = datetime('now')
        WHERE id = ?
      `).run(
        returnReason,
        `Inquiry Returned by Central Admin: ${returnReason}`,
        `Returned by Central Admin (${adminActor}) for Further Inquiry`,
        id
      );

      db.prepare(`
        INSERT INTO complaint_history (complaint_id, action_type, old_value, new_value, remarks, actor)
        VALUES (?, 'RESOLUTION_RETURNED', ?, 'Under Bureau Scrutiny', ?, ?)
      `).run(id, current.status, returnReason, adminActor);

      broadcastEvent('COMPLAINT_UPDATED', {
        id,
        bureau: current.bureau,
        status: 'Under Bureau Scrutiny',
        priority: current.priority,
        actor: adminActor,
        last_action: 'Returned by Central Admin for Further Inquiry',
        updated_at: new Date().toISOString()
      });

      return res.json({
        message: 'Complaint returned to assigned bureau officer for further investigation.',
        complaintId: id,
        status: 'Under Bureau Scrutiny',
        returnReason
      });
    }

    if (decision === 'REASSIGN') {
      const reason = (reassignment_reason || admin_notes || '').trim();
      if (!new_officer_id) {
        return res.status(400).json({ error: 'A target officer must be selected for reassignment.' });
      }
      if (reason.length < 5) {
        return res.status(400).json({ error: 'A mandatory reason for reassignment (minimum 5 characters) is required.' });
      }

      const targetOfficer = db.prepare('SELECT id, full_name, bureau, role, email FROM users WHERE id = ?').get(new_officer_id);
      if (!targetOfficer) {
        return res.status(400).json({ error: 'Selected officer does not exist in registry.' });
      }
      if (targetOfficer.role === 'BUREAU_OFFICER' && targetOfficer.bureau !== current.bureau) {
        return res.status(400).json({
          error: `Officer ${targetOfficer.full_name} is in ${targetOfficer.bureau}, which does not match case bureau (${current.bureau}).`
        });
      }

      db.prepare(`
        UPDATE complaints
        SET assigned_officer_id = ?,
            assigned_officer = ?,
            admin_notes = ?,
            next_action = ?,
            last_action = ?,
            last_action_date = datetime('now'),
            updated_at = datetime('now')
        WHERE id = ?
      `).run(
        targetOfficer.id,
        targetOfficer.full_name,
        reason,
        `Reassigned to ${targetOfficer.full_name}: ${reason}`,
        `Officer Reassigned by Central Admin (${adminActor})`,
        id
      );

      db.prepare(`
        INSERT INTO complaint_history (complaint_id, action_type, old_value, new_value, remarks, actor)
        VALUES (?, 'OFFICER_REASSIGNMENT', ?, ?, ?, ?)
      `).run(id, current.assigned_officer, targetOfficer.full_name, `Reassignment by Admin: ${reason}`, adminActor);

      broadcastEvent('COMPLAINT_UPDATED', {
        id,
        bureau: current.bureau,
        status: current.status,
        priority: current.priority,
        actor: adminActor,
        last_action: `Reassigned to ${targetOfficer.full_name}`,
        updated_at: new Date().toISOString()
      });

      return res.json({
        message: `Complaint reassigned successfully to officer ${targetOfficer.full_name}.`,
        complaintId: id,
        newOfficer: targetOfficer.full_name
      });
    }
  } catch (err) {
    console.error('Error reviewing resolution:', err);
    res.status(500).json({ error: 'Failed to process resolution review: ' + err.message });
  }
});

// -------------------------------------------------------------
// OFFICER WORKLOAD & ASSIGNMENT RECOMMENDATIONS (transparent,
// data-driven only — no fabricated expertise/availability metrics;
// the users table has no expertise/disabled columns, so eligibility
// is bureau + role based and workload uses real assigned cases)
// -------------------------------------------------------------
const ACTIVE_COMPLAINT_STATUSES_SQL =
  "('Submitted','Under Bureau Scrutiny','Notice Issued to Institute','Hearing / Inquiry Scheduled','Pending Admin Review','Transferred','Escalated')";

app.get('/api/officers/workload', requireRole('ADMIN', 'BUREAU_OFFICER'), (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    const rows = db.prepare(`
      SELECT u.id, u.full_name, u.bureau, u.role,
        COUNT(c.id) AS active_cases,
        COALESCE(SUM(CASE WHEN c.target_date < ? THEN 1 ELSE 0 END), 0) AS overdue_cases,
        COALESCE(SUM(CASE WHEN c.priority = 'CRITICAL' THEN 1 ELSE 0 END), 0) AS critical_active
      FROM users u
      LEFT JOIN complaints c
        ON c.assigned_officer_id = u.id AND c.status IN ${ACTIVE_COMPLAINT_STATUSES_SQL}
      WHERE u.role IN ('ADMIN', 'BUREAU_OFFICER')
      GROUP BY u.id
      ORDER BY active_cases ASC, overdue_cases ASC, critical_active ASC, u.full_name ASC
    `).all(today);

    // Bureau officers only see their own bureau's workload; admins see all.
    const officers = req.user.role === 'BUREAU_OFFICER'
      ? rows.filter(r => bureauMatches(r.bureau, req.user.bureau))
      : rows;

    res.json({ as_of: today, officers });
  } catch (err) {
    console.error('Error computing officer workload:', err);
    res.status(500).json({ error: 'Failed to compute officer workload: ' + err.message });
  }
});

app.get('/api/complaints/:id/assignment-recommendations', requireRole('ADMIN', 'BUREAU_OFFICER'), (req, res) => {
  try {
    const { id } = req.params;
    const complaint = db.prepare(
      'SELECT id, bureau, category, priority, status, assigned_officer_id, assigned_officer FROM complaints WHERE id = ?'
    ).get(id);
    if (!complaint) {
      return res.status(404).json({ error: 'Complaint not found.' });
    }
    if (req.user.role === 'BUREAU_OFFICER' && !bureauMatches(complaint.bureau, req.user.bureau)) {
      return res.status(403).json({
        error: `Access denied: Case belongs to ${complaint.bureau}, outside your assigned bureau (${req.user.bureau}).`
      });
    }
    if (complaint.status === 'Resolved' || complaint.status === 'Rejected / Closed') {
      return res.status(400).json({ error: 'Closed cases cannot receive new officer assignments.' });
    }

    const today = new Date().toISOString().split('T')[0];
    // Real stored data only: active caseload, overdue count and critical count
    // per eligible officer (BUREAU_OFFICER role; bureau matched case-insensitively).
    const candidates = db.prepare(`
      SELECT u.id, u.full_name, u.bureau,
        COUNT(c.id) AS active_cases,
        COALESCE(SUM(CASE WHEN c.target_date < ? THEN 1 ELSE 0 END), 0) AS overdue_cases,
        COALESCE(SUM(CASE WHEN c.priority = 'CRITICAL' THEN 1 ELSE 0 END), 0) AS critical_active
      FROM users u
      LEFT JOIN complaints c
        ON c.assigned_officer_id = u.id AND c.status IN ${ACTIVE_COMPLAINT_STATUSES_SQL}
      WHERE u.role = 'BUREAU_OFFICER'
      GROUP BY u.id
      ORDER BY active_cases ASC, overdue_cases ASC, critical_active ASC, u.full_name ASC
    `).all(today);

    const eligible = candidates.filter(o => bureauMatches(o.bureau, complaint.bureau));
    const top = eligible.slice(0, 3).map((o, idx) => {
      const explanationParts = [
        `Bureau match: ${o.bureau} (case bureau: ${complaint.bureau})`,
        `${o.active_cases} active case(s) currently assigned`,
        `${o.overdue_cases} overdue among those`,
        `${o.critical_active} critical-priority active case(s)`
      ];
      if (idx === 0) {
        explanationParts.push('Lowest current workload among eligible officers — ranked first');
      } else {
        explanationParts.push(`Ranked #${idx + 1} by workload (fewest active cases first)`);
      }
      return {
        rank: idx + 1,
        officer_id: o.id,
        full_name: o.full_name,
        bureau: o.bureau,
        active_cases: o.active_cases,
        overdue_cases: o.overdue_cases,
        critical_active: o.critical_active,
        explanation: explanationParts.join('; ') + '.'
      };
    });

    res.json({
      complaint_id: complaint.id,
      recommended_bureau: complaint.bureau,
      bureau_note: 'Bureau is taken from the case record itself; reassignment across bureaus remains an explicit Admin decision.',
      current_officer_id: complaint.assigned_officer_id,
      current_officer: complaint.assigned_officer,
      category: complaint.category,
      priority: complaint.priority,
      eligible_officer_count: eligible.length,
      recommendations: top
    });
  } catch (err) {
    console.error('Error generating assignment recommendations:', err);
    res.status(500).json({ error: 'Failed to generate recommendations: ' + err.message });
  }
});

// -------------------------------------------------------------
// CROSS-BUREAU COORDINATION WORKFLOW (persistent, auditable)
// A coordination request is an explicit ask from one bureau to
// another for assistance on a case. It never transfers, merges or
// closes the complaint; the case keeps one authoritative history.
// -------------------------------------------------------------
app.post('/api/complaints/:id/coordination', requireAuth, (req, res) => {
  try {
    const { id } = req.params;
    const { requested_bureau, reason } = req.body || {};

    if (req.user.role === 'GUEST_STUDENT') {
      return res.status(403).json({ error: 'Complainants cannot initiate cross-bureau coordination.' });
    }
    const complaint = db.prepare('SELECT id, bureau, status, subject FROM complaints WHERE id = ?').get(id);
    if (!complaint) {
      return res.status(404).json({ error: 'Complaint not found.' });
    }
    if (req.user.role === 'BUREAU_OFFICER' && !bureauMatches(complaint.bureau, req.user.bureau)) {
      return res.status(403).json({
        error: `Access denied: Case belongs to ${complaint.bureau}, outside your assigned bureau (${req.user.bureau}).`
      });
    }

    const cleanBureau = String(requested_bureau || '').trim();
    const cleanReason = String(reason || '').trim();
    if (!cleanBureau) {
      return res.status(400).json({ error: 'A target bureau must be selected for coordination.' });
    }
    if (bureauMatches(cleanBureau, complaint.bureau)) {
      return res.status(400).json({ error: 'Coordination targets a different bureau; this case already belongs to its own bureau.' });
    }
    if (cleanReason.length < 10) {
      return res.status(400).json({ error: 'A coordination reason (minimum 10 characters) is required.' });
    }
    if (complaint.status === 'Resolved' || complaint.status === 'Rejected / Closed') {
      return res.status(400).json({ error: 'Closed cases cannot receive new coordination requests.' });
    }
    const dupPending = db.prepare(
      "SELECT id FROM coordination_requests WHERE source_complaint_id = ? AND LOWER(TRIM(requested_bureau)) = LOWER(?) AND status = 'PENDING'"
    ).get(id, cleanBureau);
    if (dupPending) {
      return res.status(409).json({
        error: `A pending coordination request to ${cleanBureau} already exists for this case.`,
        existing_request_id: dupPending.id
      });
    }

    const actor = req.user.fullName || 'AICTE Officer';
    const inserted = db.prepare(`
      INSERT INTO coordination_requests
        (source_complaint_id, requesting_bureau, requested_bureau, requested_by, reason, status)
      VALUES (?, ?, ?, ?, ?, 'PENDING')
    `).run(id, complaint.bureau, cleanBureau, actor, cleanReason);
    const requestId = inserted.lastInsertRowid;

    db.prepare(`
      INSERT INTO complaint_history (complaint_id, action_type, old_value, new_value, remarks, actor)
      VALUES (?, 'COORDINATION_REQUESTED', ?, ?, ?, ?)
    `).run(id, complaint.bureau, cleanBureau, `Cross-bureau coordination requested: ${cleanReason}`, actor);

    broadcastEvent('COORDINATION_REQUESTED', {
      complaint_id: id,
      requesting_bureau: complaint.bureau,
      requested_bureau: cleanBureau,
      actor,
      created_at: new Date().toISOString()
    });

    const row = db.prepare('SELECT * FROM coordination_requests WHERE id = ?').get(requestId);
    res.status(201).json({ message: 'Coordination request submitted.', request: row });
  } catch (err) {
    console.error('Error creating coordination request:', err);
    res.status(500).json({ error: 'Failed to create coordination request: ' + err.message });
  }
});

app.get('/api/coordination', requireRole('ADMIN', 'BUREAU_OFFICER'), (req, res) => {
  try {
    const base = `
      SELECT cr.*, c.subject, c.priority, c.status AS complaint_status, c.category
      FROM coordination_requests cr
      JOIN complaints c ON c.id = cr.source_complaint_id
    `;
    let rows;
    if (req.user.role === 'ADMIN') {
      rows = db.prepare(base + ' ORDER BY cr.created_at DESC, cr.id DESC').all();
    } else {
      rows = db.prepare(base + `
        WHERE LOWER(TRIM(cr.requesting_bureau)) = LOWER(?)
           OR LOWER(TRIM(cr.requested_bureau)) = LOWER(?)
        ORDER BY cr.created_at DESC, cr.id DESC
      `).all(req.user.bureau, req.user.bureau);
    }
    res.json(rows);
  } catch (err) {
    console.error('Error listing coordination requests:', err);
    res.status(500).json({ error: 'Failed to list coordination requests: ' + err.message });
  }
});

app.post('/api/coordination/:id/respond', requireRole('ADMIN', 'BUREAU_OFFICER'), (req, res) => {
  try {
    const { id } = req.params;
    const { decision, remarks } = req.body || {};
    const allowed = ['ACCEPT', 'REJECT', 'COMPLETED', 'CANCELLED'];
    if (!allowed.includes(decision)) {
      return res.status(400).json({ error: `Invalid decision. Must be one of: ${allowed.join(', ')}.` });
    }

    const row = db.prepare(
      'SELECT cr.*, c.status AS complaint_status FROM coordination_requests cr JOIN complaints c ON c.id = cr.source_complaint_id WHERE cr.id = ?'
    ).get(id);
    if (!row) {
      return res.status(404).json({ error: 'Coordination request not found.' });
    }

    const isRequestedSide = bureauMatches(row.requested_bureau, req.user.bureau);
    const isRequestingSide = bureauMatches(row.requesting_bureau, req.user.bureau);
    const cleanRemarks = String(remarks || '').trim();

    // Permission matrix: the receiving bureau acts on ACCEPT/REJECT/COMPLETED;
    // the initiating side may only CANCEL its own request. Admin may do anything.
    if (['ACCEPT', 'REJECT', 'COMPLETED'].includes(decision)) {
      if (req.user.role !== 'ADMIN' && !isRequestedSide) {
        return res.status(403).json({
          error: `Only the receiving bureau (${row.requested_bureau}) or Central Admin may ${decision} this request.`
        });
      }
      if (cleanRemarks.length < 5) {
        return res.status(400).json({ error: `Remarks (minimum 5 characters) are required to ${decision} a coordination request.` });
      }
    }
    if (decision === 'CANCELLED') {
      if (req.user.role !== 'ADMIN' && !isRequestingSide) {
        return res.status(403).json({
          error: `Only the initiating bureau (${row.requesting_bureau}) or Central Admin may cancel this request.`
        });
      }
    }

    // State machine: PENDING -> ACCEPTED | REJECTED | CANCELLED;
    // ACCEPTED -> COMPLETED | CANCELLED; terminal states are immutable.
    const transitions = {
      PENDING: ['ACCEPT', 'REJECT', 'CANCELLED'],
      ACCEPTED: ['COMPLETED', 'CANCELLED']
    };
    const possible = transitions[row.status] || [];
    if (!possible.includes(decision)) {
      return res.status(400).json({
        error: `A ${row.status} coordination request cannot be ${decision}${possible.length ? `; allowed actions from ${row.status}: ${possible.join(', ')}` : ' (this request is already closed)'}.`
      });
    }

    const statusMap = { ACCEPT: 'ACCEPTED', REJECT: 'REJECTED', COMPLETED: 'COMPLETED', CANCELLED: 'CANCELLED' };
    const actor = req.user.fullName || 'AICTE Officer';

    db.prepare(`
      UPDATE coordination_requests
      SET status = ?, responded_by = ?, response_remarks = ?, responded_at = datetime('now')
      WHERE id = ?
    `).run(statusMap[decision], actor, cleanRemarks || null, id);

    db.prepare(`
      INSERT INTO complaint_history (complaint_id, action_type, old_value, new_value, remarks, actor)
      VALUES (?, ?, 'PENDING', ?, ?, ?)
    `).run(
      row.source_complaint_id,
      `COORDINATION_${statusMap[decision]}`,
      statusMap[decision],
      cleanRemarks || `Coordination ${statusMap[decision].toLowerCase()}.`,
      actor
    );

    broadcastEvent('COORDINATION_UPDATED', {
      complaint_id: row.source_complaint_id,
      coordination_id: Number(id),
      status: statusMap[decision],
      actor,
      updated_at: new Date().toISOString()
    });

    const updated = db.prepare('SELECT * FROM coordination_requests WHERE id = ?').get(id);
    res.json({ message: `Coordination request ${statusMap[decision].toLowerCase()}.`, request: updated });
  } catch (err) {
    console.error('Error responding to coordination request:', err);
    res.status(500).json({ error: 'Failed to process coordination response: ' + err.message });
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
app.get('/api/institutions', requireAuth, (req, res) => {
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

app.get('/api/institutions/:id', requireAuth, (req, res) => {
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

    // Role-based scoping: a Student may only view their own complaints at this
    // institution, with confidential internal fields scrubbed (mirrors /api/complaints/:id).
    let scopedComplaints = complaints;
    if (req.user.role === 'GUEST_STUDENT') {
      scopedComplaints = complaints
        .filter(c => c.complainant_email === req.user.email || c.complainant_name === req.user.fullName)
        .map(c => {
          const scrubbed = { ...c };
          delete scrubbed.investigation_notes;
          delete scrubbed.admin_notes;
          if (scrubbed.status !== 'Resolved') {
            delete scrubbed.resolution_remarks;
            delete scrubbed.final_resolution_report;
          }
          return scrubbed;
        });
    }

    const today = new Date().toISOString().split('T')[0];
    const totalGrievances = scopedComplaints.length;
    const activeGrievances = scopedComplaints.filter(c => c.status !== 'Resolved' && c.status !== 'Rejected / Closed').length;
    const resolvedGrievances = scopedComplaints.filter(c => c.status === 'Resolved' || c.status === 'Rejected / Closed').length;
    const overdueGrievances = scopedComplaints.filter(c => c.status !== 'Resolved' && c.status !== 'Rejected / Closed' && c.target_date < today).length;
    const criticalGrievances = scopedComplaints.filter(c => c.priority === 'CRITICAL').length;
    const disposalRate = totalGrievances > 0 ? Math.round((resolvedGrievances / totalGrievances) * 100) : 0;

    // Related overlaps for this institution (staff oversight only; hidden from students)
    let institutionOverlaps = [];
    if (req.user.role !== 'GUEST_STUDENT') {
      const allOverlaps = detectAllOverlaps(db.prepare('SELECT * FROM complaints').all(), db.prepare('SELECT * FROM overlap_reviews').all());
      institutionOverlaps = allOverlaps.filter(o => o.complaintA.institution_id === id || o.complaintB.institution_id === id);
    }

    res.json({
      ...inst,
      complaintHistory: scopedComplaints,
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
    const { dateFrom, dateTo } = queryScalars(req.query);
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

// Centralised API error responses. Body-parser failures (413 payload too
// large, 400 malformed JSON) otherwise fall through to Express's default
// HTML error page; API clients (browser UI, tests) get consistent JSON.
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  const status = (err && err.status) || 500;
  if (req.path.startsWith('/api/')) {
    const message = status === 413
      ? 'Request payload too large. CSV imports accept up to 2 MB of raw CSV text; other endpoints accept up to 100 KB.'
      : (err && err.message) || 'Invalid request payload.';
    return res.status(status).json({ error: message });
  }
  next(err);
});

// Start Server if executed directly
if (require.main === module) {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`=======================================================`);
    console.log(` AICTE Smart Institution Grievance Intelligence System`);
    console.log(` Problem Statement: SIH26264 | SIH 2026 Working Demo`);
    console.log(` Server active on: http://localhost:${PORT} AND http://0.0.0.0:${PORT}`);
    console.log(` Database: Persistent SQLite (grievance_system.db)`);
    console.log(`=======================================================`);
  });
}

module.exports = app;
