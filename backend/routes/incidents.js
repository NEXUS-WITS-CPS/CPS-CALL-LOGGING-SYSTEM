// =====================================================
// INCIDENTS ROUTES — /api/incidents
// UC1 Log · UC2 Track · UC3 Confirm · UC4 Assign
// UC5 Resolve · UC6 Escalate
// =====================================================
const express  = require('express');
const supabase = require('../supabaseClient');
const { authMiddleware, requireRole } = require('../middleware/auth');

const router = express.Router();

// All incident routes require authentication
router.use(authMiddleware);

// ── HELPER: Generate ticket number ──
async function generateTicketNumber() {
  const year = new Date().getFullYear();
  const { count } = await supabase
    .from('incidents')
    .select('*', { count: 'exact', head: true });
  const num = String((count || 0) + 1).padStart(3, '0');
  return `CLS-${year}-${num}`;
}

// ── HELPER: Calculate SLA deadline ──
function calcSLADeadline(priority, dateLogged) {
  const hours = { critical: 2, high: 4, medium: 8, low: 24 };
  const h = hours[priority] || 24;
  const d = new Date(dateLogged);
  d.setHours(d.getHours() + h);
  return d.toISOString();
}

// ── HELPER: Write audit trail entry ──
async function writeAudit(incidentId, userId, action, oldVal, newVal) {
  await supabase.from('audit_trail').insert({
    incident_id:        incidentId,
    performed_by:       userId,
    action_description: action,
    old_value:          oldVal || null,
    new_value:          newVal || null
  });
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

    // Validation
    if (!callerName || !callerContact || !categoryId ||
        !locationId || !priority || !description) {
      return res.status(400).json({ error: 'All required fields must be completed.' });
    }
    if (description.length < 10) {
      return res.status(400).json({ error: 'Description must be at least 10 characters.' });
    }

    const validPriorities = ['low','medium','high','critical'];
    if (!validPriorities.includes(priority)) {
      return res.status(400).json({ error: 'Invalid priority level.' });
    }

    // Generate ticket number
    const ticketNumber = await generateTicketNumber();
    const now = new Date().toISOString();
    const slaDeadline = calcSLADeadline(priority, now);

    // Check for duplicate (same location + category within 1 hour)
    const oneHourAgo = new Date(Date.now() - 3600000).toISOString();
    const { data: duplicate } = await supabase
      .from('incidents')
      .select('ticket_number')
      .eq('location_id', locationId)
      .eq('category_id', categoryId)
      .in('status', ['open','in_progress'])
      .gte('date_logged', oneHourAgo)
      .limit(1);

    // Insert incident
    const { data: incident, error } = await supabase
      .from('incidents')
      .insert({
        ticket_number:    ticketNumber,
        caller_id:        req.user.userId,
        logged_by:        req.user.userId,
        category_id:      parseInt(categoryId),
        location_id:      parseInt(locationId),
        priority,
        status:           'open',
        description,
        caller_name:      callerName,
        caller_contact:   callerContact,
        additional_notes: additionalNotes || null,
        date_logged:      now,
        sla_deadline:     slaDeadline,
        sla_breached:     false
      })
      .select(`
        *,
        categories(category_name),
        locations(location_name)
      `)
      .single();

    if (error) throw error;

    // Write audit trail
    await writeAudit(
      incident.incident_id,
      req.user.userId,
      'Ticket Created — Incident logged via CPS Call Logging System',
      null,
      `status: open, priority: ${priority}`
    );

    res.status(201).json({
      message:        `Incident logged successfully. Ticket number: ${ticketNumber}`,
      ticketNumber,
      incident,
      duplicateWarning: duplicate?.length > 0
        ? `Warning: Similar incident ${duplicate[0].ticket_number} already open for this location and category.`
        : null
    });

  } catch (err) {
    console.error('Log incident error:', err);
    res.status(500).json({ error: 'Failed to log incident. Please try again.' });
  }
});

