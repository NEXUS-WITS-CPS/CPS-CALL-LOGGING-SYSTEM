// =====================================================
// ASSET / EQUIPMENT REGISTER — /api/assets
// Serial-number tracking, criticality (drives SLA), and
// equipment removal / repair / return history.
// =====================================================
const express  = require('express');
const supabase = require('../supabaseClient');
const { authMiddleware, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(authMiddleware);

const TYPES = ['boom_gate', 'turnstile', 'reader', 'camera', 'door_controller', 'alarm_panel', 'other'];
const CRIT  = ['critical', 'high', 'medium', 'low'];
const MOVES = { removed: 'removed', sent_for_repair: 'in_repair', returned: 'in_service', replaced: 'in_service' };

const ASSET_COLS = 'asset_id, asset_tag, serial_number, name, asset_type, criticality, status, supplier, install_date, warranty_expiry, location_id, locations(location_name)';

async function audit(incidentId, userId, text) {
  if (!incidentId) return;
  try { await supabase.from('audit_trail').insert({ incident_id: incidentId, performed_by: userId, action_description: text, old_value: null, new_value: null }); }
  catch (e) { console.error('Asset audit failed:', e.message); }
}

// GET /api/assets?q=&status=
router.get('/', async (req, res) => {
  try {
    let query = supabase.from('assets').select(ASSET_COLS).order('asset_tag');
    if (req.query.status && req.query.status !== 'all') query = query.eq('status', req.query.status);
    const { data, error } = await query;
    if (error) throw error;
    const q = String(req.query.q || '').trim().toLowerCase();
    const list = (data || []).filter(a => !q || [a.asset_tag, a.serial_number, a.name].some(v => String(v || '').toLowerCase().includes(q)));
    res.json({ assets: list });
  } catch (err) {
    console.error('List assets error:', err);
    res.status(500).json({ error: 'Failed to retrieve assets.' });
  }
});

// GET /api/assets/:id — one asset with its ticket, movement and maintenance history
router.get('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid asset id.' });
    const { data: asset } = await supabase.from('assets').select(ASSET_COLS).eq('asset_id', id).single();
    if (!asset) return res.status(404).json({ error: 'Asset not found.' });

    const [{ data: tickets }, { data: movements }, { data: schedules }] = await Promise.all([
      supabase.from('incidents').select('ticket_number, status, priority, description, date_logged').eq('asset_id', id).order('date_logged', { ascending: false }),
      supabase.from('asset_movements').select('movement_id, action, notes, expected_return, performed_at, incident_id, performer:users!asset_movements_performed_by_fkey(full_name)').eq('asset_id', id).order('performed_at', { ascending: false }),
      supabase.from('maintenance_schedules').select('schedule_id, title, interval_days, next_due, last_done, is_active').eq('asset_id', id)
    ]);
    // technicians only see the ticket history of equipment (not other users' details beyond what tickets already show)
    res.json({ asset, tickets: tickets || [], movements: movements || [], schedules: schedules || [] });
  } catch (err) {
    console.error('Get asset error:', err);
    res.status(500).json({ error: 'Failed to retrieve asset.' });
  }
});

// POST /api/assets (admin)
router.post('/', requireRole('admin'), async (req, res) => {
  try {
    const { assetTag, serialNumber, name, assetType, locationId, criticality, supplier, installDate, warrantyExpiry } = req.body;
    if (!assetTag || !String(assetTag).trim()) return res.status(400).json({ error: 'An asset tag is required.' });
    if (!name || String(name).trim().length < 3) return res.status(400).json({ error: 'Please give the equipment a name.' });
    if (assetType && !TYPES.includes(assetType)) return res.status(400).json({ error: 'Invalid equipment type.' });
    if (criticality && !CRIT.includes(criticality)) return res.status(400).json({ error: 'Invalid criticality.' });

    const { data, error } = await supabase.from('assets').insert({
      asset_tag: String(assetTag).trim().toUpperCase(), serial_number: serialNumber ? String(serialNumber).trim() : null,
      name: String(name).trim(), asset_type: assetType || 'other', criticality: criticality || 'medium',
      location_id: locationId ? parseInt(locationId) : null, supplier: supplier || null,
      install_date: installDate || null, warranty_expiry: warrantyExpiry || null, status: 'in_service'
    }).select().single();
    if (error) {
      if (error.code === '23505') return res.status(409).json({ error: 'An asset with that tag already exists.' });
      throw error;
    }
    res.status(201).json({ message: `Asset ${data.asset_tag} added.`, asset: data });
  } catch (err) {
    console.error('Create asset error:', err);
    res.status(500).json({ error: 'Failed to add asset.' });
  }
});

