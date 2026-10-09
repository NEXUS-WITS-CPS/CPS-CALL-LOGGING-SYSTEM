-- Iteration 4: access requests, approval queue, forced password change, user audit
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS account_status       text    NOT NULL DEFAULT 'active',   -- active | pending | rejected
  ADD COLUMN IF NOT EXISTS must_change_password boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS requested_at         timestamptz,
  ADD COLUMN IF NOT EXISTS reviewed_by          integer,
  ADD COLUMN IF NOT EXISTS reviewed_at          timestamptz;

CREATE TABLE IF NOT EXISTS user_audit (
  audit_id     serial PRIMARY KEY,
  user_id      integer,              -- the account that was affected
  action       text NOT NULL,        -- requested | approved | rejected | created | bulk_created | password_reset | password_changed | activated | deactivated
  performed_by integer,              -- who did it (null = the person themselves / system)
  detail       text,
  created_at   timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE user_audit ENABLE ROW LEVEL SECURITY;

SELECT count(*) AS users, count(*) FILTER (WHERE account_status='active') AS active FROM users;