// =====================================================
// UC2 — TRACK INCIDENT STATUS
// GET /api/incidents — list (role-filtered)
// GET /api/incidents/:ticketNumber — single ticket detail
// =====================================================
router.get('/', async (req, res) => {
  try {
    const { status, priority, search } = req.query;

    let query = supabase
      .from('incidents')
      .select(`
        incident_id, ticket_number, priority, status,
        description, caller_name, caller_contact,
        date_logged, date_assigned, date_resolved, date_closed,
        sla_deadline, sla_breached,
        categories(category_name),
        locations(location_name),
        assigned_user:users!incidents_assigned_to_fkey(user_id, full_name),
        logged_user:users!incidents_logged_by_fkey(user_id, full_name)
      `)
      .order('date_logged', { ascending: false });

    // Role-based filtering
    if (req.user.role === 'caller') {
      query = query.eq('caller_id', req.user.userId);
    } else if (req.user.role === 'technician') {
      query = query.eq('assigned_to', req.user.userId);
    }
    // officer and admin see all

    if (status && status !== 'all') query = query.eq('status', status);
    if (priority && priority !== 'all') query = query.eq('priority', priority);
    if (search) query = query.ilike('ticket_number', `%${search}%`);

    const { data: incidents, error } = await query;
    if (error) throw error;

    res.json({ incidents, total: incidents.length });

  } catch (err) {
    console.error('Get incidents error:', err);
    res.status(500).json({ error: 'Failed to retrieve incidents.' });
  }
});

router.get('/:ticketNumber', async (req, res) => {
  try {
    const { ticketNumber } = req.params;

    const { data: incident, error } = await supabase
      .from('incidents')
      .select(`
        *,
        categories(category_name),
        locations(location_name),
        assigned_user:users!incidents_assigned_to_fkey(user_id, full_name, email),
        logged_user:users!incidents_logged_by_fkey(user_id, full_name),
        caller_user:users!incidents_caller_id_fkey(user_id, full_name, email)
      `)
      .eq('ticket_number', ticketNumber.toUpperCase())
      .single();

    if (error || !incident) {
      return res.status(404).json({ error: `Ticket ${ticketNumber} not found.` });
    }

    // Role check — callers can only view their own tickets
    if (req.user.role === 'caller' && incident.caller_id !== req.user.userId) {
      return res.status(403).json({ error: 'You can only view your own tickets.' });
    }

    // Get audit trail
    const { data: auditTrail } = await supabase
      .from('audit_trail')
      .select(`
        audit_id, action_description, old_value,
        new_value, action_time,
        performer:users!audit_trail_performed_by_fkey(full_name)
      `)
      .eq('incident_id', incident.incident_id)
      .order('action_time', { ascending: true });

    // Get resolution notes (if any)
    const { data: resolutionNotes } = await supabase
      .from('resolution_notes')
      .select(`
        *,
        technician:users!resolution_notes_technician_id_fkey(full_name)
      `)
      .eq('incident_id', incident.incident_id)
      .order('resolved_at', { ascending: false })
      .limit(1);

    // Calculate SLA status
    const now = new Date();
    const slaDeadline = new Date(incident.sla_deadline);
    const hoursOpen = (now - new Date(incident.date_logged)) / 3600000;
    const slaLimits = { critical:2, high:4, medium:8, low:24 };
    const limit = slaLimits[incident.priority];
    const slaStatus = hoursOpen >= limit ? 'breached'
      : hoursOpen >= limit * 0.75 ? 'approaching' : 'within';
    const slaPct = Math.min(Math.round((hoursOpen / limit) * 100), 100);

    res.json({
      incident,
      auditTrail:     auditTrail || [],
      resolutionNote: resolutionNotes?.[0] || null,
      sla: {
        status:      slaStatus,
        percentage:  slaPct,
        hoursOpen:   Math.round(hoursOpen * 10) / 10,
        deadline:    incident.sla_deadline,
        limitHours:  limit
      }
    });

  } catch (err) {
    console.error('Get incident error:', err);
    res.status(500).json({ error: 'Failed to retrieve incident details.' });
  }
});

