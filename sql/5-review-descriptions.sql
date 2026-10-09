-- Step A2: list every ticket description so the vague ones can be rewritten.
-- Run in the Supabase SQL editor and paste the result back.
SELECT i.ticket_number, i.status, c.category_name, l.location_name, i.description
FROM incidents i
LEFT JOIN categories c ON c.category_id = i.category_id
LEFT JOIN locations  l ON l.location_id = i.location_id
ORDER BY i.ticket_number;
