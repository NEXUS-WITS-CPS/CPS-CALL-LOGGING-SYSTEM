-- =====================================================
-- STEP 1: Check what incident IDs actually exist
-- Run this first to confirm
-- =====================================================
SELECT incident_id, ticket_number FROM incidents ORDER BY incident_id;

-- =====================================================
-- STEP 2: Check what user IDs actually exist
-- =====================================================
SELECT user_id, full_name, role FROM users ORDER BY user_id;

-- =====================================================
-- STEP 3: Insert resolution notes using only
-- ticket_number and email lookups — no hardcoded IDs
-- =====================================================

-- Resolution note for CCTV camera (CLS-2026-003)
INSERT INTO resolution_notes (
  incident_id, technician_id, resolution_notes,
  internal_notes, time_spent_mins, root_cause,
  resolution_status, resolved_at
)
SELECT
  i.incident_id,
  u.user_id,
  'The CCTV camera at the Library entrance was found to have a loose power connection caused by recent cable management work in the area. The power connector was re-seated and secured. Camera feed tested and confirmed operational.',
  'Recommend follow-up inspection of all cameras after cable work is completed.',
  45, 'hardware_failure', 'resolved',
  NOW() - INTERVAL '2 hours'
FROM incidents i, users u
WHERE i.ticket_number = 'CLS-2026-003'
  AND u.email = 'mokoena@wits.ac.za';

-- Resolution note for fire exit (CLS-2026-007)
INSERT INTO resolution_notes (
  incident_id, technician_id, resolution_notes,
  internal_notes, time_spent_mins, root_cause,
  resolution_status, resolved_at
)
SELECT
  i.incident_id,
  u.user_id,
  'Emergency escalated to Facilities Management. Construction company notified to remove equipment immediately. Fire exit cleared and verified accessible.',
  'Construction company violated site agreement. Report filed with Facilities Management.',
  30, 'human_error', 'escalated',
  NOW() - INTERVAL '1 hour'
FROM incidents i, users u
WHERE i.ticket_number = 'CLS-2026-007'
  AND u.email = 'nkosi@wits.ac.za';

-- Resolution note for boom gate (CLS-2026-008)
INSERT INTO resolution_notes (
  incident_id, technician_id, resolution_notes,
  internal_notes, time_spent_mins, root_cause,
  resolution_status, resolved_at
)
SELECT
  i.incident_id,
  u.user_id,
  'The boom gate motor at the West Campus entrance was replaced following diagnosis of complete motor failure. Gate calibrated and tested through 10 full open/close cycles without fault.',
  'Motor was at end of service life. Recommend scheduled replacement of remaining old motors.',
  120, 'hardware_failure', 'resolved',
  NOW() - INTERVAL '3 hours'
FROM incidents i, users u
WHERE i.ticket_number = 'CLS-2026-008'
  AND u.email = 'khumalo@wits.ac.za';

-- Resolution note for armed robbery (CLS-2026-009)
INSERT INTO resolution_notes (
  incident_id, technician_id, resolution_notes,
  internal_notes, time_spent_mins, root_cause,
  resolution_status, resolved_at
)
SELECT
  i.incident_id,
  u.user_id,
  'Incident reported to SAPS. Officers responded within 8 minutes. Suspect apprehended near East Campus. ATM area secured and CCTV footage preserved for investigation.',
  'Footage handed to SAPS case officer. Reference number: CAS-2026-0419.',
  90, 'security_breach', 'closed',
  NOW() - INTERVAL '3 days' + INTERVAL '90 minutes'
FROM incidents i, users u
WHERE i.ticket_number = 'CLS-2026-009'
  AND u.email = 'dlamini@wits.ac.za';

-- =====================================================
-- STEP 4: Verify — should show 4 rows
-- =====================================================
SELECT
  rn.note_id,
  i.ticket_number,
  u.full_name AS technician,
  rn.resolution_status,
  rn.time_spent_mins
FROM resolution_notes rn
JOIN incidents i ON rn.incident_id = i.incident_id
JOIN users u ON rn.technician_id = u.user_id;
