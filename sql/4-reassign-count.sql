-- 4-reassign-count.sql
-- Adds a re-assignment counter to incidents so the dashboard can show how many
-- active tickets have been re-assigned (feedback item A1).
-- Run this in the Supabase SQL Editor BEFORE deploying the matching backend code.
-- Safe to run more than once.

ALTER TABLE incidents ADD COLUMN IF NOT EXISTS reassign_count integer NOT NULL DEFAULT 0;

-- Back-fill existing tickets from the audit trail:
-- re-assignments = (number of "Ticket Assigned" audit entries) - 1, never below 0.
UPDATE incidents i
SET reassign_count = GREATEST(a.n - 1, 0)
FROM (
  SELECT incident_id, COUNT(*) AS n
  FROM audit_trail
  WHERE action_description LIKE 'Ticket Assigned%'
  GROUP BY incident_id
) a
WHERE i.incident_id = a.incident_id;

-- Check: how many tickets have been re-assigned, and the status mix
SELECT status, COUNT(*) AS tickets, SUM(CASE WHEN reassign_count > 0 THEN 1 ELSE 0 END) AS reassigned
FROM incidents
GROUP BY status
ORDER BY status;
