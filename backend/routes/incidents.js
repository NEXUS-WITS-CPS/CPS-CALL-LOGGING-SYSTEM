// =====================================================
// INCIDENTS ROUTES — /api/incidents
// Status lifecycle:  open → in_progress → pending_confirmation → closed
//                    any active status → escalated (manual UC6 or automatic on SLA breach)
// =====================================================
const express  = require('express');
const supabase = require('../supabaseClient');
const { authMiddleware, requireRole } = require('../middleware/auth');
const { notify, activeUserIds } = require('../lib/notify');
const { runSlaCheck, effectiveDeadline } = require('../lib/sla');

const router = express.Router();
router.use(authMiddleware);

const SLA_HOURS = { critical: 2, high: 4, medium: 8, low: 24 };
const VALID_PRIORITIES = ['low', 'medium', 'high', 'critical'];

// ── HELPER: Generate ticket number (CLS-YYYY-NNN) ──
async function generateTicketNumber() {
  const year = new Date().getFullYear();
  const { data } = await supabase
    .from('incidents')
    .select('ticket_number')
    .order('incident_id', { ascending: false })
    .limit(1);

  let nextNum = 1;
  if (data && data.length > 0) {
    const parts = data[0].ticket_number.split('-');
    nextNum = (parseInt(parts[parts.length - 1]) || 0) + 1;
  }
  return `CLS-${year}-${String(nextNum).padStart(3, '0')}`;
}

function calcSLADeadline(priority, dateLogged) {
  const d = new Date(dateLogged);
  d.setHours(d.getHours() + (SLA_HOURS[priority] || 24));
  return d.toISOString();
}

async function writeAudit(incidentId, userId, action, oldVal, newVal) {
  try {
    await supabase.from('audit_trail').insert({
      incident_id: incidentId, performed_by: userId,
      action_description: action, old_value: oldVal || null, new_value: newVal || null
    });
  } catch (e) { console.error('Audit write failed:', e.message); }
}

// ── HELPER: load the fields the permission checks need ──
async function loadIncident(ticketNumber) {
  const { data } = await supabase
    .from('incidents')
    .select('incident_id, ticket_number, status, priority, caller_id, logged_by, assigned_to, sla_deadline, date_assigned, reassign_count, sla_paused_at, sla_paused_total_mins')
    .eq('ticket_number', String(ticketNumber).toUpperCase())
    .single();
  return data || null;
}

// ── HELPER: who may see / act on a ticket ──
//  admin & officer: all tickets · technician: only tickets assigned to them · caller: only their own
function canView(user, inc) {
  if (user.role === 'admin' || user.role === 'officer') return true;
  if (user.role === 'technician') return inc.assigned_to === user.userId;
  if (user.role === 'caller') return inc.caller_id === user.userId;
  return false;
}
// resolve / escalate: admin on any ticket; everyone else only on tickets assigned to them
function isAssigneeOrAdmin(user, inc) {
  return user.role === 'admin' || inc.assigned_to === user.userId;
}
function wrongStatus(res, inc, allowed, verb) {
  return res.status(409).json({
    error: `Cannot ${verb} a ticket that is "${inc.status}". Allowed status: ${allowed.join(' or ')}.`
  });
}

