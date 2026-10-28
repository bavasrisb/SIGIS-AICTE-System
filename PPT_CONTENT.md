# SIGIS — SIH 2026 PPT Content (Slide-by-Slide)

Ready-to-paste main content for the official **SIH 2026-PPT FORMAT.pptx** template (6 content slides; delete the "Important Instructions" slide before upload; points only, no paragraphs; final upload is PDF).

---

## SLIDE 1 — TITLE PAGE

| Field | Content |
|---|---|
| Problem Statement ID | **26264** |
| Problem Statement Title | Integrated Dashboard for Monitoring and Tracking Institution-Related Complaint Cases Across AICTE Bureaus/Cells |
| Theme | Smart Automation |
| PS Category | Software |
| Team ID | *(fill from portal)* |
| Team Name | *(fill from portal)* |
| Video Link | *(fill — demo video URL)* |
| Drive Link | *(fill — project drive URL)* |

---

## SLIDE 2 — IDEA TITLE: SIGIS — Smart Institution Grievance Intelligence System

**Proposed Solution**
- Single-window integrated dashboard: all institution complaints across AICTE bureaus in ONE place, with real-time status, ownership and SLA tracking
- Working end-to-end prototype built on the actual AICTE workflow (not a concept)

**How it addresses the problem**
- Centralized institution profile — unique AICTE Permanent ID + consolidated case history across all bureaus
- Cross-bureau overlap detection — flags same-institution cases handled by 2+ bureaus ("Potential Overlapping Cases – Coordination Required")
- Explicit cross-bureau coordination workflow — request → accept/reject → complete, fully audited; no silent transfers or merges
- Real-time KPI dashboard: total / pending / under-process / disposed / transferred / beyond-timeline counts + bureau-wise workload

**Innovation & uniqueness**
- Human-in-the-loop automation: rule-based matching raises the alert, but a human officer confirms overlap, accepts coordination, approves resolution — accountable automation, no black-box decisions
- Nothing auto-merges — a suspected duplicate is never a duplicate until an authorized officer confirms (prevents wrongful closures)
- Transparent similarity scoring (institution 40% + category 25% + text 35%, 45% threshold) with plain-language reasons shown to reviewers

---

## SLIDE 3 — TECHNICAL APPROACH

**Technologies**
- Backend: Node.js + Express, SQLite (WAL mode), scrypt auth + token sessions
- Frontend: HTML/CSS/JavaScript (Tailwind UI), Server-Sent Events for real-time updates
- No external cloud/AI dependency — runs offline, zero-cost deployment

**Methodology / Implementation Flow**
```
Complaint Registration (Student/Officer) → Unique Case ID
→ Rule-based Overlap Detection → Human Overlap Review (Confirm/Dismiss)
→ Bureau + Officer Assignment (workload-ranked recommendations)
→ Investigation + Evidence Upload → Resolution Report
→ Admin Approval/Return → Complainant sees approved resolution
(Coordination requests possible at any stage; every step audited)
```
- Diagrams to insert: (1) system architecture, (2) case lifecycle state diagram, (3) 3-role RBAC chart

**Verification**
- 120 automated tests across 9 suites — added cross-bureau receiving-officer open-access + Accept action test — role access, workflows, security, CSV, coordination

---

## SLIDE 4 — FEASIBILITY AND VIABILITY

**Feasibility**
- Runs on basic hardware (single Node process + SQLite file); no special infrastructure
- Additive database migrations — integrates with existing data without disruption

**Potential challenges & risks**
- Notification delivery is simulated (no SMS/email gateway in demo)
- Rule-based matching can flag false positives
- Officer adoption / data quality from legacy records

**Strategies to overcome**
- Webhook-based email/SMS provider attachable via configuration (delivery state already tracked in schema)
- 45% threshold + mandatory human confirmation → false positives reviewed, never auto-actioned
- CSV bulk import with row-level validation for clean legacy data migration; simple role-based UI minimizes training

---

## SLIDE 5 — IMPACT AND BENEFITS

**Impact on target audience** (RB, PGRC, all bureaus, regional offices, AICTE management)
- Single source of truth — no more "which bureau has this case?" confusion
- Bureau/Cell officers: clear case ownership, workload visibility, SLA countdown

**Benefits**
- Social: faster grievance redressal for students & faculty; transparency via full audit trail
- Economic: eliminates duplicate investigations across bureaus; saves officer-hours
- Operational: overdue alerts + escalation prevent timeline breaches; data-driven management decisions (bureau-wise/region-wise reports, ageing analysis, disposal rates)
- Accountability: every action timestamped with actor — nothing happens off-record

---

## SLIDE 6 — RESEARCH AND REFERENCES

- AICTE (Prevention of Malpractice in Technical Institutions) Regulations & public grievance procedures — https://www.aicte-india.org
- AICTE Bureau/Cell structure: Regulation Bureau (RB), Public Grievance Redressal Cell (PGRC), Regional Offices — official AICTE portal
- SIH 2026 Problem Statement #26264 documentation
- Techniques: TF/cosine + Jaccard text similarity (rule-based, explainable), idempotent event logging, RBAC security model, SQLite WAL concurrency — standard CS practices
- Comparable govt. practice: CPGRAMS (Centralized Public Grievance Redress and Monitoring System), Dept. of Administrative Reforms — domain reference for grievance tracking design

---

## ⚠️ TEMPLATE RULES (from the instruction slide — delete that slide before upload)
- Maximum **6 slides including the title slide**
- **Points / diagrams / infographics only** — avoid paragraphs
- Precise and easy to understand; idea must be unique and novel
- Use only the provided template without changing the idea-detail pointers
- Save as **PDF** and upload on the portal (PPT/Word not accepted)

## Honesty guardrails (matches the working demo — see DEMO_GUIDE.md)
- Says "simulated delivery" (no fake email/SMS claims)
- Says "rule-based" (never claims AI/ML)
- Claims only what the demo proves live: working prototype, **120/120 tests**, RB↔PGRC overlap story, officer-approval workflow, cross-bureau coordination
