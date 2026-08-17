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

const app  = express();
const PORT = process.env.PORT || 3000;

// ── SECURITY MIDDLEWARE ──
app.use(helmet());

// ── CORS — allow your GitHub Pages frontend ──
app.use(cors({
  origin: [
    'http://localhost:5500',
    'http://127.0.0.1:5500',
    'https://nexus-wits-cps.github.io',
    process.env.FRONTEND_URL
  ].filter(Boolean),
  methods:     ['GET','POST','PUT','PATCH','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization'],
  credentials: true
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
app.listen(PORT, () => {
  console.log(`\n🚀 Wits CPS API running on port ${PORT}`);
  console.log(`📊 Supabase: ${process.env.SUPABASE_URL}`);
  console.log(`🌐 Frontend allowed: ${process.env.FRONTEND_URL}\n`);
});

module.exports = app;