// =====================================================
// UC1 — LOG INCIDENT  POST /api/incidents
// =====================================================
router.post('/', requireRole('admin', 'officer'), async (req, res) => {
  try {
    const { callerContact, categoryId, locationId, priority, description, additionalNotes } = req.body;
    // The caller/reporter is always the signed-in officer logging the ticket —
    // never trust a client-supplied name for this. The UI reflects this by
    // making the "Reported By" field read-only and auto-filled; this is the
    // server-side guarantee that holds even if that check is bypassed.
    const callerName = req.user.fullName;

    if (!callerContact || !categoryId || !locationId || !priority || !description) {
      return res.status(400).json({ error: 'All required fields must be completed.' });
    }
    if (!Number.isInteger(parseInt(categoryId)) || !Number.isInteger(parseInt(locationId))) {
      return res.status(400).json({ error: 'Please select a valid category and location.' });
    }
    if (description.trim().length < 10) {
      return res.status(400).json({ error: 'Description must be at least 10 characters.' });
    }
    if (!VALID_PRIORITIES.includes(priority)) {
      return res.status(400).json({ error: 'Invalid priority level.' });
    }
    if (!/^[0-9+()\s-]{7,20}$/.test(callerContact.trim())) {
      return res.status(400).json({ error: 'Contact number may only contain digits, spaces, + ( ) and -, and must be 7–20 characters.' });
    }

    const now = new Date().toISOString();
    const slaDeadline = calcSLADeadline(priority, now);

    // Retry if two officers log at the same moment and get the same ticket number
    let incident = null, lastError = null;
    for (let attempt = 0; attempt < 4 && !incident; attempt++) {
      const ticketNumber = await generateTicketNumber();
      const { data, error } = await supabase
        .from('incidents')
        .insert({
          ticket_number: ticketNumber, caller_id: req.user.userId, logged_by: req.user.userId,
          category_id: parseInt(categoryId), location_id: parseInt(locationId),
          priority, status: 'open', description: description.trim(),
          caller_name: callerName.trim(), caller_contact: callerContact.trim(),
          additional_notes: additionalNotes || null,
          date_logged: now, sla_deadline: slaDeadline, sla_breached: false
        })
        .select().single();
      if (!error) incident = data;
      else if (error.code === '23505') lastError = error;   // duplicate ticket number → try again
      else throw error;
    }
    if (!incident) throw lastError || new Error('Could not generate a unique ticket number.');

    await writeAudit(incident.incident_id, req.user.userId,
      'Ticket Created — Incident logged via CPS Call Logging System', null, `status: open, priority: ${priority}`);

    const admins = await activeUserIds(['admin']);
    await notify(incident.incident_id, admins, 'ticket_logged',
      `New ${priority} priority incident ${incident.ticket_number} logged by ${req.user.fullName}.`);

    res.status(201).json({
      message: `Incident logged successfully. Ticket number: ${incident.ticket_number}`,
      ticketNumber: incident.ticket_number, incident
    });
  } catch (err) {
    console.error('Log incident error:', err);
    res.status(500).json({ error: err.message || 'Failed to log incident.' });
  }
});

// =====================================================
// GET /api/incidents — list tickets (role-filtered)
// =====================================================
router.get('/', async (req, res) => {
  try {
    await runSlaCheck();   // makes sure overdue tickets are escalated before we list them
    const { status, priority } = req.query;

    let query = supabase
      .from('incidents')
      .select(`
        incident_id, ticket_number, priority, status,
        description, caller_name, caller_contact, logged_by,
        date_logged, date_assigned, date_resolved, date_closed,
        sla_deadline, sla_breached, assigned_to, reassign_count, sla_paused_at, sla_pause_reason,
        date_accepted, date_arrived, date_repair_started,
        categories(category_name),
        locations(location_name),
        assigned_user:users!incidents_assigned_to_fkey(user_id, full_name)
      `)
      .order('date_logged', { ascending: false });

    if (req.user.role === 'caller') query = query.eq('caller_id', req.user.userId);
    else if (req.user.role === 'technician') query = query.eq('assigned_to', req.user.userId);
    else if (req.user.role === 'officer') query = query.eq('logged_by', req.user.userId);

    if (status && status !== 'all') query = query.eq('status', status);
    if (priority && priority !== 'all') query = query.eq('priority', priority);

    const { data, error } = await query;
    if (error) throw error;

    const now = new Date();
    const withSLA = (data || []).map(i => {
      const deadline = effectiveDeadline(i, now);
      const limitMins = (SLA_HOURS[i.priority] || 24) * 60;
      const minsLeft = Math.round((deadline - now) / 60000);
      const pct = Math.min(Math.round(((limitMins - minsLeft) / limitMins) * 100), 100);
      return { ...i, slaStatus: i.sla_paused_at ? 'paused' : i.sla_breached || minsLeft <= 0 ? 'breached' : pct >= 75 ? 'approaching' : 'within' };
    });

    res.json({ incidents: withSLA, total: withSLA.length });
  } catch (err) {
    console.error('Get incidents error:', err);
    res.status(500).json({ error: 'Failed to retrieve incidents.' });
  }
});

// =====================================================
// GET /api/incidents/status/pending-confirmation
// =====================================================
router.get('/status/pending-confirmation', async (req, res) => {
  try {
    let query = supabase
      .from('incidents')
      .select(`
        incident_id, ticket_number, priority, status,
        description, caller_name, date_resolved,
        categories(category_name), locations(location_name),
        assigned_user:users!incidents_assigned_to_fkey(full_name),
        resolution_notes(resolution_notes, resolved_at, time_spent_mins)
      `)
      .eq('status', 'pending_confirmation')
      .order('date_resolved', { ascending: false });

    if (req.user.role === 'caller') query = query.eq('caller_id', req.user.userId);
    else if (req.user.role === 'technician') query = query.eq('assigned_to', req.user.userId);
    const { data, error } = await query;
    if (error) throw error;
    res.json({ incidents: data || [] });
  } catch (err) {
    res.status(500).json({ error: 'Failed to retrieve pending confirmations.' });
  }
});

