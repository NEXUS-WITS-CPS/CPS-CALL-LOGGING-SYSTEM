-- Step B3: asset register, spare parts, equipment removal/repair tracking, preventive maintenance.
-- Run BEFORE deploying the matching backend code. Safe to run more than once.

-- 1. Equipment register
CREATE TABLE IF NOT EXISTS assets (
  asset_id       serial PRIMARY KEY,
  asset_tag      text NOT NULL UNIQUE,                 -- e.g. CPS-BOOM-0012 (label on the equipment)
  serial_number  text,
  name           text NOT NULL,                        -- e.g. Yale North entrance boom gate
  asset_type     text NOT NULL DEFAULT 'other',        -- boom_gate, turnstile, reader, camera, door_controller, alarm_panel, other
  location_id    integer REFERENCES locations(location_id),
  criticality    text NOT NULL DEFAULT 'medium' CHECK (criticality IN ('critical','high','medium','low')),
  status         text NOT NULL DEFAULT 'in_service' CHECK (status IN ('in_service','removed','in_repair','decommissioned')),
  supplier       text,
  install_date  date,
  warranty_expiry date,
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- 2. Link tickets to equipment
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS asset_id integer REFERENCES assets(asset_id);

-- 3. Spare parts used on a ticket
CREATE TABLE IF NOT EXISTS spare_parts_used (
  part_id      serial PRIMARY KEY,
  incident_id  integer NOT NULL REFERENCES incidents(incident_id),
  part_name    text NOT NULL,
  part_number  text,
  quantity     integer NOT NULL DEFAULT 1 CHECK (quantity > 0),
  notes        text,
  recorded_by  integer REFERENCES users(user_id),
  recorded_at  timestamptz NOT NULL DEFAULT now()
);

-- 4. Equipment removal / repair tracking
CREATE TABLE IF NOT EXISTS asset_movements (
  movement_id  serial PRIMARY KEY,
  asset_id     integer NOT NULL REFERENCES assets(asset_id),
  incident_id  integer REFERENCES incidents(incident_id),
  action       text NOT NULL CHECK (action IN ('removed','sent_for_repair','returned','replaced')),
  notes        text,
  expected_return date,
  performed_by integer REFERENCES users(user_id),
  performed_at timestamptz NOT NULL DEFAULT now()
);

-- 5. Preventive maintenance
CREATE TABLE IF NOT EXISTS maintenance_schedules (
  schedule_id   serial PRIMARY KEY,
  asset_id      integer NOT NULL REFERENCES assets(asset_id),
  title         text NOT NULL,                         -- e.g. Quarterly boom gate service
  interval_days integer NOT NULL CHECK (interval_days > 0),
  next_due      date NOT NULL,
  last_done     date,
  is_active     boolean NOT NULL DEFAULT true,
  created_by    integer REFERENCES users(user_id),
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS maintenance_log (
  log_id       serial PRIMARY KEY,
  schedule_id  integer NOT NULL REFERENCES maintenance_schedules(schedule_id),
  asset_id     integer NOT NULL REFERENCES assets(asset_id),
  done_by      integer REFERENCES users(user_id),
  done_at      timestamptz NOT NULL DEFAULT now(),
  notes        text
);

-- 6. Lock the new tables away from the public anon key (backend uses the service key)
ALTER TABLE assets                ENABLE ROW LEVEL SECURITY;
ALTER TABLE spare_parts_used      ENABLE ROW LEVEL SECURITY;
ALTER TABLE asset_movements       ENABLE ROW LEVEL SECURITY;
ALTER TABLE maintenance_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE maintenance_log       ENABLE ROW LEVEL SECURITY;

-- 7. Starter equipment so the screens have something to show (edit freely)
INSERT INTO assets (asset_tag, serial_number, name, asset_type, location_id, criticality, supplier)
SELECT v.tag, v.serial, v.name, v.type, (SELECT location_id FROM locations WHERE location_name = v.loc LIMIT 1), v.crit, v.supplier
FROM (VALUES
  ('CPS-BOOM-001','YL-N-20418','Yale North entrance boom gate',          'boom_gate',       'Main Gate',    'critical','Yale'),
  ('CPS-READ-001','WV-77310', 'Main Gate wave reader',                   'reader',          'Main Gate',    'high',    'Wave'),
  ('CPS-DOOR-001','MG-55102', 'Library ground-floor maglock door',       'door_controller', 'Library',      'high',    'Yale'),
  ('CPS-TURN-001','TS-88231', 'East Campus perimeter exit turnstile',    'turnstile',       'East Campus',  'medium',  'Gunnebo'),
  ('CPS-EDR-001', 'ED-31907', 'East Campus emergency door controller',   'door_controller', 'East Campus',  'critical','Honeywell'),
  ('CPS-CAM-001', 'HK-90417', 'Parking Area entrance camera',            'camera',          'Parking Area', 'medium',  'Hikvision'),
  ('CPS-CAM-002', 'HK-90422', 'Great Hall foyer camera',                 'camera',          'Great Hall',   'low',     'Hikvision')
) AS v(tag, serial, name, type, loc, crit, supplier)
ON CONFLICT (asset_tag) DO NOTHING;

-- Check
SELECT (SELECT count(*) FROM assets) AS assets, (SELECT count(*) FROM spare_parts_used) AS parts,
       (SELECT count(*) FROM asset_movements) AS movements, (SELECT count(*) FROM maintenance_schedules) AS schedules;
