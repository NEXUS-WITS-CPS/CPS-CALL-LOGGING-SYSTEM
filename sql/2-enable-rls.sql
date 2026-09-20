-- Run AFTER the backend is deployed with SUPABASE_SERVICE_KEY set (Render env var) and login works.
-- Turns Row Level Security ON so the public anon key can no longer read/write your tables.
-- The backend uses the service-role key, which bypasses RLS, so the app keeps working.
ALTER TABLE users            ENABLE ROW LEVEL SECURITY;
ALTER TABLE incidents        ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_trail      ENABLE ROW LEVEL SECURITY;
ALTER TABLE categories       ENABLE ROW LEVEL SECURITY;
ALTER TABLE locations        ENABLE ROW LEVEL SECURITY;
ALTER TABLE confirmations    ENABLE ROW LEVEL SECURITY;
ALTER TABLE escalations      ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications    ENABLE ROW LEVEL SECURITY;
ALTER TABLE resolution_notes ENABLE ROW LEVEL SECURITY;
-- (No policies are added on purpose: with RLS on and no policies, the anon key gets no access.)