// =====================================================
// UC2 — TRACK INCIDENT  GET /api/incidents/:ticketNumber
// =====================================================
router.get('/:ticketNumber', async (req, res) => {
  try {
    const { data: incident, error } = await supabase
      .from('incidents')
      .select(`
        *,
        categories(category_name),
        locations(location_name),
        assigned_user:users!incidents_assigned_to_fkey(user_id, full_name, email),
        logged_user:users!incidents_logged_by_fkey(user_id, full_name)
      `)
      .eq('ticket_number', req.params.ticketNumber.toUpperCase())
      .single();

    if (error || !incident) {
      return res.status(404).json({ error: `Ticket ${req.params.ticketNumber} not found.` });
    }
    if (!canView(req.user, incident)) {
      return res.status(403).json({ error: 'You do not have access to this ticket.' });
    }

    const { data: auditTrail } = await supabase
      .from('audit_trail')
      .select('audit_id, action_description, old_value, new_value, action_time, performer:users!audit_trail_performed_by_fkey(full_name)')
      .eq('incident_id', incident.incident_id)
      .order('action_time', { ascending: true });

    const { data: resNotes } = await supabase
      .from('resolution_notes')
      .select('*, technician:users!resolution_notes_technician_id_fkey(full_name)')
      .eq('incident_id', incident.incident_id)
      .order('resolved_at', { ascending: false })
      .limit(1);

    const now = new Date();
    const limit = SLA_HOURS[incident.priority] || 24;
    const hoursOpen = (now - new Date(incident.date_logged)) / 3600000;
    const slaStatus = incident.sla_paused_at ? 'paused' : incident.sla_breached || hoursOpen >= limit ? 'breached' : hoursOpen >= limit * 0.75 ? 'approaching' : 'within';

    // Accountability chain: who did what, and when, taken from the audit trail (latest event of each kind)
    const trail = auditTrail || [];
    const latest = re => [...trail].reverse().find(a => re.test(a.action_description));
    const link = (key, label, re, nameOverride) => {
      const a = latest(re);
      return a ? { key, label, name: nameOverride || a.performer?.full_name || 'System', at: a.action_time } : null;
    };
    const assignEvt = latest(/^Ticket Assigned/);
    const accountability = [
      { key: 'logged', label: 'Logged by', name: incident.logged_user?.full_name || 'Unknown', at: incident.date_logged },
      assignEvt && { key: 'assigned', label: 'Assigned / re-assigned by', name: assignEvt.performer?.full_name || 'System', at: assignEvt.action_time,
                     detail: incident.assigned_user ? `to ${incident.assigned_user.full_name}` : undefined },
      link('escalated', 'Escalated by', /^Incident Escalated/),
      link('resolved', 'Resolved by', /^Incident Resolved/),
      link('rejected', 'Resolution rejected by', /^Resolution Rejected/),
      link('closed', 'Confirmed & closed by', /^Ticket Confirmed and Closed/),
      link('cancelled', 'Cancelled by', /^Ticket Cancelled/)
    ].filter(Boolean);

    // SLA tracking timeline: each milestone, with the gap from the previous one
    const milestones = [
      ['logged', 'Logged', incident.date_logged], ['assigned', 'Assigned', incident.date_assigned],
      ['accepted', 'Accepted by technician', incident.date_accepted], ['arrived', 'Arrived on site', incident.date_arrived],
      ['repair_started', 'Repair started', incident.date_repair_started], ['resolved', 'Completed', incident.date_resolved],
      ['closed', 'Confirmed by user', incident.date_closed]
    ];
    let prev = null;
    const timeline = milestones.map(([key, label, at]) => {
      const gapMins = at && prev ? Math.max(0, Math.round((new Date(at) - new Date(prev)) / 60000)) : null;
      if (at) prev = at;
      return { key, label, at: at || null, gapMins };
    });

    res.json({
      incident,
      auditTrail: trail,
      accountability,
      timeline,
      resolutionNote: resNotes?.[0] || null,
      sla: {
        status: slaStatus,
        percentage: Math.min(Math.round((hoursOpen / limit) * 100), 100),
        hoursOpen: Math.round(hoursOpen * 10) / 10,
        limitHours: limit
      }
    });
  } catch (err) {
    console.error('Get incident error:', err);
    res.status(500).json({ error: 'Failed to retrieve incident.' });
  }
});

