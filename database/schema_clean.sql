-- =====================================================
-- WITS CPS — CLEAN FULL SETUP SCRIPT
-- Run this ENTIRE script at once in Supabase SQL Editor
-- =====================================================

-- STEP 1: Enable UUID
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- STEP 2: Drop everything cleanly
DROP TABLE IF EXISTS notifications      CASCADE;
DROP TABLE IF EXISTS audit_trail        CASCADE;
DROP TABLE IF EXISTS confirmations      CASCADE;
DROP TABLE IF EXISTS escalations        CASCADE;
DROP TABLE IF EXISTS resolution_notes   CASCADE;
DROP TABLE IF EXISTS incidents          CASCADE;
DROP TABLE IF EXISTS users              CASCADE;
DROP TABLE IF EXISTS categories         CASCADE;
DROP TABLE IF EXISTS locations          CASCADE;
DROP VIEW  IF EXISTS v_resolution_time  CASCADE;
DROP VIEW  IF EXISTS v_call_volume      CASCADE;
DROP VIEW  IF EXISTS v_technician_performance CASCADE;
DROP VIEW  IF EXISTS v_dashboard_summary      CASCADE;

-- STEP 3: Create tables
CREATE TABLE categories (
  category_id   SERIAL PRIMARY KEY,
  category_name VARCHAR(100) NOT NULL UNIQUE,
  is_active     BOOLEAN DEFAULT TRUE
);

CREATE TABLE locations (
  location_id   SERIAL PRIMARY KEY,
  location_name VARCHAR(100) NOT NULL UNIQUE,
  building      VARCHAR(100),
  is_active     BOOLEAN DEFAULT TRUE
);

CREATE TABLE users (
  user_id       SERIAL PRIMARY KEY,
  full_name     VARCHAR(150) NOT NULL,
  email         VARCHAR(150) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  role          VARCHAR(20)  NOT NULL
                CHECK (role IN ('admin','officer','technician','caller')),
  is_active     BOOLEAN   DEFAULT TRUE,
  created_at    TIMESTAMP DEFAULT NOW(),
  updated_at    TIMESTAMP DEFAULT NOW()
);

CREATE TABLE incidents (
  incident_id      SERIAL PRIMARY KEY,
  ticket_number    VARCHAR(20) NOT NULL UNIQUE,
  caller_id        INTEGER REFERENCES users(user_id),
  logged_by        INTEGER REFERENCES users(user_id),
  assigned_to      INTEGER REFERENCES users(user_id),
  category_id      INTEGER REFERENCES categories(category_id),
  location_id      INTEGER REFERENCES locations(location_id),
  priority         VARCHAR(10)  NOT NULL
                   CHECK (priority IN ('low','medium','high','critical')),
  status           VARCHAR(25)  NOT NULL DEFAULT 'open'
                   CHECK (status IN (
                     'open','in_progress','resolved',
                     'pending_confirmation','closed','escalated','cancelled'
                   )),
  description      TEXT         NOT NULL,
  caller_name      VARCHAR(150),
  caller_contact   VARCHAR(50),
  date_logged      TIMESTAMP    DEFAULT NOW(),
  date_assigned    TIMESTAMP,
  date_resolved    TIMESTAMP,
  date_closed      TIMESTAMP,
  time_spent_mins  INTEGER,
  root_cause       VARCHAR(50),
  sla_deadline     TIMESTAMP,
  sla_breached     BOOLEAN      DEFAULT FALSE,
  additional_notes TEXT,
  created_at       TIMESTAMP    DEFAULT NOW(),
  updated_at       TIMESTAMP    DEFAULT NOW()
);

