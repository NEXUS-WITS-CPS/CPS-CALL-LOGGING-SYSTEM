-- =====================================================
-- WITS CPS CALL LOGGING SYSTEM — DATABASE SCHEMA
-- Team 20 · NEXUS · Iteration 3
-- Run this entire script in Supabase SQL Editor
-- =====================================================

-- ── ENABLE UUID EXTENSION ──
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ── DROP TABLES IF REBUILDING ──
DROP TABLE IF EXISTS notifications CASCADE;
DROP TABLE IF EXISTS audit_trail CASCADE;
DROP TABLE IF EXISTS confirmations CASCADE;
DROP TABLE IF EXISTS escalations CASCADE;
DROP TABLE IF EXISTS resolution_notes CASCADE;
DROP TABLE IF EXISTS incidents CASCADE;
DROP TABLE IF EXISTS users CASCADE;
DROP TABLE IF EXISTS categories CASCADE;
DROP TABLE IF EXISTS locations CASCADE;

-- =====================================================
-- TABLE 1: CATEGORIES
-- =====================================================
CREATE TABLE categories (
  category_id   SERIAL PRIMARY KEY,
  category_name VARCHAR(100) NOT NULL UNIQUE,
  is_active     BOOLEAN DEFAULT TRUE,
  created_at    TIMESTAMP DEFAULT NOW()
);

-- =====================================================
-- TABLE 2: LOCATIONS
-- =====================================================
CREATE TABLE locations (
  location_id   SERIAL PRIMARY KEY,
  location_name VARCHAR(100) NOT NULL UNIQUE,
  building      VARCHAR(100),
  is_active     BOOLEAN DEFAULT TRUE,
  created_at    TIMESTAMP DEFAULT NOW()
);

-- =====================================================
-- TABLE 3: USERS
-- =====================================================
CREATE TABLE users (
  user_id       SERIAL PRIMARY KEY,
  full_name     VARCHAR(150) NOT NULL,
  email         VARCHAR(150) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  role          VARCHAR(20) NOT NULL CHECK (role IN ('admin','officer','technician','caller')),
  is_active     BOOLEAN DEFAULT TRUE,
  created_at    TIMESTAMP DEFAULT NOW(),
  updated_at    TIMESTAMP DEFAULT NOW()
);

-- =====================================================
-- TABLE 4: INCIDENTS
-- =====================================================
CREATE TABLE incidents (
  incident_id       SERIAL PRIMARY KEY,
  ticket_number     VARCHAR(20) NOT NULL UNIQUE,
  caller_id         INTEGER REFERENCES users(user_id),
  logged_by         INTEGER REFERENCES users(user_id),
  assigned_to       INTEGER REFERENCES users(user_id),
  category_id       INTEGER REFERENCES categories(category_id),
  location_id       INTEGER REFERENCES locations(location_id),
  priority          VARCHAR(10) NOT NULL CHECK (priority IN ('low','medium','high','critical')),
  status            VARCHAR(25) NOT NULL DEFAULT 'open'
                    CHECK (status IN ('open','in_progress','resolved','pending_confirmation','closed','escalated','cancelled')),
  description       TEXT NOT NULL,
  caller_name       VARCHAR(150),
  caller_contact    VARCHAR(50),
  date_logged       TIMESTAMP DEFAULT NOW(),
  date_assigned     TIMESTAMP,
  date_resolved     TIMESTAMP,
  date_closed       TIMESTAMP,
  time_spent_mins   INTEGER,
  root_cause        VARCHAR(50),
  sla_deadline      TIMESTAMP,
  sla_breached      BOOLEAN DEFAULT FALSE,
  additional_notes  TEXT,
  created_at        TIMESTAMP DEFAULT NOW(),
  updated_at        TIMESTAMP DEFAULT NOW()
);

-- =====================================================
-- TABLE 5: RESOLUTION NOTES
-- =====================================================
CREATE TABLE resolution_notes (
  note_id           SERIAL PRIMARY KEY,
  incident_id       INTEGER NOT NULL REFERENCES incidents(incident_id) ON DELETE CASCADE,
  technician_id     INTEGER REFERENCES users(user_id),
  resolution_notes  TEXT NOT NULL,
  internal_notes    TEXT,
  time_spent_mins   INTEGER,
  root_cause        VARCHAR(50),
  resolution_status VARCHAR(20) CHECK (resolution_status IN ('resolved','closed','escalated')),
  resolved_at       TIMESTAMP DEFAULT NOW()
);