// =====================================================
// UC4 — ASSIGN INCIDENT  (admin, officer)
// Allowed from: open, in_progress (re-assign), escalated (re-assign)
// =====================================================
router.patch('/:ticketNumber/assign', requireRole('admin'), async (req, res) => {
  try {
    const { assignTo, priority, assignmentNotes } = req.body;
    if (!assignTo) return res.status(400).json({ error: 'Please select an officer.' });
    if (priority && !VALID_PRIORITIES.includes(priority)) return res.status(400).json({ error: 'Invalid priority level.' });

    const incident = await loadIncident(req.params.ticketNumber);
    if (!incident) return res.status(404).json({ error: 'Ticket not found.' });
    const allowed = ['open', 'in_progress', 'escalated'];
    if (!allowed.includes(incident.status)) return wrongStatus(res, incident, allowed, 'assign');

    const { data: assignee } = await supabase
      .from('users').select('user_id, full_name, role, is_active')
      .eq('user_id', parseInt(assignTo)).single();
    if (!assignee || !assignee.is_active) return res.status(404).json({ error: 'Officer not found.' });
    if (!['technician', 'officer'].includes(assignee.role)) {
      return res.status(400).json({ error: 'Tickets can only be assigned to a technician or officer.' });
    }

    // Re-assigning a ticket that is already with someone: must name a different person and give a reason
    const isReassign = ['in_progress', 'escalated'].includes(incident.status) && !!incident.assigned_to;
    if (isReassign) {
      if (incident.assigned_to === assignee.user_id) {
        return res.status(400).json({ error: `Ticket ${incident.ticket_number} is already assigned to ${assignee.full_name}. Choose a different person.` });
      }
      if (!assignmentNotes || assignmentNotes.trim().length < 5) {
        return res.status(400).json({ error: 'A reason is required when re-assigning a ticket.' });
      }
    }

    const now = new Date().toISOString();
    const { data: updated, error } = await supabase
      .from('incidents')
      .update({ assigned_to: assignee.user_id, status: 'in_progress', priority: priority || incident.priority, date_assigned: now,
                // a ticket that was assigned before (re-assigned, or reopened after a rejected resolution) counts as a re-assignment
                reassign_count: (incident.reassign_count || 0) + (incident.date_assigned ? 1 : 0),
                // a new assignee starts their own accepted / arrived / repair steps (earlier ones stay in the audit trail)
                date_accepted: null, date_arrived: null, date_repair_started: null })
      .eq('ticket_number', incident.ticket_number).select().single();
    if (error) throw error;

    const notes = assignmentNotes && assignmentNotes.trim() ? ` ${isReassign ? 'Reason' : 'Notes'}: ${assignmentNotes.trim()}` : '';
    await writeAudit(incident.incident_id, req.user.userId,
      `Ticket Assigned — ${isReassign ? 'Re-assigned' : 'Assigned'} to ${assignee.full_name} by ${req.user.fullName}.${notes}`,
      `status: ${incident.status}`, 'status: in_progress');
    await notify(incident.incident_id, [assignee.user_id], 'ticket_assigned',
      `Ticket ${incident.ticket_number} (${updated.priority}) has been assigned to you by ${req.user.fullName}.${notes}`);

    res.json({ message: `Ticket assigned to ${assignee.full_name}.`, incident: updated });
  } catch (err) {
    console.error('Assign error:', err);
    res.status(500).json({ error: err.message || 'Failed to assign incident.' });
  }
});

