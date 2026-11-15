# SHIKSHATRACK

> **AI-Powered Smart Attendance and School Management System for Rural Schools**

## Live Demo

- Deployed Application: https://shiksha-track-major-project-six.vercel.app/

---

## 1. Problem Statement & Objectives

### The Problem
Many rural schools in India continue to rely on manual paper attendance registers. These manual processes:
- Consume valuable instructional classroom time (15–20 minutes daily per class).
- Are highly prone to human error, proxy attendance, and physical register damage.
- Severely complicate district reporting for schemes such as the **Mid-Day Meal (MDM)**, leading to ration misallocations and budget discrepancies.
- Struggle in low-connectivity rural zones where cloud-dependent applications fail.

### Objectives
1. **Automate student attendance** using fast, secure, cryptographic QR code scanning via standard mobile/laptop cameras.
2. **Digitize student, faculty, class, and timetable scheduling** with a modern, high-performance web dashboard with automated conflict detection.
3. **Guarantee offline attendance support** in low-connectivity rural regions via Progressive Web App (PWA) caching and client-side IndexedDB synchronization.
4. **Generate automated governance reports**, including daily registers, monthly trends, low-attendance alert lists (< 75% RTE threshold), and physical Mid-Day Meal headcounts.
5. **Provide AI-powered administrative insights** and a natural-language query interface ("Ask ShikshaTrack") with verified, non-destructive database query execution.
6. **Provide a separate Node.js terminal CLI application** (`shikshatrack`) for headless and low-bandwidth administrative environments.
7. **Demonstrate deep mastery** of core BTech curricula: PostgreSQL database engineering, Node.js/Express MVC software development, and modern React web architecture.

---

## 2. Technology Stack

- **Frontend:** React 18, Vite, React Router v6, Tailwind CSS, Recharts, Lucide Icons, Axios.
- **Backend:** Node.js (v20+ / v25), Express.js (ES Modules), RESTful APIs (`/api/v1`), JWT authentication, bcryptjs, Rate Limiting.
- **Database:** PostgreSQL 18, Prisma ORM (Client, Schema, Migrations, Studio, Seed Scripts).
- **CLI Application:** Node.js, Commander.js, Chalk, Cli-table3, Readline, Node.js Streams, EventEmitter.
- **QR Subsystem:** `qrcode` (cryptographic random token generator & high-res PNG encoder), `html5-qrcode` (real-time camera viewfinder scanning).
- **Offline Subsystem:** Progressive Web App (PWA), Service Worker (`sw.js`), Web App Manifest, client-side IndexedDB storage (`ShikshaTrackOfflineDB`), and idempotent batch synchronization.
- **AI Subsystem:** Configurable external AI provider (Gemini / OpenAI / Heuristic Engine) with prompt engineering, intent routing, and autonomous statistical anomaly detection.
- **Testing:** Vitest, Supertest, Integration test suite.

---

## 3. High-Level Architecture

```
React Frontend (Vite + Tailwind CSS)
       │
       │ HTTP / REST API (/api/v1)
       ▼
Express.js Backend (Node.js MVC Monolith)
       │
       │ Prisma ORM Client
       ▼
PostgreSQL 18 Database

──────────────────────────────────────────────────────
Separate Terminal CLI:
Node.js CLI (Commander.js) ──► REST API ──► Express Backend

Offline Resilience:
React PWA ──► IndexedDB Queue ──► Batch Sync API ──► PostgreSQL

AI Subsystem:
Admin Dashboard ──► AI Intent Router ──► Verified SQL Queries
```

---

## 4. Database Schema & Key Models

All models are normalized in **Third Normal Form (3NF)**:
1. `schools`: School profile, institution code, contact particulars.
2. `users`: System accounts (Principal/Admin, Teachers), bcrypt password hashes, roles.
3. `classes`: Grades, sections (e.g. `Class 8-A`), academic session years.
4. `teacher_assignments`: Associative junction table resolving M:N faculty allocations.
5. `students`: Enrolled students, admission numbers (unique per school), roll numbers, unique non-guessable `qrToken`s.
6. `attendance_sessions`: Daily attendance session lifecycle (`OPEN` $\rightarrow$ `CLOSED`).
7. `attendance_records`: Individual marked attendances with composite unique constraint `@@unique([sessionId, studentId])`, status (`PRESENT`, `ABSENT`, `LATE`), and method (`QR`, `MANUAL`, `OFFLINE_SYNC`), plus metadata like `lateReason` and `deviceInfo`.
8. `audit_logs`: Administrative modification audit trail recording `actorId`, `previousValue`, `newValue`, and mandatory `reason`.

