-- Step A2: replace vague / test descriptions with specific, realistic ones.
-- Review the wording first: details (floors, doors, times) are illustrative demo data.
-- Safe to re-run. A backup of the originals is kept in incidents_description_backup.

CREATE TABLE IF NOT EXISTS incidents_description_backup AS
  SELECT incident_id, ticket_number, description FROM incidents;

UPDATE incidents i SET description = v.new_desc
FROM (VALUES
 ('CLS-2026-001','Library 2nd floor emergency exit sign is not illuminated and needs a replacement lamp. Fire marshal reported it during the evening walk-through.'),
 ('CLS-2026-002','Section of the boundary wall at East Campus has collapsed next to the walkway. Bricks are on the path; area needs to be cordoned off and inspected.'),
 ('CLS-2026-003','Loud music and shouting from a Student Residence common room after 23:00. Neighbouring residents have complained; the first warning was ignored.'),
 ('CLS-2026-004','Unidentified male in a dark jacket loitering in the Parking Area and trying car door handles. Left on foot towards the main road before patrol arrived.'),
 ('CLS-2026-006','Large crowd gathering outside the Great Hall entrance and blocking the walkway. Crowd control and an alternative access route are needed.'),
 ('CLS-2026-007','About 200 students gathering on the Great Hall steps ahead of an event. Entrance partially blocked; marshals requested to manage the queue.'),
 ('CLS-2026-008','Two unknown persons loitering near the West Campus building entrance after hours. Neither could present a valid access card.'),
 ('CLS-2026-011','Library basement stairwell access door is being propped open. Reader shows a door-held-open alarm and the door will not re-lock.'),
 ('CLS-2026-012','Faulty plug socket at the Commerce Library sparks when a device is plugged in. Socket has been taped off; electrician needed.'),
 ('CLS-2026-013','Graffiti sprayed on the Student Residence entrance wall and a ground-floor window broken overnight. CCTV footage to be reviewed.'),
 ('CLS-2026-014','Library ground-floor main access door maglock is not releasing after a valid permit tag is presented. Reader beeps "accepted" but the door stays locked.'),
 ('CLS-2026-015','Fire extinguisher in the Science Block corridor is missing from its bracket. Replacement unit required before the next fire inspection.'),
 ('CLS-2026-018','Perimeter exit turnstile at the East Campus gate is free-wheeling and does not lock after a person passes through. Allows unauthorised entry in reverse.'),
 ('CLS-2026-019','Cracked plaster on the Great Hall side-corridor wall with debris falling onto the walkway. Area needs to be made safe.'),
 ('CLS-2026-020','Car alarm sounding continuously in the Parking Area for more than 30 minutes. Owner could not be traced.'),
 ('CLS-2026-022','Wave reader at the Main Gate vehicle entrance does not release the boom after a successful biometric authentication. Reader shows green but the boom stays down.'),
 ('CLS-2026-023','Camera covering the Parking Area entrance shows "no signal" on the control room monitor since this morning. Cable and power at the camera not yet checked.'),
 ('CLS-2026-024','East Campus camera image is frozen on the same frame and has not updated for several hours. Recording appears to have stopped.'),
 ('CLS-2026-025','Main Gate pedestrian camera shows a heavily blurred image and cannot be used to identify faces. Lens may be dirty or out of focus.'),
 ('CLS-2026-026','Fire alarm panel at the Great Hall shows a fault on zone 2. No fire or smoke found on inspection; panel needs to be reset and checked.'),
 ('CLS-2026-027','West Campus camera image flickers with horizontal lines at night. Footage is unusable after dark.'),
 ('CLS-2026-029','Great Hall foyer camera is offline with no image on the monitor. Power LED on the camera is off.'),
 ('CLS-2026-030','Emergency door controller (EDR) at the East Campus building has been activated and needs resetting. Door is released and the panel alarm is sounding.')
) AS v(ticket_number, new_desc)
WHERE i.ticket_number = v.ticket_number;

-- Check: anything still very short?
SELECT ticket_number, description FROM incidents WHERE length(description) < 40 ORDER BY ticket_number;