// =====================================================
// WORK PROGRESS  PATCH /:ticketNumber/progress   { step }
// The assigned technician records accepted -> arrived on site -> repair started,
// in that order, so every SLA milestone has a trustworthy timestamp.
// =====================================================
const PROGRESS_STEPS = [
  { step: 'accepted',       col: 'date_accepted',       label: 'Job accepted' },
  { step: 'arrived',        col: 'date_arrived',        label: 'Arrived on site' },
  { step: 'repair_started', col: 'date_repair_started', label: 'Repair started' }
];
router.patch('/:ticketNumber/progress', requireRole('admin', 'technician'), async (req, res) => {
  try {
    const def = PROGRESS_STEPS.find(p => p.step === req.body.step);
    if (!def) return res.status(400).json({ error: 'Unknown step. Use accepted, arrived or repair_started.' });

    const { data: incident } = await supabase.from('incidents')
      .select('incident_id, ticket_number, status, assigned_to, date_accepted, date_arrived, date_repair_started').eq('ticket_number', String(req.params.ticketNumber).toUpperCase()).single();
    if (!incident) return res.status(404).json({ error: 'Ticket not found.' });
    if (!isAssigneeOrAdmin(req.user, incident)) return res.status(403).json({ error: 'Only the technician assigned to this ticket (or an admin) can record progress.' });
    const allowed = ['in_progress', 'escalated'];
    if (!allowed.includes(incident.status)) return wrongStatus(res, incident, allowed, 'record progress on');

    const idx = PROGRESS_STEPS.indexOf(def);
    if (incident[def.col]) return res.status(409).json({ error: `${def.label} has already been recorded for ${incident.ticket_number}.` });
    const missing = PROGRESS_STEPS.slice(0, idx).find(p => !incident[p.col]);
    if (missing) return res.status(409).json({ error: `Record "${missing.label}" first.` });

    const now = new Date().toISOString();
    const { data: updated, error } = await supabase.from('incidents')
      .update({ [def.col]: now }).eq('ticket_number', incident.ticket_number).select().single();
    if (error) throw error;
    await writeAudit(incident.incident_id, req.user.userId, `Work Progress — ${def.label} (recorded by ${req.user.fullName})`, null, `${def.col}: ${now}`);
    res.json({ message: `${def.label} recorded for ${incident.ticket_number}.`, incident: updated });
  } catch (err) {
    console.error('Progress error:', err);
    res.status(500).json({ error: err.message || 'Failed to record progress.' });
  }
});

// =====================================================
// SLA PAUSE / RESUME  (assigned technician, or admin)
// Stops the SLA clock while the ticket waits on something outside CPS
// (parts, a contractor, building access). A reason is mandatory and audited.
// =====================================================
const PAUSE_REASONS = {
  awaiting_parts: 'Awaiting spare parts',
  third_party: 'Waiting on a third party / contractor',
  awaiting_access: 'Awaiting access to the area',
  awaiting_user: 'Awaiting the user / caller',
  other: 'Other'
};

router.patch('/:ticketNumber/sla-pause', requireRole('admin', 'technician'), async (req, res) => {
  try {
    const { reason, notes } = req.body;
    if (!PAUSE_REASONS[reason]) return res.status(400).json({ error: 'Please choose a reason for pausing the SLA.' });
    if (!notes || notes.trim().length < 10) return res.status(400).json({ error: 'Please explain what the ticket is waiting for (min 10 characters).' });

    const incident = await loadIncident(req.params.ticketNumber);
    if (!incident) return res.status(404).json({ error: 'Ticket not found.' });
    if (!isAssigneeOrAdmin(req.user, incident)) return res.status(403).json({ error: 'Only the technician assigned to this ticket (or an admin) can pause its SLA.' });
    if (incident.status !== 'in_progress') return wrongStatus(res, incident, ['in_progress'], 'pause the SLA of');
    if (incident.sla_paused_at) return res.status(409).json({ error: `The SLA for ${incident.ticket_number} is already paused.` });

    const now = new Date().toISOString();
    const reasonText = `${PAUSE_REASONS[reason]} — ${notes.trim()}`;
    const { data: updated, error } = await supabase.from('incidents')
      .update({ sla_paused_at: now, sla_pause_reason: reasonText })
      .eq('ticket_number', incident.ticket_number).is('sla_paused_at', null).select().single();
    if (error) throw error;

    await writeAudit(incident.incident_id, req.user.userId,
      `SLA Paused by ${req.user.fullName}. Reason: ${reasonText}`, 'sla: running', 'sla: paused');
    const admins = await activeUserIds(['admin']);
    await notify(incident.incident_id, admins, 'sla_paused',
      `SLA for ticket ${incident.ticket_number} was paused by ${req.user.fullName}: ${reasonText}`);
    res.json({ message: `SLA paused for ${incident.ticket_number}.`, incident: updated });
  } catch (err) {
    console.error('SLA pause error:', err);
    res.status(500).json({ error: err.message || 'Failed to pause SLA.' });
  }
});

