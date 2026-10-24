const { db, initSchema } = require('./db');

function seedDatabase() {
  initSchema();

  console.log('Clearing existing data for clean seed...');
  db.exec('DELETE FROM overlap_reviews');
  db.exec('DELETE FROM complaint_history');
  db.exec('DELETE FROM complaints');
  db.exec('DELETE FROM institutions');

  console.log('Inserting institutions...');
  const insertInst = db.prepare(`
    INSERT INTO institutions (id, name, state, district, type, email, phone, risk_score)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const institutions = [
    [
      '1-10492811',
      'Apex Institute of Engineering & Technology',
      'Delhi',
      'South West Delhi',
      'Private Self-Financed',
      'director@apexinstitute.edu.in',
      '+91 11 2689 4401',
      75
    ],
    [
      '1-20948122',
      'Vanguard Institute of Technology & Management',
      'Karnataka',
      'Bengaluru Urban',
      'Deemed University',
      'contact@vanguardtech.ac.in',
      '+91 80 4120 7700',
      85
    ],
    [
      '1-30491823',
      'Dr. B.R. Ambedkar Government Engineering College',
      'Maharashtra',
      'Pune',
      'Government',
      'principal@bragecpune.ac.in',
      '+91 20 2550 3000',
      20
    ],
    [
      '1-40918234',
      'Kaveri Institute of Technology',
      'Tamil Nadu',
      'Chennai',
      'Private Self-Financed',
      'admin@kaveritech.edu.in',
      '+91 44 2745 6000',
      55
    ],
    [
      '1-50918245',
      'Saraswati Polytechnic & Engineering Institute',
      'Uttar Pradesh',
      'Lucknow',
      'Private Aided',
      'registrar@saraswatieng.org',
      '+91 522 2390 100',
      68
    ],
    [
      '1-60918256',
      'Deccan Institute of Advanced Computing',
      'Telangana',
      'Hyderabad',
      'Private Self-Financed',
      'info@deccanac.in',
      '+91 40 2314 9000',
      42
    ]
  ];

  for (const inst of institutions) {
    insertInst.run(...inst);
  }

  console.log('Inserting complaints...');
  const insertComp = db.prepare(`
    INSERT INTO complaints (
      id, institution_id, bureau, category, priority, status,
      complainant_name, complainant_role, complainant_email, complainant_phone,
      subject, description, target_date, resolution_remarks, linked_group_id, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertHist = db.prepare(`
    INSERT INTO complaint_history (complaint_id, action_type, old_value, new_value, remarks, actor, timestamp)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const complaints = [
    {
      id: 'AICTE-GRV-2026-001',
      institution_id: '1-10492811',
      bureau: 'Student Grievance Redressal Cell (SGRC)',
      category: 'Withholding of Certificates / Marksheets',
      priority: 'HIGH',
      status: 'Under Bureau Scrutiny',
      complainant_name: 'Aarav Sharma',
      complainant_role: 'Student',
      complainant_email: 'aarav.sharma99@example.com',
      complainant_phone: '+91 98112 34567',
      subject: 'Withholding of original 10th, 12th, and B.Tech degree certificates upon course completion',
      description: 'College registrar is refusing to hand over my original 10th, 12th marksheets and provisional B.Tech degree certificate demanding an unauthorized development fee of Rs. 45,000 despite all official semester dues cleared.',
      target_date: '2026-11-05',
      resolution_remarks: null,
      linked_group_id: null,
      created_at: '2026-10-12 10:30:00',
      history: [
        ['CREATED', null, 'Submitted', 'Grievance lodged through AICTE Central Portal by student.', 'Central Ingestion System', '2026-10-12 10:30:00'],
        ['STATUS_CHANGE', 'Submitted', 'Under Bureau Scrutiny', 'Case assigned to SGRC Desk Officer for initial verification of fee receipts.', 'SGRC Desk Officer', '2026-10-13 14:15:00']
      ]
    },
    {
      id: 'AICTE-GRV-2026-002',
      institution_id: '1-10492811',
      bureau: 'Approval Bureau',
      category: 'Withholding of Certificates / Marksheets',
      priority: 'HIGH',
      status: 'Submitted',
      complainant_name: 'Rajesh Sharma',
      complainant_role: 'Parent',
      complainant_email: 'r.sharma.parent@example.com',
      complainant_phone: '+91 98112 34568',
      subject: 'Illegal retention of original academic marksheets and refusal to issue transfer certificate',
      description: 'The college administration at Apex Institute has illegally retained original marksheets and certificates of final year engineering students demanding Rs 45000 extra fee in violation of AICTE public notice.',
      target_date: '2026-11-10',
      resolution_remarks: null,
      linked_group_id: null,
      created_at: '2026-10-18 11:20:00',
      history: [
        ['CREATED', null, 'Submitted', 'Grievance submitted by parent regarding arbitrary certificate withholding.', 'Central Ingestion System', '2026-10-18 11:20:00']
      ]
    },
    {
      id: 'AICTE-GRV-2026-003',
      institution_id: '1-20948122',
      bureau: 'Anti-Ragging Cell',
      category: 'Ragging / Harassment',
      priority: 'CRITICAL',
      status: 'Notice Issued to Institute',
      complainant_name: 'Rohit Kulkarni',
      complainant_role: 'Student',
      complainant_email: 'rohit.k2026@example.com',
      complainant_phone: '+91 97401 22334',
      subject: 'Severe ragging and harassment in boys hostel block B by senior students',
      description: 'Freshman students in campus hostel are facing physical intimidation and abusive ragging late at night by 3rd year seniors. Hostel warden is ignoring repeated verbal complaints and failing to maintain logbooks.',
      target_date: '2026-10-28',
      resolution_remarks: null,
      linked_group_id: null,
      created_at: '2026-10-14 09:00:00',
      history: [
        ['CREATED', null, 'Submitted', 'High priority ragging complaint lodged.', 'Central Ingestion System', '2026-10-14 09:00:00'],
        ['STATUS_CHANGE', 'Submitted', 'Notice Issued to Institute', 'Show cause notice dispatched to Institute Director and Anti-Ragging Committee.', 'Anti-Ragging Bureau Officer', '2026-10-15 11:00:00']
      ]
    },
    {
      id: 'AICTE-GRV-2026-004',
      institution_id: '1-20948122',
      bureau: 'Student Grievance Redressal Cell (SGRC)',
      category: 'Ragging / Harassment',
      priority: 'CRITICAL',
      status: 'Submitted',
      complainant_name: 'Anonymous Student Group',
      complainant_role: 'Student',
      complainant_email: 'concerned.hostellers@example.com',
      complainant_phone: '+91 97401 99887',
      subject: 'Senior students harassing first year hostellers in hostel block B - urgent intervention',
      description: 'Urgent complaint regarding ragging and harassment of first year engineering students in boys hostel block B. Seniors demanding late night tasks. Hostel warden took no action.',
      target_date: '2026-10-27',
      resolution_remarks: null,
      linked_group_id: null,
      created_at: '2026-10-16 16:45:00',
      history: [
        ['CREATED', null, 'Submitted', 'Cross-cell complaint received via Student Cell.', 'Central Ingestion System', '2026-10-16 16:45:00']
      ]
    },
    {
      id: 'AICTE-GRV-2026-005',
      institution_id: '1-50918245',
      bureau: 'Faculty & Staff Grievance Cell',
      category: 'Faculty Salary / 7th Pay Commission Non-Payment',
      priority: 'HIGH',
      status: 'Notice Issued to Institute',
      complainant_name: 'Dr. Vivek Mishra',
      complainant_role: 'Faculty',
      complainant_email: 'v.mishra.faculty@example.com',
      complainant_phone: '+91 94500 11223',
      subject: 'Non-payment of 7th CPC scale salaries and 8 months pending salary arrears',
      description: 'Assistant Professors in Mechanical and CSE departments have not received monthly salaries since March 2026. Management threatens termination if staff approaches AICTE or state ombudsman.',
      target_date: '2026-11-08',
      resolution_remarks: null,
      linked_group_id: null,
      created_at: '2026-10-05 14:10:00',
      history: [
        ['CREATED', null, 'Submitted', 'Formal faculty delegation grievance submitted.', 'Central Ingestion System', '2026-10-05 14:10:00'],
        ['STATUS_CHANGE', 'Submitted', 'Under Bureau Scrutiny', 'Audited bank statements requested from complainant.', 'Faculty Cell Lead', '2026-10-07 10:00:00'],
        ['STATUS_CHANGE', 'Under Bureau Scrutiny', 'Notice Issued to Institute', 'Formal explanation letter sent to College Secretary with 15-day compliance window.', 'Bureau Director', '2026-10-12 16:30:00']
      ]
    },
    {
      id: 'AICTE-GRV-2026-006',
      institution_id: '1-60918256',
      bureau: 'Approval Bureau',
      category: 'Unapproved Technical Courses / Infrastructure Deficit',
      priority: 'HIGH',
      status: 'Under Bureau Scrutiny',
      complainant_name: 'P. Venkat Reddy',
      complainant_role: 'Parent',
      complainant_email: 'pv.reddy@example.com',
      complainant_phone: '+91 99480 33445',
      subject: 'Conducting unapproved AI & Data Science B.Tech section exceeding sanctioned intake',
      description: 'College admitted 120 students in AI & Data Science whereas AICTE Approved Extension of Approval (EoA) lists sanctioned intake as only 60. Laboratory computers and faculty are missing.',
      target_date: '2026-11-12',
      resolution_remarks: null,
      linked_group_id: null,
      created_at: '2026-10-10 12:00:00',
      history: [
        ['CREATED', null, 'Submitted', 'Parent complaint registered regarding intake discrepancy.', 'Central Ingestion System', '2026-10-10 12:00:00'],
        ['STATUS_CHANGE', 'Submitted', 'Under Bureau Scrutiny', 'EoA database records cross-referenced with admission list.', 'Approval Bureau Officer', '2026-10-11 15:40:00']
      ]
    },
    {
      id: 'AICTE-GRV-2026-007',
      institution_id: '1-40918234',
      bureau: 'Vigilance Cell',
      category: 'Capitation Fee / Financial Irregularity',
      priority: 'CRITICAL',
      status: 'Hearing / Inquiry Scheduled',
      complainant_name: 'S. Ramanathan',
      complainant_role: 'Whistleblower',
      complainant_email: 'whistleblower.tn@example.com',
      complainant_phone: '+91 94440 88990',
      subject: 'Demand of cash capitation fee of Rs. 3,00,000 under management quota admission',
      description: 'Trust management demanded cash payment without receipt for engineering seat allotment in violation of Prohibition of Capitation Fee regulations. Audio recordings submitted as evidence.',
      target_date: '2026-11-02',
      resolution_remarks: null,
      linked_group_id: null,
      created_at: '2026-10-02 08:30:00',
      history: [
        ['CREATED', null, 'Submitted', 'Confidential vigilance case logged.', 'Central Ingestion System', '2026-10-02 08:30:00'],
        ['STATUS_CHANGE', 'Submitted', 'Under Bureau Scrutiny', 'Preliminary evidence reviewed by Chief Vigilance Officer.', 'Chief Vigilance Officer', '2026-10-04 10:15:00'],
        ['STATUS_CHANGE', 'Under Bureau Scrutiny', 'Hearing / Inquiry Scheduled', 'Virtual hearing scheduled with Institute Governing Board.', 'Vigilance Cell', '2026-10-15 14:00:00']
      ]
    },
    {
      id: 'AICTE-GRV-2026-008',
      institution_id: '1-10492811',
      bureau: 'Student Grievance Redressal Cell (SGRC)',
      category: 'Non-Refund of Caution Deposit/Fees',
      priority: 'MEDIUM',
      status: 'Submitted',
      complainant_name: 'Neha Verma',
      complainant_role: 'Student',
      complainant_email: 'neha.v@example.com',
      complainant_phone: '+91 98101 22334',
      subject: 'Non-refund of caution deposit after formal withdrawal from M.Tech program',
      description: 'Submitted seat surrender application on 15th August before the cut-off date. Institute accounts department has not refunded Rs. 25,000 caution deposit and deduction is unexplained.',
      target_date: '2026-10-10', // OVERDUE
      resolution_remarks: null,
      linked_group_id: null,
      created_at: '2026-09-25 11:00:00',
      history: [
        ['CREATED', null, 'Submitted', 'Complaint filed regarding unrefunded caution deposit.', 'Central Ingestion System', '2026-09-25 11:00:00']
      ]
    },
    {
      id: 'AICTE-GRV-2026-009',
      institution_id: '1-50918245',
      bureau: 'Faculty & Staff Grievance Cell',
      category: 'Faculty Salary / 7th Pay Commission Non-Payment',
      priority: 'HIGH',
      status: 'Under Bureau Scrutiny',
      complainant_name: 'Ananya Gupta',
      complainant_role: 'Faculty',
      complainant_email: 'ananya.g@example.com',
      complainant_phone: '+91 94511 77665',
      subject: 'Denial of maternity leave to female assistant professor with salary deduction',
      description: 'College administration denied statutory paid maternity leave and deducted two months salary arbitrarily during medical leave period in violation of AICTE regulations.',
      target_date: '2026-10-18', // OVERDUE
      resolution_remarks: null,
      linked_group_id: null,
      created_at: '2026-09-28 14:20:00',
      history: [
        ['CREATED', null, 'Submitted', 'Faculty maternity leave violation complaint registered.', 'Central Ingestion System', '2026-09-28 14:20:00'],
        ['STATUS_CHANGE', 'Submitted', 'Under Bureau Scrutiny', 'Leave records requested from complainant.', 'Faculty Cell Lead', '2026-10-02 09:30:00']
      ]
    },
    {
      id: 'AICTE-GRV-2026-010',
      institution_id: '1-30491823',
      bureau: 'Student Grievance Redressal Cell (SGRC)',
      category: 'Withholding of Certificates / Marksheets',
      priority: 'MEDIUM',
      status: 'Resolved',
      complainant_name: 'Tanmay Deshmukh',
      complainant_role: 'Alumnus',
      complainant_email: 'tanmay.desh@example.com',
      complainant_phone: '+91 98220 55667',
      subject: 'Rectification of incorrect grade card printing for 2025 batch',
      description: 'SGPA calculation printed on physical semester grade cards had mathematical errors causing issue with higher education applications abroad.',
      target_date: '2026-10-15',
      resolution_remarks: 'Institute examination cell re-issued corrected official grade cards conforming to university syllabus guidelines. Complainant confirmed receipt.',
      linked_group_id: null,
      created_at: '2026-09-15 10:00:00',
      history: [
        ['CREATED', null, 'Submitted', 'Grade card error grievance logged.', 'Central Ingestion System', '2026-09-15 10:00:00'],
        ['STATUS_CHANGE', 'Submitted', 'Notice Issued to Institute', 'Query forwarded to Controller of Examinations.', 'SGRC Officer', '2026-09-20 12:00:00'],
        ['STATUS_CHANGE', 'Notice Issued to Institute', 'Resolved', 'Corrected transcripts dispatched and confirmed by student.', 'SGRC Officer', '2026-10-14 16:00:00']
      ]
    },
    {
      id: 'AICTE-GRV-2026-011',
      institution_id: '1-40918234',
      bureau: 'Student Grievance Redressal Cell (SGRC)',
      category: 'Non-Refund of Caution Deposit/Fees',
      priority: 'LOW',
      status: 'Resolved',
      complainant_name: 'K. Balaji',
      complainant_role: 'Student',
      complainant_email: 'kbalaji@example.com',
      complainant_phone: '+91 94430 11229',
      subject: 'Refund of hostel caution fee for graduated batch',
      description: 'Hostel caution deposit of Rs. 10,000 pending refund after final year convocation.',
      target_date: '2026-10-20',
      resolution_remarks: 'Full caution deposit of Rs. 10,000 credited to student bank account on 12-Oct-2026 via NEFT transaction reference 2026101299812.',
      linked_group_id: null,
      created_at: '2026-09-29 11:30:00',
      history: [
        ['CREATED', null, 'Submitted', 'Hostel fee refund ticket raised.', 'Central Ingestion System', '2026-09-29 11:30:00'],
        ['STATUS_CHANGE', 'Submitted', 'Resolved', 'Payment voucher uploaded by college accounts division.', 'SGRC Officer', '2026-10-12 17:00:00']
      ]
    },
    {
      id: 'AICTE-GRV-2026-012',
      institution_id: '1-30491823',
      bureau: 'Legal Cell',
      category: 'Unapproved Technical Courses / Infrastructure Deficit',
      priority: 'MEDIUM',
      status: 'Notice Issued to Institute',
      complainant_name: 'Citizens Forum for Technical Education',
      complainant_role: 'Whistleblower',
      complainant_email: 'info@cfte-pune.org',
      complainant_phone: '+91 20 2612 0000',
      subject: 'Fire safety audit compliance certificate missing for newly built engineering block',
      description: 'The newly constructed 4-story computer science building does not possess valid NOC from state fire department, putting student safety at risk.',
      target_date: '2026-11-20',
      resolution_remarks: null,
      linked_group_id: null,
      created_at: '2026-10-15 15:00:00',
      history: [
        ['CREATED', null, 'Submitted', 'Public interest vigilance complaint received.', 'Central Ingestion System', '2026-10-15 15:00:00'],
        ['STATUS_CHANGE', 'Submitted', 'Notice Issued to Institute', 'Compliance query sent to college building committee.', 'Legal Cell Officer', '2026-10-18 10:30:00']
      ]
    }
  ];

  for (const c of complaints) {
    insertComp.run(
      c.id,
      c.institution_id,
      c.bureau,
      c.category,
      c.priority,
      c.status,
      c.complainant_name,
      c.complainant_role,
      c.complainant_email,
      c.complainant_phone,
      c.subject,
      c.description,
      c.target_date,
      c.resolution_remarks,
      c.linked_group_id,
      c.created_at
    );

    for (const h of c.history) {
      insertHist.run(c.id, h[0], h[1], h[2], h[3], h[4], h[5]);
    }
  }

  console.log(`Database seeded successfully with ${institutions.length} institutions and ${complaints.length} complaints.`);
}

if (require.main === module) {
  seedDatabase();
}

module.exports = { seedDatabase };
