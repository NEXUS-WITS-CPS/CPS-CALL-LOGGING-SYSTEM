// =====================================================
// INCIDENTS ROUTES — /api/incidents
// =====================================================
const express  = require('express');
const supabase = require('../supabaseClient');
const { authMiddleware, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(authMiddleware);

// ── HELPER: Generate ticket number ──
async function generateTicketNumber() {
  try {
    const year = new Date().getFullYear();
    const { count } = await supabase
      .from('incidents')
      .select('*', { count: 'exact', head: true });
    const nextNum = String((count || 0) + 1).padStart(3, '0');
    return `CLS-${year}-${nextNum}`;
  } catch (e) {
    const rand = String(Math.floor(Math.random() * 900) + 100);
    return `CLS-${new Date().getFullYear()}-${rand}`;
  }
}

// ── HELPER: Calculate SLA deadline ──
function calcSLADeadline(priority, dateLogged) {
  const hours = { critical: 2, high: 4, medium: 8, low: 24 };
  const h = hours[priority] || 24;
  const d = new Date(dateLogged);
  d.setHours(d.getHours() + h);
  return d.toISOString();
}

// ── HELPER: Write audit trail ──
async function writeAudit(incidentId, userId, action, oldVal, newVal) {
  try {
    await supabase.from('audit_trail').insert({
      incident_id:        incidentId,
      performed_by:       userId,
      action_description: action,
      old_value:          oldVal || null,
      new_value:          newVal || null
    });
  } catch (e) {
    console.error('Audit write failed:', e.message);
  }
}

// =====================================================
// UC1 — LOG INCIDENT
// POST /api/incidents
// =====================================================
router.post('/', async (req, res) => {
  try {
    const {
      callerName, callerContact,
      categoryId, locationId,
      priority, description, additionalNotes
    } = req.body;

    console.log('Log incident request:', { callerName, categoryId, locationId, priority });

    // Validation
    if (!callerName || !callerContact || !categoryId || !locationId || !priority || !description) {
      return res.status(400).json({ error: 'All required fields must be completed.' });
    }
    if (description.trim().length < 10) {
      return res.status(400).json({ error: 'Description must be at least 10 characters.' });
    }
    const validPriorities = ['low','medium','high','critical'];
    if (!validPriorities.includes(priority)) {
      return res.status(400).json({ error: 'Invalid priority level.' });
    }

    const ticketNumber = await generateTicketNumber();
    const now = new Date().toISOString();
    const slaDeadline = calcSLADeadline(priority, now);

    console.log('Generated ticket:', ticketNumber);

    // Insert incident
    const { data: incident, error } = await supabase
      .from('incidents')
      .insert({
        ticket_number:    ticketNumber,
        caller_id:        req.user.userId,
        logged_by:        req.user.userId,
        category_id:      parseInt(categoryId),
        location_id:      parseInt(locationId),
        priority:         priority,
        status:           'open',
        description:      description.trim(),
        caller_name:      callerName.trim(),
        caller_contact:   callerContact.trim(),
        additional_notes: additionalNotes || null,
        date_logged:      now,
        sla_deadline:     slaDeadline,
        sla_breached:     false
      })
      .select()
      .single();

    if (error) {
      console.error('Insert error:', error);
      throw error;
    }

    console.log('Incident created:', incident.incident_id);

    // Write audit trail
    await writeAudit(
      incident.incident_id,
      req.user.userId,
      'Ticket Created — Incident logged via CPS Call Logging System',
      null,
      `status: open, priority: ${priority}`
    );

    res.status(201).json({
      message: `Incident logged successfully. Ticket number: ${ticketNumber}`,
      ticketNumber,
      incident
    });

  } catch (err) {
    console.error('Log incident error:', err);
    res.status(500).json({ error: err.message || 'Failed to log incident.' });
  }
});

// =====================================================
// GET /api/incidents — list tickets
// =====================================================
router.get('/', async (req, res) => {
  try {
    const { status, priority } = req.query;

    let query = supabase
      .from('incidents')
      .select(`
        incident_id, ticket_number, priority, status,
        description, caller_name, caller_contact,
        date_logged, sla_deadline, sla_breached,
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

    // Add SLA status
    const now = new Date();
    const slaLimits = { critical:120, high:240, medium:480, low:1440 };
    const withSLA = (data || []).map(i => {
      const deadline = new Date(i.sla_deadline);
      const minsLeft = Math.round((deadline - now) / 60000);
      const limit    = slaLimits[i.priority] || 1440;
      const elapsed  = limit - minsLeft;
      const pct      = Math.min(Math.round((elapsed / limit) * 100), 100);
      return {
        ...i,
        slaStatus: i.sla_breached || minsLeft <= 0 ? 'breached'
          : pct >= 75 ? 'approaching' : 'within'
      };
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
        categories(category_name),
        locations(location_name),
        assigned_user:users!incidents_assigned_to_fkey(full_name),
        resolution_notes(resolution_notes, resolved_at, time_spent_mins)
      `)
      .eq('status', 'pending_confirmation')
      .order('date_resolved', { ascending: false });

    if (req.user.role === 'caller') query = query.eq('caller_id', req.user.userId);
    const { data, error } = await query;
    if (error) throw error;
    res.json({ incidents: data || [] });
  } catch (err) {
    res.status(500).json({ error: 'Failed to retrieve pending confirmations.' });
  }
});

// =====================================================
// GET /api/incidents/:ticketNumber — single ticket
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

    if (req.user.role === 'caller' && incident.caller_id !== req.user.userId) {
      return res.status(403).json({ error: 'You can only view your own tickets.' });
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
    const slaLimits = { critical:2, high:4, medium:8, low:24 };
    const limit = slaLimits[incident.priority] || 24;
    const hoursOpen = (now - new Date(incident.date_logged)) / 3600000;
    const slaStatus = hoursOpen >= limit ? 'breached' : hoursOpen >= limit * 0.75 ? 'approaching' : 'within';

    res.json({
      incident,
      auditTrail:     auditTrail || [],
      resolutionNote: resNotes?.[0] || null,
      sla: {
        status:     slaStatus,
        percentage: Math.min(Math.round((hoursOpen / limit) * 100), 100),
        hoursOpen:  Math.round(hoursOpen * 10) / 10,
        limitHours: limit
      }
    });
  } catch (err) {
    console.error('Get incident error:', err);
    res.status(500).json({ error: 'Failed to retrieve incident.' });
  }
});

