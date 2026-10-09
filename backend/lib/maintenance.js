// =====================================================
// PREVENTIVE MAINTENANCE -> TICKETS
// When a schedule becomes due, raise one ticket for it (not again until that ticket is finished).
// Runs hourly from server.js; safe to call any time.
// =====================================================
const supabase = require('../supabaseClient');
const { notify, activeUserIds } = require('./notify');

const SLA_HOURS = { critical: 2, high: 4, medium: 8, low: 24 };
let lastRun = 0;

async function runMaintenanceCheck(force = false) {
  if (!force && Date.now() - lastRun < 55 * 60 * 1000) return 0;
  lastRun = Date.now();
  let raised = 0;
  try {
    const today = new Date().toISOString().slice(0, 10);
    const { data: due } = await supabase.from('maintenance_schedules')
      .select('schedule_id, title, next_due, asset_id, assets(asset_id, asset_tag, name, criticality, location_id, status)')
      .eq('is_active', true);
    const list = (due || []).filter(s => s.next_due <= today && s.assets && s.assets.status !== 'decommissioned');
    if (!list.length) return 0;

    const { data: admins } = await supabase.from('users').select('user_id').eq('role', 'admin').eq('is_active', true).order('user_id').limit(1);
    const actor = admins && admins[0] && admins[0].user_id; if (!actor) return 0;
    const { data: cats } = await supabase.from('categories').select('category_id, category_name');
    const cat = (cats || []).find(c => /infrastructure/i.test(c.category_name)) || (cats || [])[0];
    const { data: locs } = await supabase.from('locations').select('location_id');
    if (!cat) return 0;

    for (const s of list) {
      const description = `Preventive maintenance due: ${s.title} — ${s.assets.asset_tag} (${s.assets.name})`;
      const { data: existing } = await supabase.from('incidents').select('incident_id, status').eq('asset_id', s.asset_id).eq('description', description);
      if ((existing || []).some(i => !['closed', 'cancelled'].includes(i.status))) continue;   // already has a live ticket
      const locationId = s.assets.location_id || (locs && locs[0] && locs[0].location_id);
      if (!locationId) continue;

      const priority = 'medium';
      const tier = { critical: 0, high: 1, medium: 2, low: 3 }[s.assets.criticality] < 2 ? s.assets.criticality : priority;
      const nowIso = new Date().toISOString();
      const deadline = new Date(Date.now() + SLA_HOURS[tier] * 3600 * 1000).toISOString();
      const { data: yr } = await supabase.from('incidents').select('ticket_number').order('ticket_number', { ascending: false }).limit(1);
      const parts = yr && yr[0] ? yr[0].ticket_number.split('-') : [];
      const next = (parseInt(parts[parts.length - 1]) || 0) + 1;
      const ticketNumber = `CLS-${new Date().getFullYear()}-${String(next).padStart(3, '0')}`;
      const { data: inc, error } = await supabase.from('incidents').insert({
        ticket_number: ticketNumber, caller_id: actor, logged_by: actor, category_id: cat.category_id, location_id: locationId,
        priority, status: 'open', description, caller_name: 'Preventive maintenance (system)', caller_contact: '0000000000',
        asset_id: s.asset_id, date_logged: nowIso, sla_deadline: deadline, sla_breached: false
      }).select().single();
      if (error || !inc) { if (error) console.error('Maintenance ticket failed:', error.message); continue; }
      raised++;
      await supabase.from('audit_trail').insert({ incident_id: inc.incident_id, performed_by: actor,
        action_description: `Ticket Created — raised automatically because the "${s.title}" schedule was due (${s.next_due})`, old_value: null, new_value: 'status: open' });
      await notify(inc.incident_id, await activeUserIds(['admin']), 'ticket_logged', `Preventive maintenance ticket ${ticketNumber} raised: ${s.title} — ${s.assets.asset_tag}.`);
    }
  } catch (e) { console.error('Maintenance check failed:', e.message); }
  return raised;
}

module.exports = { runMaintenanceCheck };