router.patch('/:ticketNumber/sla-resume', requireRole('admin', 'technician'), async (req, res) => {
  try {
    const incident = await loadIncident(req.params.ticketNumber);
    if (!incident) return res.status(404).json({ error: 'Ticket not found.' });
    if (!isAssigneeOrAdmin(req.user, incident)) return res.status(403).json({ error: 'Only the technician assigned to this ticket (or an admin) can resume its SLA.' });
    if (!incident.sla_paused_at) return res.status(409).json({ error: `The SLA for ${incident.ticket_number} is not paused.` });

    const now = new Date();
    const pausedMins = Math.max(0, Math.round((now - new Date(incident.sla_paused_at)) / 60000));
    const { data: updated, error } = await supabase.from('incidents')
      .update({
        sla_deadline: effectiveDeadline(incident, now).toISOString(),   // deadline moves out by the paused time
        sla_paused_at: null, sla_pause_reason: null,
        sla_paused_total_mins: (incident.sla_paused_total_mins || 0) + pausedMins
      })
      .eq('ticket_number', incident.ticket_number).select().single();
    if (error) throw error;

    await writeAudit(incident.incident_id, req.user.userId,
      `SLA Resumed by ${req.user.fullName} after ${pausedMins} min paused. Deadline extended accordingly.`, 'sla: paused', 'sla: running');
    res.json({ message: `SLA resumed for ${incident.ticket_number}. Deadline extended by ${pausedMins} min.`, incident: updated });
  } catch (err) {
    console.error('SLA resume error:', err);
    res.status(500).json({ error: err.message || 'Failed to resume SLA.' });
  }
});

// =====================================================
// UC5 — RESOLVE INCIDENT  (assigned technician/officer, or admin)
// Allowed from: in_progress, escalated
// =====================================================
router.patch('/:ticketNumber/resolve', requireRole('admin', 'technician', 'officer'), async (req, res) => {
  try {
    const { resolutionNotes, internalNotes, rootCause } = req.body;
    if (!resolutionNotes || resolutionNotes.trim().length < 20) return res.status(400).json({ error: 'Resolution notes must be at least 20 characters.' });

    const incident = await loadIncident(req.params.ticketNumber);
    if (!incident) return res.status(404).json({ error: 'Ticket not found.' });
    if (!isAssigneeOrAdmin(req.user, incident)) return res.status(403).json({ error: 'Only the technician assigned to this ticket (or an admin) can resolve it.' });
    const allowed = ['in_progress', 'escalated'];
    if (!allowed.includes(incident.status)) return wrongStatus(res, incident, allowed, 'resolve');

    const now = new Date();
    const nowIso = now.toISOString();
    // Time spent is computed automatically — assigned -> resolved — never trusted from the client.
    const assignedAt = incident.date_assigned ? new Date(incident.date_assigned) : now;
    const timeSpentMins = Math.max(1, Math.round((now - assignedAt) / 60000));

    const { error: noteErr } = await supabase.from('resolution_notes').insert({
      incident_id: incident.incident_id, technician_id: req.user.userId,
      resolution_notes: resolutionNotes.trim(), internal_notes: internalNotes || null,
      time_spent_mins: timeSpentMins, root_cause: rootCause || null,
      resolution_status: 'resolved', resolved_at: nowIso
    });
    if (noteErr) throw noteErr;

    const { data: updated, error } = await supabase
      .from('incidents')
      .update({ status: 'pending_confirmation', date_resolved: nowIso, time_spent_mins: timeSpentMins, root_cause: rootCause || null,
                // resolving a paused ticket ends the pause (the clock is no longer relevant)
                ...(incident.sla_paused_at ? { sla_paused_at: null, sla_pause_reason: null,
                     sla_paused_total_mins: (incident.sla_paused_total_mins || 0) + Math.round((now - new Date(incident.sla_paused_at)) / 60000),
                     sla_deadline: effectiveDeadline(incident, now).toISOString() } : {}) })
      .eq('ticket_number', incident.ticket_number).select().single();
    if (error) throw error;

    await writeAudit(incident.incident_id, req.user.userId,
      `Incident Resolved by ${req.user.fullName}. Awaiting confirmation.`, `status: ${incident.status}`, 'status: pending_confirmation');
    const admins = await activeUserIds(['admin']);
    await notify(incident.incident_id, [incident.logged_by, ...admins], 'ticket_resolved',
      `Ticket ${incident.ticket_number} was resolved by ${req.user.fullName} and awaits confirmation.`);

    res.json({ message: 'Ticket resolved. Awaiting confirmation.', incident: updated });
  } catch (err) {
    console.error('Resolve error:', err);
    res.status(500).json({ error: err.message || 'Failed to resolve incident.' });
  }
});

