# SIGIS — Complete Browser Demonstration Guide (SIH 26264)

**Problem:** Integrated Dashboard for Monitoring and Tracking Institution-Related Complaint Cases Across AICTE Bureaus/Cells

**Our innovation story (one line):** AICTE's problem isn't detection — it's that two bureaus silently act on the same institution. SIGIS uses transparent **rule-based matching** (institution ID + category + text similarity, 45% threshold) to RAISE the alert, but deliberately leaves every decision to officers: overlap confirmation, coordination accept/reject, and resolution approval are all **explicit human actions** with full audit trails. No silent merges, no black-box AI making regulatory decisions — accountable automation.

*Note: the problem statement explicitly allows "data matching, rule-based logic and/or AI-assisted analytics" — rule-based logic is a first-class answer here, not a compromise.*

---

## 🚀 STARTUP (2 minutes)

```bash
cd sigis-aicte-system
npm install     # first time only
npm start       # → http://127.0.0.1:3000
```

Open Chrome → `http://127.0.0.1:3000`

**Demo accounts** (click **"Switch Role"** in the header to see/switch all):

| Role | Username | Password | Represents |
|---|---|---|---|
| Admin | `admin@aicte.gov.in` | `aicte@admin2026` | Competent Authority / AICTE HQ |
| Officer (PGRC) | `officer.pgrc@aicte.gov.in` | `pgrc@2026` | Public Grievance Redressal Cell |
| Officer (RB) | `officer.regional@aicte.gov.in` | `regional@2026` | Regulation Bureau |
| Officer (Vigilance) | `officer.vigilance@aicte.gov.in` | `vigilance@2026` | Vigilance Cell |
| Student | `student.rahul@gmail.com` | `student@2026` | Complainant |

---

## ACT 1 — THE CORE PROBLEM STORY: Same Institution, Two Bureaus (8 min) ★ centrepiece

*This directly re-enacts the problem statement's "Institution A → PGRC case + RB case" example.
Dry-run verified: this exact pair scores **76% (CRITICAL)** against the 45% threshold — it WILL trigger.*

1. **Login as PGRC officer** (`officer.pgrc@aicte.gov.in`).
2. Click **"+ Lodge Complaint"** — the form pre-fills the officer as the *registering officer*, NOT the complainant (a stakeholder complaint received at the desk).
   - Institution: pick **any one** (e.g., `1-10492811`) — **remember this institution**
   - Bureau: `Public Grievance Redressal Cell (PGRC)`
   - Category: `General Administration / Public Grievance`, Priority: `HIGH`
   - Subject: `College refusing to conduct re-evaluation of answer scripts`
   - Description: `Student alleges the college is refusing re-evaluation of end-semester answer scripts despite payment of fees.`
   - Submit → **✅ Checkpoint: unique case ID `AICTE-GRV-2026-0XX` generated & shown**
3. **Switch Role → RB officer** (`officer.regional@aicte.gov.in`).
4. **"+ Lodge Complaint"** → **SAME institution** as step 2.
   - Bureau: `Regional Bureau / Regional Office (RB)`
   - Category: `General Administration / Public Grievance` (same category)
   - Subject: `Re-evaluation request denied by institute`
   - Description: `Institute has denied re-evaluation of semester exam papers to multiple students despite fee payment.`
   - Submit
