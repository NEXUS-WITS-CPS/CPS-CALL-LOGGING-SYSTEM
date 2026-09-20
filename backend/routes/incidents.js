// =====================================================
// INCIDENTS ROUTES — /api/incidents
// Status lifecycle:  open → in_progress → pending_confirmation → closed
//                    any active status → escalated (manual UC6 or automatic on SLA breach)
// =====================================================
const express  = require('express');
const supabase = require('../supabaseClient');
const { authMiddleware, requireRole } = require('../middleware/auth');
const { notify, activeUserIds } = require('../lib/notify');
const { runSlaCheck } = require('../lib/sla');

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
    .select('incident_id, ticket_number, status, priority, caller_id, logged_by, assigned_to, sla_deadline')
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
    const { callerName, callerContact, categoryId, locationId, priority, description, additionalNotes } = req.body;

    if (!callerName || !callerContact || !categoryId || !locationId || !priority || !description) {
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
        description, caller_name, caller_contact,
        date_logged, date_assigned, date_resolved, date_closed,
        sla_deadline, sla_breached, assigned_to,
        categories(category_name),
        locations(location_name),
        assigned_user:users!incidents_assigned_to_fkey(user_id, full_name)
      `)
      .order('date_logged', { ascending: false });

    if (req.user.role === 'caller') query = query.eq('caller_id', req.user.userId);
    else if (req.user.role === 'technician') query = query.eq('assigned_to', req.user.userId);

    if (status && status !== 'all') query = query.eq('status', status);
    if (priority && priority !== 'all') query = query.eq('priority', priority);

    const { data, error } = await query;
    if (error) throw error;

    const now = new Date();
    const withSLA = (data || []).map(i => {
      const deadline = new Date(i.sla_deadline);
      const limitMins = (SLA_HOURS[i.priority] || 24) * 60;
      const minsLeft = Math.round((deadline - now) / 60000);
      const pct = Math.min(Math.round(((limitMins - minsLeft) / limitMins) * 100), 100);
      return { ...i, slaStatus: i.sla_breached || minsLeft <= 0 ? 'breached' : pct >= 75 ? 'approaching' : 'within' };
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
    const slaStatus = incident.sla_breached || hoursOpen >= limit ? 'breached' : hoursOpen >= limit * 0.75 ? 'approaching' : 'within';

    res.json({
      incident,
      auditTrail: auditTrail || [],
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
router.patch('/:ticketNumber/assign', requireRole('admin', 'officer'), async (req, res) => {
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

    const now = new Date().toISOString();
    const { data: updated, error } = await supabase
      .from('incidents')
      .update({ assigned_to: assignee.user_id, status: 'in_progress', priority: priority || incident.priority, date_assigned: now })
      .eq('ticket_number', incident.ticket_number).select().single();
    if (error) throw error;

    const notes = assignmentNotes && assignmentNotes.trim() ? ` Notes: ${assignmentNotes.trim()}` : '';
    await writeAudit(incident.incident_id, req.user.userId,
      `Ticket Assigned — Assigned to ${assignee.full_name} by ${req.user.fullName}.${notes}`,
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
// UC5 — RESOLVE INCIDENT  (assigned technician/officer, or admin)
// Allowed from: in_progress, escalated
// =====================================================
router.patch('/:ticketNumber/resolve', requireRole('admin', 'technician', 'officer'), async (req, res) => {
  try {
    const { resolutionNotes, internalNotes, timeSpent, rootCause } = req.body;
    if (!resolutionNotes || resolutionNotes.trim().length < 20) return res.status(400).json({ error: 'Resolution notes must be at least 20 characters.' });
    if (!timeSpent || !Number.isInteger(parseInt(timeSpent))) return res.status(400).json({ error: 'Please select time spent.' });

    const incident = await loadIncident(req.params.ticketNumber);
    if (!incident) return res.status(404).json({ error: 'Ticket not found.' });
    if (!isAssigneeOrAdmin(req.user, incident)) return res.status(403).json({ error: 'Only the technician assigned to this ticket (or an admin) can resolve it.' });
    const allowed = ['in_progress', 'escalated'];
    if (!allowed.includes(incident.status)) return wrongStatus(res, incident, allowed, 'resolve');

    const now = new Date().toISOString();
    const { error: noteErr } = await supabase.from('resolution_notes').insert({
      incident_id: incident.incident_id, technician_id: req.user.userId,
      resolution_notes: resolutionNotes.trim(), internal_notes: internalNotes || null,
      time_spent_mins: parseInt(timeSpent), root_cause: rootCause || null,
      resolution_status: 'resolved', resolved_at: now
    });
    if (noteErr) throw noteErr;

    const { data: updated, error } = await supabase
      .from('incidents')
      .update({ status: 'pending_confirmation', date_resolved: now, time_spent_mins: parseInt(timeSpent), root_cause: rootCause || null })
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
    const breached = new Date(incident.sla_deadline) < new Date();

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
