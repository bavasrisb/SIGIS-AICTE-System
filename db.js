const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');

const DB_PATH = path.join(__dirname, 'grievance_system.db');
const db = new DatabaseSync(DB_PATH);

// Enable foreign keys for reliability
db.exec('PRAGMA foreign_keys = ON;');

function initSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS institutions (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      state TEXT NOT NULL,
      district TEXT NOT NULL,
      type TEXT NOT NULL,
      email TEXT,
      phone TEXT,
      risk_score INTEGER DEFAULT 10,
      region TEXT DEFAULT 'Northern',
      address TEXT DEFAULT 'Main Campus',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS complaints (
      id TEXT PRIMARY KEY,
      institution_id TEXT NOT NULL,
      bureau TEXT NOT NULL,
      category TEXT NOT NULL,
      priority TEXT NOT NULL CHECK(priority IN ('CRITICAL', 'HIGH', 'MEDIUM', 'LOW')),
      status TEXT NOT NULL CHECK(status IN ('Submitted', 'Under Bureau Scrutiny', 'Notice Issued to Institute', 'Hearing / Inquiry Scheduled', 'Transferred', 'Escalated', 'Resolved', 'Rejected / Closed')),
      complainant_name TEXT NOT NULL,
      complainant_role TEXT NOT NULL,
      complainant_email TEXT,
      complainant_phone TEXT,
      subject TEXT NOT NULL,
      description TEXT NOT NULL,
      target_date TEXT NOT NULL,
      resolution_remarks TEXT,
      linked_group_id TEXT,
      assigned_officer TEXT DEFAULT 'AICTE Grievance Desk Officer',
      last_action TEXT DEFAULT 'Grievance Registered',
      next_action TEXT DEFAULT 'Initial Scrutiny by Bureau Desk',
      last_action_date DATETIME DEFAULT CURRENT_TIMESTAMP,
      supporting_docs TEXT,
      is_escalated INTEGER DEFAULT 0,
      is_transferred INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (institution_id) REFERENCES institutions(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS complaint_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      complaint_id TEXT NOT NULL,
      action_type TEXT NOT NULL,
      old_value TEXT,
      new_value TEXT,
      remarks TEXT,
      actor TEXT DEFAULT 'AICTE Grievance Cell Officer',
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (complaint_id) REFERENCES complaints(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS overlap_reviews (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      complaint_a_id TEXT NOT NULL,
      complaint_b_id TEXT NOT NULL,
      similarity_score REAL NOT NULL,
      match_reasons TEXT NOT NULL,
      review_status TEXT NOT NULL DEFAULT 'PENDING_REVIEW' CHECK(review_status IN ('PENDING_REVIEW', 'CONFIRMED_RELATED', 'DISMISSED_DISTINCT')),
      reviewer_notes TEXT,
      reviewed_by TEXT,
      reviewed_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(complaint_a_id, complaint_b_id)
    );

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      salt TEXT NOT NULL,
      full_name TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('ADMIN', 'BUREAU_OFFICER', 'GUEST_STUDENT')),
      bureau TEXT,
      email TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      expires_at DATETIME NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS complaint_documents (
      id TEXT PRIMARY KEY,
      complaint_id TEXT NOT NULL,
      original_filename TEXT NOT NULL,
      stored_filename TEXT NOT NULL UNIQUE,
      file_size INTEGER NOT NULL,
      mime_type TEXT NOT NULL,
      uploaded_by TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (complaint_id) REFERENCES complaints(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS notification_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      complaint_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      recipient_email TEXT,
      recipient_phone TEXT,
      channel TEXT NOT NULL CHECK(channel IN ('EMAIL', 'SMS', 'IN_APP')),
      status TEXT NOT NULL CHECK(status IN ('DELIVERED', 'SIMULATED_LOCAL', 'FAILED', 'SKIPPED')),
      provider_response TEXT,
      idempotency_key TEXT UNIQUE NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (complaint_id) REFERENCES complaints(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_complaints_inst ON complaints(institution_id);
    CREATE INDEX IF NOT EXISTS idx_complaints_status ON complaints(status);
    CREATE INDEX IF NOT EXISTS idx_complaints_bureau ON complaints(bureau);
    CREATE INDEX IF NOT EXISTS idx_complaints_target_date ON complaints(target_date);
  `);

  runMigrations();
}

function runMigrations() {
  const compCols = db.prepare('PRAGMA table_info(complaints)').all().map(c => c.name);
  if (!compCols.includes('assigned_officer_id')) {
    db.exec('ALTER TABLE complaints ADD COLUMN assigned_officer_id TEXT;');
  }
  if (!compCols.includes('investigation_notes')) {
    db.exec('ALTER TABLE complaints ADD COLUMN investigation_notes TEXT;');
  }
  if (!compCols.includes('resolved_at')) {
    db.exec('ALTER TABLE complaints ADD COLUMN resolved_at DATETIME;');
  }
}

module.exports = {
  db,
  initSchema
};
