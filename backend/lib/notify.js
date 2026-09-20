// =====================================================
// IN-APP NOTIFICATIONS — writes to the `notifications` table
// (email / SMS gateways are planned for Construction 2)
// =====================================================
const supabase = require('../supabaseClient');

async function activeUserIds(roles) {
  const { data } = await supabase.from('users').select('user_id').in('role', roles).eq('is_active', true);
  return (data || []).map(u => u.user_id);
}

// notify(incidentId, recipientIds[], type, message) — never throws (notifications must not break an action)
async function notify(incidentId, recipientIds, type, message) {
  try {
    const ids = [...new Set((recipientIds || []).filter(Boolean))];
    if (!ids.length) return;
    const now = new Date().toISOString();
    const rows = ids.map(id => ({
      incident_id: incidentId, recipient_id: id, notification_type: type,
      channel: 'in_app', message, is_sent: true, sent_at: now, created_at: now, is_read: false
    }));
    const { error } = await supabase.from('notifications').insert(rows);
    if (error) console.error('Notification insert failed:', error.message);
  } catch (e) { console.error('Notify error:', e.message); }
}

module.exports = { notify, activeUserIds };
