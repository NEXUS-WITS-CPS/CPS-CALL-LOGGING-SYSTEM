// =====================================================
// USERS ROUTES — /api/users
// =====================================================
const express  = require('express');
const supabase = require('../supabaseClient');
const { authMiddleware, requireRole } = require('../middleware/auth');

const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { logUserAudit } = require('../lib/userAudit');

const ROLES = ['admin','officer','technician','caller'];
const router = express.Router();
router.use(authMiddleware);

// GET /api/users — list all users (admin only)
router.get('/', requireRole('admin'), async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('users')
      .select('user_id, full_name, email, role, is_active, created_at, account_status, requested_at, reviewed_by, reviewed_at, must_change_password')
      .order('role')
      .order('full_name');
    if (error) throw error;
    res.json({ users: data });
  } catch (err) {
    res.status(500).json({ error: 'Failed to retrieve users.' });
  }
});

// GET /api/users/technicians — available technicians with workload
router.get('/technicians', requireRole('admin','officer'), async (req, res) => {
  try {
    const { data: techs, error } = await supabase
      .from('users')
      .select('user_id, full_name, email, role')
      .eq('role', 'technician')
      .eq('is_active', true)
      .order('full_name');
    if (error) throw error;

    // Get active ticket count per technician
    const { data: counts } = await supabase
      .from('incidents')
      .select('assigned_to')
      .in('status', ['in_progress','escalated']);   // cancelled, closed, resolved and unassigned tickets never count

    const workload = {};
    (counts || []).forEach(i => {
      if (i.assigned_to) workload[i.assigned_to] = (workload[i.assigned_to] || 0) + 1;
    });

    const result = techs.map(t => ({
      ...t,
      activeTickets: workload[t.user_id] || 0,
      availability:
        (workload[t.user_id] || 0) === 0 ? 'available' :
        (workload[t.user_id] || 0) <= 2 ? 'moderate' : 'busy'
    }));

    res.json({ technicians: result });
  } catch (err) {
    res.status(500).json({ error: 'Failed to retrieve technicians.' });
  }
});

// PATCH /api/users/:userId/deactivate — admin only
router.patch('/:userId/deactivate', requireRole('admin'), async (req, res) => {
  try {
    if (String(req.params.userId) === String(req.user.userId)) return res.status(400).json({ error: 'You cannot deactivate your own account.' });
    const { data, error } = await supabase
      .from('users')
      .update({ is_active: false })
      .eq('user_id', req.params.userId)
      .select('user_id, full_name, email, role, is_active')
      .single();
    if (error) throw error;
    await logUserAudit(data.user_id, 'deactivated', req.user.userId, `Deactivated by ${req.user.fullName}`);
    res.json({ message: `User ${data.full_name} deactivated.`, user: data });
  } catch (err) {
    res.status(500).json({ error: 'Failed to deactivate user.' });
  }
});

// PATCH /api/users/:userId/activate — admin only
router.patch('/:userId/activate', requireRole('admin'), async (req, res) => {
  try {
    const { data, error } = await supabase.from('users').update({ is_active: true, account_status: 'active' })
      .eq('user_id', req.params.userId).select('user_id, full_name, email, role, is_active').single();
    if (error || !data) return res.status(404).json({ error: 'User not found.' });
    await logUserAudit(data.user_id, 'activated', req.user.userId, `Reactivated by ${req.user.fullName}`);
    res.json({ message: `User ${data.full_name} reactivated.`, user: data });
  } catch (err) {
    res.status(500).json({ error: 'Failed to reactivate user.' });
  }
});

// PATCH /api/users/:userId/password — admin sets a new (temporary) password
router.patch('/:userId/password', requireRole('admin'), async (req, res) => {
  try {
    const { password } = req.body;
    if (!password || String(password).length < 8) return res.status(400).json({ error: 'The password must be at least 8 characters.' });
    const hash = await require('bcryptjs').hash(String(password), 10);
    const { data, error } = await supabase.from('users').update({ password_hash: hash, must_change_password: true })
      .eq('user_id', req.params.userId).select('user_id, full_name').single();
    if (error || !data) return res.status(404).json({ error: 'User not found.' });
    await logUserAudit(data.user_id, 'password_reset', req.user.userId, `Password reset by ${req.user.fullName}; user must choose a new one at next sign-in`);
    res.json({ message: `Password reset for ${data.full_name}. They will be asked to choose a new one when they sign in.` });
  } catch (err) {
    res.status(500).json({ error: 'Failed to reset password.' });
  }
});

