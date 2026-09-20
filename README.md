# Wits CPS Call Logging System
### Team 20 — NEXUS | INFO3003 | University of the Witwatersrand

A custom-built, web-based call logging system developed for 
Wits Campus Protection Services (CPS) to replace the 
third-party Fidelity Pulse platform.

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
6. Finally run `sql/2-enable-rls.sql` in Supabase to lock down the tables.

## Pages
- Login
- Admin Dashboard
- Officer Dashboard
- Technician Dashboard
- Log Incident (UC1)
- Assign Incident (UC4)
- Resolve Incident (UC5)
- Escalate Incident (UC6)
- Track Incident (UC2)
- Reports & Analytics

## Team Members
- Ashley Mathebe
- Melissa Bantom
- Rudzani Musida
- Rendani Ramantswana
- Vuyo Simelane
- Panashe Maunganidze

## Tech Stack
- HTML5
- CSS3
- JavaScript
- GitHub Pages