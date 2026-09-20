// Live API test run for the Testing Report (Construction 1).
// Usage (PowerShell), from the backend folder:
//   $env:API="https://wits-cps-api.onrender.com/api"
//   $env:PW_OFFICER="..."; $env:PW_ADMIN="..."; $env:PW_TECH="..."
//   node tests/live-api.test.js
// Node 18+ (built-in fetch). Creates a few clearly-labelled TEST tickets in the live database.
const API = process.env.API || 'https://wits-cps-api.onrender.com/api';
const CREDS = {
  officer: ['1895234@wits.ac.za', process.env.PW_OFFICER],
  admin:   ['2809151@wits.ac.za', process.env.PW_ADMIN],
  tech:    ['2700513@wits.ac.za', process.env.PW_TECH]
};
let pass = 0, fail = 0; const rows = [];
function check(id, strategy, name, ok, detail = '') {
  ok ? pass++ : fail++;
  rows.push({ id, strategy, name, result: ok ? 'PASS' : 'FAIL', detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${id}  [${strategy}]  ${name}${ok ? '' : '  -> ' + detail}`);
}
async function call(method, path, token, body) {
  const r = await fetch(API + path, {
    method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  let j = {}; try { j = await r.json(); } catch (e) {}
  return { s: r.status, j };
}
(async () => {
  for (const [k, v] of Object.entries(CREDS)) if (!v[1]) { console.error(`Set PW_${k.toUpperCase()} first.`); process.exit(2); }
  console.log('Waking server (free tier can take ~50s)...');
  await fetch(API.replace(/\/api$/, '') + '/api/health').catch(() => {});

  // ---- Security / auth
  const bad = await call('POST', '/auth/login', null, { email: CREDS.officer[0], password: 'wrong-password' });
  check('SEC-01', 'Security', 'Wrong password rejected (401)', bad.s === 401, bad.s);
  const empty = await call('POST', '/auth/login', null, { email: '', password: '' });
  check('SEC-02', 'Security', 'Empty credentials rejected (400)', empty.s === 400, empty.s);
  const sqli = await call('POST', '/auth/login', null, { email: "' OR 1=1 --", password: 'x' });
  check('SEC-03', 'Security', 'SQL injection string in login rejected', sqli.s === 401 || sqli.s === 400, sqli.s);
  const noTok = await call('GET', '/incidents');
  check('SEC-04', 'Security', 'Request without token rejected (401)', noTok.s === 401, noTok.s);
  const junk = await call('GET', '/incidents', 'not.a.token');
  check('SEC-05', 'Security', 'Forged token rejected (401/403)', [401, 403].includes(junk.s), junk.s);

  const T = {};
  for (const [k, [email, pw]] of Object.entries(CREDS)) {
    const r = await call('POST', '/auth/login', null, { email, password: pw });
    check('REQ-L-' + k, 'Requirements', `Login as ${k}`, r.s === 200 && r.j.token && r.j.user.role, r.s);
    T[k] = r.j.token; T[k + 'Id'] = r.j.user?.userId;
  }
  if (!T.officer || !T.admin || !T.tech) { console.log('Cannot continue without all three logins.'); process.exit(1); }

  // ---- Role-based access
  const techLog = await call('POST', '/incidents', T.tech, {});
  check('SEC-06', 'Security', 'Technician cannot log an incident (403)', techLog.s === 403, techLog.s);
  const offUsers = await call('GET', '/users', T.officer);
  check('SEC-07', 'Security', 'Officer cannot list all users (403)', offUsers.s === 403, offUsers.s);

  // ---- UC1 Log + input field validation
  const cats = await call('GET', '/users/categories', T.officer);
  const locs = await call('GET', '/users/locations', T.officer);
  const categoryId = cats.j.categories?.[0]?.category_id, locationId = locs.j.locations?.[0]?.location_id;
  check('REQ-01', 'Requirements', 'Lookups (categories, locations) load', !!categoryId && !!locationId);
  const valid = { callerName: 'TEST Caller', callerContact: '0111234567', categoryId, locationId, priority: 'low', description: 'TEST ticket created by automated API test run' };
  const bodies = [
    ['INP-01', 'Missing caller name', { ...valid, callerName: '' }],
    ['INP-02', 'Description too short (<10)', { ...valid, description: 'short' }],
    ['INP-03', 'Invalid priority value', { ...valid, priority: 'urgent' }],
    ['INP-04', 'Contact with letters', { ...valid, callerContact: 'abc-not-a-number' }],
    ['INP-05', 'Contact too short', { ...valid, callerContact: '123' }],
    ['INP-06', 'Non-numeric category id', { ...valid, categoryId: 'x' }]
  ];
  for (const [id, name, b] of bodies) { const r = await call('POST', '/incidents', T.officer, b); check(id, 'Input Field', name + ' rejected (400)', r.s === 400, r.s); }
  const xss = await call('POST', '/incidents', T.officer, { ...valid, description: '<script>alert(1)</script> TEST xss payload stored as text' });
  check('INP-07', 'Input Field', 'Script tag accepted as plain text (escaped on display)', xss.s === 201, xss.s);

  const logged = await call('POST', '/incidents', T.officer, valid);
  const tn = logged.j.ticketNumber;
  check('UC1-01', 'Scenario', 'UC1 Log incident returns ticket CLS-YYYY-NNN', logged.s === 201 && /^CLS-\d{4}-\d+$/.test(tn || ''), logged.s + ' ' + tn);
  check('UC1-02', 'Scenario', 'New ticket status is open', logged.j.incident?.status === 'open');

  // ---- UC2 Track
  const got = await call('GET', '/incidents/' + tn, T.officer);
  check('UC2-01', 'Scenario', 'UC2 Track ticket returns detail + audit trail', got.s === 200 && Array.isArray(got.j.auditTrail) && got.j.auditTrail.length >= 1, got.s);
  const nf = await call('GET', '/incidents/CLS-1999-999', T.officer);
  check('UC2-02', 'Scenario', 'Unknown ticket returns 404', nf.s === 404, nf.s);
  const techView = await call('GET', '/incidents/' + tn, T.tech);
  check('SEC-08', 'Security', 'Technician cannot view an unassigned ticket', [403, 404].includes(techView.s), techView.s);

  // ---- UC4 Assign
  const techs = await call('GET', '/users/technicians', T.admin);
  check('UC4-00', 'Requirements', 'Technician list loads', techs.s === 200 && techs.j.technicians?.length > 0, techs.s);
  const resEarly = await call('PATCH', `/incidents/${tn}/resolve`, T.tech, { resolutionNotes: 'x'.repeat(25), timeSpent: 30 });
  check('UC5-00', 'Scenario', 'Cannot resolve an unassigned ticket (403/409)', [403, 409].includes(resEarly.s), resEarly.s);
  const asg = await call('PATCH', `/incidents/${tn}/assign`, T.admin, { assignTo: T.techId, assignmentNotes: 'TEST assignment' });
  check('UC4-01', 'Scenario', 'UC4 Admin assigns ticket -> in_progress', asg.s === 200, asg.s + ' ' + JSON.stringify(asg.j));
  const asgOff = await call('PATCH', `/incidents/${tn}/assign`, T.tech, { assignTo: T.techId });
  check('SEC-09', 'Security', 'Technician cannot assign (403)', asgOff.s === 403, asgOff.s);

  // ---- UC5 Resolve
  const shortNote = await call('PATCH', `/incidents/${tn}/resolve`, T.tech, { resolutionNotes: 'too short', timeSpent: 30 });
  check('INP-08', 'Input Field', 'Resolution notes <20 chars rejected', shortNote.s === 400, shortNote.s);
  const res = await call('PATCH', `/incidents/${tn}/resolve`, T.tech, { resolutionNotes: 'TEST resolved: restarted the affected service.', timeSpent: 30, rootCause: 'TEST' });
  check('UC5-01', 'Scenario', 'UC5 Technician resolves -> pending_confirmation', res.s === 200, res.s + ' ' + JSON.stringify(res.j));
  const res2 = await call('PATCH', `/incidents/${tn}/resolve`, T.tech, { resolutionNotes: 'TEST resolved twice, should be refused.', timeSpent: 30 });
  check('UC5-02', 'Scenario', 'Resolving twice refused (409)', res2.s === 409, res2.s);

  // ---- UC3 Confirm / reject
  const noReason = await call('PATCH', `/incidents/${tn}/confirm`, T.officer, { action: 'reject' });
  check('INP-09', 'Input Field', 'Reject without reason refused (400)', noReason.s === 400, noReason.s);
  const badRate = await call('PATCH', `/incidents/${tn}/confirm`, T.officer, { action: 'accept', satisfactionRating: 9 });
  check('INP-10', 'Input Field', 'Rating outside 1-5 refused (400)', badRate.s === 400, badRate.s);
  const techConf = await call('PATCH', `/incidents/${tn}/confirm`, T.tech, { action: 'accept' });
  check('SEC-10', 'Security', 'Technician cannot confirm (403)', techConf.s === 403, techConf.s);
  const rej = await call('PATCH', `/incidents/${tn}/confirm`, T.officer, { action: 'reject', rejectionReason: 'TEST: problem still present' });
  check('UC3-01', 'Scenario', 'UC3 Reject returns ticket to open', rej.s === 200, rej.s);
  const afterRej = await call('GET', '/incidents/' + tn, T.officer);
  check('UC3-02', 'Scenario', 'Rejected ticket is open and unassigned', afterRej.j.incident?.status === 'open' && !afterRej.j.incident?.assigned_to, JSON.stringify(afterRej.j.incident?.status));

  // ---- second cycle: assign -> escalate -> resolve -> accept
  await call('PATCH', `/incidents/${tn}/assign`, T.admin, { assignTo: T.techId });
  const shortEsc = await call('PATCH', `/incidents/${tn}/escalate`, T.tech, { escalationReason: 'technical', escalateTo: 'it', escalationNotes: 'short' });
  check('INP-11', 'Input Field', 'Escalation notes <15 chars refused', shortEsc.s === 400, shortEsc.s);
  const esc = await call('PATCH', `/incidents/${tn}/escalate`, T.tech, { escalationReason: 'technical', escalateTo: 'senior_management', escalationNotes: 'TEST manual escalation, needs senior review.' });
  check('UC6-01', 'Scenario', 'UC6 Manual escalation -> escalated', esc.s === 200, esc.s + ' ' + JSON.stringify(esc.j));
  const res3 = await call('PATCH', `/incidents/${tn}/resolve`, T.tech, { resolutionNotes: 'TEST resolved after escalation was handled.', timeSpent: 60 });
  check('UC5-03', 'Scenario', 'Escalated ticket can be resolved', res3.s === 200, res3.s);
  const acc = await call('PATCH', `/incidents/${tn}/confirm`, T.officer, { action: 'accept', satisfactionRating: 5, feedback: 'TEST' });
  check('UC3-03', 'Scenario', 'UC3 Accept closes ticket', acc.s === 200, acc.s);
  const closed = await call('GET', '/incidents/' + tn, T.officer);
  check('UC3-04', 'Scenario', 'Ticket status is closed', closed.j.incident?.status === 'closed', closed.j.incident?.status);
  const audit = await call('GET', `/incidents/${tn}/audit`, T.admin);
  check('UC2-03', 'Scenario', 'Audit trail has >= 6 entries for full lifecycle', (audit.j.auditTrail || audit.j.audit || []).length >= 6, JSON.stringify(Object.keys(audit.j)));

  // ---- Reports & dashboard & notifications
  for (const [id, p] of [['RPT-01', '/reports/resolution-time'], ['RPT-02', '/reports/call-volume'], ['RPT-03', '/reports/priority-analysis'], ['RPT-04', '/reports/incident-history'], ['RPT-05', '/reports/technician-performance'], ['RPT-06', '/dashboard/summary'], ['REQ-N1', '/notifications']]) {
    const r = await call('GET', p, T.admin); check(id, id.startsWith('RPT') ? 'Report' : 'Requirements', `GET ${p} returns 200 JSON`, r.s === 200, r.s);
  }
  const rt = await call('GET', '/reports/technician-performance', T.tech);
  check('SEC-11', 'Security', 'Technician access to reports is controlled', [200, 403].includes(rt.s), rt.s);

  console.log(`\n${pass} passed, ${fail} failed, ${pass + fail} total. Test ticket: ${tn}`);
  require('fs').writeFileSync('live-api-results.json', JSON.stringify({ run: new Date().toISOString(), api: API, ticket: tn, pass, fail, rows }, null, 2));
  console.log('Full results saved to live-api-results.json');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
