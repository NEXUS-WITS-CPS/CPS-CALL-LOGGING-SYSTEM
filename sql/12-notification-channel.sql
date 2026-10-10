-- Run once in Supabase > SQL Editor (Iteration 5)
-- The notifications table only allowed some channel values, so every in-app notification
-- ('in_app') was rejected by the database and the bell stayed empty. Allow 'in_app'.
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_channel_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_channel_check
  CHECK (channel IN ('in_app','email','sms','push','system'));