// PATCH /api/assets/:id (admin) — edit details / criticality
router.patch('/:id', requireRole('admin'), async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const b = req.body, changes = {};
    if (b.name !== undefined) { if (String(b.name).trim().length < 3) return res.status(400).json({ error: 'Please give the equipment a name.' }); changes.name = String(b.name).trim(); }
    if (b.serialNumber !== undefined) changes.serial_number = b.serialNumber ? String(b.serialNumber).trim() : null;
    if (b.assetType !== undefined) { if (!TYPES.includes(b.assetType)) return res.status(400).json({ error: 'Invalid equipment type.' }); changes.asset_type = b.assetType; }
    if (b.criticality !== undefined) { if (!CRIT.includes(b.criticality)) return res.status(400).json({ error: 'Invalid criticality.' }); changes.criticality = b.criticality; }
    if (b.supplier !== undefined) changes.supplier = b.supplier || null;
    if (b.status === 'decommissioned') changes.status = 'decommissioned';
    if (!Object.keys(changes).length) return res.status(400).json({ error: 'Nothing to update.' });
    const { data, error } = await supabase.from('assets').update(changes).eq('asset_id', id).select().single();
    if (error || !data) return res.status(404).json({ error: 'Asset not found.' });
    res.json({ message: `Asset ${data.asset_tag} updated.`, asset: data });
  } catch (err) {
    console.error('Update asset error:', err);
    res.status(500).json({ error: 'Failed to update asset.' });
  }
});

// POST /api/assets/:id/movements (admin, technician) — removal / repair / return / replacement
router.post('/:id/movements', requireRole('admin', 'technician'), async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { action, notes, expectedReturn, ticketNumber, newSerial } = req.body;
    if (!MOVES[action]) return res.status(400).json({ error: 'Action must be removed, sent_for_repair, returned or replaced.' });
    if (!notes || String(notes).trim().length < 5) return res.status(400).json({ error: 'Please add a note explaining what happened (min 5 characters).' });
    if (action === 'replaced' && !(newSerial && String(newSerial).trim())) return res.status(400).json({ error: 'Enter the serial number of the replacement unit.' });

    const { data: asset } = await supabase.from('assets').select('asset_id, asset_tag, status, serial_number').eq('asset_id', id).single();
    if (!asset) return res.status(404).json({ error: 'Asset not found.' });
    if (asset.status === 'decommissioned') return res.status(409).json({ error: 'This asset is decommissioned.' });
    if (action === 'returned' && asset.status === 'in_service') return res.status(409).json({ error: 'This asset is already in service.' });
    if (['removed', 'sent_for_repair'].includes(action) && asset.status !== 'in_service' && !(action === 'sent_for_repair' && asset.status === 'removed')) {
      return res.status(409).json({ error: `This asset is already ${asset.status.replace('_', ' ')}.` });
    }

    let incidentId = null;
    if (ticketNumber) {
      const { data: inc } = await supabase.from('incidents').select('incident_id, assigned_to').eq('ticket_number', String(ticketNumber).toUpperCase()).single();
      if (!inc) return res.status(404).json({ error: 'Ticket not found.' });
      if (req.user.role === 'technician' && inc.assigned_to !== req.user.userId) return res.status(403).json({ error: 'You can only link equipment movements to your own tickets.' });
      incidentId = inc.incident_id;
    } else if (req.user.role === 'technician') {
      return res.status(400).json({ error: 'Link the movement to one of your tickets.' });
    }

    const { error: mErr } = await supabase.from('asset_movements').insert({
      asset_id: id, incident_id: incidentId, action, notes: String(notes).trim(),
      expected_return: expectedReturn || null, performed_by: req.user.userId, performed_at: new Date().toISOString()
    });
    if (mErr) throw mErr;
    const changes = { status: MOVES[action] };
    if (action === 'replaced') changes.serial_number = String(newSerial).trim();
    const { data: updated, error } = await supabase.from('assets').update(changes).eq('asset_id', id).select().single();
    if (error) throw error;

    const label = { removed: 'removed from service', sent_for_repair: 'sent for repair', returned: 'returned to service', replaced: `replaced (new serial ${String(newSerial || '').trim()})` }[action];
    await audit(incidentId, req.user.userId, `Equipment ${asset.asset_tag} ${label} by ${req.user.fullName}. ${String(notes).trim()}`);
    res.status(201).json({ message: `${asset.asset_tag} ${label}.`, asset: updated });
  } catch (err) {
    console.error('Asset movement error:', err);
    res.status(500).json({ error: 'Failed to record equipment movement.' });
  }
});

module.exports = router;
