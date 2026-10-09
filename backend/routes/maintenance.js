// =====================================================
// PREVENTIVE MAINTENANCE — /api/maintenance
// Recurring service schedules per asset, with due/overdue tracking.
// =====================================================
const express  = require('express');
const supabase = require('../supabaseClient');
const { authMiddleware, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(authMiddleware);
router.use(requireRole('admin', 'technician'));

const DAY = 86400000;
const todayStr = () => new Date().toISOString().slice(0, 10);
const addDays = (dateStr, n) => new Date(new Date(dateStr + 'T00:00:00Z').getTime() + n * DAY).toISOString().slice(0, 10);

function dueState(nextDue) {
  const days = Math.round((new Date(nextDue + 'T00:00:00Z') - new Date(todayStr() + 'T00:00:00Z')) / DAY);
  return { daysUntilDue: days, state: days < 0 ? 'overdue' : days <= 7 ? 'due_soon' : 'ok' };
}

// GET /api/maintenance
router.get('/', async (req, res) => {
  try {
    const { data, error } = await supabase.from('maintenance_schedules')
      .select('schedule_id, title, interval_days, next_due, last_done, is_active, asset_id, assets(asset_tag, name, criticality, status)')
      .order('next_due');
    if (error) throw error;
    const schedules = (data || []).map(s => ({ ...s, ...dueState(s.next_due) }));
    res.json({ schedules });
  } catch (err) {
    console.error('List maintenance error:', err);
    res.status(500).json({ error: 'Failed to retrieve maintenance schedules.' });
  }
});

// POST /api/maintenance (admin)
router.post('/', requireRole('admin'), async (req, res) => {
  try {
    const { assetId, title, intervalDays, nextDue } = req.body;
    const interval = parseInt(intervalDays);
    if (!Number.isInteger(parseInt(assetId))) return res.status(400).json({ error: 'Choose the equipment this applies to.' });
    if (!title || String(title).trim().length < 3) return res.status(400).json({ error: 'Please give the schedule a title.' });
    if (!Number.isInteger(interval) || interval < 1 || interval > 3650) return res.status(400).json({ error: 'Interval must be between 1 and 3650 days.' });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(nextDue || ''))) return res.status(400).json({ error: 'Choose the first due date.' });
    const { data: asset } = await supabase.from('assets').select('asset_id').eq('asset_id', parseInt(assetId)).single();
    if (!asset) return res.status(404).json({ error: 'Asset not found.' });
    const { data, error } = await supabase.from('maintenance_schedules').insert({
      asset_id: parseInt(assetId), title: String(title).trim(), interval_days: interval, next_due: nextDue, is_active: true, created_by: req.user.userId
    }).select().single();
    if (error) throw error;
    res.status(201).json({ message: 'Maintenance schedule created.', schedule: data });
  } catch (err) {
    console.error('Create maintenance error:', err);
    res.status(500).json({ error: 'Failed to create schedule.' });
  }
});

// POST /api/maintenance/:id/complete (admin, technician) — records the service, moves the due date on
router.post('/:id/complete', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { data: s } = await supabase.from('maintenance_schedules').select('schedule_id, asset_id, title, interval_days, is_active').eq('schedule_id', id).single();
    if (!s) return res.status(404).json({ error: 'Schedule not found.' });
    if (!s.is_active) return res.status(409).json({ error: 'This schedule is switched off.' });
    const today = todayStr();
    await supabase.from('maintenance_log').insert({ schedule_id: id, asset_id: s.asset_id, done_by: req.user.userId, done_at: new Date().toISOString(), notes: (req.body.notes || '').trim() || null });
    const next = addDays(today, s.interval_days);
    const { data, error } = await supabase.from('maintenance_schedules').update({ last_done: today, next_due: next }).eq('schedule_id', id).select().single();
    if (error) throw error;
    res.json({ message: `"${s.title}" recorded as done. Next due ${next}.`, schedule: data });
  } catch (err) {
    console.error('Complete maintenance error:', err);
    res.status(500).json({ error: 'Failed to record maintenance.' });
  }
});

// PATCH /api/maintenance/:id (admin) — switch on / off
router.patch('/:id', requireRole('admin'), async (req, res) => {
  try {
    if (typeof req.body.isActive !== 'boolean') return res.status(400).json({ error: 'isActive must be true or false.' });
    const { data, error } = await supabase.from('maintenance_schedules').update({ is_active: req.body.isActive }).eq('schedule_id', parseInt(req.params.id)).select().single();
    if (error || !data) return res.status(404).json({ error: 'Schedule not found.' });
    res.json({ message: `Schedule ${data.is_active ? 'switched on' : 'switched off'}.`, schedule: data });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update schedule.' });
  }
});

module.exports = router;