// =====================================================
// UC4 — ASSIGN INCIDENT
// PATCH /api/incidents/:ticketNumber/assign
// =====================================================
router.patch('/:ticketNumber/assign',
  requireRole('admin','officer'),
  async (req, res) => {
  try {
    const { ticketNumber } = req.params;
    const { assignTo, priority, assignmentNotes, expectedResolution } = req.body;

    if (!assignTo) {
      return res.status(400).json({ error: 'Please select an officer to assign this ticket to.' });
    }

    // Get incident
    const { data: incident, error: fetchErr } = await supabase
      .from('incidents')
      .select('incident_id, status, assigned_to, priority')
      .eq('ticket_number', ticketNumber.toUpperCase())
      .single();

    if (fetchErr || !incident) {
      return res.status(404).json({ error: `Ticket ${ticketNumber} not found.` });
    }

    if (!['open','escalated'].includes(incident.status)) {
      return res.status(400).json({
        error: `Cannot assign a ticket with status: ${incident.status}. Only Open or Escalated tickets can be assigned.`
      });
    }

    // Verify assignee exists
    const { data: assignee } = await supabase
      .from('users')
      .select('user_id, full_name, role')
      .eq('user_id', parseInt(assignTo))
      .eq('is_active', true)
      .single();

    if (!assignee) {
      return res.status(404).json({ error: 'Selected officer not found.' });
    }

    const now = new Date().toISOString();
    const oldAssigned = incident.assigned_to;
    const oldPriority = incident.priority;
    const newPriority = priority || incident.priority;

    // Update incident
    const { data: updated, error: updateErr } = await supabase
      .from('incidents')
      .update({
        assigned_to:   parseInt(assignTo),
        status:        'in_progress',
        priority:      newPriority,
        date_assigned: now
      })
      .eq('ticket_number', ticketNumber.toUpperCase())
      .select()
      .single();

    if (updateErr) throw updateErr;

    // Audit trail
    await writeAudit(
      incident.incident_id, req.user.userId,
      `Ticket Assigned — Assigned to ${assignee.full_name} by ${req.user.fullName}`,
      `assigned_to: ${oldAssigned || 'Unassigned'}, status: open`,
      `assigned_to: ${assignee.full_name}, status: in_progress`
    );

    if (newPriority !== oldPriority) {
      await writeAudit(
        incident.incident_id, req.user.userId,
        `Priority Updated — Changed from ${oldPriority} to ${newPriority}`,
        `priority: ${oldPriority}`,
        `priority: ${newPriority}`
      );
    }

    // Log notification
    await supabase.from('notifications').insert({
      incident_id:       incident.incident_id,
      recipient_id:      parseInt(assignTo),
      notification_type: 'assignment',
      channel:           'email',
      message:           `You have been assigned ticket ${ticketNumber}. Priority: ${newPriority}. ${assignmentNotes || ''}`,
      is_sent:           true,
      sent_at:           now
    });

    res.json({
      message:  `Ticket ${ticketNumber} successfully assigned to ${assignee.full_name}.`,
      incident: updated,
      assignee
    });

  } catch (err) {
    console.error('Assign error:', err);
    res.status(500).json({ error: 'Failed to assign incident.' });
  }
});