5. **Switch Role → Admin** → click **"Overlap Centre"** tab.
   - **✅ Checkpoint A (Innovation #3):** the two cases appear with similarity % + reasons ("Target identical institution", "Cross-Bureau routing", "Identical category"), severity CRITICAL, status **PENDING_REVIEW**.
   - **Say to judges:** *"Auto-identified — same institution handled by two bureaus. But the system does NOT auto-merge or auto-close. A human officer decides."*
6. Click **"Review Side-by-Side"** → read both complaints → click **"Confirm Link"** (human decision, persisted with your name + timestamp).
   - **✅ Checkpoint:** both cases now show a **🔗 Linked** badge in the Complaints Registry.
7. Open one of the linked cases (click its case ID) → drawer → click the **handshake icon** → **"Request Assistance"** → select the other bureau → reason: `Same-institution parallel action detected; coordinating to avoid conflicting re-evaluation orders.` → Submit.
8. **Switch Role → the other bureau's officer** → open the same case drawer → see the PENDING request → click **Accept** (with remarks) → later **Mark Completed**.
   - **✅ Checkpoint:** drawer shows the full status trail; **Case History & Audit Trail** shows `COORDINATION_REQUESTED → ACCEPTED → COMPLETED` with officer names + timestamps.
   - **Say:** *"Explicit approval workflow — no silent transfers, no merges, one authoritative history."*

---

## ACT 2 — REAL-TIME DASHBOARD (3 min) — problem key feature #4

**As Admin**, stay on the **Dashboard** tab:
- **✅ Checkpoint:** KPI cards — Total / Pending / Under Process / Disposed / Transferred / **Overdue beyond timeline** — plus bureau-wise and status-wise charts.
- **Verify honestly:** click the **"Pending"** KPI → jumps to Complaints Registry pre-filtered → counts match the table.
- Click **Deadline Radar** tab → **✅ Officer Workload Monitor** (real active caseload per officer, colour-banded) + overdue cases table with days-overdue + **Escalate** action.

---

## ACT 3 — INSTITUTION PROFILE (2 min) — problem key feature #1

- **Institutions** tab → click any institution → **✅ consolidated complaint history** for that institution across ALL bureaus in one view (the "single source of truth" outcome).
- Later, as Student: the same institution view shows only their case, internal notes scrubbed (privacy proof).

---

## ACT 4 — FULL CASE LIFECYCLE WITH OFFICER APPROVAL (6 min) ★ the officer-approval workflow

1. **Student** (`student.rahul@gmail.com`) → **"+ Lodge Complaint"** (form auto-fills name/email) → e.g., Vigilance Cell, `Capitation Fee / Financial Irregularity` → submit → **✅ gets unique ID, sees ONLY own case** (registry shows just their rows; Overlap/Reports tabs hidden).
2. **Switch → Vigilance officer** → open that case → **✅ Assignment Recommendations** panel (ranked by real workload with plain-language explanation) → pick officer via **Use** button → status → **"Under Bureau Scrutiny"** → add confidential **Investigation Notes** → **upload evidence** (any small PDF) → **"Submit for Admin Review"**.
3. **Switch → Admin** → **✅ "Pending Admin Review"** KPI → open case → **"Review"** button → see officer's report + documents → **"Return for Inquiry"** (reason mandatory) → officer re-submits → Admin **"Approve & Close"** with closure order remark.
4. **Switch → Student** → open own case → **✅ sees the final approved resolution** — but NOT investigation notes, NOT internal remarks. Prove it in DevTools console (student session):
   ```js
   fetch('/api/complaints/AICTE-GRV-2026-0XX').then(r => r.json()).then(c => console.log(c.investigation_notes, c.resolution_remarks))
   // → undefined undefined (scrubbed server-side)
   ```

---

## ACT 5 — SEARCH, FILTERS, REPORTS, CSV (4 min) — problem key features #6 & #8

1. **Complaints Registry** → search box: type the Act-1 case ID → instant filter. Try institution name, region.
2. Filters: Bureau = RB → only RB cases. Status = `ESCALATED`. Date range. **✅ Checkpoint:** every filter is a real server query (Network tab: `/api/complaints?bureau=...`).
3. **Reports** tab → bureau-wise / region-wise / pending-ageing / disposal-rate scorecards. **✅** numbers match the registry (spot-check one count).
4. **"Export CSV Dataset"** → open the file → show `Source_Reference` + `Target_SLA_Date` columns → **re-import the same file via "Import CSV"** → result: **"0 imported, all duplicates"** → **✅ proves repeat-safe ingestion, originals untouched.**
5. **Pagination:** with many rows, the registry shows the first 50 + a **Load More** button (page_size cap 500 server-side).

---

## ACT 6 — ALERTS & NOTIFICATIONS (2 min) — problem key feature #7

- Overlap alert badge on the Overlap Centre tab (live pending-review count).
- SLA alert: Admin/Officer actions create notification log entries → **honesty moment:** *"Delivery is SIMULATED_LOCAL — logged with status, never a fake email claim. Real SMTP/MSG91 is a config swap; the schema already records delivery state."* Judges respect this honesty.

---

## ACT 7 — SECURITY FINALE + USER MANAGEMENT (2 min)

1. Login as **Student**, open DevTools → Console:
   ```js
   fetch('/api/reports').then(r => console.log(r.status))   // → 403
   fetch('/api/users').then(r => console.log(r.status))     // → 403
   ```
   **✅ Checkpoint:** *"Not hidden in the UI — enforced by the server."*
2. **Admin → "Manage Users"** → create a live officer account → log out → log in as the new account → works immediately with correct bureau scoping.
3. **Reset Demo** (Admin only) restores the synthetic dataset when you want a clean re-run.

---

## 📊 REQUIREMENT → STATUS MATRIX (honest)

| Problem-statement requirement | Status | Where |
|---|---|---|
| 1. Centralized institution profile + consolidated history | ✅ Works | Act 3 |
| 2. Case tracking (ID, date, category, status, bureau, officer, last action, expected disposal date) | ✅ Works | Drawer, export CSV |
| 3. **Cross-bureau overlap detection + alert + linking** | ✅ Works — rule-based, human confirm | Act 1 |
| 4. Real-time dashboard (all 8 counts + institution/bureau-wise + workload) | ✅ Works | Act 2 |
| 5. Workflow & action history (chronological, actor, timestamp, remarks, documents, transfer/escalation) | ✅ Works | Audit trail in drawer |
| 6. Search & filters (all 8 dimensions) | ✅ Works | Act 5 |
| 7. Alerts & notifications | ⚠️ Partial — alerts real, **delivery simulated** (logged honestly) | notification_logs |
| 8. Reports & analytics (bureau/region/institution/ageing/disposal/overlaps) | ✅ Works | Reports tab |
| RB↔PGRC overlap scenario from the problem statement | ✅ Works end-to-end | Act 1 |
| Officer approval workflow (submit → admin review → approve/return) | ✅ Works | Act 4 |
| Cross-bureau coordination with explicit approval | ✅ Works | Act 1 steps 7–8 |
| CSV bulk ingestion + export round-trip | ✅ Works | Act 5 |
| Real email/SMS delivery | ❌ Not built — external provider needed | — |
| ML-based matching | ❌ Intentionally not used — rule-based logic is explicitly allowed; human approval is the decision point | — |
| Officer expertise/availability metrics | ❌ Not present — no such data exists; fabricating would be a judge trap | — |
| Automated browser click-testing | ⚠️ Not verified automatically — this manual flow + 116 API tests cover it | — |

## ⚠️ KNOWN FLAWS (state them before judges ask)

1. **Notification delivery simulated** → *now shown honestly in the UI itself* (the notification audit dialog displays the `SIMULATED_LOCAL` delivery state). Fix for production: Nodemailer/MSG91 swap; schema already stores delivery status and a webhook provider attaches via configuration.
2. **No browser-automated tests** → fix: Playwright suite; today, the manual flow + 119 API-level tests cover behavior. Session-expiry is handled in-app with a clear toast + auto-restore.
3. **Rule-based similarity can produce false positives** (two genuinely different complaints at the same institution in the same category) → *by design*: that's why human confirm exists, the threshold is 45%, and nothing auto-merges.
4. **SQLite single-file** → now runs in WAL journal mode (concurrent readers + writer, better crash recovery); a network-shared or high-write production deployment would still move to Postgres.
5. **User lifecycle** → full create + deactivate now exists (Admin UI + API) with guards: no self-delete, no deleting the last admin, no deleting officers with active cases. Audit history always survives deactivation.

## 🧪 VERIFICATION BASELINE

- **120/120 automated tests** across 9 suites (`npm test`): core API, auth/RBAC, documents, SSE, notifications, resolution workflow, security, CSV import, workload/coordination/pagination/user-management (incl. user deactivation guards + WAL mode + receiving-officer open-access).
- **Act-1 overlap dry-run:** PGRC vs RB pair scores **76% (CRITICAL)** ≥ 45% threshold — verified against the real engine.
- `/api/overlaps` recomputes on every request — complaints created live during the demo appear in the Overlap Centre immediately.
