// =====================================================
// WITS CPS CALL LOGGING SYSTEM — EXPRESS API SERVER
// Team 20 · NEXUS · Iteration 3
// =====================================================
require('dotenv').config();

const express    = require('express');
const cors       = require('cors');
const helmet     = require('helmet');
const rateLimit  = require('express-rate-limit');

const authRoutes      = require('./routes/auth');
const incidentRoutes  = require('./routes/incidents');
const userRoutes      = require('./routes/users');
const reportRoutes    = require('./routes/reports');
const dashboardRoutes = require('./routes/dashboard');
const notificationRoutes = require('./routes/notifications');
const { runSlaCheck }    = require('./lib/sla');

const app  = express();
const PORT = process.env.PORT || 3000;

// Behind Render/Railway's proxy — needed so rate limiting sees each visitor's real IP
app.set('trust proxy', 1);

// ── SECURITY MIDDLEWARE ──
app.use(helmet());

// ── CORS — only the GitHub Pages frontend (set FRONTEND_URL to the site ORIGIN, no path) ──
// e.g. FRONTEND_URL=https://nexus-wits-cps.github.io
const allowedOrigins = (process.env.FRONTEND_URL || '')
  .split(',').map(o => o.trim().replace(/\/$/, '')).filter(Boolean);
app.use(cors({
  origin: function(origin, callback) {
    // no Origin header = curl / health checks; otherwise must be on the allow-list
    if (!origin || allowedOrigins.length === 0 || allowedOrigins.includes(origin)) return callback(null, true);
    const err = new Error('Origin not allowed by CORS'); err.status = 403;
    callback(err);
  },
  methods:     ['GET','POST','PUT','PATCH','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization']
}));

// ── BODY PARSER ──
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ── RATE LIMITING ──
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 200,
  message: { error: 'Too many requests — please try again later.' }
});
app.use('/api/', limiter);

// Stricter limit on login attempts (brute-force protection)
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: 'Too many login attempts — please try again in 15 minutes.' }
});
app.use('/api/auth/login', loginLimiter);

// ── HEALTH CHECK ──
app.get('/', (req, res) => {
  res.json({
    system:  'Wits CPS Call Logging System',
    team:    'Group 20 · NEXUS',
    version: '3.0.0',
    status:  'running',
    time:    new Date().toISOString()
  });
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ── ROUTES ──
app.use('/api/auth',      authRoutes);
app.use('/api/incidents', incidentRoutes);
app.use('/api/users',     userRoutes);
app.use('/api/reports',   reportRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/notifications', notificationRoutes);

// ── 404 HANDLER ──
app.use((req, res) => {
  res.status(404).json({ error: `Route ${req.method} ${req.path} not found` });
});

// ── GLOBAL ERROR HANDLER ──
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(err.status || 500).json({
    error:   err.message || 'Internal server error',
    path:    req.path,
    method:  req.method
  });
});

// ── START ──
// Automatic escalation (UC6): check for SLA breaches every minute
// (dashboards and ticket lists also trigger a check, so it still works if a free host sleeps)
setInterval(() => { runSlaCheck(true); }, 60 * 1000).unref();

app.listen(PORT, () => {
  console.log(`\n🚀 Wits CPS API running on port ${PORT}`);
  console.log(`📊 Supabase: ${process.env.SUPABASE_URL}`);
  console.log(`🌐 Frontend allowed: ${process.env.FRONTEND_URL}\n`);
});

module.exports = app;