For complete details, see [docs/database-schema.md](file:///Users/shivrajbissa/ShikshaTrack/docs/database-schema.md), [docs/teacher-management-api.md](file:///Users/shivrajbissa/ShikshaTrack/docs/teacher-management-api.md), [docs/architecture.md](file:///Users/shivrajbissa/ShikshaTrack/docs/architecture.md), and [docs/api-documentation.md](file:///Users/shivrajbissa/ShikshaTrack/docs/api-documentation.md).

---

## 5. Quick Start & Installation

### Prerequisites
- **Node.js** (v20+ or v25+)
- **PostgreSQL** (v14+ / v18) installed locally or via Docker
- **npm** (v10+ or v11+)

### 1. Configure Environment
Copy `.env.example` to `.env`:
```bash
cp .env.example .env
```
Default `.env` settings:
```env
DATABASE_URL="postgresql://shivrajbissa@127.0.0.1:5432/shikshatrack?schema=public"
TEST_DATABASE_URL="postgresql://shivrajbissa@127.0.0.1:5432/shikshatrack_test?schema=public"
PORT=5050
NODE_ENV=development
JWT_SECRET="shikshatrack_super_secret_jwt_key_2026_rural_education"
FRONTEND_URL="http://localhost:5173"
AI_PROVIDER="mock"
```

### 2. Install Dependencies
```bash
npm install
```
*(This automatically installs root, backend, frontend, and CLI dependencies).*

### 3. Setup Database & Seed Demo Data
```bash
# Run Prisma migrations
npm run prisma:migrate

# Seed database with sample school, classes, teachers, students, and past attendance
npm run prisma:seed
```

---

## 6. Running the Application

### Option A: Run Both Backend & Frontend Simultaneously
```bash
npm run dev
```

### Option B: Run Individually
In Terminal 1 (Backend):
```bash
npm run dev:backend
# Starts Express server on http://localhost:5050
```

In Terminal 2 (Frontend):
```bash
npm run dev:frontend
# Starts Vite React development server on http://localhost:5173
```

---

## 7. Demo Accounts & Credentials

| Role | Email | Password | Assigned Scope |
| :--- | :--- | :--- | :--- |
| **Principal (Admin)** | `admin@shikshatrack.in` | `admin123` | Full School Administration, Faculty & Student Management, Visual Analytics, AI Reports. |
| **Teacher (Ramesh Sharma)** | `ramesh.teacher@shikshatrack.in` | `teacher123` | Class 8-A (Class Teacher) & Class 8-B. |
| **Teacher (Sunita Verma)** | `sunita.teacher@shikshatrack.in` | `teacher123` | Class 9-A (Class Teacher) & Class 10-A. |
| **Teacher (Anil Kumar)** | `anil.teacher@shikshatrack.in` | `teacher123` | Class 6-A (Class Teacher) & Class 7-A. |

---

## 8. Running the Terminal CLI (`shikshatrack`)

```bash
# Display help and available commands
node cli/bin/shikshatrack.js --help

# Login interactively
node cli/bin/shikshatrack.js login

# View institution information
node cli/bin/shikshatrack.js school info

# List registered students
node cli/bin/shikshatrack.js students list --limit 10

# Import students from CSV stream
node cli/bin/shikshatrack.js students import sample_students.csv

# Export students to CSV stream
node cli/bin/shikshatrack.js students export

# View today's attendance summary and class breakdown
node cli/bin/shikshatrack.js attendance today

# View system statistics and flagged anomalies
node cli/bin/shikshatrack.js stats
```

---

## 9. Running Automated Tests

Run the complete Vitest and Supertest suite:
```bash
npm test
```
All **21 automated tests** covering Authentication, Student CRUD, QR Attendance, SQL Aggregations, AI Subsystem, and Offline Synchronization will execute.

---

## 10. Academic Documentation & Viva Preparation

Comprehensive academic documentation has been created inside `docs/`:

- [docs/student-performance-and-early-intervention.md](file:///Users/shivrajbissa/ShikshaTrack/docs/student-performance-and-early-intervention.md): Student performance analytics, Pearson correlation, and early intervention strategies.
- [docs/student-document-and-certificate-management.md](file:///Users/shivrajbissa/ShikshaTrack/docs/student-document-and-certificate-management.md): Student digital document repository, multi-category document lifecycle, and verification workflows.
- [docs/offline-sync-and-recovery-engine.md](file:///Users/shivrajbissa/ShikshaTrack/docs/offline-sync-and-recovery-engine.md): Offline attendance sync engine, persistent operation queue, exponential backoff, and recovery logic.
- [docs/parent-portal-and-school-communication.md](file:///Users/shivrajbissa/ShikshaTrack/docs/parent-portal-and-school-communication.md): Parent portal dashboard, multi-child linking, school-wide communication, and engagement tracking.
- [docs/school-fee-and-financial-management.md](file:///Users/shivrajbissa/ShikshaTrack/docs/school-fee-and-financial-management.md): Fee structures, installment scheduling, atomic receipting, payment reconciliation, and reminder systems.
- [docs/attendance-analytics-and-intelligence.md](file:///Users/shivrajbissa/ShikshaTrack/docs/attendance-analytics-and-intelligence.md): Advanced attendance intelligence, predictive trends, truancy detection, and pattern scanning.
- [docs/student-leave-and-discipline-management.md](file:///Users/shivrajbissa/ShikshaTrack/docs/student-leave-and-discipline-management.md): Student leave applications, approval workflows, attendance balancing, and disciplinary management.
- [docs/examination-and-result-management.md](file:///Users/shivrajbissa/ShikshaTrack/docs/examination-and-result-management.md): Examination administration, subject marks entry, grading scale, and result analytics.
- [docs/school-timetable-and-scheduling.md](file:///Users/shivrajbissa/ShikshaTrack/docs/school-timetable-and-scheduling.md): School timetable, period management, and faculty conflict detection.
- [docs/school-notifications-and-alerts.md](file:///Users/shivrajbissa/ShikshaTrack/docs/school-notifications-and-alerts.md): School notifications, proactive attendance alerts, and dismissal lifecycle management.
- [docs/team-contribution-matrix.md](file:///Users/shivrajbissa/ShikshaTrack/docs/team-contribution-matrix.md): Cross-functional ownership mapping Member 1, Member 2, and Member 3 across DE, ASD, and ISD.
- [docs/viva-preparation.md](file:///Users/shivrajbissa/ShikshaTrack/docs/viva-preparation.md): In-depth Q&A for DE, ASD, and ISD, plus 3 separate member practice defense sections.
- [docs/asd-concept-mapping.md](file:///Users/shivrajbissa/ShikshaTrack/docs/asd-concept-mapping.md): Complete Node.js syllabus concept mapping with exact code references.
- [docs/isd-concept-mapping.md](file:///Users/shivrajbissa/ShikshaTrack/docs/isd-concept-mapping.md): Web architecture, component lifecycle, PWA, and offline sync.
- [docs/academic-coverage.md](file:///Users/shivrajbissa/ShikshaTrack/docs/academic-coverage.md): Overview of syllabus coverage across all subjects.
- [docs/architecture.md](file:///Users/shivrajbissa/ShikshaTrack/docs/architecture.md): Detailed architectural design.
- [docs/database-schema.md](file:///Users/shivrajbissa/ShikshaTrack/docs/database-schema.md): 3NF schema specifications and relational integrity.
- [docs/api-documentation.md](file:///Users/shivrajbissa/ShikshaTrack/docs/api-documentation.md): Full REST API endpoint reference.
- [docs/user-guide.md](file:///Users/shivrajbissa/ShikshaTrack/docs/user-guide.md): Operational guide for administrators and teachers.
- **SQL Demonstrations (`docs/sql-demonstrations/`):** 12 executable SQL files covering Lectures 0 through 12 (DDL, DML, DCL, TCL, built-in functions, grouping, window functions, subqueries, joins, and normalization examples).
- **Runnable Educational Examples (`docs/examples/`):** Runnable scripts illustrating CommonJS vs ES Modules, EventEmitters, Streams, and Raw Node.js HTTP servers.

---
