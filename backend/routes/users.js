// =====================================================
// USERS ROUTES — /api/users
// =====================================================
const express  = require('express');
const supabase = require('../supabaseClient');
const { authMiddleware, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(authMiddleware);

// GET /api/users — list all users (admin only)
router.get('/', requireRole('admin'), async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('users')
      .select('user_id, full_name, email, role, is_active, created_at')
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
    res.json({ message: `User ${data.full_name} deactivated.`, user: data });
  } catch (err) {
    res.status(500).json({ error: 'Failed to deactivate user.' });
  }
});

// PATCH /api/users/:userId/activate — admin only
router.patch('/:userId/activate', requireRole('admin'), async (req, res) => {
  try {
    const { data, error } = await supabase.from('users').update({ is_active: true })
      .eq('user_id', req.params.userId).select('user_id, full_name, email, role, is_active').single();
    if (error || !data) return res.status(404).json({ error: 'User not found.' });
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
    const { data, error } = await supabase.from('users').update({ password_hash: hash })
      .eq('user_id', req.params.userId).select('user_id, full_name').single();
    if (error || !data) return res.status(404).json({ error: 'User not found.' });
    res.json({ message: `Password reset for ${data.full_name}.` });
  } catch (err) {
    res.status(500).json({ error: 'Failed to reset password.' });
  }
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
