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
const assetRoutes       = require('./routes/assets');
const maintenanceRoutes = require('./routes/maintenance');
const { runSlaCheck }    = require('./lib/sla');
const { runMaintenanceCheck } = require('./lib/maintenance');

const app  = express();
const PORT = process.env.PORT || 3000;

// Behind Render's proxy — needed so rate limiting sees each visitor's real IP
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

// Stricter limits on login attempts (brute-force protection). Only FAILED sign-ins count.
// 1) per account: 5 wrong passwords for the same email locks that account's sign-in for 15 minutes
//    (even the correct password is refused until the window ends); a successful sign-in resets the count.
// 2) per connection: 20 failed sign-ins from one address in 15 minutes, whichever accounts were tried.
// The counters are kept in memory, so they also clear if the free-tier server restarts.
const acctKey = req => String((req.body && req.body.email) || '').trim().toLowerCase() || 'no-email';
const clientIp = req => String(req.headers['cf-connecting-ip'] || req.ip || '');
const loginByAccount = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  keyGenerator: acctKey,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many failed sign-in attempts for this account — please try again in 15 minutes.' }
});
const loginByConnection = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  keyGenerator: clientIp,
  skipSuccessfulRequests: true,
  standardHeaders: false,
  legacyHeaders: false,
  validate: false,
  message: { error: 'Too many failed sign-in attempts from this connection — please try again in 15 minutes.' }
});
app.use('/api/auth/login', (req, res, next) => {
  res.on('finish', () => { if (res.statusCode === 200) loginByAccount.resetKey(acctKey(req)); });
  next();
});
app.use('/api/auth/login', loginByAccount);
app.use('/api/auth/login', loginByConnection);
// Access requests are public, so keep them to a few per visitor per hour
app.use('/api/auth/request-access', rateLimit({
  windowMs: 60 * 60 * 1000, max: 5,
  message: { error: 'Too many access requests from this connection — please try again later.' }
}));

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
app.use('/api/assets',       assetRoutes);
app.use('/api/maintenance',  maintenanceRoutes);

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
setInterval(() => { runMaintenanceCheck(true); }, 60 * 60 * 1000).unref();   // raise tickets for due preventive maintenance
setTimeout(() => { runMaintenanceCheck(true); }, 30 * 1000).unref();

app.listen(PORT, () => {
  console.log(`\n🚀 Wits CPS API running on port ${PORT}`);
  console.log(`📊 Supabase: ${process.env.SUPABASE_URL}`);
  console.log(`🌐 Frontend allowed: ${process.env.FRONTEND_URL}\n`);
});

module.exports = app;