// =====================================================
// UC6 — ESCALATE INCIDENT — manual path (auto path: lib/sla.js)
// Allowed from: open, in_progress
// =====================================================
router.patch('/:ticketNumber/escalate', requireRole('admin', 'technician', 'officer'), async (req, res) => {
  try {
    const { escalationReason, escalateTo, escalationNotes, priorityUpdate } = req.body;
    if (!escalationReason) return res.status(400).json({ error: 'Please select escalation reason.' });
    if (!escalateTo) return res.status(400).json({ error: 'Please select department.' });
    if (!escalationNotes || escalationNotes.trim().length < 15) return res.status(400).json({ error: 'Escalation notes must be at least 15 characters.' });
    if (priorityUpdate && !VALID_PRIORITIES.includes(priorityUpdate)) return res.status(400).json({ error: 'Invalid priority level.' });

    const incident = await loadIncident(req.params.ticketNumber);
    if (!incident) return res.status(404).json({ error: 'Ticket not found.' });
    if (!isAssigneeOrAdmin(req.user, incident)) return res.status(403).json({ error: 'Only the technician assigned to this ticket (or an admin) can escalate it.' });
    const allowed = ['open', 'in_progress'];
    if (!allowed.includes(incident.status)) return wrongStatus(res, incident, allowed, 'escalate');

    const now = new Date().toISOString();
    const newPriority = priorityUpdate || 'critical';
    const breached = effectiveDeadline(incident) < new Date();

    const { error: escErr } = await supabase.from('escalations').insert({
      incident_id: incident.incident_id, escalated_by: req.user.userId,
      escalation_reason: escalationReason, escalate_to_dept: escalateTo,
      escalation_notes: escalationNotes.trim(), new_priority: newPriority,
      notify_parties: 'Administrators', escalated_at: now
    });
    if (escErr) throw escErr;

    const changes = { status: 'escalated', priority: newPriority };
    if (breached) changes.sla_breached = true;      // only flag a breach if the deadline really passed
    const { data: updated, error } = await supabase
      .from('incidents').update(changes).eq('ticket_number', incident.ticket_number).select().single();
    if (error) throw error;

    await writeAudit(incident.incident_id, req.user.userId,
      `Incident Escalated by ${req.user.fullName} to ${escalateTo}. Reason: ${escalationReason}`,
      `status: ${incident.status}`, 'status: escalated');
    const admins = await activeUserIds(['admin']);
    await notify(incident.incident_id, [...admins, incident.assigned_to], 'ticket_escalated',
      `Ticket ${incident.ticket_number} was escalated to ${escalateTo} by ${req.user.fullName}.`);

    res.json({ message: `Ticket escalated to ${escalateTo}.`, incident: updated });
  } catch (err) {
    console.error('Escalate error:', err);
    res.status(500).json({ error: err.message || 'Failed to escalate incident.' });
  }
});

// =====================================================
// UC3 — CONFIRM / CLOSE INCIDENT  (the officer who logged it, or an admin)
// Allowed from: pending_confirmation
// =====================================================
router.patch('/:ticketNumber/confirm', requireRole('admin', 'officer'), async (req, res) => {
  try {
    const { action, satisfactionRating, feedback, rejectionReason } = req.body;
    if (!['accept', 'reject'].includes(action)) return res.status(400).json({ error: 'Action must be accept or reject.' });
    if (action === 'reject' && !rejectionReason?.trim()) return res.status(400).json({ error: 'Rejection reason is mandatory.' });
    const rating = satisfactionRating ? parseInt(satisfactionRating) : null;
    if (rating !== null && !(rating >= 1 && rating <= 5)) return res.status(400).json({ error: 'Rating must be between 1 and 5.' });

    const incident = await loadIncident(req.params.ticketNumber);
    if (!incident) return res.status(404).json({ error: 'Ticket not found.' });
    if (req.user.role === 'officer' && incident.logged_by !== req.user.userId) {
      return res.status(403).json({ error: 'Only the officer who logged this ticket (or an admin) can confirm or reject the resolution.' });
    }
    if (incident.status !== 'pending_confirmation') return wrongStatus(res, incident, ['pending_confirmation'], 'confirm');

    const now = new Date().toISOString();
    const { error: confErr } = await supabase.from('confirmations').insert({
      incident_id: incident.incident_id, confirmed_by: req.user.userId, action,
      satisfaction_rating: rating, feedback: feedback || null,
      rejection_reason: action === 'reject' ? rejectionReason.trim() : null, confirmed_at: now
    });
    if (confErr) throw confErr;

    if (action === 'accept') {
      await supabase.from('incidents').update({ status: 'closed', date_closed: now }).eq('ticket_number', incident.ticket_number);
      await writeAudit(incident.incident_id, req.user.userId, `Ticket Confirmed and Closed by ${req.user.fullName}`, 'status: pending_confirmation', 'status: closed');
      await notify(incident.incident_id, [incident.assigned_to], 'ticket_closed', `Ticket ${incident.ticket_number} was confirmed and closed by ${req.user.fullName}.`);
      res.json({ message: 'Ticket confirmed and closed. Thank you!' });
    } else {
      await supabase.from('incidents').update({ status: 'open', assigned_to: null, date_resolved: null }).eq('ticket_number', incident.ticket_number);
      await writeAudit(incident.incident_id, req.user.userId, `Resolution Rejected — Reopened by ${req.user.fullName}. Reason: ${rejectionReason.trim()}`, 'status: pending_confirmation', 'status: open');
      const admins = await activeUserIds(['admin']);
      await notify(incident.incident_id, [incident.assigned_to, ...admins], 'ticket_reopened',
        `Ticket ${incident.ticket_number} was reopened: ${rejectionReason.trim()}`);
      res.json({ message: 'Ticket reopened and returned to the open queue.' });
    }
  } catch (err) {
    console.error('Confirm error:', err);
    res.status(500).json({ error: err.message || 'Failed to process confirmation.' });
  }
});

