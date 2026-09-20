// =====================================================
// NOTIFICATIONS ROUTES — /api/notifications
// =====================================================
const express  = require('express');
const supabase = require('../supabaseClient');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();
router.use(authMiddleware);

// GET /api/notifications — my latest notifications + unread count
router.get('/', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('notifications')
      .select('notification_id, incident_id, notification_type, message, is_read, created_at, incidents(ticket_number)')
      .eq('recipient_id', req.user.userId)
      .order('created_at', { ascending: false })
      .limit(20);
    if (error) throw error;
    const { count } = await supabase
      .from('notifications')
      .select('notification_id', { count: 'exact', head: true })
      .eq('recipient_id', req.user.userId)
      .eq('is_read', false);
    res.json({ notifications: data || [], unread: count || 0 });
  } catch (err) {
    console.error('Notifications error:', err);
    res.status(500).json({ error: 'Failed to load notifications.' });
  }
});

// PATCH /api/notifications/read-all
router.patch('/read-all', async (req, res) => {
  try {
    const { error } = await supabase.from('notifications').update({ is_read: true })
      .eq('recipient_id', req.user.userId).eq('is_read', false);
    if (error) throw error;
    res.json({ message: 'All notifications marked as read.' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update notifications.' });
  }
});

module.exports = router;