-- =====================================================
-- TABLE 6: ESCALATIONS
-- =====================================================
CREATE TABLE escalations (
  escalation_id     SERIAL PRIMARY KEY,
  incident_id       INTEGER NOT NULL REFERENCES incidents(incident_id) ON DELETE CASCADE,
  escalated_by      INTEGER REFERENCES users(user_id),
  escalation_reason VARCHAR(50) NOT NULL,
  escalate_to_dept  VARCHAR(100) NOT NULL,
  escalation_notes  TEXT NOT NULL,
  new_priority      VARCHAR(10),
  notify_parties    VARCHAR(100),
  escalated_at      TIMESTAMP DEFAULT NOW()
);

-- =====================================================
-- TABLE 7: CONFIRMATIONS
-- =====================================================
CREATE TABLE confirmations (
  confirmation_id     SERIAL PRIMARY KEY,
  incident_id         INTEGER NOT NULL REFERENCES incidents(incident_id) ON DELETE CASCADE,
  confirmed_by        INTEGER REFERENCES users(user_id),
  action              VARCHAR(10) NOT NULL CHECK (action IN ('accept','reject')),
  satisfaction_rating INTEGER CHECK (satisfaction_rating BETWEEN 1 AND 5),
  feedback            TEXT,
  rejection_reason    TEXT,
  confirmed_at        TIMESTAMP DEFAULT NOW()
);

-- =====================================================
-- TABLE 8: AUDIT TRAIL
-- =====================================================
CREATE TABLE audit_trail (
  audit_id            SERIAL PRIMARY KEY,
  incident_id         INTEGER NOT NULL REFERENCES incidents(incident_id) ON DELETE CASCADE,
  performed_by        INTEGER REFERENCES users(user_id),
  action_description  TEXT NOT NULL,
  old_value           TEXT,
  new_value           TEXT,
  action_time         TIMESTAMP DEFAULT NOW()
);

-- =====================================================
-- TABLE 9: NOTIFICATIONS
-- =====================================================
CREATE TABLE notifications (
  notification_id   SERIAL PRIMARY KEY,
  incident_id       INTEGER REFERENCES incidents(incident_id) ON DELETE CASCADE,
  recipient_id      INTEGER REFERENCES users(user_id),
  notification_type VARCHAR(30) NOT NULL,
  channel           VARCHAR(10) DEFAULT 'email' CHECK (channel IN ('email','sms','both')),
  message           TEXT NOT NULL,
  is_sent           BOOLEAN DEFAULT FALSE,
  sent_at           TIMESTAMP,
  created_at        TIMESTAMP DEFAULT NOW()
);

-- =====================================================
-- INDEXES FOR PERFORMANCE
-- =====================================================
CREATE INDEX idx_incidents_status       ON incidents(status);
CREATE INDEX idx_incidents_priority     ON incidents(priority);
CREATE INDEX idx_incidents_assigned_to  ON incidents(assigned_to);
CREATE INDEX idx_incidents_caller_id    ON incidents(caller_id);
CREATE INDEX idx_incidents_date_logged  ON incidents(date_logged);
CREATE INDEX idx_audit_incident_id      ON audit_trail(incident_id);
CREATE INDEX idx_notifications_recipient ON notifications(recipient_id);

-- =====================================================
-- FUNCTION: AUTO-UPDATE updated_at TIMESTAMP
-- =====================================================
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_incidents_updated
  BEFORE UPDATE ON incidents
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_users_updated
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- =====================================================
-- FUNCTION: CALCULATE SLA DEADLINE
-- =====================================================
CREATE OR REPLACE FUNCTION calculate_sla_deadline(
  p_priority VARCHAR,
  p_date_logged TIMESTAMP
) RETURNS TIMESTAMP AS $$
BEGIN
  RETURN CASE p_priority
    WHEN 'critical' THEN p_date_logged + INTERVAL '2 hours'
    WHEN 'high'     THEN p_date_logged + INTERVAL '4 hours'
    WHEN 'medium'   THEN p_date_logged + INTERVAL '8 hours'
    WHEN 'low'      THEN p_date_logged + INTERVAL '24 hours'
    ELSE p_date_logged + INTERVAL '24 hours'
  END;
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- FUNCTION: GENERATE TICKET NUMBER
-- =====================================================
CREATE OR REPLACE FUNCTION generate_ticket_number()
RETURNS VARCHAR AS $$
DECLARE
  v_year  VARCHAR(4);
  v_count INTEGER;
  v_num   VARCHAR(20);
