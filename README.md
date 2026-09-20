# Wits CPS Call Logging System
### Team 20 — NEXUS | INFO3003 | University of the Witwatersrand

A custom-built, web-based call logging system developed for 
Wits Campus Protection Services (CPS) to replace the 
third-party Fidelity Pulse platform.

## Status: Iteration 4 (Construction 1)
All six core use cases are implemented end to end: UC1 Log, UC2 Track, UC3 Confirm/Close, UC4 Assign, UC5 Resolve, UC6 Escalate (manual and automatic on SLA breach), plus five reports (Resolution Time, Call Volume, Priority Analysis, Incident History, Technician Performance) with a reporting period, drill-down and CSV/Excel/PDF export.

- Front end: https://nexus-wits-cps.github.io/CPS-CALL-LOGGING-SYSTEM/ (GitHub Pages)
- API: https://wits-cps-api.onrender.com (Render free tier; the first request after inactivity can take about a minute)
- Database: Supabase PostgreSQL, Row Level Security enabled

Ticket statuses: Open, In Progress, Escalated, Pending Confirmation, Closed. Notifications are in-app only.
Deferred to Construction 2: email/SMS notifications, Cancel Incident, update details/attachments, user-management and system-table screens, profile/password change, client-hosted deployment.

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
- `npm test` runs the workflow tests against an in-memory database (no credentials needed).
- Live API suite (49 checks against the deployed API): set `PW_ADMIN`, `PW_OFFICER` and `PW_TECH` to the demo passwords, then `node tests/live-api.test.js`. It creates a TEST ticket each run; delete it afterwards.

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