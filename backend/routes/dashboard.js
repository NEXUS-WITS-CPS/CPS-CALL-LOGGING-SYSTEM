// =====================================================
// DASHBOARD ROUTES — /api/dashboard
// =====================================================
const express  = require('express');
const supabase = require('../supabaseClient');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();
router.use(authMiddleware);

// GET /api/dashboard/summary — KPI stats for dashboard
router.get('/summary', async (req, res) => {
  try {
    let query = supabase.from('incidents').select('status, priority, sla_breached, date_logged, date_resolved');

    // Role-based filtering
    if (req.user.role === 'caller') {
      query = query.eq('caller_id', req.user.userId);
    } else if (req.user.role === 'technician') {
      query = query.eq('assigned_to', req.user.userId);
    }

    const { data: incidents, error } = await query;
    if (error) throw error;

    const total       = incidents.length;
    const open        = incidents.filter(i => i.status === 'open').length;
    const inProgress  = incidents.filter(i => i.status === 'in_progress').length;
    const resolved    = incidents.filter(i => ['resolved','pending_confirmation'].includes(i.status)).length;
    const closed      = incidents.filter(i => i.status === 'closed').length;
    const escalated   = incidents.filter(i => i.status === 'escalated').length;
    const slaBreached = incidents.filter(i => i.sla_breached).length;

    // Avg resolution time in hours
    const resolvedWithTime = incidents.filter(i => i.date_resolved && i.date_logged);
    const avgResolutionHrs = resolvedWithTime.length > 0
      ? resolvedWithTime.reduce((sum, i) => {
          return sum + (new Date(i.date_resolved) - new Date(i.date_logged)) / 3600000;
        }, 0) / resolvedWithTime.length
      : 0;

    // SLA compliance %
    const resolvedTotal = incidents.filter(i => ['resolved','pending_confirmation','closed'].includes(i.status)).length;
    const slaCompliance = resolvedTotal > 0
      ? Math.round(((resolvedTotal - slaBreached) / resolvedTotal) * 100)
      : 100;

    // SLA alerts — breached or approaching
    let alertQuery = supabase
      .from('incidents')
      .select(`
        ticket_number, priority, status, sla_deadline, sla_breached,
        description, categories(category_name)
      `)
      .in('status', ['open','in_progress'])
      .order('sla_deadline', { ascending: true })
      .limit(5);

    if (req.user.role === 'technician') {
      alertQuery = alertQuery.eq('assigned_to', req.user.userId);
    }

    const { data: slaAlerts } = await alertQuery;
    const now = new Date();
    const alerts = (slaAlerts || []).map(i => {
      const deadline   = new Date(i.sla_deadline);
      const minsLeft   = Math.round((deadline - now) / 60000);
      const hoursLeft  = Math.round(minsLeft / 60 * 10) / 10;
      const slaLimits  = { critical:2, high:4, medium:8, low:24 };
      const limit      = slaLimits[i.priority] * 60;
      const elapsed    = limit - minsLeft;
      const pct        = Math.min(Math.round((elapsed / limit) * 100), 100);
      return {
        ...i,
        hoursLeft,
        slaStatus: i.sla_breached || minsLeft <= 0 ? 'breached'
          : pct >= 75 ? 'approaching' : 'within',
        pct
      };
    }).filter(i => i.slaStatus !== 'within');

    res.json({
      summary: {
        total, open, inProgress, resolved,
        closed, escalated, slaBreached,
        avgResolutionHrs: Math.round(avgResolutionHrs * 10) / 10,
        slaCompliance
      },
      slaAlerts: alerts
    });

  } catch (err) {
    console.error('Dashboard error:', err);
    res.status(500).json({ error: 'Failed to load dashboard summary.' });
  }
});

// GET /api/dashboard/recent — recent tickets for table
router.get('/recent', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;

    let query = supabase
      .from('incidents')
      .select(`
        incident_id, ticket_number, priority, status,
        description, caller_name, date_logged, sla_deadline, sla_breached,
        categories(category_name),
        locations(location_name),
        assigned_user:users!incidents_assigned_to_fkey(full_name)
      `)
      .order('date_logged', { ascending: false })
      .limit(limit);

    if (req.user.role === 'caller') {
      query = query.eq('caller_id', req.user.userId);
    } else if (req.user.role === 'technician') {
      query = query.eq('assigned_to', req.user.userId);
    }

    const { data, error } = await query;
    if (error) throw error;

    // Add SLA status to each
    const now = new Date();
    const withSLA = (data || []).map(i => {
      const deadline  = new Date(i.sla_deadline);
      const minsLeft  = Math.round((deadline - now) / 60000);
      const slaLimits = { critical:120, high:240, medium:480, low:1440 };
      const limit     = slaLimits[i.priority];
      const elapsed   = limit - minsLeft;
      const pct       = Math.min(Math.round((elapsed / limit) * 100), 100);
      return {
        ...i,
        slaStatus: i.sla_breached || minsLeft <= 0 ? 'breached'
          : pct >= 75 ? 'approaching' : 'within'
      };
    });

    res.json({ incidents: withSLA });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load recent incidents.' });
  }
});

module.exports = router;