BEGIN
  v_year  := EXTRACT(YEAR FROM NOW())::VARCHAR;
  SELECT COUNT(*) + 1 INTO v_count FROM incidents
    WHERE EXTRACT(YEAR FROM date_logged) = EXTRACT(YEAR FROM NOW());
  v_num := 'CLS-' || v_year || '-' || LPAD(v_count::VARCHAR, 3, '0');
  RETURN v_num;
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- SEED DATA: CATEGORIES
-- =====================================================
INSERT INTO categories (category_name) VALUES
  ('Access Control'),
  ('CCTV / Surveillance'),
  ('Infrastructure'),
  ('Security Threat'),
  ('Noise Complaint'),
  ('Medical Emergency'),
  ('Fire / Safety'),
  ('Theft / Robbery'),
  ('Vandalism'),
  ('Other');

-- =====================================================
-- SEED DATA: LOCATIONS
-- =====================================================
INSERT INTO locations (location_name, building) VALUES
  ('Main Gate',             'Campus Entrance'),
  ('Science Block',         'FNB Building'),
  ('Library',               'Wartenweiler Library'),
  ('East Campus',           'East Campus'),
  ('West Campus',           'West Campus'),
  ('Student Residence',     'Barnato Hall'),
  ('Administration Block',  'Senate House'),
  ('Sports Fields',         'Sports Complex'),
  ('Parking Area',          'Parking Deck'),
  ('Medical School',        'Health Sciences'),
  ('Great Hall',            'Great Hall'),
  ('Other',                 'Other');