// =====================================================
// UC5 — RESOLVE INCIDENT
// PATCH /api/incidents/:ticketNumber/resolve
// =====================================================
router.patch('/:ticketNumber/resolve',
  requireRole('admin','technician','officer'),
  async (req, res) => {
  try {
    const { ticketNumber } = req.params;
    const { resolutionNotes, internalNotes, timeSpent, rootCause, resolutionStatus } = req.body;

    // Validation
    if (!resolutionNotes || resolutionNotes.trim().length < 20) {
      return res.status(400).json({
        error: 'Resolution notes must be at least 20 characters. Please provide more detail.'
      });
    }
    if (!timeSpent) {
      return res.status(400).json({ error: 'Please select the time spent on this ticket.' });
    }
    if (!resolutionStatus) {
      return res.status(400).json({ error: 'Please select a resolution status.' });
    }

    // Get incident
    const { data: incident, error: fetchErr } = await supabase
      .from('incidents')
      .select('incident_id, status, assigned_to, priority')
      .eq('ticket_number', ticketNumber.toUpperCase())
      .single();

    if (fetchErr || !incident) {
      return res.status(404).json({ error: `Ticket ${ticketNumber} not found.` });
    }

    if (!['in_progress','open'].includes(incident.status)) {
      return res.status(400).json({
        error: `Cannot resolve a ticket with status: ${incident.status}.`
      });
    }

    const now = new Date().toISOString();

    // Insert resolution notes
    const { error: noteErr } = await supabase
      .from('resolution_notes')
      .insert({
        incident_id:       incident.incident_id,
        technician_id:     req.user.userId,
        resolution_notes:  resolutionNotes.trim(),
        internal_notes:    internalNotes || null,
        time_spent_mins:   parseInt(timeSpent),
        root_cause:        rootCause || null,
        resolution_status: resolutionStatus,
        resolved_at:       now
      });

    if (noteErr) throw noteErr;

    // Update incident status
    const { data: updated, error: updateErr } = await supabase
      .from('incidents')
      .update({
        status:          'pending_confirmation',
        date_resolved:   now,
        time_spent_mins: parseInt(timeSpent),
        root_cause:      rootCause || null
      })
      .eq('ticket_number', ticketNumber.toUpperCase())
      .select()
      .single();

    if (updateErr) throw updateErr;

    // Audit trail
    await writeAudit(
      incident.incident_id, req.user.userId,
      `Incident Resolved — Resolution notes submitted by ${req.user.fullName}. Awaiting caller confirmation.`,
      'status: in_progress',
      'status: pending_confirmation'
    );

    // Notify caller
    await supabase.from('notifications').insert({
      incident_id:       incident.incident_id,
      recipient_id:      updated.caller_id,
      notification_type: 'resolution',
      channel:           'email',
      message:           `Your incident ${ticketNumber} has been resolved. Please log in to review the resolution and confirm or reject it.`,
      is_sent:           true,
      sent_at:           now
    });

    res.json({
      message:  `Ticket ${ticketNumber} marked as resolved. Caller has been notified to confirm.`,
      incident: updated
    });

  } catch (err) {
    console.error('Resolve error:', err);
    res.status(500).json({ error: 'Failed to resolve incident.' });
  }
});

