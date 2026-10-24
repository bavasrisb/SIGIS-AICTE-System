const { db } = require('../db');

function migrate() {
  console.log('Running safe database schema check & migration...');

  // 1. Check institutions columns
  const instCols = db.prepare('PRAGMA table_info(institutions)').all().map(c => c.name);
  if (!instCols.includes('region')) {
    console.log('Adding region column to institutions...');
    db.exec('ALTER TABLE institutions ADD COLUMN region TEXT DEFAULT "Northern";');
  }
  if (!instCols.includes('address')) {
    console.log('Adding address column to institutions...');
    db.exec('ALTER TABLE institutions ADD COLUMN address TEXT DEFAULT "Main Academic Campus";');
  }

  // Update existing institutions with realistic AICTE region and address
  const regionUpdates = [
    ['North-Western', 'Plot 12, Sector 22, Dwarka, New Delhi - 110077', '1-10492811'],
    ['South-Western', 'Electronic City Phase 1, Hosur Road, Bengaluru, Karnataka - 560100', '1-20948122'],
    ['Western', 'Wellesley Road, Shivajinagar, Pune, Maharashtra - 411005', '1-30491823'],
    ['Southern', 'Rajiv Gandhi Salai, OMR, Chennai, Tamil Nadu - 600119', '1-40918234'],
    ['Northern', 'Faizabad Road, Gomti Nagar Extension, Lucknow, Uttar Pradesh - 226010', '1-50918245'],
    ['South-Central', 'Gachibowli Knowledge Park, Hyderabad, Telangana - 500032', '1-60918256']
  ];

  const updateInstStmt = db.prepare('UPDATE institutions SET region = ?, address = ? WHERE id = ?');
  for (const r of regionUpdates) {
    updateInstStmt.run(...r);
  }

  // 2. Check complaints table definition and check constraint
  const compMaster = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='complaints'").get();
  const needsCheckUpdate = compMaster && !compMaster.sql.includes('Transferred');

  if (needsCheckUpdate) {
    console.log('Upgrading complaints table CHECK constraint to support Transferred & Escalated states...');
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
    `);

    // Copy existing data
    db.exec(`
      INSERT INTO complaints (
        id, institution_id, bureau, category, priority, status,
        complainant_name, complainant_role, complainant_email, complainant_phone,
        subject, description, target_date, resolution_remarks, linked_group_id,
        created_at, updated_at
      )
      SELECT 
        id, institution_id, bureau, category, priority, status,
        complainant_name, complainant_role, complainant_email, complainant_phone,
        subject, description, target_date, resolution_remarks, linked_group_id,
        created_at, updated_at
      FROM complaints_old;
    `);

    db.exec('DROP TABLE complaints_old;');

    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_complaints_inst ON complaints(institution_id);
      CREATE INDEX IF NOT EXISTS idx_complaints_status ON complaints(status);
      CREATE INDEX IF NOT EXISTS idx_complaints_bureau ON complaints(bureau);
      CREATE INDEX IF NOT EXISTS idx_complaints_target_date ON complaints(target_date);
    `);

    db.exec('COMMIT;');
    db.exec('PRAGMA foreign_keys = ON;');
    console.log('Complaints table migration completed successfully.');
  } else {
    // Check if new columns exist
    const compCols = db.prepare('PRAGMA table_info(complaints)').all().map(c => c.name);
    const newCols = [
      ['assigned_officer', 'TEXT DEFAULT "AICTE Grievance Desk Officer"'],
      ['last_action', 'TEXT DEFAULT "Grievance Registered"'],
      ['next_action', 'TEXT DEFAULT "Initial Scrutiny by Bureau Desk"'],
      ['last_action_date', 'DATETIME DEFAULT CURRENT_TIMESTAMP'],
      ['supporting_docs', 'TEXT'],
      ['is_escalated', 'INTEGER DEFAULT 0'],
      ['is_transferred', 'INTEGER DEFAULT 0']
    ];

    for (const [col, def] of newCols) {
      if (!compCols.includes(col)) {
        console.log(`Adding ${col} column to complaints...`);
        db.exec(`ALTER TABLE complaints ADD COLUMN ${col} ${def};`);
      }
    }
  }

  // Populate realistic last_action / next_action / assigned_officer for existing complaints
  const complaints = db.prepare('SELECT id, status, bureau FROM complaints').all();
  const updateMeta = db.prepare(`
    UPDATE complaints 
    SET assigned_officer = ?, last_action = ?, next_action = ?, is_escalated = ?, is_transferred = ?
    WHERE id = ?
  `);

  for (const c of complaints) {
    let officer = 'AICTE Desk Officer';
    let lastAction = 'Complaint Registered';
    let nextAction = 'Scrutiny & Document Verification';
    let isEsc = 0;
    let isTrans = 0;

    if (c.bureau.includes('Anti-Ragging')) {
      officer = 'Member Secretary, National Anti-Ragging Cell';
    } else if (c.bureau.includes('Vigilance')) {
      officer = 'Chief Vigilance Officer (CVO)';
    } else if (c.bureau.includes('Legal')) {
      officer = 'Legal Officer / Law Officer';
    } else if (c.bureau.includes('Approval')) {
      officer = 'Advisor, Approval Bureau';
    } else if (c.bureau.includes('Faculty')) {
      officer = 'Director, Faculty & Staff Grievance Cell';
    } else {
      officer = 'Director, Student Grievance Redressal Cell (SGRC)';
    }

    if (c.status === 'Resolved') {
      lastAction = 'Official Order Issued & Grievance Disposed';
      nextAction = 'Case Closed in Archives';
    } else if (c.status === 'Notice Issued to Institute') {
      lastAction = 'Official Show Cause Notice Dispatched to Institute';
      nextAction = 'Awaiting Written Explanation from Management (15-Day Window)';
    } else if (c.status === 'Hearing / Inquiry Scheduled') {
      lastAction = 'Virtual Inquiry Hearing Scheduled';
      nextAction = 'Scrutiny of Submitted Affidavits & Attendance of Institute Head';
      isEsc = 1;
    } else if (c.status === 'Under Bureau Scrutiny') {
      lastAction = 'Initial Documents Verified';
      nextAction = 'Drafting Explanation Mandate to Regional Officer';
    }

    updateMeta.run(officer, lastAction, nextAction, isEsc, isTrans, c.id);
  }

  console.log('Migration verification complete.');
}

if (require.main === module) {
  migrate();
}

module.exports = { migrate };
