const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');

const DB_PATH = path.join(__dirname, 'grievance_system.db');
const db = new DatabaseSync(DB_PATH);

// Enable foreign keys for reliability
db.exec('PRAGMA foreign_keys = ON;');

// Write-Ahead Logging: concurrent readers never block the writer (important
// for the real-time SSE + multi-tab demo) and it provides better crash
// recovery than the default rollback-journal mode. Purely additive — no
// schema or data change; the -wal/-shm sidecar files are gitignored via *.db-*.
try {
  db.exec('PRAGMA journal_mode = WAL;');
} catch (err) {
  // WAL unavailable on some filesystems (e.g. network shares) — default journal
  // mode remains fully functional.
  console.warn('[DB] WAL mode unavailable, using default journal mode:', err.message);
}

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
      status TEXT NOT NULL CHECK(status IN ('Submitted', 'Under Bureau Scrutiny', 'Notice Issued to Institute', 'Hearing / Inquiry Scheduled', 'Pending Admin Review', 'Transferred', 'Escalated', 'Resolved', 'Rejected / Closed')),
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
      assigned_officer_id TEXT,
      investigation_notes TEXT,
      admin_notes TEXT,
      final_resolution_report TEXT,
      return_count INTEGER DEFAULT 0,
      resolved_at DATETIME,
      source_reference TEXT,
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
  const compMaster = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='complaints'").get();
  const needsCheckUpdate = compMaster && !compMaster.sql.includes('Pending Admin Review');

  if (needsCheckUpdate) {
    db.exec('PRAGMA foreign_keys = OFF;');
    db.exec('BEGIN TRANSACTION;');
    db.exec('ALTER TABLE complaints RENAME TO complaints_old;');

    db.exec(`
      CREATE TABLE complaints (
        id TEXT PRIMARY KEY,
        institution_id TEXT NOT NULL,
        bureau TEXT NOT NULL,
        category TEXT NOT NULL,
        priority TEXT NOT NULL CHECK(priority IN ('CRITICAL', 'HIGH', 'MEDIUM', 'LOW')),
        status TEXT NOT NULL CHECK(status IN ('Submitted', 'Under Bureau Scrutiny', 'Notice Issued to Institute', 'Hearing / Inquiry Scheduled', 'Pending Admin Review', 'Transferred', 'Escalated', 'Resolved', 'Rejected / Closed')),
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
        assigned_officer_id TEXT,
        investigation_notes TEXT,
        admin_notes TEXT,
        final_resolution_report TEXT,
        return_count INTEGER DEFAULT 0,
        resolved_at DATETIME,
        source_reference TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (institution_id) REFERENCES institutions(id) ON DELETE CASCADE
      );
    `);

    const oldCols = db.prepare('PRAGMA table_info(complaints_old)').all().map(c => c.name);
    const targetCols = [
      'id', 'institution_id', 'bureau', 'category', 'priority', 'status',
      'complainant_name', 'complainant_role', 'complainant_email', 'complainant_phone',
      'subject', 'description', 'target_date', 'resolution_remarks', 'linked_group_id',
      'assigned_officer', 'last_action', 'next_action', 'last_action_date', 'supporting_docs',
      'is_escalated', 'is_transferred', 'created_at', 'updated_at'
    ];
    const optCols = ['assigned_officer_id', 'investigation_notes', 'resolved_at', 'admin_notes', 'final_resolution_report', 'return_count', 'source_reference'];
    const presentOptCols = optCols.filter(col => oldCols.includes(col));
    const allCopyCols = targetCols.concat(presentOptCols);
    const colsStr = allCopyCols.join(', ');

    db.exec(`INSERT INTO complaints (${colsStr}) SELECT ${colsStr} FROM complaints_old;`);
    db.exec('DROP TABLE complaints_old;');

    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_complaints_inst ON complaints(institution_id);
      CREATE INDEX IF NOT EXISTS idx_complaints_status ON complaints(status);
      CREATE INDEX IF NOT EXISTS idx_complaints_bureau ON complaints(bureau);
      CREATE INDEX IF NOT EXISTS idx_complaints_target_date ON complaints(target_date);
    `);

    db.exec('COMMIT;');
    db.exec('PRAGMA foreign_keys = ON;');
    console.log('[Migration] Upgraded complaints table schema to support Pending Admin Review.');
  }

  // Fix foreign keys in child tables if they point to complaints_old
  const tablesWithOld = db.prepare("SELECT name, sql FROM sqlite_master WHERE type='table' AND sql LIKE '%complaints_old%'").all();
  if (tablesWithOld.length > 0) {
    db.exec('PRAGMA foreign_keys = OFF;');
    db.exec('BEGIN TRANSACTION;');
    for (const t of tablesWithOld) {
      if (t.name === 'complaint_history') {
        db.exec(`
          CREATE TABLE complaint_history_new (
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
          INSERT INTO complaint_history_new SELECT * FROM complaint_history;
          DROP TABLE complaint_history;
          ALTER TABLE complaint_history_new RENAME TO complaint_history;
        `);
      } else if (t.name === 'complaint_documents') {
        db.exec(`
          CREATE TABLE complaint_documents_new (
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
          INSERT INTO complaint_documents_new SELECT * FROM complaint_documents;
          DROP TABLE complaint_documents;
          ALTER TABLE complaint_documents_new RENAME TO complaint_documents;
        `);
      } else if (t.name === 'notification_logs') {
        db.exec(`
          CREATE TABLE notification_logs_new (
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
          INSERT INTO notification_logs_new SELECT * FROM notification_logs;
          DROP TABLE notification_logs;
          ALTER TABLE notification_logs_new RENAME TO notification_logs;
        `);
      }
    }
    db.exec('COMMIT;');
    db.exec('PRAGMA foreign_keys = ON;');
    console.log('[Migration] Fixed foreign keys pointing to complaints_old.');
  }

  const compCols = db.prepare('PRAGMA table_info(complaints)').all().map(c => c.name);
  if (!compCols.includes('assigned_officer_id')) {
    db.exec('ALTER TABLE complaints ADD COLUMN assigned_officer_id TEXT;');
  }
  if (!compCols.includes('source_reference')) {
    db.exec('ALTER TABLE complaints ADD COLUMN source_reference TEXT;');
  }
  // Duplicate-safe imports: enforce one complaint per external source reference.
  // Partial index -> rows without a source reference (legacy/manual) are unaffected.
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_complaints_source_ref
    ON complaints(source_reference)
    WHERE source_reference IS NOT NULL AND source_reference != '';
  `);
  // Cross-bureau coordination workflow (additive; existing tables untouched)
  db.exec(`
    CREATE TABLE IF NOT EXISTS coordination_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_complaint_id TEXT NOT NULL,
      requesting_bureau TEXT NOT NULL,
      requested_bureau TEXT NOT NULL,
      requested_by TEXT NOT NULL,
      reason TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'PENDING'
        CHECK(status IN ('PENDING', 'ACCEPTED', 'REJECTED', 'COMPLETED', 'CANCELLED')),
      responded_by TEXT,
      response_remarks TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      responded_at DATETIME,
      FOREIGN KEY (source_complaint_id) REFERENCES complaints(id) ON DELETE CASCADE
    );
  `);
  db.exec('CREATE INDEX IF NOT EXISTS idx_coordination_complaint ON coordination_requests(source_complaint_id);');
  if (!compCols.includes('investigation_notes')) {
    db.exec('ALTER TABLE complaints ADD COLUMN investigation_notes TEXT;');
  }
  if (!compCols.includes('admin_notes')) {
    db.exec('ALTER TABLE complaints ADD COLUMN admin_notes TEXT;');
  }
  if (!compCols.includes('final_resolution_report')) {
    db.exec('ALTER TABLE complaints ADD COLUMN final_resolution_report TEXT;');
  }
  if (!compCols.includes('return_count')) {
    db.exec('ALTER TABLE complaints ADD COLUMN return_count INTEGER DEFAULT 0;');
  }
  if (!compCols.includes('resolved_at')) {
    db.exec('ALTER TABLE complaints ADD COLUMN resolved_at DATETIME;');
  }
}

module.exports = {
  db,
  initSchema
};