CREATE TABLE resolution_notes (
  note_id           SERIAL PRIMARY KEY,
  incident_id       INTEGER NOT NULL REFERENCES incidents(incident_id) ON DELETE CASCADE,
  technician_id     INTEGER REFERENCES users(user_id),
  resolution_notes  TEXT    NOT NULL,
  internal_notes    TEXT,
  time_spent_mins   INTEGER,
  root_cause        VARCHAR(50),
  resolution_status VARCHAR(20)
                    CHECK (resolution_status IN ('resolved','closed','escalated')),
  resolved_at       TIMESTAMP DEFAULT NOW()
);

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

CREATE TABLE confirmations (
  confirmation_id     SERIAL PRIMARY KEY,
  incident_id         INTEGER NOT NULL REFERENCES incidents(incident_id) ON DELETE CASCADE,
  confirmed_by        INTEGER REFERENCES users(user_id),
  action              VARCHAR(10) NOT NULL CHECK (action IN ('accept','reject')),
  satisfaction_rating INTEGER     CHECK (satisfaction_rating BETWEEN 1 AND 5),
  feedback            TEXT,
  rejection_reason    TEXT,
  confirmed_at        TIMESTAMP DEFAULT NOW()
);

CREATE TABLE audit_trail (
  audit_id           SERIAL PRIMARY KEY,
  incident_id        INTEGER NOT NULL REFERENCES incidents(incident_id) ON DELETE CASCADE,
  performed_by       INTEGER REFERENCES users(user_id),
  action_description TEXT    NOT NULL,
  old_value          TEXT,
  new_value          TEXT,
  action_time        TIMESTAMP DEFAULT NOW()
);

CREATE TABLE notifications (
  notification_id   SERIAL PRIMARY KEY,
  incident_id       INTEGER REFERENCES incidents(incident_id) ON DELETE CASCADE,
  recipient_id      INTEGER REFERENCES users(user_id),
  notification_type VARCHAR(30) NOT NULL,
  channel           VARCHAR(10) DEFAULT 'email'
                    CHECK (channel IN ('email','sms','both')),
  message           TEXT NOT NULL,
  is_sent           BOOLEAN   DEFAULT FALSE,
  sent_at           TIMESTAMP,
  created_at        TIMESTAMP DEFAULT NOW()
);

-- STEP 4: Indexes
CREATE INDEX idx_incidents_status      ON incidents(status);
CREATE INDEX idx_incidents_priority    ON incidents(priority);
CREATE INDEX idx_incidents_assigned    ON incidents(assigned_to);
CREATE INDEX idx_incidents_caller      ON incidents(caller_id);
CREATE INDEX idx_incidents_date        ON incidents(date_logged);
CREATE INDEX idx_audit_incident        ON audit_trail(incident_id);

-- STEP 5: Auto-update trigger
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_incidents_updated
  BEFORE UPDATE ON incidents
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_users_updated
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- STEP 6: Seed categories
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

-- STEP 7: Seed locations
INSERT INTO locations (location_name, building) VALUES
  ('Main Gate',            'Campus Entrance'),
  ('Science Block',        'FNB Building'),
  ('Library',              'Wartenweiler Library'),
  ('East Campus',          'East Campus'),
  ('West Campus',          'West Campus'),
  ('Student Residence',    'Barnato Hall'),
  ('Administration Block', 'Senate House'),
  ('Sports Fields',        'Sports Complex'),
  ('Parking Area',         'Parking Deck'),
  ('Medical School',       'Health Sciences'),
  ('Great Hall',           'Great Hall'),
  ('Other',                'Other');

