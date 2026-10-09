// =====================================================
// DASHBOARD ROUTES — /api/dashboard
// =====================================================
const express  = require('express');
const supabase = require('../supabaseClient');
const { authMiddleware, requireRole } = require('../middleware/auth');
const { runSlaCheck, effectiveDeadline } = require('../lib/sla');

const router = express.Router();
router.use(authMiddleware);

// GET /api/dashboard/operations — management / operations view (admin)
router.get('/operations', requireRole('admin'), async (req, res) => {
  try {
    await runSlaCheck();
    const now = new Date();
    const [{ data: active }, { data: techs }, { data: assets }, { data: sched }, { data: parts }] = await Promise.all([
      supabase.from('incidents').select('ticket_number, priority, status, description, assigned_to, date_logged, sla_deadline, sla_breached, sla_paused_at, assigned_user:users!incidents_assigned_to_fkey(full_name)').in('status', ['open', 'in_progress', 'escalated']),
      supabase.from('users').select('user_id, full_name').eq('role', 'technician').eq('is_active', true),
      supabase.from('assets').select('asset_id, asset_tag, name, status, criticality').neq('status', 'in_service'),
      supabase.from('maintenance_schedules').select('schedule_id, title, next_due, is_active, assets(asset_tag, name)').eq('is_active', true),
      supabase.from('spare_parts_used').select('part_name, quantity, recorded_at')
    ]);

    const list = active || [];
    const atRisk = list.filter(i => ['open', 'in_progress'].includes(i.status) && !i.sla_paused_at && !i.sla_breached).map(i => {
      const total = new Date(i.sla_deadline) - new Date(i.date_logged);
      const minsLeft = Math.round((new Date(i.sla_deadline) - now) / 60000);
      return { ticket_number: i.ticket_number, priority: i.priority, status: i.status, description: i.description, minsLeft, usedPct: total > 0 ? Math.min(100, Math.round(((now - new Date(i.date_logged)) / total) * 100)) : 100 };
    }).sort((a, b) => b.usedPct - a.usedPct).slice(0, 8);

    const workload = (techs || []).map(t => {
      const mine = list.filter(i => i.assigned_to === t.user_id);
      return { userId: t.user_id, fullName: t.full_name, active: mine.length, paused: mine.filter(i => i.sla_paused_at).length, escalated: mine.filter(i => i.status === 'escalated').length };
    }).sort((a, b) => b.active - a.active);

    const today = now.toISOString().slice(0, 10);
    const in7 = new Date(now.getTime() + 7 * 86400000).toISOString().slice(0, 10);
    const sc = sched || [];
    const maintenance = { overdue: sc.filter(x => x.next_due < today).length, dueSoon: sc.filter(x => x.next_due >= today && x.next_due <= in7).length, total: sc.length };

    const since = now.getTime() - 30 * 86400000;
    const tally = {};
    (parts || []).filter(p => new Date(p.recorded_at).getTime() >= since).forEach(p => { tally[p.part_name] = (tally[p.part_name] || 0) + (p.quantity || 1); });
    const topParts = Object.entries(tally).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([name, qty]) => ({ name, qty }));

    res.json({
      tickets: { active: list.length, breached: list.filter(i => i.sla_breached).length, paused: list.filter(i => i.sla_paused_at).length, unassigned: list.filter(i => i.status === 'open').length },
      atRisk, workload, equipmentOut: assets || [], maintenance, topParts
    });
  } catch (err) {
    console.error('Operations dashboard error:', err);
    res.status(500).json({ error: 'Failed to load the operations dashboard.' });
  }
});

// GET /api/dashboard/summary — KPI stats for dashboard
router.get('/summary', async (req, res) => {
  try {
    await runSlaCheck();   // escalate overdue tickets first so the numbers are current
    let query = supabase.from('incidents').select('status, priority, sla_breached, date_logged, date_resolved, reassign_count');

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
    // Every status gets a bucket so the dashboard cards add up to the total:
    // open + inProgress + escalated + pendingConfirmation + resolvedClosed + cancelled = total
    const pendingConfirmation = incidents.filter(i => i.status === 'pending_confirmation').length;
    const resolvedClosed      = incidents.filter(i => ['resolved','closed'].includes(i.status)).length;
    const cancelled           = incidents.filter(i => i.status === 'cancelled').length;
    // Re-assigned is NOT a status: it counts still-active tickets that have been assigned more than once
    const reassigned          = incidents.filter(i => i.reassign_count > 0 && ['open','in_progress','escalated'].includes(i.status)).length;
    const slaBreached = incidents.filter(i => i.sla_breached).length;

    // Avg resolution time in hours
    const resolvedWithTime = incidents.filter(i => i.date_resolved && i.date_logged);
    const avgResolutionHrs = resolvedWithTime.length > 0
      ? resolvedWithTime.reduce((sum, i) => {
          return sum + (new Date(i.date_resolved) - new Date(i.date_logged)) / 3600000;
        }, 0) / resolvedWithTime.length
      : 0;

    // SLA compliance %
    // Same definition as the technician report: of the tickets that have been resolved
    // (resolved / awaiting confirmation / closed), the % that never breached their SLA.
    const resolvedList  = incidents.filter(i => ['resolved','pending_confirmation','closed'].includes(i.status));
    const resolvedTotal = resolvedList.length;
    const slaCompliance = resolvedTotal > 0
      ? Math.round((resolvedList.filter(i => !i.sla_breached).length / resolvedTotal) * 100)
      : 100;

    // SLA alerts — breached or approaching
    let alertQuery = supabase
      .from('incidents')
      .select(`
        ticket_number, priority, status, sla_deadline, sla_breached, sla_paused_at,
        description, categories(category_name)
      `)
      .in('status', ['open','in_progress'])
      .is('sla_paused_at', null)          // paused clocks are not at risk
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
        pendingConfirmation, resolvedClosed, cancelled, reassigned,
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
    await runSlaCheck();
    const limit = parseInt(req.query.limit) || 10;

    let query = supabase
      .from('incidents')
      .select(`
        incident_id, ticket_number, priority, status, logged_by, assigned_to, reassign_count,
        description, caller_name, date_logged, sla_deadline, sla_breached, sla_paused_at,
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
      const deadline  = effectiveDeadline(i, now);
      const minsLeft  = Math.round((deadline - now) / 60000);
      const slaLimits = { critical:120, high:240, medium:480, low:1440 };
      const limit     = slaLimits[i.priority];
      const elapsed   = limit - minsLeft;
      const pct       = Math.min(Math.round((elapsed / limit) * 100), 100);
      return {
        ...i,
        slaStatus: i.sla_paused_at ? 'paused' : i.sla_breached || minsLeft <= 0 ? 'breached'
          : pct >= 75 ? 'approaching' : 'within'
      };
    });

    res.json({ incidents: withSLA });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load recent incidents.' });
  }
});

module.exports = router;