// PATCH /api/users/:userId/approve — admin approves an access request and assigns the role
router.patch('/:userId/approve', requireRole('admin'), async (req, res) => {
  try {
    const { role } = req.body || {};
    if (!ROLES.includes(role)) return res.status(400).json({ error: `Choose a role: ${ROLES.join(', ')}.` });
    const { data: u } = await supabase.from('users').select('user_id, full_name, account_status').eq('user_id', req.params.userId).single();
    if (!u) return res.status(404).json({ error: 'User not found.' });
    if (u.account_status !== 'pending') return res.status(400).json({ error: 'This request is no longer pending.' });
    await supabase.from('users').update({ role, is_active: true, account_status: 'active', reviewed_by: req.user.userId, reviewed_at: new Date().toISOString() }).eq('user_id', u.user_id);
    await logUserAudit(u.user_id, 'approved', req.user.userId, `Approved as ${role} by ${req.user.fullName}`);
    res.json({ message: `${u.full_name} approved as ${role}.` });
  } catch (err) { res.status(500).json({ error: 'Failed to approve request.' }); }
});

// PATCH /api/users/:userId/reject — admin declines an access request
router.patch('/:userId/reject', requireRole('admin'), async (req, res) => {
  try {
    const { data: u } = await supabase.from('users').select('user_id, full_name, account_status').eq('user_id', req.params.userId).single();
    if (!u) return res.status(404).json({ error: 'User not found.' });
    if (u.account_status !== 'pending') return res.status(400).json({ error: 'This request is no longer pending.' });
    await supabase.from('users').update({ account_status: 'rejected', is_active: false, reviewed_by: req.user.userId, reviewed_at: new Date().toISOString() }).eq('user_id', u.user_id);
    await logUserAudit(u.user_id, 'rejected', req.user.userId, `Request declined by ${req.user.fullName}`);
    res.json({ message: `Request from ${u.full_name} declined.` });
  } catch (err) { res.status(500).json({ error: 'Failed to decline request.' }); }
});

// POST /api/users/bulk — admin adds many people at once: rows = [{ fullName, email, role }]
router.post('/bulk', requireRole('admin'), async (req, res) => {
  try {
    const rows = Array.isArray(req.body && req.body.rows) ? req.body.rows : [];
    if (!rows.length) return res.status(400).json({ error: 'No rows to import.' });
    if (rows.length > 200) return res.status(400).json({ error: 'Import at most 200 people at a time.' });
    const results = [], seen = new Set();
    for (const [i, r] of rows.entries()) {
      const name = String(r.fullName || '').trim(), email = String(r.email || '').toLowerCase().trim(), role = String(r.role || 'officer').toLowerCase().trim();
      const fail = msg => results.push({ row: i + 1, email, fullName: name, ok: false, error: msg });
      if (name.length < 3) { fail('Full name missing'); continue; }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { fail('Invalid email'); continue; }
      if (!ROLES.includes(role)) { fail(`Invalid role "${role}"`); continue; }
      if (seen.has(email)) { fail('Duplicate in this list'); continue; }
      seen.add(email);
      const { data: ex } = await supabase.from('users').select('user_id').eq('email', email).single();
      if (ex) { fail('Already has an account'); continue; }
      const temp = 'Wits-' + crypto.randomBytes(4).toString('hex');
      const { data: nu, error } = await supabase.from('users').insert({ full_name: name, email, password_hash: await bcrypt.hash(temp, 10), role, is_active: true, account_status: 'active', must_change_password: true }).select('user_id').single();
      if (error || !nu) { fail('Could not be created'); continue; }
      await logUserAudit(nu.user_id, 'bulk_created', req.user.userId, `Created as ${role} in a bulk import by ${req.user.fullName}`);
      results.push({ row: i + 1, email, fullName: name, role, ok: true, tempPassword: temp });
    }
    const created = results.filter(r => r.ok).length;
    res.status(created ? 201 : 400).json({ message: `${created} of ${rows.length} people created.`, created, failed: rows.length - created, results });
  } catch (err) { console.error('Bulk import error:', err); res.status(500).json({ error: 'Bulk import failed.' }); }
});

// GET /api/users/audit — recent account events (admin)
router.get('/audit', requireRole('admin'), async (req, res) => {
  try {
    const { data: ev, error } = await supabase.from('user_audit').select('*').order('created_at', { ascending: false }).limit(50);
    if (error) throw error;
    const { data: us } = await supabase.from('users').select('user_id, full_name');
    const nm = {}; (us || []).forEach(u => { nm[u.user_id] = u.full_name; });
    res.json({ events: (ev || []).map(e => ({ ...e, user: nm[e.user_id] || 'Unknown', by: e.performed_by ? (nm[e.performed_by] || 'Unknown') : 'Self / system' })) });
  } catch (err) { res.status(500).json({ error: 'Failed to load account history.' }); }
});

// GET /api/users/categories — lookup table
router.get('/categories', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('categories')
      .select('*')
      .eq('is_active', true)
      .order('category_name');
    if (error) throw error;
    res.json({ categories: data });
  } catch (err) {
    res.status(500).json({ error: 'Failed to retrieve categories.' });
  }
});

// GET /api/users/locations — lookup table
router.get('/locations', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('locations')
      .select('*')
      .eq('is_active', true)
      .order('location_name');
    if (error) throw error;
    res.json({ locations: data });
  } catch (err) {
    res.status(500).json({ error: 'Failed to retrieve locations.' });
  }
});

module.exports = router;