-- STEP 8: Seed users
-- All passwords = "password123" (bcrypt hash)
INSERT INTO users (full_name, email, password_hash, role) VALUES
  ('System Admin',     'admin@wits.ac.za',    '$2b$10$rIC3ZHvCMbNFSqT7kWXWVutB0XHGnV0YKmVuV7KV7V7KV7V7KV7Ve', 'admin'),
  ('Security Officer', 'officer@wits.ac.za',  '$2b$10$rIC3ZHvCMbNFSqT7kWXWVutB0XHGnV0YKmVuV7KV7V7KV7V7KV7Ve', 'officer'),
  ('Technician User',  'tech@wits.ac.za',     '$2b$10$rIC3ZHvCMbNFSqT7kWXWVutB0XHGnV0YKmVuV7KV7V7KV7V7KV7Ve', 'technician'),
  ('Caller User',      'caller@wits.ac.za',   '$2b$10$rIC3ZHvCMbNFSqT7kWXWVutB0XHGnV0YKmVuV7KV7V7KV7V7KV7Ve', 'caller'),
  ('J. Dlamini',       'dlamini@wits.ac.za',  '$2b$10$rIC3ZHvCMbNFSqT7kWXWVutB0XHGnV0YKmVuV7KV7V7KV7V7KV7Ve', 'technician'),
  ('T. Mokoena',       'mokoena@wits.ac.za',  '$2b$10$rIC3ZHvCMbNFSqT7kWXWVutB0XHGnV0YKmVuV7KV7V7KV7V7KV7Ve', 'technician'),
  ('S. Nkosi',         'nkosi@wits.ac.za',    '$2b$10$rIC3ZHvCMbNFSqT7kWXWVutB0XHGnV0YKmVuV7KV7V7KV7V7KV7Ve', 'technician'),
  ('M. Khumalo',       'khumalo@wits.ac.za',  '$2b$10$rIC3ZHvCMbNFSqT7kWXWVutB0XHGnV0YKmVuV7KV7V7KV7V7KV7Ve', 'technician');

-- STEP 9: Seed incidents (uses subqueries for all FKs)
INSERT INTO incidents (
  ticket_number, caller_id, logged_by, assigned_to,
  category_id, location_id, priority, status,
  description, caller_name, caller_contact,
  date_logged, sla_deadline, sla_breached
)
SELECT
  'CLS-2026-001',
  (SELECT user_id FROM users WHERE email='caller@wits.ac.za'),
  (SELECT user_id FROM users WHERE email='officer@wits.ac.za'),
  NULL,
  (SELECT category_id FROM categories WHERE category_name='Security Threat'),
  (SELECT location_id FROM locations WHERE location_name='Main Gate'),
  'critical', 'open',
  'Suspicious person loitering at the main gate. Subject refused to identify themselves and became aggressive when approached.',
  'John Smith', '011 717 1001',
  NOW() - INTERVAL '1 hour',
  NOW() + INTERVAL '1 hour', FALSE;

INSERT INTO incidents (
  ticket_number, caller_id, logged_by, assigned_to,
  category_id, location_id, priority, status,
  description, caller_name, caller_contact,
  date_logged, date_assigned, sla_deadline, sla_breached
)
SELECT
  'CLS-2026-002',
  (SELECT user_id FROM users WHERE email='caller@wits.ac.za'),
  (SELECT user_id FROM users WHERE email='officer@wits.ac.za'),
  (SELECT user_id FROM users WHERE email='dlamini@wits.ac.za'),
  (SELECT category_id FROM categories WHERE category_name='Access Control'),
  (SELECT location_id FROM locations WHERE location_name='Science Block'),
  'high', 'in_progress',
  'The access control panel at the Science Block entrance is unresponsive. Students and staff cannot badge in.',
  'Mary Jones', '011 717 1002',
  NOW() - INTERVAL '3 hours',
  NOW() - INTERVAL '2 hours',
  NOW() + INTERVAL '1 hour', FALSE;

INSERT INTO incidents (
  ticket_number, caller_id, logged_by, assigned_to,
  category_id, location_id, priority, status,
  description, caller_name, caller_contact,
  date_logged, date_assigned, date_resolved, sla_deadline, sla_breached
)
SELECT
  'CLS-2026-003',
  (SELECT user_id FROM users WHERE email='caller@wits.ac.za'),
  (SELECT user_id FROM users WHERE email='officer@wits.ac.za'),
  (SELECT user_id FROM users WHERE email='mokoena@wits.ac.za'),
  (SELECT category_id FROM categories WHERE category_name='CCTV / Surveillance'),
  (SELECT location_id FROM locations WHERE location_name='Library'),
  'medium', 'pending_confirmation',
  'CCTV camera at library entrance is offline. The feed shows a black screen on the monitoring system.',
  'Peter Moyo', '011 717 1003',
  NOW() - INTERVAL '5 hours',
  NOW() - INTERVAL '4 hours',
  NOW() - INTERVAL '2 hours',
  NOW() + INTERVAL '3 hours', FALSE;

