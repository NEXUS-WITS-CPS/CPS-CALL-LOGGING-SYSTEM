# Wits CPS Call Logging System
### Team 20 — NEXUS | INFO3003 | University of the Witwatersrand

A custom-built, web-based call logging system developed for 
Wits Campus Protection Services (CPS) to replace the 
third-party Fidelity Pulse platform.

## Status: Iteration 5 (Construction 2)
All six core use cases are implemented end to end: UC1 Log, UC2 Track, UC3 Confirm/Close, UC4 Assign, UC5 Resolve, UC6 Escalate (manual, and automatic when the SLA deadline is breached), plus Cancel Incident (soft-delete). Construction 2 added:

- SLA tiers (2/4/8/24 hours, from priority, equipment criticality and category), pause and resume with a reason, and warnings at 75% and 90%
- Work progress steps (accepted, arrived, repair started), spare parts and automatic time spent; re-assignment with a reason
- Equipment register, equipment movements (remove, repair, return, replace) and preventive maintenance schedules that raise tickets when due
- User management: access requests, bulk import (up to 200), password reset, activate/deactivate, account history, forced change of a temporary password
- Six reports (Resolution Time, Call Volume, Priority Analysis, Incident History, Technician Performance, SLA Compliance) with a reporting period, drill-down and CSV/Excel/PDF export
- Role dashboards, an Operations dashboard and a phone-friendly technician view (My Jobs)

- Front end: https://nexus-wits-cps.github.io/CPS-CALL-LOGGING-SYSTEM/ (GitHub Pages)
- API: https://wits-cps-api.onrender.com (Render free tier; the first request after inactivity can take about a minute)
- Database: Supabase PostgreSQL (15 tables), Row Level Security enabled

Ticket statuses: Open, In Progress, Escalated, Pending Confirmation, Closed, Cancelled. Notifications are in-app only.

Cancel Incident: an admin can cancel any ticket that isn't already closed/cancelled; an officer can only cancel a ticket they logged themselves, and only while it is still open. Cancelling never deletes the row; it sets status = `cancelled` so the ticket number and audit trail stay intact.

Not built: email/SMS notifications, file attachments, editing incident details after logging, a screen to manage categories and locations, profile editing and self-service password reset, automatic technician assignment, client-hosted deployment and Fidelity Pulse data migration.

## Accounts
There are no shared demo accounts. The administrator signs in with their own account, adds people on the Users page (one at a time or by bulk import) or approves access requests from the login page. Everyone must choose their own password at first sign-in.

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
- `npm test` runs the workflow tests (185 checks covering the use cases, SLA rules, equipment and maintenance, user management and security) against an in-memory database (no credentials needed).
- Live API suite (61 checks against the deployed API): create an active admin, officer and technician account on the Users page, set `PW_ADMIN`, `PW_OFFICER` and `PW_TECH` to their passwords (the three e-mail addresses are set in the `CREDS` table at the top of the script; edit them to match your accounts), then run `node tests/live-api.test.js`. It creates a handful of clearly-labelled TEST tickets each run; delete them afterwards.

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
- Reports & Analytics (six reports)
- Operations dashboard, Equipment (assets), Maintenance, Users, My Jobs (technician), Change password

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
- Security: JWT (8 h), bcrypt, role-based access control, helmet, CORS allow-list, rate limiting (5 failed sign-ins per account in 15 minutes), input validation, 30-minute idle timeout