// Records account-level events (requests, approvals, resets) in user_audit
const supabase = require('../supabaseClient');
async function logUserAudit(userId, action, performedBy, detail) {
  try { await supabase.from('user_audit').insert({ user_id: userId, action, performed_by: performedBy || null, detail }); }
  catch (e) { console.error('user audit failed:', e.message); }
}
module.exports = { logUserAudit };
