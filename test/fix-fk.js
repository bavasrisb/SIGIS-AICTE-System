const { db } = require('../db');

db.exec('PRAGMA foreign_keys = OFF;');
db.exec('BEGIN TRANSACTION;');
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
`);
db.exec('INSERT INTO complaint_history_new SELECT * FROM complaint_history;');
db.exec('DROP TABLE complaint_history;');
db.exec('ALTER TABLE complaint_history_new RENAME TO complaint_history;');
db.exec('COMMIT;');
db.exec('PRAGMA foreign_keys = ON;');
console.log('Fixed complaint_history foreign key successfully!');