// =====================================================
// UC6 — ESCALATE INCIDENT
// PATCH /api/incidents/:ticketNumber/escalate
// =====================================================
router.patch('/:ticketNumber/escalate',
  requireRole('admin','technician','officer'),
  async (req, res) => {
  try {
    const { ticketNumber } = req.params;
    const { escalationReason, escalateTo, escalationNotes, priorityUpdate, notifyParties } = req.body;

    // Validation
    if (!escalationReason) {
      return res.status(400).json({ error: 'Please select an escalation reason.' });
    }
    if (!escalateTo) {
      return res.status(400).json({ error: 'Please select a department to escalate to.' });
    }
    if (!escalationNotes || escalationNotes.trim().length < 15) {
      return res.status(400).json({
        error: 'Escalation notes must be at least 15 characters.'
      });
    }

    // Get incident
    const { data: incident, error: fetchErr } = await supabase
      .from('incidents')
      .select('incident_id, status, priority')
      .eq('ticket_number', ticketNumber.toUpperCase())
      .single();

    if (fetchErr || !incident) {
      return res.status(404).json({ error: `Ticket ${ticketNumber} not found.` });
    }

    if (['closed','cancelled'].includes(incident.status)) {
      return res.status(400).json({
        error: `Cannot escalate a ticket with status: ${incident.status}.`
      });
    }

    const now = new Date().toISOString();
    const newPriority = priorityUpdate || 'critical';

    // Save escalation record
    const { error: escErr } = await supabase
      .from('escalations')
      .insert({
        incident_id:       incident.incident_id,
        escalated_by:      req.user.userId,
        escalation_reason: escalationReason,
        escalate_to_dept:  escalateTo,
        escalation_notes:  escalationNotes.trim(),
        new_priority:      newPriority,
        notify_parties:    notifyParties || null,
        escalated_at:      now
      });

    if (escErr) throw escErr;

    // Update incident
    const { data: updated, error: updateErr } = await supabase
      .from('incidents')
      .update({
        status:      'escalated',
        priority:    newPriority,
        sla_breached: true
      })
      .eq('ticket_number', ticketNumber.toUpperCase())
      .select()
      .single();

    if (updateErr) throw updateErr;

    // Audit trail
    await writeAudit(
      incident.incident_id, req.user.userId,
      `Incident Escalated by ${req.user.fullName} — Reason: ${escalationReason}. Escalated to: ${escalateTo}`,
      `status: ${incident.status}, priority: ${incident.priority}`,
      `status: escalated, priority: ${newPriority}`
    );

    // Notify management
    await supabase.from('notifications').insert({
      incident_id:       incident.incident_id,
      recipient_id:      null,
      notification_type: 'escalation',
      channel:           'email',
      message:           `ESCALATION ALERT: Ticket ${ticketNumber} has been escalated to ${escalateTo}. Reason: ${escalationReason}. Escalated by: ${req.user.fullName}.`,
      is_sent:           true,
      sent_at:           now
    });

    res.json({
      message:  `Ticket ${ticketNumber} has been escalated to ${escalateTo}.`,
      incident: updated
    });

  } catch (err) {
    console.error('Escalate error:', err);
    res.status(500).json({ error: 'Failed to escalate incident.' });
  }
});

