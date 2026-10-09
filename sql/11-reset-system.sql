-- =====================================================================
-- FRESH START: wipes ALL tickets, activity and every user except Panashe.
-- THIS CANNOT BE UNDONE. Runs as one transaction: if anything fails,
-- nothing is changed. Kept: categories, locations, equipment register,
-- maintenance schedules (so you still have equipment to link to).
-- =====================================================================
BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM users WHERE email = '2725508@wits.ac.za' AND role = 'admin') THEN
    RAISE EXCEPTION 'Admin account 2725508@wits.ac.za not found - nothing was changed';
  END IF;
END $$;

-- 1. All tickets and everything attached to them (ticket numbers restart at 001)
TRUNCATE TABLE audit_trail, notifications, escalations, confirmations, resolution_notes,
               spare_parts_used, asset_movements, maintenance_log, user_audit, incidents
  RESTART IDENTITY CASCADE;

-- 2. Old description back-up table from the clean-up (no longer needed)
DROP TABLE IF EXISTS incidents_description_backup;

-- 3. Equipment goes back to normal service; schedules belong to the admin
UPDATE assets SET status = 'in_service';
UPDATE maintenance_schedules
   SET created_by = (SELECT user_id FROM users WHERE email = '2725508@wits.ac.za'),
       last_done = NULL;

-- 4. Remove every user except the admin
DELETE FROM users WHERE email <> '2725508@wits.ac.za';
UPDATE users SET must_change_password = false, account_status = 'active', is_active = true
 WHERE email = '2725508@wits.ac.za';

COMMIT;

SELECT (SELECT count(*) FROM users)     AS users,
       (SELECT count(*) FROM incidents) AS tickets,
       (SELECT count(*) FROM assets)    AS equipment,
       (SELECT email FROM users LIMIT 1) AS remaining_user;
