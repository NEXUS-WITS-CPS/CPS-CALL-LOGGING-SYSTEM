# Wits CPS Call Logging System — Deployment Guide
## Team 20 · NEXUS · Iteration 3

## Architecture
- **Frontend**: GitHub Pages (HTML/CSS/JS)
- **Backend**: Railway.app (Node.js + Express)
- **Database**: Supabase (PostgreSQL)

## Step 1 — Deploy Backend to Railway

1. Go to https://railway.app and sign up with GitHub
2. Click **New Project → Deploy from GitHub repo**
3. Select your repo → choose the `backend/` folder as root
4. Add environment variables in Railway dashboard:
   ```
   SUPABASE_URL=https://sftbahfyyllzvtehdlwe.supabase.co
   SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNmdGJhaGZ5eWxsenZ0ZWhkbHdlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYyOTQwNjgsImV4cCI6MjEwMTg3MDA2OH0.LDVP7-ReB6-bq19PIbX67kyHtKgw7uGjHFKbVt45h1M
   JWT_SECRET=nexus-wits-cps-secret-2026-group20
   PORT=3000
   FRONTEND_URL=https://nexus-wits-cps.github.io
   ```
5. Railway gives you a URL like: `https://wits-cps-api.up.railway.app`

## Step 2 — Update Frontend API URL

In `assets/js/main.js` line 8, replace:
```js
const API_BASE = 'https://wits-cps-api.up.railway.app/api';
```
with your actual Railway URL.

## Step 3 — Deploy Frontend to GitHub Pages

1. Push all frontend files to your GitHub repo
2. Go to repo Settings → Pages → Source: main branch
3. Your site will be live at: https://nexus-wits-cps.github.io/CPS-CALL-LOGGING-SYSTEM/

## Demo Credentials
| Role | Email | Password |
|---|---|---|
| Admin | admin@wits.ac.za | admin123 |
| Officer | officer@wits.ac.za | officer123 |
| Technician | tech@wits.ac.za | tech123 |
| Caller | caller@wits.ac.za | caller123 |

## API Endpoints
- POST /api/auth/login
- GET  /api/dashboard/summary
- GET  /api/dashboard/recent
- POST /api/incidents (UC1)
- GET  /api/incidents (UC2)
- GET  /api/incidents/:ticketNumber (UC2 detail)
- PATCH /api/incidents/:ticketNumber/assign (UC4)
- PATCH /api/incidents/:ticketNumber/resolve (UC5)
- PATCH /api/incidents/:ticketNumber/escalate (UC6)
- PATCH /api/incidents/:ticketNumber/confirm (UC3)
- GET  /api/reports/resolution-time (R1)
- GET  /api/reports/call-volume (R2)
- GET  /api/reports/priority-analysis (R3)
- GET  /api/reports/incident-history (R4)
- GET  /api/reports/technician-performance (R5)
