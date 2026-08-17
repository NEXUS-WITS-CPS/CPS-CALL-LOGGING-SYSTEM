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
      .in('role', ['technician','officer'])
      .eq('is_active', true)
      .order('full_name');
    if (error) throw error;

    // Get active ticket count per technician
    const { data: counts } = await supabase
      .from('incidents')
      .select('assigned_to')
      .in('status', ['open','in_progress','escalated']);

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