INSERT INTO incidents (
  ticket_number, caller_id, logged_by, assigned_to,
  category_id, location_id, priority, status,
  description, caller_name, caller_contact,
  date_logged, date_assigned, sla_deadline, sla_breached
)
SELECT
  'CLS-2026-004',
  (SELECT user_id FROM users WHERE email='caller@wits.ac.za'),
  (SELECT user_id FROM users WHERE email='officer@wits.ac.za'),
  (SELECT user_id FROM users WHERE email='mokoena@wits.ac.za'),
  (SELECT category_id FROM categories WHERE category_name='Noise Complaint'),
  (SELECT location_id FROM locations WHERE location_name='East Campus'),
  'low', 'in_progress',
  'Loud music and noise from a gathering near the East Campus residence. Multiple complaints received.',
  'Sarah Dube', '011 717 1004',
  NOW() - INTERVAL '4 hours',
  NOW() - INTERVAL '3 hours',
  NOW() + INTERVAL '20 hours', FALSE;

INSERT INTO incidents (
  ticket_number, caller_id, logged_by, assigned_to,
  category_id, location_id, priority, status,
  description, caller_name, caller_contact,
  date_logged, date_assigned, sla_deadline, sla_breached
)
SELECT
  'CLS-2026-007',
  (SELECT user_id FROM users WHERE email='caller@wits.ac.za'),
  (SELECT user_id FROM users WHERE email='admin@wits.ac.za'),
  (SELECT user_id FROM users WHERE email='nkosi@wits.ac.za'),
  (SELECT category_id FROM categories WHERE category_name='Fire / Safety'),
  (SELECT location_id FROM locations WHERE location_name='Administration Block'),
  'critical', 'escalated',
  'Fire exit on the second floor of the Administration Block is blocked by construction equipment.',
  'Admin Staff', '011 717 1007',
  NOW() - INTERVAL '6 hours',
  NOW() - INTERVAL '5 hours',
  NOW() - INTERVAL '4 hours', TRUE;

INSERT INTO incidents (
  ticket_number, caller_id, logged_by, assigned_to,
  category_id, location_id, priority, status,
  description, caller_name, caller_contact,
  date_logged, date_assigned, date_resolved, sla_deadline, sla_breached
)
SELECT
  'CLS-2026-008',
  (SELECT user_id FROM users WHERE email='caller@wits.ac.za'),
  (SELECT user_id FROM users WHERE email='officer@wits.ac.za'),
  (SELECT user_id FROM users WHERE email='khumalo@wits.ac.za'),
  (SELECT category_id FROM categories WHERE category_name='Access Control'),
  (SELECT location_id FROM locations WHERE location_name='West Campus'),
  'high', 'pending_confirmation',
  'Boom gate at the West Campus entrance is stuck in the closed position. Vehicles unable to enter or exit.',
  'Parking User', '011 717 1008',
  NOW() - INTERVAL '8 hours',
  NOW() - INTERVAL '7 hours',
  NOW() - INTERVAL '3 hours',
  NOW() - INTERVAL '4 hours', FALSE;

