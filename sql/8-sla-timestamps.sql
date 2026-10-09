-- Step B2: SLA tracking timestamps (accepted / arrived on site / repair started).
-- Run BEFORE deploying the matching backend code. Safe to run more than once.
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS date_accepted        timestamptz;
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS date_arrived         timestamptz;
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS date_repair_started  timestamptz;

-- Check
SELECT count(*) AS tickets, count(date_accepted) AS accepted, count(date_arrived) AS arrived, count(date_repair_started) AS repair_started FROM incidents;
