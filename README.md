# Smart Institution Grievance Intelligence System (SIGIS)
### AICTE Multi-Bureau Complaint Monitoring & Overlap Intelligence Platform
**Smart India Hackathon (SIH 2026) | Problem Statement: SIH26264**

---

## 🏛️ Executive Summary

The **Smart Institution Grievance Intelligence System (SIGIS)** is an integrated monitoring and decision-support web platform engineered for the All India Council for Technical Education (AICTE). 

In traditional administration, complaints regarding technical institutions are received across siloed bureaus (Student Grievance Cell, Anti-Ragging Cell, Approval Bureau, Faculty Grievance Cell, Vigilance Cell, Legal Cell, Regional Bureau, PGRC). Often, the same complainant or multiple victims file identical or related grievances across different cells. This causes duplicated inquiry efforts, conflicting institutional communications, and exceeded resolution deadlines (SLAs).

**SIGIS eliminates these silos by providing:**
1. **Consolidated Multi-Bureau Dashboard**: Tracks total, active, under process, transferred, escalated, resolved, and overdue grievances in real-time with direct KPI card navigation.
2. **Complete Complaint Lifecycle Management**: Full CRUD capability (register, view case dossier, update status, reassign bureau, set deadlines, and delete).
3. **AICTE Permanent Institution Profiles**: Anchored by unique Permanent Institute IDs (e.g., `1-10492811`), tracking AICTE regions, risk ratings, and full grievance history.
4. **Smart Overlap Detection Centre**: Algorithmic NLP similarity (Cosine Similarity + Jaccard token overlap + Category & Institution matching) that flags multi-channel duplicates for human officer verification. **Strict Guardrail:** Complaints are linked and cross-referenced, *never automatically merged*.
5. **SLA Deadline Radar & Alerts**: Automatic calculation of overdue days with escalation prompts.
6. **Multi-Dimensional Analytical Reports & Dossiers**: Bureau scorecards, region-wise distribution, pending-case ageing analysis, monthly/quarterly disposal rates, and CSV export.
7. **Transparent Demo Environment**: Clearly marked synthetic data designed specifically for SIH presentation.

---

## 💻 Technology Stack (Beginner-Friendly Windows Architecture)

Designed specifically so that **any Windows user can run it immediately without complex database installations**:

- **Runtime**: Node.js (v20+ or v26+)
- **Backend**: Express.js
- **Database**: Persistent SQLite via Node's native `node:sqlite` (`grievance_system.db`). 
  - *No PostgreSQL, MySQL, or Docker required.* The database is stored in a clean local file that automatically persists all edits, status updates, and history across server restarts.
- **NLP Overlap Engine**: Pure JavaScript TF-IDF token vectorizer with suffix stemmer, stop-word elimination, and multi-factor weighted scoring.
- **Frontend**: Responsive HTML5 + Tailwind CSS + Lucide Icons + Chart.js (interactive donut and bar charts).

---

## 🗄️ Database Architecture & Setup

### Database Location:
The database is stored locally in the file:
```
grievance_system.db
```
Inside the project root directory.