INSERT INTO incidents (
  ticket_number, caller_id, logged_by, assigned_to,
  category_id, location_id, priority, status,
  description, caller_name, caller_contact,
  date_logged, date_assigned, date_resolved, date_closed, sla_deadline, sla_breached
)
SELECT
  'CLS-2026-009',
  (SELECT user_id FROM users WHERE email='caller@wits.ac.za'),
  (SELECT user_id FROM users WHERE email='officer@wits.ac.za'),
  (SELECT user_id FROM users WHERE email='dlamini@wits.ac.za'),
  (SELECT category_id FROM categories WHERE category_name='Theft / Robbery'),
  (SELECT location_id FROM locations WHERE location_name='Parking Area'),
  'critical', 'closed',
  'Armed robbery reported near the ATM machines in the parking area. Suspect fled on foot toward East Campus.',
  'Witness', '011 717 1009',
  NOW() - INTERVAL '3 days',
  NOW() - INTERVAL '3 days' + INTERVAL '15 minutes',
  NOW() - INTERVAL '3 days' + INTERVAL '90 minutes',
  NOW() - INTERVAL '2 days',
  NOW() - INTERVAL '3 days' + INTERVAL '2 hours', FALSE;

-- STEP 10: Seed resolution notes (all subqueries - no hardcoded IDs)
INSERT INTO resolution_notes (
  incident_id, technician_id, resolution_notes, internal_notes,
  time_spent_mins, root_cause, resolution_status, resolved_at
)
SELECT
  (SELECT incident_id FROM incidents WHERE ticket_number='CLS-2026-003'),
  (SELECT user_id FROM users WHERE email='mokoena@wits.ac.za'),
  'The CCTV camera at the Library entrance was found to have a loose power connection caused by recent cable management work. The connector was re-seated and secured. Camera feed tested and confirmed operational.',
  'Recommend follow-up inspection of all cameras after cable work is completed.',
  45, 'hardware_failure', 'resolved', NOW() - INTERVAL '2 hours';

INSERT INTO resolution_notes (
  incident_id, technician_id, resolution_notes, internal_notes,
  time_spent_mins, root_cause, resolution_status, resolved_at
)
SELECT
  (SELECT incident_id FROM incidents WHERE ticket_number='CLS-2026-007'),
  (SELECT user_id FROM users WHERE email='nkosi@wits.ac.za'),
  'Emergency escalated to Facilities Management. Construction company notified to remove equipment. Fire exit cleared and verified accessible.',
  'Construction company violated site agreement. Report filed with Facilities Management.',
  30, 'human_error', 'escalated', NOW() - INTERVAL '1 hour';

INSERT INTO resolution_notes (
  incident_id, technician_id, resolution_notes, internal_notes,
  time_spent_mins, root_cause, resolution_status, resolved_at
)
SELECT
  (SELECT incident_id FROM incidents WHERE ticket_number='CLS-2026-008'),
  (SELECT user_id FROM users WHERE email='khumalo@wits.ac.za'),
  'The boom gate motor at the West Campus entrance was replaced following diagnosis of complete motor failure. Gate calibrated and tested through 10 full open/close cycles without fault.',
  'Motor was at end of service life. Recommend scheduled replacement of remaining old motors.',
  120, 'hardware_failure', 'resolved', NOW() - INTERVAL '3 hours';

INSERT INTO resolution_notes (
  incident_id, technician_id, resolution_notes, internal_notes,
  time_spent_mins, root_cause, resolution_status, resolved_at
)
SELECT
  (SELECT incident_id FROM incidents WHERE ticket_number='CLS-2026-009'),
  (SELECT user_id FROM users WHERE email='dlamini@wits.ac.za'),
  'Incident reported to SAPS. Officers responded within 8 minutes. Suspect apprehended near East Campus. ATM area secured and CCTV footage preserved.',
  'Footage handed to SAPS case officer. Reference: CAS-2026-0419.',
  90, 'security_breach', 'closed', NOW() - INTERVAL '3 days' + INTERVAL '90 minutes';

-- STEP 11: Seed audit trail
INSERT INTO audit_trail (incident_id, performed_by, action_description, old_value, new_value)
SELECT (SELECT incident_id FROM incidents WHERE ticket_number='CLS-2026-001'),
  (SELECT user_id FROM users WHERE email='officer@wits.ac.za'),
  'Ticket Created — Incident logged via CPS Call Logging System', NULL, 'status: open';

