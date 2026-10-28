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

- **Runtime**: Node.js **v22.5 or newer** (required for the built-in `node:sqlite` module; developed and tested on Node v26)
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
- **`complaints`**: Unique Case ID (`AICTE-GRV-2026-XXX`), institution ID, bureau, category, priority, status, complainant details, target SLA date, linked group ID, assigned officer, last action, next action, supporting docs, **`source_reference`** (external source-system reference, stored separately from the internal case ID, unique per case via a partial index).
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
Verify that all **120 tests across 9 suites** pass (core API, auth/RBAC, documents, real-time SSE, notifications, resolution workflow, security hardening, CSV import, workload & coordination):
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

## 📥 Validated CSV Import & Source References (SIH26264 Data Management)

Officers can bulk-register complaints received through external channels via the validated CSV import API, either from the **Import CSV** button in the web UI or directly via the API.

### Using the UI (Import CSV)
- The **Import CSV** button (top bar, next to "Lodge Complaint") is shown only to **Central Admin** and **Bureau Officer** roles; the server enforces the same rule (students get `403` even if they call the API directly).
- The import dialog accepts `.csv` files only (2 MB cap — enforced both in the browser and server-side; oversized requests are rejected with a clear `413` message), shows the selected filename with basic validation, and previews the first rows (line-numbered) before anything is submitted.
- Nothing is imported until you press **Import N rows**. After import, the dialog reports: successfully imported cases (new case ID + source reference), duplicate source references (with the existing case ID when available, skipped without modifying the original), and failed rows with physical line numbers and per-field validation messages. An empty or all-duplicate file gets an explicit "nothing new was imported" note.
- The complaints table and case drawer display a case's `Source_Reference` (when present) so imported cases can be traced back to their originating channel.
- The **Export CSV Dataset** output includes `Source_Reference`, `Description`, and `Target_SLA_Date` columns; exported files can be re-imported directly with no data loss — the original SLA target date is preserved (export-only columns such as `Complaint_ID` and `Status` are ignored on import and each row receives a fresh internal case ID).

### Endpoint
`POST /api/complaints/import` (Central Admin and Bureau Officers; officers are restricted to their own bureau)

Request body:
```json
{ "csv": "source_reference,institution_id,bureau,category,priority,complainant_name,subject,description\n..." }
```

### Required columns
`source_reference`, `institution_id`, `bureau`, `category`, `priority` (`CRITICAL|HIGH|MEDIUM|LOW`), `complainant_name`, `subject`, `description`.
Optional columns: `complainant_role` (defaults to Student), `complainant_email`, `complainant_phone`, `target_date` / `Target_SLA_Date` (`YYYY-MM-DD`, defaults to +30 days when empty; invalid formats are rejected as row errors), `assigned_officer`.
Header aliases are tolerated (e.g. `Source Reference`, `institution`, `email`).