// =====================================================
// UC3 — CONFIRM / CLOSE INCIDENT
// PATCH /api/incidents/:ticketNumber/confirm
// =====================================================
router.patch('/:ticketNumber/confirm', async (req, res) => {
  try {
    const { ticketNumber } = req.params;
    const { action, satisfactionRating, feedback, rejectionReason } = req.body;

    if (!['accept','reject'].includes(action)) {
      return res.status(400).json({ error: 'Action must be "accept" or "reject".' });
    }
    if (action === 'reject' && (!rejectionReason || rejectionReason.trim().length === 0)) {
      return res.status(400).json({ error: 'Rejection reason is mandatory. Please explain why the resolution is unsatisfactory.' });
    }

    // Get incident
    const { data: incident, error: fetchErr } = await supabase
      .from('incidents')
      .select('incident_id, status, caller_id, assigned_to')
      .eq('ticket_number', ticketNumber.toUpperCase())
      .single();

    if (fetchErr || !incident) {
      return res.status(404).json({ error: `Ticket ${ticketNumber} not found.` });
    }

    if (incident.status !== 'pending_confirmation') {
      return res.status(400).json({
        error: `This ticket is not awaiting confirmation. Current status: ${incident.status}.`
      });
    }

    // Callers can only confirm their own tickets
    if (req.user.role === 'caller' && incident.caller_id !== req.user.userId) {
      return res.status(403).json({ error: 'You can only confirm your own tickets.' });
    }

    const now = new Date().toISOString();

    // Save confirmation record
    const { error: confErr } = await supabase
      .from('confirmations')
      .insert({
        incident_id:         incident.incident_id,
        confirmed_by:        req.user.userId,
        action,
        satisfaction_rating: satisfactionRating ? parseInt(satisfactionRating) : null,
        feedback:            feedback || null,
        rejection_reason:    action === 'reject' ? rejectionReason.trim() : null,
        confirmed_at:        now
      });

    if (confErr) throw confErr;

    if (action === 'accept') {
      // Close the ticket
      await supabase
        .from('incidents')
        .update({ status: 'closed', date_closed: now })
        .eq('ticket_number', ticketNumber.toUpperCase());

      await writeAudit(
        incident.incident_id, req.user.userId,
        `Ticket Confirmed and Closed — Accepted by ${req.user.fullName}${satisfactionRating ? `. Rating: ${satisfactionRating}/5` : ''}`,
        'status: pending_confirmation',
        'status: closed'
      );

      // Notify technician
      if (incident.assigned_to) {
        await supabase.from('notifications').insert({
          incident_id:       incident.incident_id,
          recipient_id:      incident.assigned_to,
          notification_type: 'closure',
          channel:           'email',
          message:           `Ticket ${ticketNumber} has been confirmed and closed by the caller.${satisfactionRating ? ` Rating: ${satisfactionRating}/5.` : ''}`,
          is_sent:           true,
          sent_at:           now
        });
      }

      res.json({ message: `Ticket ${ticketNumber} confirmed and closed. Thank you for your feedback!` });

    } else {
      // Reject — reopen ticket
      await supabase
        .from('incidents')
        .update({
          status:      'open',
          assigned_to: null,
          date_resolved: null
        })
        .eq('ticket_number', ticketNumber.toUpperCase());

      await writeAudit(
        incident.incident_id, req.user.userId,
        `Resolution Rejected — Ticket Reopened by ${req.user.fullName}. Reason: ${rejectionReason.trim()}`,
        'status: pending_confirmation',
        'status: open'
      );

      // Notify technician with rejection reason
      if (incident.assigned_to) {
        await supabase.from('notifications').insert({
          incident_id:       incident.incident_id,
          recipient_id:      incident.assigned_to,
          notification_type: 'rejection',
          channel:           'email',
          message:           `Ticket ${ticketNumber} resolution was rejected by the caller. Reason: ${rejectionReason.trim()}. The ticket has been reopened for further investigation.`,
          is_sent:           true,
          sent_at:           now
        });
      }

      res.json({
        message: `Ticket ${ticketNumber} has been reopened. The technician has been notified with your feedback.`
      });
    }

  } catch (err) {
    console.error('Confirm error:', err);
    res.status(500).json({ error: 'Failed to process confirmation.' });
  }
});

// =====================================================
// GET /api/incidents/:ticketNumber/audit
// Full audit trail for a ticket
// =====================================================
router.get('/:ticketNumber/audit', async (req, res) => {
  try {
    const { data: incident } = await supabase
      .from('incidents')
      .select('incident_id')
      .eq('ticket_number', req.params.ticketNumber.toUpperCase())
      .single();

    if (!incident) {
      return res.status(404).json({ error: 'Ticket not found.' });
    }

    const { data: audit, error } = await supabase
      .from('audit_trail')
      .select(`
        audit_id, action_description, old_value,
        new_value, action_time,
        performer:users!audit_trail_performed_by_fkey(full_name)
      `)
      .eq('incident_id', incident.incident_id)
      .order('action_time', { ascending: true });

    if (error) throw error;

    res.json({ auditTrail: audit });
  } catch (err) {
    res.status(500).json({ error: 'Failed to retrieve audit trail.' });
  }
});

// =====================================================
// GET /api/incidents/pending-confirmation
// Tickets waiting for caller confirmation
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

    if (req.user.role === 'caller') {
      query = query.eq('caller_id', req.user.userId);
    }

    const { data, error } = await query;
    if (error) throw error;

    res.json({ incidents: data });
  } catch (err) {
    res.status(500).json({ error: 'Failed to retrieve pending confirmation tickets.' });
  }
});

module.exports = router;
