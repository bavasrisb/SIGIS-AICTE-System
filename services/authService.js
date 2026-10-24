const crypto = require('node:crypto');
const { db } = require('../db');

// Hash password using PBKDF2/scrypt with unique salt
function hashPassword(password, salt) {
  if (!salt) {
    salt = crypto.randomBytes(16).toString('hex');
  }
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { hash, salt };
}

// Constant-time password verification to prevent timing attacks
function verifyPassword(password, storedHash, salt) {
  try {
    const calculatedHash = crypto.scryptSync(password, salt, 64).toString('hex');
    const bufA = Buffer.from(calculatedHash, 'hex');
    const bufB = Buffer.from(storedHash, 'hex');
    if (bufA.length !== bufB.length) return false;
    return crypto.timingSafeEqual(bufA, bufB);
  } catch (err) {
    return false;
  }
}

// Strip sensitive fields
function sanitizeUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    username: user.username,
    fullName: user.full_name,
    role: user.role,
    bureau: user.bureau || null,
    email: user.email || null
  };
}

// Seed official AICTE demo user accounts
function seedUsers() {
  const defaultUsers = [
    {
      id: 'USR-ADMIN-01',
      username: 'admin@aicte.gov.in',
      password: 'aicte@admin2026',
      fullName: 'Dr. Ramesh Sharma (Central Grievance Director)',
      role: 'ADMIN',
      bureau: null,
      email: 'admin@aicte.gov.in'
    },
    {
      id: 'USR-APPR-01',
      username: 'officer.approval@aicte.gov.in',
      password: 'approval@2026',
      fullName: 'Prof. Meenakshi Sundaram (Approval Bureau Officer)',
      role: 'BUREAU_OFFICER',
      bureau: 'Approval Bureau',
      email: 'officer.approval@aicte.gov.in'
    },
    {
      id: 'USR-APPR-02',
      username: 'officer.approval2@aicte.gov.in',
      password: 'approval@2026',
      fullName: 'Dr. S. K. Gupta (Senior Scrutiny Officer)',
      role: 'BUREAU_OFFICER',
      bureau: 'Approval Bureau',
      email: 'officer.approval2@aicte.gov.in'
    },
    {
      id: 'USR-SGRC-01',
      username: 'officer.sgrc@aicte.gov.in',
      password: 'sgrc@2026',
      fullName: 'Er. Amitav Sen (SGRC Desk Officer)',
      role: 'BUREAU_OFFICER',
      bureau: 'Student Grievance Redressal Cell (SGRC)',
      email: 'officer.sgrc@aicte.gov.in'
    },
    {
      id: 'USR-SGRC-02',
      username: 'officer.sgrc2@aicte.gov.in',
      password: 'sgrc@2026',
      fullName: 'Smt. Priya Nair (Student Ombudsman Coordinator)',
      role: 'BUREAU_OFFICER',
      bureau: 'Student Grievance Redressal Cell (SGRC)',
      email: 'officer.sgrc2@aicte.gov.in'
    },
    {
      id: 'USR-VIG-01',
      username: 'officer.vigilance@aicte.gov.in',
      password: 'vigilance@2026',
      fullName: 'Shri R. K. Verma (Chief Vigilance Officer)',
      role: 'BUREAU_OFFICER',
      bureau: 'Vigilance Cell',
      email: 'officer.vigilance@aicte.gov.in'
    },
    {
      id: 'USR-RAGG-01',
      username: 'officer.antiragging@aicte.gov.in',
      password: 'ragging@2026',
      fullName: 'Dr. K. S. Rao (Anti-Ragging Cell Officer)',
      role: 'BUREAU_OFFICER',
      bureau: 'Anti-Ragging Cell',
      email: 'officer.antiragging@aicte.gov.in'
    },
    {
      id: 'USR-FAC-01',
      username: 'officer.faculty@aicte.gov.in',
      password: 'faculty@2026',
      fullName: 'Dr. Ananya Roy (Faculty Grievance Officer)',
      role: 'BUREAU_OFFICER',
      bureau: 'Faculty & Staff Grievance Cell',
      email: 'officer.faculty@aicte.gov.in'
    },
    {
      id: 'USR-LEGAL-01',
      username: 'officer.legal@aicte.gov.in',
      password: 'legal@2026',
      fullName: 'Adv. N. C. Chawla (Legal Cell Counsel)',
      role: 'BUREAU_OFFICER',
      bureau: 'Legal Cell',
      email: 'officer.legal@aicte.gov.in'
    },
    {
      id: 'USR-RB-01',
      username: 'officer.regional@aicte.gov.in',
      password: 'regional@2026',
      fullName: 'Er. Pradeep Nair (Regional Bureau Officer)',
      role: 'BUREAU_OFFICER',
      bureau: 'Regional Bureau / Regional Office (RB)',
      email: 'officer.regional@aicte.gov.in'
    },
    {
      id: 'USR-PGRC-01',
      username: 'officer.pgrc@aicte.gov.in',
      password: 'pgrc@2026',
      fullName: 'Smt. Geeta Mathur (Public Grievance Officer)',
      role: 'BUREAU_OFFICER',
      bureau: 'Public Grievance Redressal Cell (PGRC)',
      email: 'officer.pgrc@aicte.gov.in'
    },
    {
      id: 'USR-STUD-01',
      username: 'student.rahul@gmail.com',
      password: 'student@2026',
      fullName: 'Rahul Verma (B.Tech Complainant)',
      role: 'GUEST_STUDENT',
      bureau: null,
      email: 'student.rahul@gmail.com'
    },
    {
      id: 'USR-STUD-02',
      username: 'student.anita@gmail.com',
      password: 'student@2026',
      fullName: 'Anita Desai (M.Tech Complainant)',
      role: 'GUEST_STUDENT',
      bureau: null,
      email: 'student.anita@gmail.com'
    }
  ];

  const insert = db.prepare(`
    INSERT OR IGNORE INTO users (id, username, password_hash, salt, full_name, role, bureau, email)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const u of defaultUsers) {
    const { hash, salt } = hashPassword(u.password);
    insert.run(u.id, u.username, hash, salt, u.fullName, u.role, u.bureau, u.email);
  }

  // Link any unassigned complaints to valid officer IDs based on bureau
  try {
    const unlinked = db.prepare('SELECT id, bureau, assigned_officer FROM complaints WHERE assigned_officer_id IS NULL').all();
    for (const c of unlinked) {
      const match = db.prepare('SELECT id, full_name FROM users WHERE bureau = ? AND role = ? LIMIT 1').get(c.bureau, 'BUREAU_OFFICER');
      if (match) {
        db.prepare('UPDATE complaints SET assigned_officer_id = ?, assigned_officer = ? WHERE id = ?').run(match.id, match.full_name, c.id);
      } else {
        db.prepare('UPDATE complaints SET assigned_officer_id = ? WHERE id = ?').run('USR-ADMIN-01', c.id);
      }
    }
  } catch (err) {
    // Column might not exist yet if called before migration
  }

  console.log('[Auth] Pre-seeded official AICTE demo user accounts for all bureaus.');
}

// Create expiring session in SQLite
function createSession(userId, durationMs = 24 * 60 * 60 * 1000) {
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + durationMs).toISOString();

  db.prepare(`
    INSERT INTO sessions (token, user_id, expires_at)
    VALUES (?, ?, ?)
  `).run(token, userId, expiresAt);

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  return {
    token,
    user: sanitizeUser(user),
    expiresAt
  };
}

// Validate session token
function validateSession(token) {
  if (!token) return null;
  const now = new Date().toISOString();

  const row = db.prepare(`
    SELECT s.token, s.expires_at, u.*
    FROM sessions s
    JOIN users u ON s.user_id = u.id
    WHERE s.token = ?
  `).get(token);

  if (!row) return null;

  if (row.expires_at < now) {
    // Invalidate expired session
    db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
    return null;
  }

  return sanitizeUser(row);
}

// Invalidate session on logout
function invalidateSession(token) {
  if (!token) return false;
  const res = db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  return res.changes > 0;
}

// Authenticate user with credentials
function authenticateUser(username, password) {
  if (!username || !password) return null;

  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user) return null;

  const isValid = verifyPassword(password, user.password_hash, user.salt);
  if (!isValid) return null;

  return createSession(user.id);
}

module.exports = {
  hashPassword,
  verifyPassword,
  sanitizeUser,
  seedUsers,
  createSession,
  validateSession,
  invalidateSession,
  authenticateUser
};
