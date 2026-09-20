-- Run once in Supabase > SQL Editor BEFORE switching to the fixed backend.
-- Gives every account its own real bcrypt hash (same passwords as before, so logins keep working).
-- The old hardcoded password list has been removed from backend/routes/auth.js.

UPDATE users SET password_hash = '$2a$10$Mrg4c/0QTQaCNx1a255erOV5LKgcBIakoSoi5XaD2Tn1lVoX0x94S' WHERE email = 'admin@wits.ac.za';
UPDATE users SET password_hash = '$2a$10$thrDr9K3xrwrjwhuvX.A6usSPNAX2IkdGv/rM9/3qgu40wVa1DypO' WHERE email = 'officer@wits.ac.za';
UPDATE users SET password_hash = '$2a$10$OKJoGLs66OSrteqy7TeR8OBvurFNwhlwuy8Ib36lB2YC9FmkLS4eS' WHERE email = 'tech@wits.ac.za';
UPDATE users SET password_hash = '$2a$10$cat/5enIU6VxU1b2jn72kOVdSZcrwMjOENMckOO0ep3DEYVptRawi' WHERE email = '2725508@wits.ac.za';
UPDATE users SET password_hash = '$2a$10$GB2IYGLFqjFlBXcW2J9a9ubYt1YhJ.E2dhhT73VIF3StWS0tulMUm' WHERE email = '2809151@wits.ac.za';
UPDATE users SET password_hash = '$2a$10$6pC/SKJZhQRDm3D.j/P8T.4NZNo5X4UQUdrRoTaYXIo0KuzKBKZTC' WHERE email = '2700513@wits.ac.za';
UPDATE users SET password_hash = '$2a$10$xJLatMAW3iPobaKOUyNyUeVG6flR1O28TPNImbAkVI5j1xXyLo2k2' WHERE email = '2836373@wits.ac.za';
UPDATE users SET password_hash = '$2a$10$xV/YoGtc8N3MKR5GtDpKBeuegdyynMpFDOA/KhQ7vH0TBxaRTIJVO' WHERE email = '1895234@wits.ac.za';
UPDATE users SET password_hash = '$2a$10$Wx6giaUSrbsDMOn6P6QEu.UlVtZjFSSL9fxMlcj4EqloyfUkh6RJC' WHERE email = '2749154@wits.ac.za';

-- Check: every row should now have a different-looking hash prefix per password
SELECT user_id, email, role, is_active, left(password_hash, 20) AS hash_start FROM users ORDER BY user_id;
