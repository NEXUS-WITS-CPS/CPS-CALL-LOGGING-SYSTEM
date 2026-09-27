# Wits CPS Call Logging System
### Team 20 — NEXUS | INFO3003 | University of the Witwatersrand

A custom-built, web-based call logging system developed for 
Wits Campus Protection Services (CPS) to replace the 
third-party Fidelity Pulse platform.

## Status: Iteration 4 (Construction 1)
All six core use cases are implemented end to end: UC1 Log, UC2 Track, UC3 Confirm/Close, UC4 Assign, UC5 Resolve, UC6 Escalate (manual and automatic on SLA breach), plus a Cancel Incident (soft-delete) feature, five reports (Resolution Time, Call Volume, Priority Analysis, Incident History, Technician Performance) with a reporting period, drill-down and CSV/Excel/PDF export, and a fully responsive UI (mobile, tablet, laptop and large-display breakpoints).

- Front end: https://nexus-wits-cps.github.io/CPS-CALL-LOGGING-SYSTEM/ (GitHub Pages)
- API: https://wits-cps-api.onrender.com (Render free tier; the first request after inactivity can take about a minute)
- Database: Supabase PostgreSQL, Row Level Security enabled

Ticket statuses: Open, In Progress, Escalated, Pending Confirmation, Closed, Cancelled. Notifications are in-app only.

Cancel Incident: an admin can cancel any ticket that isn't already closed/cancelled; an officer can only cancel a ticket they logged themselves, and only while it is still open (before a technician has been assigned). Cancelling never deletes the row — it sets status = `cancelled` so the ticket number and audit trail stay intact for accountability. Available from the Track Incident detail view.

Deferred to Construction 2: email/SMS notifications, update details/attachments, user-management and system-table screens, profile/password change, client-hosted deployment.

## Demo Credentials
Passwords are stored as bcrypt hashes in the database (run `sql/1-set-passwords.sql` once to set them).

| Role | Email | Password |
|---|---|---|
| Admin | admin@wits.ac.za | admin123 |
| Officer | officer@wits.ac.za | officer123 |
| Technician | tech@wits.ac.za | tech123 |

## Deploying the backend (Render, free tier)
1. Supabase SQL Editor: run `sql/1-set-passwords.sql`.
2. Render > New > Web Service > this repo. Root directory `backend`, build `npm install`, start `npm start`
   (or use the `render.yaml` blueprint).
3. Environment variables: `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` (Supabase > Settings > API > service_role),
   `JWT_SECRET` (long random string), `FRONTEND_URL=https://nexus-wits-cps.github.io`.
4. Put the Render URL in `assets/js/main.js` (`API_BASE`, must end in `/api`) and push to GitHub.
5. Check `https://<your-service>.onrender.com/api/health`, then log in.
6. Run `sql/3-notifications-read-flag.sql` (adds the notification read flag), then `sql/2-enable-rls.sql` to lock down the tables.

## Running the tests
From the `backend` folder (`npm install` first):
- `npm test` runs the workflow tests (67 checks, including Cancel Incident, `/auth/me`, register/deactivate, dashboard/recent and the technician drill-down report) against an in-memory database (no credentials needed).
- Live API suite (61 checks against the deployed API): set `PW_ADMIN`, `PW_OFFICER` and `PW_TECH` to the demo passwords, then `node tests/live-api.test.js`. It creates a handful of clearly-labelled TEST tickets each run; delete them afterwards. Register/deactivate are not exercised here since they would create permanent accounts in the live database.

## Pages
- Login
- Admin Dashboard
- Officer Dashboard
- Technician Dashboard
- Log Incident (UC1)
- Assign Incident (UC4)
- Resolve Incident (UC5)
- Escalate Incident (UC6)
- Track Incident (UC2); Confirm / Reject (UC3) is offered to the officer who logged a ticket once it is Pending Confirmation
- Reports & Analytics

## Team Members
- Ashley Mathebe
- Melissa Bantom
- Rudzani Musida
- Rendani Ramantswana
- Vuyo Simelane
- Panashe Maunganidze

## Tech Stack
- HTML5, CSS3, JavaScript (GitHub Pages)
- Node.js 22 + Express REST API (Render)
- Supabase (PostgreSQL)
- Security: JWT (8 h), bcrypt, role-based access control, helmet, CORS allow-list, rate limiting, input validation, 30-minute idle timeout