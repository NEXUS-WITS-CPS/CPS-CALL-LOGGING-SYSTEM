-- Step B1: SLA pause / resume (third-party dependencies).
-- Run BEFORE deploying the matching backend code. Safe to run more than once.
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS sla_paused_at          timestamptz;
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS sla_pause_reason       text;
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS sla_paused_total_mins  integer NOT NULL DEFAULT 0;

-- Check
SELECT count(*) AS tickets, count(sla_paused_at) AS paused, sum(sla_paused_total_mins) AS paused_mins FROM incidents;
