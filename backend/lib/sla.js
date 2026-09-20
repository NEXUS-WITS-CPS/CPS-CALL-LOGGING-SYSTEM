// =====================================================
// UC6 — AUTOMATIC ESCALATION ON SLA BREACH
// Any Open / In Progress ticket past its SLA deadline is
// flagged as breached and moved to Escalated automatically.
// =====================================================
const supabase = require('../supabaseClient');
const { notify, activeUserIds } = require('./notify');

let lastRun = 0;
let systemActor = null;

async function getSystemActor() {
  if (systemActor) return systemActor;
  const { data } = await supabase.from('users').select('user_id').eq('role', 'admin').eq('is_active', true).order('user_id').limit(1);
  systemActor = data && data[0] ? data[0].user_id : null;
  return systemActor;
}

// runSlaCheck(): safe to call often — throttled to once per 30 s unless force = true
async function runSlaCheck(force = false) {
  const nowMs = Date.now();
  if (!force && nowMs - lastRun < 30000) return 0;
  lastRun = nowMs;
  let escalated = 0;
  try {
    const nowIso = new Date().toISOString();
    const { data: overdue, error } = await supabase
      .from('incidents')
      .select('incident_id, ticket_number, priority, status, assigned_to')
      .in('status', ['open', 'in_progress'])
      .eq('sla_breached', false)
      .lt('sla_deadline', nowIso);
    if (error) throw error;
    if (!overdue || !overdue.length) return 0;

    const actor = await getSystemActor();
    const admins = await activeUserIds(['admin']);
    const limits = { critical: 2, high: 4, medium: 8, low: 24 };

    for (const t of overdue) {
      // conditional update = safe if two checks overlap (only one wins)
      const { data: upd } = await supabase
        .from('incidents')
        .update({ status: 'escalated', sla_breached: true })
        .eq('incident_id', t.incident_id)
        .in('status', ['open', 'in_progress'])
        .eq('sla_breached', false)
        .select('incident_id');
      if (!upd || !upd.length) continue;
      escalated++;

      const note = `Automatically escalated: the ${limits[t.priority] || 24}-hour SLA for ${t.priority} priority incidents was breached.`;
      await supabase.from('escalations').insert({
        incident_id: t.incident_id, escalated_by: actor, escalation_reason: 'sla_breach',
        escalate_to_dept: 'senior_management', escalation_notes: note, new_priority: t.priority,
        notify_parties: 'Administrators; assigned technician', escalated_at: nowIso
      });
      await supabase.from('audit_trail').insert({
        incident_id: t.incident_id, performed_by: actor,
        action_description: 'Automatic Escalation — SLA breached (system)',
        old_value: `status: ${t.status}`, new_value: 'status: escalated'
      });
      await notify(t.incident_id, [...admins, t.assigned_to], 'sla_breach',
        `Ticket ${t.ticket_number} breached its SLA and was escalated automatically.`);
    }
  } catch (e) {
    console.error('SLA check failed:', e.message);
  }
  return escalated;
}

module.exports = { runSlaCheck };
