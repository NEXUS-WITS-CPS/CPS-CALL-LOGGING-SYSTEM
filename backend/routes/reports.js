// =====================================================
// REPORTS ROUTES — /api/reports
// R1 Resolution Time · R2 Call Volume
// R3 Priority Analysis · R4 Incident History
// R5 Technician Performance · R6 SLA Compliance
// =====================================================
const express  = require('express');
const supabase = require('../supabaseClient');
const { authMiddleware, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(authMiddleware);
router.use(requireRole('admin'));

// ── HELPER: build date filter ──
function dateFilter(query, dateFrom, dateTo) {
  if (dateFrom) query = query.gte('date_logged', new Date(dateFrom).toISOString());
  if (dateTo)   query = query.lte('date_logged', new Date(dateTo + 'T23:59:59').toISOString());
  return query;
}

// =====================================================
// R1 — RESOLUTION TIME REPORT
// GET /api/reports/resolution-time
// =====================================================
router.get('/resolution-time', async (req, res) => {
  try {
    const { dateFrom, dateTo, priority } = req.query;

    let query = supabase
      .from('incidents')
      .select(`
        incident_id, ticket_number, priority, status,
        date_logged, date_resolved, sla_deadline, sla_breached,
        time_spent_mins,
        assigned_user:users!incidents_assigned_to_fkey(full_name),
        confirmations(satisfaction_rating)
      `)
      .not('date_resolved', 'is', null)
      .order('date_logged', { ascending: false });

    query = dateFilter(query, dateFrom, dateTo);
    if (priority && priority !== 'all') query = query.eq('priority', priority);

    const { data: incidents, error } = await query;
    if (error) throw error;

    // Group by priority
    const groups = { critical:[], high:[], medium:[], low:[] };
    incidents.forEach(i => { if (groups[i.priority]) groups[i.priority].push(i); });

    // Calculate averages per priority
    const summary = Object.entries(groups).map(([pri, items]) => {
      const withTime = items.filter(i => i.date_resolved);
      const avgHours = withTime.length > 0
        ? withTime.reduce((s, i) =>
            s + (new Date(i.date_resolved) - new Date(i.date_logged)) / 3600000, 0)
          / withTime.length : 0;
      const slaLimits = { critical:2, high:4, medium:8, low:24 };
      const met = items.filter(i => !i.sla_breached).length;
      return {
        priority: pri,
        count: items.length,
        avgResolutionHours: Math.round(avgHours * 10) / 10,
        slaLimit: slaLimits[pri],
        slaMet: met,
        slaBreached: items.length - met,
        slaCompliancePct: items.length > 0
          ? Math.round((met / items.length) * 100) : 100
      };
    });

    // KPIs
    const allResolved = incidents.filter(i => i.date_resolved);
    const overallAvg = allResolved.length > 0
      ? allResolved.reduce((s, i) =>
          s + (new Date(i.date_resolved) - new Date(i.date_logged)) / 3600000, 0)
        / allResolved.length : 0;

    res.json({
      summary,
      kpis: {
        totalResolved:      incidents.length,
        overallAvgHours:    Math.round(overallAvg * 10) / 10,
        totalSLABreached:   incidents.filter(i => i.sla_breached).length,
        overallCompliance:  incidents.length > 0
          ? Math.round((incidents.filter(i => !i.sla_breached).length / incidents.length) * 100) : 100
      },
      incidents // for drill-down
    });

  } catch (err) {
    console.error('R1 error:', err);
    res.status(500).json({ error: 'Failed to generate Resolution Time Report.' });
  }
});

// =====================================================
// R2 — CALL VOLUME REPORT
// GET /api/reports/call-volume
// =====================================================
router.get('/call-volume', async (req, res) => {
  try {
    const { dateFrom, dateTo } = req.query;

    let query = supabase
      .from('incidents')
      .select(`
        incident_id, ticket_number, priority, status,
        date_logged, categories(category_name),
        locations(location_name)
      `)
      .order('date_logged', { ascending: false });

    query = dateFilter(query, dateFrom, dateTo);
    const { data: incidents, error } = await query;
    if (error) throw error;

    // Group by week
    const weekGroups = {};
    incidents.forEach(i => {
      const d = new Date(i.date_logged);
      const monday = new Date(d);
      monday.setDate(d.getDate() - d.getDay() + 1);
      const wk = monday.toISOString().split('T')[0];
      if (!weekGroups[wk]) weekGroups[wk] = [];
      weekGroups[wk].push(i);
    });

    const byWeek = Object.entries(weekGroups)
      .sort(([a],[b]) => a.localeCompare(b))
      .map(([week, items]) => ({
        weekStart: week,
        count: items.length,
        incidents: items
      }));

    // Group by category
    const catGroups = {};
    incidents.forEach(i => {
      const cat = i.categories?.category_name || 'Other';
      if (!catGroups[cat]) catGroups[cat] = [];
      catGroups[cat].push(i);
    });

    const byCategory = Object.entries(catGroups)
      .sort(([,a],[,b]) => b.length - a.length)
      .map(([category, items]) => ({
        category,
        count: items.length,
        pct: Math.round((items.length / incidents.length) * 100),
        incidents: items
      }));

    // Group by location
    const locGroups = {};
    incidents.forEach(i => {
      const loc = i.locations?.location_name || 'Other';
      if (!locGroups[loc]) locGroups[loc] = [];
      locGroups[loc].push(i);
    });

    const byLocation = Object.entries(locGroups)
      .sort(([,a],[,b]) => b.length - a.length)
      .slice(0, 6)
      .map(([location, items]) => ({
        location,
        count: items.length,
        incidents: items
      }));

    res.json({
      kpis: { total: incidents.length, weeks: byWeek.length },
      byWeek,
      byCategory,
      byLocation,
      incidents
    });

  } catch (err) {
    console.error('R2 error:', err);
    res.status(500).json({ error: 'Failed to generate Call Volume Report.' });
  }
});

// =====================================================
// R3 — PRIORITY ANALYSIS REPORT
// GET /api/reports/priority-analysis
// =====================================================
router.get('/priority-analysis', async (req, res) => {
  try {
    const { dateFrom, dateTo } = req.query;

    let query = supabase
      .from('incidents')
      .select(`
        incident_id, ticket_number, priority, status,
        date_logged, sla_breached,
        categories(category_name),
        locations(location_name),
        assigned_user:users!incidents_assigned_to_fkey(full_name)
      `)
      .order('date_logged', { ascending: false });

    query = dateFilter(query, dateFrom, dateTo);
    const { data: incidents, error } = await query;
    if (error) throw error;

    const total = incidents.length;

    // By priority
    const priorities = ['critical','high','medium','low'];
    const byPriority = priorities.map(p => {
      const items = incidents.filter(i => i.priority === p);
      return {
        priority: p,
        count: items.length,
        pct: total > 0 ? Math.round((items.length / total) * 100) : 0,
        incidents: items
      };
    });

    // By location (hotspots)
    const locGroups = {};
    incidents.forEach(i => {
      const loc = i.locations?.location_name || 'Other';
      if (!locGroups[loc]) locGroups[loc] = [];
      locGroups[loc].push(i);
    });

    const byLocation = Object.entries(locGroups)
      .sort(([,a],[,b]) => b.length - a.length)
      .slice(0, 8)
      .map(([location, items]) => ({
        location,
        count: items.length,
        pct: total > 0 ? Math.round((items.length / total) * 100) : 0,
        criticalCount: items.filter(i => i.priority === 'critical').length,
        incidents: items
      }));

    res.json({
      kpis: {
        total,
        criticalPct: total > 0
          ? Math.round((incidents.filter(i => i.priority === 'critical').length / total) * 100) : 0,
        slaBreachedTotal: incidents.filter(i => i.sla_breached).length
      },
      byPriority,
      byLocation,
      incidents
    });

  } catch (err) {
    console.error('R3 error:', err);
    res.status(500).json({ error: 'Failed to generate Priority Analysis Report.' });
  }
});

// =====================================================
// R4 — INCIDENT HISTORY REPORT
// GET /api/reports/incident-history
// =====================================================
router.get('/incident-history', async (req, res) => {
  try {
    const { dateFrom, dateTo, status, priority } = req.query;

    let query = supabase
      .from('incidents')
      .select(`
        incident_id, ticket_number, priority, status,
        description, caller_name, caller_contact,
        date_logged, date_assigned, date_resolved, date_closed,
        sla_deadline, sla_breached, time_spent_mins, root_cause,
        categories(category_name),
        locations(location_name),
        assigned_user:users!incidents_assigned_to_fkey(full_name),
        confirmations(satisfaction_rating, action, confirmed_at)
      `)
      .order('date_logged', { ascending: false });

    query = dateFilter(query, dateFrom, dateTo);
    if (status && status !== 'all') query = query.eq('status', status);
    if (priority && priority !== 'all') query = query.eq('priority', priority);

    const { data: incidents, error } = await query;
    if (error) throw error;

    const statusCounts = {
      total:      incidents.length,
      open:       incidents.filter(i => i.status === 'open').length,
      inProgress: incidents.filter(i => i.status === 'in_progress').length,
      resolved:   incidents.filter(i => ['resolved','pending_confirmation'].includes(i.status)).length,
      closed:     incidents.filter(i => i.status === 'closed').length,
      escalated:  incidents.filter(i => i.status === 'escalated').length,
      cancelled:  incidents.filter(i => i.status === 'cancelled').length,
    };

    res.json({ statusCounts, incidents });

  } catch (err) {
    console.error('R4 error:', err);
    res.status(500).json({ error: 'Failed to generate Incident History Report.' });
  }
});

// =====================================================
// R5 — TECHNICIAN PERFORMANCE REPORT
// GET /api/reports/technician-performance
// GET /api/reports/technician-performance/:userId (drill-down)
// =====================================================
router.get('/technician-performance', async (req, res) => {
  try {
    const { dateFrom, dateTo } = req.query;

    // Get all technicians
    const { data: techs } = await supabase
      .from('users')
      .select('user_id, full_name, email')
      .in('role', ['technician','officer'])
      .eq('is_active', true)
      .order('full_name');

    // Get all assigned incidents
    let query = supabase
      .from('incidents')
      .select(`
        incident_id, ticket_number, priority, status,
        date_logged, date_resolved, sla_breached,
        assigned_to, time_spent_mins,
        confirmations(satisfaction_rating)
      `)
      .not('assigned_to', 'is', null);

    query = dateFilter(query, dateFrom, dateTo);
    const { data: incidents } = await query;

    // Build performance per technician
    const performance = (techs || []).map(tech => {
      const myIncidents = (incidents || []).filter(i => i.assigned_to === tech.user_id);
      const resolved    = myIncidents.filter(i => ['resolved','pending_confirmation','closed'].includes(i.status));
      const withTime    = resolved.filter(i => i.date_resolved);
      const avgHrs      = withTime.length > 0
        ? withTime.reduce((s, i) =>
            s + (new Date(i.date_resolved) - new Date(i.date_logged)) / 3600000, 0)
          / withTime.length : 0;
      const ratings     = myIncidents
        .flatMap(i => i.confirmations || [])
        .filter(c => c.satisfaction_rating)
        .map(c => c.satisfaction_rating);
      const avgRating   = ratings.length > 0
        ? Math.round((ratings.reduce((s, r) => s + r, 0) / ratings.length) * 10) / 10 : null;
      const slaMet      = resolved.filter(i => !i.sla_breached).length;
      const compliance  = resolved.length > 0
        ? Math.round((slaMet / resolved.length) * 100) : 100;
      const workload    = myIncidents.filter(i => ['open','in_progress'].includes(i.status)).length;

      return {
        userId:          tech.user_id,
        fullName:        tech.full_name,
        email:           tech.email,
        totalAssigned:   myIncidents.length,
        totalResolved:   resolved.length,
        avgResolutionHrs: Math.round(avgHrs * 10) / 10,
        slaCompliancePct: compliance,
        avgRating,
        activeTickets:   workload,
        availability:    workload === 0 ? 'available' : workload <= 2 ? 'moderate' : 'busy'
      };
    });

    res.json({ performance });

  } catch (err) {
    console.error('R5 error:', err);
    res.status(500).json({ error: 'Failed to generate Technician Performance Report.' });
  }
});

// R5 Drill-down — individual technician ticket history
router.get('/technician-performance/:userId', async (req, res) => {
  try {
    const { data: incidents, error } = await supabase
      .from('incidents')
      .select(`
        incident_id, ticket_number, priority, status,
        description, date_logged, date_resolved,
        sla_deadline, sla_breached, time_spent_mins,
        categories(category_name),
        locations(location_name),
        confirmations(satisfaction_rating, action, confirmed_at)
      `)
      .eq('assigned_to', req.params.userId)
      .order('date_logged', { ascending: false });

    if (error) throw error;

    const { data: tech } = await supabase
      .from('users')
      .select('user_id, full_name, email')
      .eq('user_id', req.params.userId)
      .single();

    res.json({ technician: tech, incidents });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load technician history.' });
  }
});

// =====================================================
// R6 — SLA COMPLIANCE & MILESTONE REPORT
// GET /api/reports/sla-performance
// Success / breach %, monthly compliance, and per-technician response,
// travel and repair times taken from the SLA tracking timestamps.
// =====================================================
router.get('/sla-performance', async (req, res) => {
  try {
    const { dateFrom, dateTo } = req.query;
    let query = supabase.from('incidents').select(`
        ticket_number, priority, status, date_logged, date_assigned, date_accepted, date_arrived,
        date_repair_started, date_resolved, sla_breached, sla_paused_total_mins, assigned_to,
        assigned_user:users!incidents_assigned_to_fkey(full_name)`);
    query = dateFilter(query, dateFrom, dateTo);
    const { data } = await query;
    const all = (data || []).filter(i => i.status !== 'cancelled');

    const pct = (n, d) => d ? Math.round((n / d) * 100) : 100;
    const mins = (a, b) => (a && b) ? Math.max(0, Math.round((new Date(b) - new Date(a)) / 60000)) : null;
    const avg = arr => { const v = arr.filter(x => x !== null); return v.length ? Math.round(v.reduce((s, x) => s + x, 0) / v.length) : null; };

    const breached = all.filter(i => i.sla_breached).length;
    const overall = { total: all.length, met: all.length - breached, breached,
                      successPct: pct(all.length - breached, all.length), breachPct: all.length ? 100 - pct(all.length - breached, all.length) : 0 };

    const byMonth = {};
    all.forEach(i => { const k = new Date(i.date_logged).toISOString().slice(0, 7); (byMonth[k] = byMonth[k] || []).push(i); });
    const monthly = Object.keys(byMonth).sort().map(k => {
      const b = byMonth[k].filter(i => i.sla_breached).length;
      return { month: k, total: byMonth[k].length, breached: b, compliancePct: pct(byMonth[k].length - b, byMonth[k].length) };
    });

    const byTech = {};
    all.filter(i => i.assigned_to).forEach(i => { (byTech[i.assigned_to] = byTech[i.assigned_to] || { name: i.assigned_user?.full_name || 'Unknown', items: [] }).items.push(i); });
    const technicians = Object.keys(byTech).map(id => {
      const { name, items } = byTech[id]; const b = items.filter(i => i.sla_breached).length;
      return {
        userId: Number(id), fullName: name, tickets: items.length, breached: b, compliancePct: pct(items.length - b, items.length),
        avgResponseMins: avg(items.map(i => mins(i.date_assigned, i.date_accepted))),
        avgTravelMins:   avg(items.map(i => mins(i.date_accepted, i.date_arrived))),
        avgRepairMins:   avg(items.map(i => mins(i.date_repair_started, i.date_resolved))),
        pausedMins: items.reduce((s, i) => s + (i.sla_paused_total_mins || 0), 0)
      };
    }).sort((a, b) => a.fullName.localeCompare(b.fullName));

    const byPriority = ['critical', 'high', 'medium', 'low'].map(p => {
      const items = all.filter(i => i.priority === p); const b = items.filter(i => i.sla_breached).length;
      return { priority: p, total: items.length, breached: b, compliancePct: pct(items.length - b, items.length) };
    });

    res.json({ overall, monthly, technicians, byPriority });
  } catch (err) {
    console.error('R6 error:', err);
    res.status(500).json({ error: 'Failed to generate SLA report.' });
  }
});

module.exports = router;