INSERT INTO audit_trail (incident_id, performed_by, action_description, old_value, new_value)
SELECT (SELECT incident_id FROM incidents WHERE ticket_number='CLS-2026-002'),
  (SELECT user_id FROM users WHERE email='officer@wits.ac.za'),
  'Ticket Created — Incident logged via CPS Call Logging System', NULL, 'status: open';

INSERT INTO audit_trail (incident_id, performed_by, action_description, old_value, new_value)
SELECT (SELECT incident_id FROM incidents WHERE ticket_number='CLS-2026-002'),
  (SELECT user_id FROM users WHERE email='admin@wits.ac.za'),
  'Ticket Assigned — Assigned to J. Dlamini by Admin', 'assigned_to: NULL', 'assigned_to: J. Dlamini';

INSERT INTO audit_trail (incident_id, performed_by, action_description, old_value, new_value)
SELECT (SELECT incident_id FROM incidents WHERE ticket_number='CLS-2026-003'),
  (SELECT user_id FROM users WHERE email='mokoena@wits.ac.za'),
  'Incident Resolved — Resolution notes submitted by T. Mokoena', 'status: in_progress', 'status: pending_confirmation';

INSERT INTO audit_trail (incident_id, performed_by, action_description, old_value, new_value)
SELECT (SELECT incident_id FROM incidents WHERE ticket_number='CLS-2026-007'),
  (SELECT user_id FROM users WHERE email='nkosi@wits.ac.za'),
  'Incident Escalated — SLA Breached. Escalated to Facilities Management', 'status: in_progress', 'status: escalated';

INSERT INTO audit_trail (incident_id, performed_by, action_description, old_value, new_value)
SELECT (SELECT incident_id FROM incidents WHERE ticket_number='CLS-2026-009'),
  (SELECT user_id FROM users WHERE email='caller@wits.ac.za'),
  'Ticket Confirmed and Closed — Accepted by caller', 'status: resolved', 'status: closed';

-- STEP 12: Seed confirmations
INSERT INTO confirmations (incident_id, confirmed_by, action, satisfaction_rating, feedback, confirmed_at)
SELECT
  (SELECT incident_id FROM incidents WHERE ticket_number='CLS-2026-009'),
  (SELECT user_id FROM users WHERE email='caller@wits.ac.za'),
  'accept', 5,
  'Very satisfied with the rapid response. Officers were professional and handled the situation efficiently.',
  NOW() - INTERVAL '2 days';

-- STEP 13: Seed escalations
INSERT INTO escalations (incident_id, escalated_by, escalation_reason, escalate_to_dept, escalation_notes, new_priority)
SELECT
  (SELECT incident_id FROM incidents WHERE ticket_number='CLS-2026-007'),
  (SELECT user_id FROM users WHERE email='nkosi@wits.ac.za'),
  'sla_breach', 'Facilities Management',
  'Fire exit blocked for over 4 hours. Critical safety violation. SLA breached. Immediate intervention required.',
  'critical';

-- STEP 14: Verify all tables populated correctly
SELECT 'categories'      AS tbl, COUNT(*) AS rows FROM categories      UNION ALL
SELECT 'locations',               COUNT(*)          FROM locations       UNION ALL
SELECT 'users',                   COUNT(*)          FROM users           UNION ALL
SELECT 'incidents',               COUNT(*)          FROM incidents       UNION ALL
SELECT 'resolution_notes',        COUNT(*)          FROM resolution_notes UNION ALL
SELECT 'audit_trail',             COUNT(*)          FROM audit_trail     UNION ALL
SELECT 'confirmations',           COUNT(*)          FROM confirmations   UNION ALL
SELECT 'escalations',             COUNT(*)          FROM escalations
ORDER BY tbl;