// =====================================================
// UC4 — ASSIGN INCIDENT
// =====================================================
router.patch('/:ticketNumber/assign', requireRole('admin','officer'), async (req, res) => {
  try {
    const { assignTo, priority, assignmentNotes } = req.body;
    if (!assignTo) return res.status(400).json({ error: 'Please select an officer.' });

    const { data: incident } = await supabase.from('incidents').select('incident_id, status, assigned_to, priority').eq('ticket_number', req.params.ticketNumber.toUpperCase()).single();
    if (!incident) return res.status(404).json({ error: 'Ticket not found.' });

    const { data: assignee } = await supabase.from('users').select('user_id, full_name').eq('user_id', parseInt(assignTo)).single();
    if (!assignee) return res.status(404).json({ error: 'Officer not found.' });

    const now = new Date().toISOString();
    const { data: updated, error } = await supabase.from('incidents').update({ assigned_to: parseInt(assignTo), status: 'in_progress', priority: priority || incident.priority, date_assigned: now }).eq('ticket_number', req.params.ticketNumber.toUpperCase()).select().single();
    if (error) throw error;

    await writeAudit(incident.incident_id, req.user.userId, `Ticket Assigned — Assigned to ${assignee.full_name} by ${req.user.fullName}`, 'status: open', 'status: in_progress');

    res.json({ message: `Ticket assigned to ${assignee.full_name}.`, incident: updated });
  } catch (err) {
    console.error('Assign error:', err);
    res.status(500).json({ error: err.message || 'Failed to assign incident.' });
  }
});

// =====================================================
// UC5 — RESOLVE INCIDENT
// =====================================================
router.patch('/:ticketNumber/resolve', requireRole('admin','technician','officer'), async (req, res) => {
  try {
    const { resolutionNotes, internalNotes, timeSpent, rootCause } = req.body;
    if (!resolutionNotes || resolutionNotes.trim().length < 20) return res.status(400).json({ error: 'Resolution notes must be at least 20 characters.' });
    if (!timeSpent) return res.status(400).json({ error: 'Please select time spent.' });

    const { data: incident } = await supabase.from('incidents').select('incident_id, status, caller_id, assigned_to').eq('ticket_number', req.params.ticketNumber.toUpperCase()).single();
    if (!incident) return res.status(404).json({ error: 'Ticket not found.' });

    const now = new Date().toISOString();

    await supabase.from('resolution_notes').insert({ incident_id: incident.incident_id, technician_id: req.user.userId, resolution_notes: resolutionNotes.trim(), internal_notes: internalNotes || null, time_spent_mins: parseInt(timeSpent), root_cause: rootCause || null, resolution_status: 'resolved', resolved_at: now });

    const { data: updated, error } = await supabase.from('incidents').update({ status: 'pending_confirmation', date_resolved: now, time_spent_mins: parseInt(timeSpent), root_cause: rootCause || null }).eq('ticket_number', req.params.ticketNumber.toUpperCase()).select().single();
    if (error) throw error;

    await writeAudit(incident.incident_id, req.user.userId, `Incident Resolved by ${req.user.fullName}. Awaiting caller confirmation.`, 'status: in_progress', 'status: pending_confirmation');

    res.json({ message: `Ticket resolved. Caller notified to confirm.`, incident: updated });
  } catch (err) {
    console.error('Resolve error:', err);
    res.status(500).json({ error: err.message || 'Failed to resolve incident.' });
  }
});

