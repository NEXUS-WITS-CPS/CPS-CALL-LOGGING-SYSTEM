-- Run once in Supabase > SQL Editor (Iteration 4: in-app notifications need a read flag)
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS is_read boolean NOT NULL DEFAULT false;