### Why SQLite is Ideal for this SIH Demo:
- **Zero Configuration**: No passwords, port conflicts, or separate database servers to start.
- **ACID Compliant**: Complete transactional safety and foreign key constraints enabled.
- **Full Persistence**: Any case added, status modified, or overlap reviewed remains permanently saved.
- **Inspection**: You can inspect or query this file using free GUI tools like [DB Browser for SQLite](https://sqlitebrowser.org/) or VS Code SQLite extensions.

### Schema Structure:
- **`institutions`**: AICTE Permanent ID (`id`), name, state, district, type, risk score, region, address.
- **`complaints`**: Unique Case ID (`AICTE-GRV-2026-XXX`), institution ID, bureau, category, priority, status, complainant details, target SLA date, linked group ID, assigned officer, last action, next action, supporting docs.
- **`complaint_history`**: Immutable audit trail of every status transition, bureau reassignment, officer remark, and link action.
- **`overlap_reviews`**: Records officer decisions (`CONFIRMED_RELATED`, `DISMISSED_DISTINCT`), review notes, and timestamps.

---

## 🚀 Beginner Setup Instructions (Windows)

Follow these simple steps in Windows PowerShell or Command Prompt:

### Step 1: Open Terminal in Project Folder
Navigate to the project directory:
```powershell
cd "C:\Users\Bavasri\.gemini\antigravity\scratch\sigis-aicte-system"
```

### Step 2: Install Dependencies (One-time)
```powershell
npm install
```

### Step 3: Run the Automated Master Test Suite
Verify that all 17 integration and compliance tests pass:
```powershell
npm test
```

### Step 4: Start the SIGIS Web Application
```powershell
npm start
```
You will see:
```text
=======================================================
 AICTE Smart Institution Grievance Intelligence System
 Problem Statement: SIH26264 | SIH 2026 Working Demo
 Server active on: http://localhost:3000
 Database: Persistent SQLite (grievance_system.db)
=======================================================
```

### Step 5: Open in Your Browser
Open your browser (Chrome, Edge, Firefox) and navigate to:
```
http://localhost:3000
```

---

## 🎯 SIH 2026 Presentation & Demo Walkthrough Script

When demonstrating the project to the SIH judges, follow this presentation flow:

### 1. The Silo Problem & Interactive KPI Cards (Dashboard Tab)
- Point to the **Executive Dashboard**.
- Explain that AICTE currently receives complaints across multiple disparate cells (Student Cell, Anti-Ragging, Approval Bureau, Faculty Cell, Regional Bureau, PGRC).
- Click on **Active / Pending** or **SLA Overdue** KPI cards to show instant direct filtered navigation into the complaints registry!

### 2. Multi-Channel Overlap Detection (The Core Intelligence)
- Click on the **Overlap Detection Centre** tab.
- Explain: *"When students or parents face an urgent issue—such as illegal withholding of marksheets or hostel ragging—they often lodge complaints in both the Anti-Ragging Cell and the Student Grievance Cell simultaneously, or across different dates."*
- Show how the system flags **`AICTE-GRV-2026-003`** (Anti-Ragging Cell) and **`AICTE-GRV-2026-004`** (Student Cell) with **84% Match (CRITICAL)**.
- Click **"Inspect & Review Side-by-Side"**.
- Point out the extracted shared keywords (`[senior, student, harass, hostel, block, ragg]`).
- Explain the **Strict AICTE Guardrail**: *"We do not auto-merge cases because each complaint represents formal evidentiary testimony. Instead, the officer clicks 'Confirm Link as Related Cross-Bureau Case', which ties them with a shared Linked Group ID while preserving each dossier's integrity."*

### 3. End-to-End Complaint Lifecycle (Complaints Registry Tab)
- Show the multi-criteria filter toolbar (Search, Bureau, Category, Region, Status, Priority, Date Range).
- Click **"Lodge Complaint"** to register a new case (now with Complainant Phone, Assigned Officer, and Supporting Docs).
- Notice how the system automatically checks for overlap in real time upon registration!
- Open any case to view the **Complete Case Dossier & Immutable Audit Trail**.
- Click **"Update / Reassign"** to reassign the bureau (e.g. from Student Cell to Legal Cell) or update status to *Notice Issued*, *Transferred*, or *Escalated*. Notice how the audit trail immediately records every transition.

### 4. Institution Profile & Consolidated History (Institution Profiles Tab)
- Click on **Institution Profiles**.
- Select *Apex Institute of Engineering & Technology* or *Vanguard Institute*.
- Show how AICTE directors can view **all complaints ever filed against an institution across every bureau** in one consolidated place, preventing institutions from hiding recurring violations.

### 5. Multi-Dimensional Reporting & Dossier Export (Reports & Export Tab)
- Demonstrate the **Bureau SLA Scorecard**, **Region-Wise Audit**, **Pending Case Ageing Analysis**, and **Overlap Intelligence Statistics**.
- Click **"Export CSV Dataset"** to download raw data for central ministry analytics.
- Click **"Print Report"** or open a case dossier to showcase official government-format printed outputs.

---

## ⚠️ Synthetic Demo Data Notice
All complaint narratives, student names, and phone numbers in this project are realistic synthetic test data generated strictly for SIH 2026 demonstration and evaluation. The application does not connect to live AICTE production servers.