### Behaviour
- **Row-level validation**: every rejected row is reported with its physical line number, the offending field, and a human-readable message; valid rows in the same file still import.
- **Short rows tolerated**: rows with fewer cells than the header are padded with empty trailing cells (e.g. omitting the optional `target_date` is fine — the default applies); rows with *extra* cells are still reported as malformed.
- **Bureau scoping is case-insensitive**: a Bureau Officer may import rows whose `bureau` matches theirs ignoring case and surrounding whitespace; the bureau value is stored exactly as provided in the CSV and is never altered.
- **Duplicate classification is precise**: only a violation of the `source_reference` unique index is reported as a duplicate; any other database error on insert is reported as a failed row, never as a duplicate.
- **Students cannot set `source_reference`**: a `source_reference` supplied by a `GUEST_STUDENT` on ordinary complaint creation (`POST /api/complaints`) is silently ignored (stored as `NULL`); the authorised channels are officer registration and the admin/officer CSV import.
- **Duplicate-safe & repeat-safe**: the `source_reference` (the complaint's own source-system ID — e.g. portal ticket or letter reference) is stored separately from the internal `AICTE-GRV-2026-XXX` case ID and is enforced unique by a database index. Re-importing the same file reports every row as a duplicate and creates nothing; existing cases are never overwritten.
- **Auditable**: each imported case receives a `CREATED` audit-trail entry naming the importer and the source reference. Imported cases start at status `Submitted`.
- **CSV parser**: RFC 4180 compliant pure-JS parser (`services/csvService.js`) — quoted fields with commas, escaped quotes (`""`), embedded newlines, CRLF/LF, and UTF-8 BOM are all handled.

*Note: this is a simulated internal AICTE ingestion channel for the demo — no external AICTE system is contacted.*

---

## 📊 Officer Workload & Assignment Recommendations

- `GET /api/officers/workload` (Admin sees all bureaus; Bureau Officers see only their own bureau) — real active caseload per officer, computed from `assigned_officer_id` and active statuses, with overdue and critical counts.
- `GET /api/complaints/:id/assignment-recommendations` (Admin + the case's own bureau officer) — up to three eligible same-bureau officers ranked by fewest active cases (then fewest overdue, fewest critical), each with a plain-language explanation. Recommendations use **only stored data**; the system has no expertise/availability/performance metrics and never invents them. Applying a recommendation is an explicit Admin/officer action recorded through the normal case-update audit trail.
- In the UI, the case edit dialog shows the recommendation panel with a **Use** button that pre-selects the officer in the assignment dropdown.

## 🤝 Cross-Bureau Coordination Workflow

An explicit, persistent, auditable workflow — a visual link alone is not coordination, and a coordination request never transfers, merges, or closes a case.

- `POST /api/complaints/:id/coordination` — initiate a request (Admin, or the case's own bureau officer) to a different bureau with a mandatory reason (min 10 chars). Duplicate pending requests to the same bureau return `409`.
- `GET /api/coordination` — Admin sees all; Bureau Officers see only requests where their bureau is the initiator or the receiver.
- `POST /api/coordination/:id/respond` — state machine `PENDING → ACCEPTED | REJECTED | CANCELLED`, `ACCEPTED → COMPLETED | CANCELLED`; terminal states are immutable. The **receiving** bureau accepts/rejects/completes; the **initiating** bureau may only cancel; Admin may do anything. Accept/reject/complete require remarks.
- Every transition writes a `COORDINATION_*` entry into the case's own audit history and broadcasts a real-time event. Students cannot see or use any coordination endpoint.
- In the UI, the case drawer shows the coordination list with status badges and role-appropriate action buttons, plus a **Request Assistance** dialog.

## 📈 Officer Workload Dashboard Widget

- The **Deadline Radar** tab includes an **Officer Workload Monitor** panel (Admin and Bureau Officers only — hidden for students, and the underlying `/api/officers/workload` endpoint returns 403 for them regardless).
- It lists every officer in scope with real active assigned caseload, overdue count, and critical-priority count — computed directly from the `complaints` table, with a simple load-band colour hint (light / moderate / heavy).
- Bureau Officers see only their own bureau's officers; Admin sees all bureaus. No expertise, availability, or performance metrics are shown or inferred — the database has no such data.

## 📄 Complaint List Pagination

- `GET /api/complaints` now accepts optional `page` and `page_size` query parameters (max 500 rows/page). The response stays a plain JSON array; totals are exposed via `X-Total-Count` and `X-Total-Pages` response headers. **Omitting both parameters returns the full result set exactly as before** — fully backward compatible with the existing UI and every existing test.
- In the UI, the Complaints Registry renders the first 50 rows immediately and appends a **Load More** button for the rest, so very large result sets never freeze the table. Filters compose with pagination on the server side.

## 👥 User Management (Admin Only)

- `GET /api/users` and `POST /api/users` (both Admin-only; 401/403 for everyone else) list and create accounts for the three existing roles: `ADMIN`, `BUREAU_OFFICER`, `GUEST_STUDENT`.
- Validation: email-format username, full name ≥ 3 chars, password ≥ 8 chars (stored only as scrypt hash + per-user salt, same scheme as login), a recognised bureau is mandatory for Bureau Officer accounts, unknown roles/bureaus are rejected, and duplicate usernames return `409`.
- `DELETE /api/users/:id` (Admin-only) deactivates an account with safety guards: **cannot delete your own account**, **cannot delete the last remaining Admin**, and **cannot delete an officer who still has active assigned cases** (they must reassign first — 409 with the case count). Sessions cascade-delete instantly (the login dies); past audit-history entries are preserved as name strings.
- In the UI, Admin sees a **Manage Users** button in the header opening a dialog with the account list (incl. a **Deactivate** action with confirmation) and a create form. New accounts can log in immediately and are subject to the same backend role scoping as seeded accounts.

## 🔔 Session-Expiry Feedback & Notification Honesty

- **Session expiry:** if any API call returns `401` mid-session (expired or invalidated session), the user sees a clear *"Your session has expired"* toast and the app silently restores access automatically — no more silent failures after idle periods.
- **Notification delivery honesty:** the notification audit dialog explicitly states that delivery is `SIMULATED_LOCAL` — every alert is logged with its real delivery state and shown in-app, but no external email/SMS gateway is contacted in this deployment. A webhook provider can be attached via configuration without code changes. Duplicate suppression is enforced by a per-day idempotency key (`complaint:event:channel:date`).

## 💾 Database Reliability

- SQLite runs in **WAL (Write-Ahead Logging) journal mode**: concurrent readers never block the writer (important for the real-time SSE + multi-tab demo) with better crash recovery. Purely additive — no schema/data change; falls back to the default journal mode automatically on filesystems without WAL support.

## ⚠️ Synthetic Demo Data Notice
All complaint narratives, student names, and phone numbers in this project are realistic synthetic test data generated strictly for SIH 2026 demonstration and evaluation. The application does not connect to live AICTE production servers.
