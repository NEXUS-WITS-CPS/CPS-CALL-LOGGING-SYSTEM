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
      .is('sla_paused_at', null)          // a paused ticket's clock is stopped
      .lt('sla_deadline', nowIso);
    if (error) throw error;
    if (!overdue || !overdue.length) { await runSlaWarnings(nowMs); return 0; }

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
        .is('sla_paused_at', null)
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
    await runSlaWarnings(nowMs);
  } catch (e) {
    console.error('SLA check failed:', e.message);
  }
  return escalated;
}

// Early warning: tell the admins and the assignee when a ticket has used 75% / 90% of its SLA,
// once per threshold per ticket (the notification itself is the "already warned" marker).
const WARN_LEVELS = [{ pct: 90, type: 'sla_warning_90', word: '90%' }, { pct: 75, type: 'sla_warning_75', word: '75%' }];
async function runSlaWarnings(nowMs) {
  const { data: active } = await supabase.from('incidents')
    .select('incident_id, ticket_number, priority, assigned_to, date_logged, sla_deadline')
    .in('status', ['open', 'in_progress'])
    .eq('sla_breached', false)
    .is('sla_paused_at', null);
  const list = (active || []).filter(t => new Date(t.sla_deadline) > nowMs);
  if (!list.length) return;
  const admins = await activeUserIds(['admin']);
  for (const t of list) {
    const total = new Date(t.sla_deadline) - new Date(t.date_logged);
    if (total <= 0) continue;
    const used = ((nowMs - new Date(t.date_logged)) / total) * 100;
    const level = WARN_LEVELS.find(l => used >= l.pct);
    if (!level) continue;
    const { data: already } = await supabase.from('notifications').select('notification_id')
      .eq('incident_id', t.incident_id).eq('notification_type', level.type).limit(1);
    if (already && already.length) continue;
    const minsLeft = Math.max(1, Math.round((new Date(t.sla_deadline) - nowMs) / 60000));
    await notify(t.incident_id, [...admins, t.assigned_to], level.type,
      `Ticket ${t.ticket_number} (${t.priority}) has used ${level.word} of its SLA — about ${minsLeft >= 60 ? Math.floor(minsLeft / 60) + 'h ' + (minsLeft % 60) + 'm' : minsLeft + 'm'} left.`);
  }
}

// The deadline a ticket is really working to: while paused, the clock is stopped,
// so the deadline keeps moving out by however long it has been paused.
function effectiveDeadline(inc, now = new Date()) {
  const d = new Date(inc.sla_deadline);
  return inc.sla_paused_at ? new Date(d.getTime() + (now - new Date(inc.sla_paused_at))) : d;
}

module.exports = { runSlaCheck, effectiveDeadline };