// =====================================================
// CANCEL (SOFT-DELETE) INCIDENT  (admin: any ticket, not already
// closed/cancelled · officer: only a ticket they logged themselves,
// and only while it is still "open" — before a technician has been
// assigned or done any work on it)
// This never removes the row: it sets status='cancelled' so the ticket
// number, audit trail and any resolution history stay intact for
// accountability, it just drops off the active queues.
// =====================================================
router.patch('/:ticketNumber/cancel', requireRole('admin', 'officer'), async (req, res) => {
  try {
    const { reason } = req.body;
    if (!reason || !reason.trim() || reason.trim().length < 5) {
      return res.status(400).json({ error: 'Please give a reason (at least 5 characters) for cancelling this ticket.' });
    }

    const incident = await loadIncident(req.params.ticketNumber);
    if (!incident) return res.status(404).json({ error: 'Ticket not found.' });

    if (['closed', 'cancelled'].includes(incident.status)) {
      return res.status(409).json({ error: `Ticket ${incident.ticket_number} is already ${incident.status} and cannot be cancelled.` });
    }

    if (req.user.role === 'officer') {
      if (incident.logged_by !== req.user.userId) {
        return res.status(403).json({ error: 'You can only cancel tickets you logged yourself.' });
      }
      if (incident.status !== 'open') {
        return res.status(403).json({ error: 'This ticket has already been assigned or actioned — ask an admin to cancel it.' });
      }
    }
    // admin may cancel from any status other than closed/cancelled, checked above.

    const now = new Date().toISOString();
    const { data: updated, error } = await supabase
      .from('incidents')
      .update({ status: 'cancelled', date_closed: now })
      .eq('ticket_number', incident.ticket_number)
      .select().single();
    if (error) throw error;

    await writeAudit(incident.incident_id, req.user.userId,
      `Ticket Cancelled by ${req.user.fullName}. Reason: ${reason.trim()}`,
      `status: ${incident.status}`, 'status: cancelled');

    if (incident.assigned_to) {
      await notify(incident.incident_id, [incident.assigned_to], 'ticket_cancelled',
        `Ticket ${incident.ticket_number} was cancelled by ${req.user.fullName}. Reason: ${reason.trim()}`);
    }

    res.json({ message: `Ticket ${incident.ticket_number} cancelled.`, incident: updated });
  } catch (err) {
    console.error('Cancel error:', err);
    res.status(500).json({ error: err.message || 'Failed to cancel incident.' });
  }
});

// =====================================================
// GET /api/incidents/:ticketNumber/audit
// =====================================================
router.get('/:ticketNumber/audit', async (req, res) => {
  try {
    const incident = await loadIncident(req.params.ticketNumber);
    if (!incident) return res.status(404).json({ error: 'Ticket not found.' });
    if (!canView(req.user, incident)) return res.status(403).json({ error: 'You do not have access to this ticket.' });
    const { data: audit, error } = await supabase
      .from('audit_trail')
      .select('audit_id, action_description, old_value, new_value, action_time, performer:users!audit_trail_performed_by_fkey(full_name)')
      .eq('incident_id', incident.incident_id).order('action_time', { ascending: true });
    if (error) throw error;
    res.json({ auditTrail: audit });
  } catch (err) {
    res.status(500).json({ error: 'Failed to retrieve audit trail.' });
  }
});

module.exports = router;