-- =====================================================
-- SEED DATA: USERS
-- Passwords are bcrypt hashes of the demo passwords
-- admin123, officer123, tech123, caller123
-- =====================================================
INSERT INTO users (full_name, email, password_hash, role) VALUES
  ('System Admin',        'admin@wits.ac.za',   '$2b$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 'admin'),
  ('Security Officer',    'officer@wits.ac.za', '$2b$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 'officer'),
  ('Technician T',        'tech@wits.ac.za',    '$2b$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 'technician'),
  ('Caller User',         'caller@wits.ac.za',  '$2b$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 'caller'),
  ('J. Dlamini',          'dlamini@wits.ac.za', '$2b$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 'technician'),
  ('T. Mokoena',          'mokoena@wits.ac.za', '$2b$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 'technician'),
  ('S. Nkosi',            'nkosi@wits.ac.za',   '$2b$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 'technician'),
  ('M. Khumalo',          'khumalo@wits.ac.za', '$2b$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 'technician');

-- =====================================================
-- SEED DATA: SAMPLE INCIDENTS
-- =====================================================
INSERT INTO incidents (
  ticket_number, caller_id, logged_by, assigned_to,
  category_id, location_id, priority, status,
  description, caller_name, caller_contact,
  date_logged, sla_deadline, sla_breached
) VALUES
(
  'CLS-2026-001', 4, 2, NULL,
  4, 1, 'critical', 'open',
  'Suspicious person loitering at the main gate. Subject refused to identify themselves and became aggressive when approached.',
  'John Smith', '011 717 1001',
  NOW() - INTERVAL '1 hour',
  NOW() + INTERVAL '1 hour', FALSE
),
(
  'CLS-2026-002', 4, 2, 5,
  1, 2, 'high', 'in_progress',
  'The access control panel at the Science Block entrance is unresponsive. Students and staff cannot badge in. Manual override required.',
  'Mary Jones', '011 717 1002',
  NOW() - INTERVAL '3 hours',
  NOW() + INTERVAL '1 hour', FALSE
),
(
  'CLS-2026-003', 4, 2, 6,
  2, 3, 'medium', 'resolved',
  'CCTV camera at library entrance is offline. The feed shows a black screen on the monitoring system.',
  'Peter Moyo', '011 717 1003',
  NOW() - INTERVAL '5 hours',
  NOW() + INTERVAL '3 hours', FALSE
),
(
  'CLS-2026-004', 4, 2, 6,
  5, 4, 'low', 'in_progress',
  'Loud music and noise from a gathering near the East Campus residence. Multiple complaints received from nearby study areas.',
  'Sarah Dube', '011 717 1004',
  NOW() - INTERVAL '4 hours',
  NOW() + INTERVAL '20 hours', FALSE
),
(
  'CLS-2026-007', 4, 1, 7,
  7, 7, 'critical', 'escalated',
  'Fire exit on the second floor of the Administration Block is blocked by construction equipment. This is a safety violation.',
  'Admin Staff', '011 717 1007',
  NOW() - INTERVAL '6 hours',
  NOW() - INTERVAL '4 hours', TRUE
),
(
  'CLS-2026-008', 4, 2, 8,
  1, 5, 'high', 'pending_confirmation',
  'Boom gate at the West Campus entrance is stuck in the closed position. Vehicles unable to enter or exit.',
  'Parking User', '011 717 1008',
  NOW() - INTERVAL '8 hours',
  NOW() - INTERVAL '4 hours', FALSE
),
(
  'CLS-2026-009', 4, 2, 5,
  8, 9, 'critical', 'closed',
  'Armed robbery reported near the ATM machines in the parking area. Suspect fled on foot toward East Campus.',
  'Witness', '011 717 1009',
  NOW() - INTERVAL '3 days',
  NOW() - INTERVAL '3 days' + INTERVAL '2 hours', FALSE
);

-- =====================================================
-- SEED DATA: RESOLUTION NOTES
-- Uses subqueries to find correct incident_id by ticket number
-- =====================================================
INSERT INTO resolution_notes (
  incident_id, technician_id, resolution_notes,
  internal_notes, time_spent_mins, root_cause, resolution_status, resolved_at
)
SELECT i.incident_id, 6,
  'The CCTV camera at the Library entrance was found to have a loose power connection caused by recent cable management work in the area. The power connector was re-seated and secured with cable ties to prevent recurrence. Camera feed tested and confirmed operational.',
  'Recommend follow-up inspection of all cameras in the area after the cable work is completed.',
  45, 'hardware_failure', 'resolved', NOW() - INTERVAL '2 hours'
FROM incidents i WHERE i.ticket_number = 'CLS-2026-003';

INSERT INTO resolution_notes (
  incident_id, technician_id, resolution_notes,
  internal_notes, time_spent_mins, root_cause, resolution_status, resolved_at
)
SELECT i.incident_id, 7,
  'Emergency escalated to Facilities Management and Campus Safety. Construction company notified to remove equipment immediately. Fire exit cleared and verified accessible.',
  'Construction company violated site agreement. Report filed with Facilities Management for contract review.',
  30, 'human_error', 'escalated', NOW() - INTERVAL '1 hour'
FROM incidents i WHERE i.ticket_number = 'CLS-2026-007';

INSERT INTO resolution_notes (
  incident_id, technician_id, resolution_notes,
  internal_notes, time_spent_mins, root_cause, resolution_status, resolved_at
)
SELECT i.incident_id, 8,
  'The boom gate motor at the West Campus entrance was replaced following diagnosis of complete motor failure. The replacement motor was sourced from the facilities store and installed. Gate calibrated and tested through 10 full open/close cycles without fault.',
  'Motor was at end of service life. Recommend scheduled replacement of remaining old motors.',
  120, 'hardware_failure', 'resolved', NOW() - INTERVAL '3 hours'
FROM incidents i WHERE i.ticket_number = 'CLS-2026-008';

INSERT INTO resolution_notes (
  incident_id, technician_id, resolution_notes,
  internal_notes, time_spent_mins, root_cause, resolution_status, resolved_at
)
SELECT i.incident_id, 5,
  'Incident reported to SAPS. Officers responded within 8 minutes. Suspect apprehended near East Campus. ATM area secured and CCTV footage preserved for investigation.',
  'Footage handed to SAPS case officer. Reference number: CAS-2026-0419.',
  90, 'security_breach', 'closed', NOW() - INTERVAL '3 days' + INTERVAL '90 minutes'
FROM incidents i WHERE i.ticket_number = 'CLS-2026-009';

-- =====================================================
-- SEED DATA: AUDIT TRAIL
-- =====================================================
INSERT INTO audit_trail (incident_id, performed_by, action_description, old_value, new_value) VALUES
(1, 2, 'Ticket Created — Incident logged via CPS Call Logging System', NULL, 'status: open'),
(2, 2, 'Ticket Created — Incident logged via CPS Call Logging System', NULL, 'status: open'),
(2, 1, 'Ticket Assigned — Assigned to J. Dlamini by Admin', 'assigned_to: NULL', 'assigned_to: J. Dlamini'),
(2, 1, 'Status Updated — Open → In Progress', 'status: open', 'status: in_progress'),
(3, 2, 'Ticket Created — Incident logged via CPS Call Logging System', NULL, 'status: open'),
(3, 1, 'Ticket Assigned — Assigned to T. Mokoena by Admin', 'assigned_to: NULL', 'assigned_to: T. Mokoena'),
(3, 1, 'Status Updated — Open → In Progress', 'status: open', 'status: in_progress'),
(3, 6, 'Incident Resolved — Resolution notes submitted by T. Mokoena', 'status: in_progress', 'status: resolved'),
(3, 6, 'Status Updated — Resolved → Pending Confirmation', 'status: resolved', 'status: pending_confirmation'),
(7, 1, 'Ticket Created — Incident logged via CPS Call Logging System', NULL, 'status: open'),
(7, 1, 'Ticket Assigned — Assigned to S. Nkosi by Admin', 'assigned_to: NULL', 'assigned_to: S. Nkosi'),
(7, 7, 'Incident Escalated — SLA Breached. Escalated to Facilities Management', 'status: in_progress', 'status: escalated'),
(7, 7, 'Priority Upgraded — Auto-upgraded to Critical due to SLA breach', 'priority: high', 'priority: critical'),
(8, 2, 'Ticket Created — Incident logged via CPS Call Logging System', NULL, 'status: open'),
(8, 8, 'Incident Resolved — Resolution notes submitted by M. Khumalo', 'status: in_progress', 'status: resolved'),
(9, 5, 'Ticket Closed — Confirmed and closed by caller', 'status: resolved', 'status: closed');

-- =====================================================
-- SEED DATA: CONFIRMATIONS
-- =====================================================
INSERT INTO confirmations (
  incident_id, confirmed_by, action,
  satisfaction_rating, feedback, confirmed_at
) VALUES
(
  9, 4, 'accept',
  5, 'Very satisfied with the rapid response. Officers were professional and handled the situation efficiently.',
  NOW() - INTERVAL '2 days'
);

-- =====================================================
-- SEED DATA: ESCALATIONS
-- =====================================================
INSERT INTO escalations (
  incident_id, escalated_by, escalation_reason,
  escalate_to_dept, escalation_notes, new_priority, escalated_at
) VALUES
(
  7, 7, 'sla_breach',
  'Facilities Management',
  'Fire exit has been blocked for over 4 hours. This is a critical safety and compliance violation. SLA has been breached. Immediate physical intervention required to clear the obstruction and verify compliance.',
  'critical',
  NOW() - INTERVAL '1 hour'
);

-- =====================================================
-- VIEWS FOR REPORTS
-- =====================================================

-- Resolution Time Report View
CREATE OR REPLACE VIEW v_resolution_time AS
SELECT
  i.ticket_number,
  i.priority,
  i.date_logged,
  i.date_resolved,
  i.date_closed,
  i.sla_deadline,
  i.sla_breached,
  EXTRACT(EPOCH FROM (COALESCE(i.date_resolved, NOW()) - i.date_logged)) / 3600 AS hours_open,
  u.full_name AS assigned_to_name,
  c.action AS caller_action,
  c.satisfaction_rating
FROM incidents i
LEFT JOIN users u ON i.assigned_to = u.user_id
LEFT JOIN confirmations c ON i.incident_id = c.incident_id;

-- Call Volume Report View
CREATE OR REPLACE VIEW v_call_volume AS
SELECT
  DATE_TRUNC('week', date_logged) AS week_start,
  DATE_TRUNC('day', date_logged) AS day,
  cat.category_name,
  l.location_name,
  i.priority,
  i.status,
  COUNT(*) AS incident_count
FROM incidents i
JOIN categories cat ON i.category_id = cat.category_id
JOIN locations l ON i.location_id = l.location_id
GROUP BY 1, 2, 3, 4, 5, 6;

-- Technician Performance View
CREATE OR REPLACE VIEW v_technician_performance AS
SELECT
  u.user_id,
  u.full_name,
  COUNT(i.incident_id) AS total_assigned,
  COUNT(CASE WHEN i.status IN ('resolved','closed') THEN 1 END) AS total_resolved,
  ROUND(AVG(
    CASE WHEN i.date_resolved IS NOT NULL
    THEN EXTRACT(EPOCH FROM (i.date_resolved - i.date_logged)) / 3600
    END
  )::NUMERIC, 2) AS avg_resolution_hours,
  COUNT(CASE WHEN i.sla_breached = TRUE THEN 1 END) AS sla_breaches,
  ROUND(
    (COUNT(CASE WHEN i.sla_breached = FALSE AND i.status IN ('resolved','closed') THEN 1 END)::NUMERIC /
     NULLIF(COUNT(CASE WHEN i.status IN ('resolved','closed') THEN 1 END), 0)) * 100, 1
  ) AS sla_compliance_pct,
  ROUND(AVG(c.satisfaction_rating)::NUMERIC, 1) AS avg_rating
FROM users u
LEFT JOIN incidents i ON u.user_id = i.assigned_to
LEFT JOIN confirmations c ON i.incident_id = c.incident_id
WHERE u.role IN ('technician', 'officer')
GROUP BY u.user_id, u.full_name;

-- Dashboard Summary View
CREATE OR REPLACE VIEW v_dashboard_summary AS
SELECT
  COUNT(*) AS total,
  COUNT(CASE WHEN status = 'open' THEN 1 END) AS open_count,
  COUNT(CASE WHEN status = 'in_progress' THEN 1 END) AS inprogress_count,
  COUNT(CASE WHEN status IN ('resolved','pending_confirmation') THEN 1 END) AS resolved_count,
  COUNT(CASE WHEN status = 'closed' THEN 1 END) AS closed_count,
  COUNT(CASE WHEN status = 'escalated' THEN 1 END) AS escalated_count,
  COUNT(CASE WHEN sla_breached = TRUE THEN 1 END) AS sla_breached_count,
  ROUND(AVG(
    CASE WHEN date_resolved IS NOT NULL
    THEN EXTRACT(EPOCH FROM (date_resolved - date_logged)) / 3600
    END
  )::NUMERIC, 1) AS avg_resolution_hours
FROM incidents;

-- =====================================================
-- ROW LEVEL SECURITY (RLS) — Enable for production
-- =====================================================
ALTER TABLE incidents ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_trail ENABLE ROW LEVEL SECURITY;

-- Allow all operations via service_role key (used by our API)
CREATE POLICY "Service role full access incidents"
  ON incidents FOR ALL USING (TRUE);

CREATE POLICY "Service role full access users"
  ON users FOR ALL USING (TRUE);

CREATE POLICY "Service role full access audit"
  ON audit_trail FOR ALL USING (TRUE);

-- =====================================================
-- VERIFY SETUP
-- =====================================================
SELECT 'Categories' AS tbl, COUNT(*) AS rows FROM categories
UNION ALL SELECT 'Locations', COUNT(*) FROM locations
UNION ALL SELECT 'Users', COUNT(*) FROM users
UNION ALL SELECT 'Incidents', COUNT(*) FROM incidents
UNION ALL SELECT 'Resolution Notes', COUNT(*) FROM resolution_notes
UNION ALL SELECT 'Audit Trail', COUNT(*) FROM audit_trail
UNION ALL SELECT 'Confirmations', COUNT(*) FROM confirmations
UNION ALL SELECT 'Escalations', COUNT(*) FROM escalations;