// =====================================================
// UC6 — ESCALATE INCIDENT
// =====================================================
router.patch('/:ticketNumber/escalate', requireRole('admin','technician','officer'), async (req, res) => {
  try {
    const { escalationReason, escalateTo, escalationNotes, priorityUpdate } = req.body;
    if (!escalationReason) return res.status(400).json({ error: 'Please select escalation reason.' });
    if (!escalateTo) return res.status(400).json({ error: 'Please select department.' });
    if (!escalationNotes || escalationNotes.trim().length < 15) return res.status(400).json({ error: 'Escalation notes must be at least 15 characters.' });

    const { data: incident } = await supabase.from('incidents').select('incident_id, status, priority').eq('ticket_number', req.params.ticketNumber.toUpperCase()).single();
    if (!incident) return res.status(404).json({ error: 'Ticket not found.' });

    const now = new Date().toISOString();
    const newPriority = priorityUpdate || 'critical';

    await supabase.from('escalations').insert({ incident_id: incident.incident_id, escalated_by: req.user.userId, escalation_reason: escalationReason, escalate_to_dept: escalateTo, escalation_notes: escalationNotes.trim(), new_priority: newPriority, escalated_at: now });

    const { data: updated, error } = await supabase.from('incidents').update({ status: 'escalated', priority: newPriority, sla_breached: true }).eq('ticket_number', req.params.ticketNumber.toUpperCase()).select().single();
    if (error) throw error;

    await writeAudit(incident.incident_id, req.user.userId, `Incident Escalated by ${req.user.fullName} to ${escalateTo}. Reason: ${escalationReason}`, `status: ${incident.status}`, 'status: escalated');

    res.json({ message: `Ticket escalated to ${escalateTo}.`, incident: updated });
  } catch (err) {
    console.error('Escalate error:', err);
    res.status(500).json({ error: err.message || 'Failed to escalate incident.' });
  }
});

// =====================================================
// UC3 — CONFIRM / CLOSE INCIDENT
// =====================================================
router.patch('/:ticketNumber/confirm', async (req, res) => {
  try {
    const { action, satisfactionRating, feedback, rejectionReason } = req.body;
    if (!['accept','reject'].includes(action)) return res.status(400).json({ error: 'Action must be accept or reject.' });
    if (action === 'reject' && !rejectionReason?.trim()) return res.status(400).json({ error: 'Rejection reason is mandatory.' });

    const { data: incident } = await supabase.from('incidents').select('incident_id, status, caller_id, assigned_to').eq('ticket_number', req.params.ticketNumber.toUpperCase()).single();
    if (!incident) return res.status(404).json({ error: 'Ticket not found.' });
    if (incident.status !== 'pending_confirmation') return res.status(400).json({ error: `Ticket is not awaiting confirmation. Status: ${incident.status}` });

    const now = new Date().toISOString();

    await supabase.from('confirmations').insert({ incident_id: incident.incident_id, confirmed_by: req.user.userId, action, satisfaction_rating: satisfactionRating ? parseInt(satisfactionRating) : null, feedback: feedback || null, rejection_reason: action === 'reject' ? rejectionReason.trim() : null, confirmed_at: now });

    if (action === 'accept') {
      await supabase.from('incidents').update({ status: 'closed', date_closed: now }).eq('ticket_number', req.params.ticketNumber.toUpperCase());
      await writeAudit(incident.incident_id, req.user.userId, `Ticket Confirmed and Closed by ${req.user.fullName}`, 'status: pending_confirmation', 'status: closed');
      res.json({ message: `Ticket confirmed and closed. Thank you!` });
    } else {
      await supabase.from('incidents').update({ status: 'open', assigned_to: null, date_resolved: null }).eq('ticket_number', req.params.ticketNumber.toUpperCase());
      await writeAudit(incident.incident_id, req.user.userId, `Resolution Rejected — Reopened by ${req.user.fullName}. Reason: ${rejectionReason.trim()}`, 'status: pending_confirmation', 'status: open');
      res.json({ message: `Ticket reopened. Technician notified.` });
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
    const { data: incident } = await supabase.from('incidents').select('incident_id').eq('ticket_number', req.params.ticketNumber.toUpperCase()).single();
    if (!incident) return res.status(404).json({ error: 'Ticket not found.' });
    const { data: audit, error } = await supabase.from('audit_trail').select('audit_id, action_description, old_value, new_value, action_time, performer:users!audit_trail_performed_by_fkey(full_name)').eq('incident_id', incident.incident_id).order('action_time', { ascending: true });
    if (error) throw error;
    res.json({ auditTrail: audit });
  } catch (err) {
    res.status(500).json({ error: 'Failed to retrieve audit trail.' });
  }
});

module.exports = router;
