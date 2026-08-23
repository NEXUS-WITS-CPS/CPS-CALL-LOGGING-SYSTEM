// =====================================================
// WITS CPS CALL LOGGING SYSTEM — MAIN.JS
// Connects original Iteration 2 design to Railway API
// Team 20 · NEXUS · Iteration 3
// =====================================================

const API_BASE = 'https://cps-call-logging-system-production.up.railway.app/api';

// ── AUTH HELPERS ──
function getToken()  { return sessionStorage.getItem('cps_token'); }
function getUser()   { return JSON.parse(sessionStorage.getItem('cps_user') || 'null'); }
function setSession(token, user) {
  sessionStorage.setItem('cps_token', token);
  sessionStorage.setItem('cps_user', JSON.stringify(user));
}
function clearSession() {
  sessionStorage.removeItem('cps_token');
  sessionStorage.removeItem('cps_user');
}

// ── API FETCH WRAPPER ──
async function apiFetch(endpoint, options = {}) {
  const token = getToken();
  const res = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
      ...(options.headers || {})
    }
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `Request failed: ${res.status}`);
  return data;
}

// =====================================================
// ROLE ACCESS & SIDEBAR
// =====================================================
const roleAccess = {
  admin:      ['dashboard.html','log-incident.html','assign-incident.html','resolve-incident.html','escalate-incident.html','track-incident.html','reports.html'],
  officer:    ['officer-dashboard.html','log-incident.html','track-incident.html'],
  technician: ['technician-dashboard.html','resolve-incident.html','escalate-incident.html','track-incident.html']
};

const roleSidebar = {
  admin: `<ul>
    <li><a href="dashboard.html">🏠 Dashboard</a></li>
    <li><a href="log-incident.html">📋 Log Incident</a></li>
    <li><a href="assign-incident.html">👤 Assign Incident</a></li>
    <li><a href="resolve-incident.html">✅ Resolve Incident</a></li>
    <li><a href="escalate-incident.html">🚨 Escalate Incident</a></li>
    <li><a href="track-incident.html">🔍 Track Incident</a></li>
    <li><a href="reports.html">📊 Reports</a></li>
  </ul>`,
  officer: `<ul>
    <li><a href="officer-dashboard.html">🏠 Dashboard</a></li>
    <li><a href="log-incident.html">📋 Log Incident</a></li>
    <li><a href="track-incident.html">🔍 Track Incident</a></li>
  </ul>`,
  technician: `<ul>
    <li><a href="technician-dashboard.html">🏠 Dashboard</a></li>
    <li><a href="resolve-incident.html">✅ Resolve Incident</a></li>
    <li><a href="escalate-incident.html">🚨 Escalate Incident</a></li>
    <li><a href="track-incident.html">🔍 Track Incident</a></li>
  </ul>`
};

function checkAccess() {
  const user  = getUser();
  const token = getToken();
  const page  = window.location.pathname.split('/').pop();

  if (!user || !token) { window.location.href = '../index.html'; return; }

  const allowed = roleAccess[user.role] || [];
  if (!allowed.includes(page)) { window.location.href = '../index.html'; return; }

  const navUser = document.querySelector('.nav-user');
  if (navUser) navUser.textContent = `Welcome, ${user.fullName}`;

  const sidebarNav = document.querySelector('.sidebar-nav');
  if (sidebarNav) {
    sidebarNav.innerHTML = roleSidebar[user.role] || '';
    sidebarNav.querySelectorAll('a').forEach(link => {
      if (link.getAttribute('href') === page) link.closest('li')?.classList.add('active');
    });
  }

  if (page === 'dashboard.html')            loadAdminDashboard();
  if (page === 'officer-dashboard.html')    loadOfficerDashboard();
  if (page === 'technician-dashboard.html') loadTechDashboard();
  if (page === 'assign-incident.html')      loadUnassignedTickets();
  if (page === 'resolve-incident.html')     loadActiveTickets();
  if (page === 'escalate-incident.html')    loadEscalateTickets();
}

function logout() { clearSession(); window.location.href = '../index.html'; }

// =====================================================
// LOGIN
// =====================================================
async function handleLogin(event) {
  event.preventDefault();
  const email  = document.getElementById('email').value.trim();
  const pass   = document.getElementById('password').value.trim();
  const errEl  = document.getElementById('errorMessage');
  const btn    = event.target.querySelector('button[type="submit"]');

  errEl.textContent = '';
  btn.textContent   = 'Signing in...';
  btn.disabled      = true;

  try {
    const data = await apiFetch('/auth/login', {
      method: 'POST',
      body:   JSON.stringify({ email, password: pass })
    });
    setSession(data.token, data.user);
    const pages = { admin:'pages/dashboard.html', officer:'pages/officer-dashboard.html', technician:'pages/technician-dashboard.html' };
    window.location.href = pages[data.user.role] || 'pages/dashboard.html';
  } catch (err) {
    errEl.textContent = err.message || 'Invalid email or password.';
    btn.textContent   = 'Sign In';
    btn.disabled      = false;
  }
}

// =====================================================
// HELPERS
// =====================================================
function formatDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-ZA', { day:'numeric', month:'short', year:'numeric' });
}

function formatStatus(s) {
  const m = { open:'Open', in_progress:'In Progress', resolved:'Resolved', pending_confirmation:'Pending Confirmation', closed:'Closed', escalated:'Escalated', cancelled:'Cancelled' };
  return m[s] || s;
}

function getSLAStatus(i) {
  if (i.sla_breached) return 'breached';
  const now = new Date(), dl = new Date(i.sla_deadline);
  const mins = (dl - now) / 60000;
  const lims = { critical:120, high:240, medium:480, low:1440 };
  const pct  = ((lims[i.priority] - mins) / lims[i.priority]) * 100;
  return pct >= 75 ? 'approaching' : 'within';
}

window.onload = function() {
  const dateField = document.getElementById('incidentDate');
  const timeField = document.getElementById('incidentTime');
  if (dateField && timeField) {
    const now = new Date();
    dateField.value = now.toISOString().split('T')[0];
    timeField.value = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
  }
};

// =====================================================
// DASHBOARDS
// =====================================================
async function loadAdminDashboard() {
  try {
    const [s, r] = await Promise.all([apiFetch('/dashboard/summary'), apiFetch('/dashboard/recent?limit=10')]);
    const nums = document.querySelectorAll('.stat-number');
    if (nums[0]) nums[0].textContent = s.summary.total;
    if (nums[1]) nums[1].textContent = s.summary.open;
    if (nums[2]) nums[2].textContent = s.summary.inProgress;
    if (nums[3]) nums[3].textContent = s.summary.resolved + s.summary.closed;
    renderTable(r.incidents || [], 'admin');
  } catch(e) { console.error('Admin dashboard:', e); }
}

async function loadOfficerDashboard() {
  try {
    const r = await apiFetch('/dashboard/recent?limit=10');
    const inc = r.incidents || [];
    const nums = document.querySelectorAll('.stat-number');
    if (nums[0]) nums[0].textContent = inc.length;
    if (nums[1]) nums[1].textContent = inc.filter(i=>i.status==='open').length;
    if (nums[2]) nums[2].textContent = inc.filter(i=>i.status==='in_progress').length;
    if (nums[3]) nums[3].textContent = inc.filter(i=>['resolved','closed'].includes(i.status)).length;
    renderTable(inc, 'officer');
  } catch(e) { console.error('Officer dashboard:', e); }
}

async function loadTechDashboard() {
  try {
    const r = await apiFetch('/incidents');
    const user = getUser();
    const inc = (r.incidents || []).filter(i => i.assigned_user?.user_id === user.userId || i.assigned_to === user.userId);
    const nums = document.querySelectorAll('.stat-number');
    if (nums[0]) nums[0].textContent = inc.length;
    if (nums[1]) nums[1].textContent = inc.filter(i=>i.status==='open').length;
    if (nums[2]) nums[2].textContent = inc.filter(i=>i.status==='in_progress').length;
    if (nums[3]) nums[3].textContent = inc.filter(i=>['resolved','closed'].includes(i.status)).length;
    renderTable(inc, 'technician');
  } catch(e) { console.error('Tech dashboard:', e); }
}

function renderTable(incidents, role) {
  const tbody = document.querySelector('.tickets-table tbody');
  if (!tbody) return;
  if (!incidents.length) {
    tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;padding:20px;color:#999;">No tickets found.</td></tr>';
    return;
  }
  tbody.innerHTML = incidents.map(i => {
    const loc  = i.locations?.location_name || '—';
    const asgn = i.assigned_user?.full_name || 'Unassigned';
    const date = formatDate(i.date_logged);
    const st   = formatStatus(i.status);
    const stCl = i.status.replace('_','');
    const pri  = i.priority.charAt(0).toUpperCase()+i.priority.slice(1);
    let action = `<button class="btn-assign" onclick="viewTicketDetail('${i.ticket_number}')">View</button>`;
    if (i.status === 'open' && (role==='admin'||role==='officer')) {
      action = `<button class="btn-assign" onclick="openAssignModal('${i.ticket_number}','${i.description.replace(/'/g,"\\'")}','${i.priority}')">Assign</button>`;
    } else if (i.status === 'in_progress' && (role==='admin'||role==='technician')) {
      action = `<button class="btn-assign" onclick="openResolveModal('${i.ticket_number}','${i.description.replace(/'/g,"\\'")}','${i.priority}','${asgn}')">Resolve</button>`;
    } else if (role==='officer') {
      action = `<a href="track-incident.html" class="btn-assign">Track</a>`;
    }
    return `<tr>
      <td>${i.ticket_number}</td>
      <td>${i.description.substring(0,40)}${i.description.length>40?'...':''}</td>
      <td>${loc}</td>
      <td><span class="badge ${i.priority}">${pri}</span></td>
      <td><span class="badge ${stCl}">${st}</span></td>
      <td>${asgn}</td>
      <td>${date}</td>
      <td>${action}</td>
    </tr>`;
  }).join('');
}

// =====================================================
// UC1 — LOG INCIDENT
// =====================================================
async function handleLogIncident(event) {
  event.preventDefault();
  const callerName    = document.getElementById('callerName')?.value.trim();
  const callerContact = document.getElementById('callerContact')?.value.trim();
  const categoryId    = document.getElementById('category')?.value;
  const locationId    = document.getElementById('location')?.value;
  const priority      = document.getElementById('priority')?.value;
  const description   = document.getElementById('description')?.value.trim();
  const notes         = document.getElementById('notes')?.value.trim();
  const errEl         = document.getElementById('errorMessage');
  const successEl     = document.getElementById('successMessage');
  const btn           = event.target.querySelector('button[type="submit"]');

  errEl.textContent = ''; successEl.style.display = 'none';

  if (!callerName||!callerContact||!categoryId||!locationId||!priority||!description) {
    errEl.textContent = 'Please complete all required fields before submitting.'; return;
  }

  btn.textContent = 'Submitting...'; btn.disabled = true;

  try {
    const data = await apiFetch('/incidents', {
      method: 'POST',
      body: JSON.stringify({ callerName, callerContact, categoryId, locationId, priority, description, additionalNotes: notes })
    });
    const ticketEl = document.getElementById('ticketNumber');
    if (ticketEl) ticketEl.textContent = data.ticketNumber;
    successEl.textContent = `Incident successfully logged! Ticket Number: ${data.ticketNumber}`;
    successEl.style.display = 'block';
    document.getElementById('incidentForm').reset();
    window.onload();
    setTimeout(() => { successEl.style.display = 'none'; }, 5000);
  } catch(err) {
    errEl.textContent = err.message || 'Failed to log incident. Please try again.';
  } finally {
    btn.textContent = 'Submit Incident'; btn.disabled = false;
  }
}

function resetForm() {
  document.getElementById('incidentForm')?.reset();
  const e = document.getElementById('errorMessage'); if(e) e.textContent='';
  const s = document.getElementById('successMessage'); if(s) s.style.display='none';
  window.onload();
}

// =====================================================
// UC4 — ASSIGN INCIDENT
// =====================================================
async function loadUnassignedTickets() {
  try {
    const data = await apiFetch('/incidents?status=open');
    const inc  = data.incidents || [];
    const badge = document.querySelector('.badge-count');
    if (badge) badge.textContent = `${inc.length} pending`;
    const tbody = document.querySelector('.tickets-table tbody');
    if (!tbody) return;
    if (!inc.length) { tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:20px;color:#999;">No unassigned tickets.</td></tr>'; return; }
    tbody.innerHTML = inc.map(i => `<tr>
      <td>${i.ticket_number}</td>
      <td>${i.description.substring(0,45)}${i.description.length>45?'...':''}</td>
      <td>${i.locations?.location_name||'—'}</td>
      <td>${i.categories?.category_name||'—'}</td>
      <td><span class="badge ${i.priority}">${i.priority.charAt(0).toUpperCase()+i.priority.slice(1)}</span></td>
      <td>${formatDate(i.date_logged)}</td>
      <td><button class="btn-assign" onclick="openAssignModal('${i.ticket_number}','${i.description.replace(/'/g,"\\'")}','${i.priority}')">Assign</button></td>
    </tr>`).join('');
    await loadTechDropdown();
  } catch(e) { console.error('Unassigned tickets:', e); }
}

async function loadTechDropdown() {
  try {
    const data = await apiFetch('/users/technicians');
    const sel  = document.getElementById('assignTo');
    if (!sel||!data.technicians) return;
    sel.innerHTML = '<option value="" disabled selected>Select officer</option>';
    data.technicians.forEach(t => {
      sel.innerHTML += `<option value="${t.user_id}">${t.full_name} (${t.activeTickets} active)</option>`;
    });
  } catch(e) { console.error('Tech dropdown:', e); }
}

let currentTicket = '';
function openAssignModal(tn, desc, pri) {
  currentTicket = tn;
  document.getElementById('modalTicketNumber').textContent = tn;
  document.getElementById('modalDescription').textContent  = desc;
  document.getElementById('modalPriority').textContent     = pri;
  const p = document.getElementById('updatePriority'); if(p) p.value = pri.toLowerCase();
  document.getElementById('assignModal').showModal();
}
function closeAssignModal() {
  document.getElementById('assignModal').close();
  document.getElementById('assignForm')?.reset();
  document.getElementById('assignErrorMessage').textContent = '';
}
async function handleAssignIncident(event) {
  event.preventDefault();
  const assignTo = document.getElementById('assignTo').value;
  const priority = document.getElementById('updatePriority')?.value;
  const notes    = document.getElementById('assignmentNotes')?.value.trim();
  const errEl    = document.getElementById('assignErrorMessage');
  const successEl= document.getElementById('successMessage');
  const btn      = event.target.querySelector('button[type="submit"]');
  errEl.textContent = '';
  if (!assignTo) { errEl.textContent = 'Please select an officer.'; return; }
  btn.textContent = 'Assigning...'; btn.disabled = true;
  try {
    const data = await apiFetch(`/incidents/${currentTicket}/assign`, {
      method:'PATCH', body:JSON.stringify({ assignTo, priority, assignmentNotes:notes })
    });
    closeAssignModal();
    successEl.textContent = data.message; successEl.style.display = 'block';
    setTimeout(() => { successEl.style.display='none'; loadUnassignedTickets(); }, 3000);
  } catch(err) {
    errEl.textContent = err.message || 'Failed to assign ticket.';
  } finally { btn.textContent='Confirm Assignment'; btn.disabled=false; }
}

// =====================================================
// UC5 — RESOLVE INCIDENT
// =====================================================
async function loadActiveTickets() {
  try {
    const data = await apiFetch('/incidents?status=in_progress');
    const inc  = data.incidents || [];
    const badge = document.querySelector('.badge-count');
    if (badge) badge.textContent = `${inc.length} active`;
    const tbody = document.querySelector('.tickets-table tbody');
    if (!tbody) return;
    if (!inc.length) { tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:20px;color:#999;">No active tickets.</td></tr>'; return; }
    tbody.innerHTML = inc.map(i => `<tr>
      <td>${i.ticket_number}</td>
      <td>${i.description.substring(0,40)}${i.description.length>40?'...':''}</td>
      <td>${i.locations?.location_name||'—'}</td>
      <td><span class="badge ${i.priority}">${i.priority.charAt(0).toUpperCase()+i.priority.slice(1)}</span></td>
      <td>${i.assigned_user?.full_name||'Unassigned'}</td>
      <td>${formatDate(i.date_logged)}</td>
      <td><span class="badge inprogress">In Progress</span></td>
      <td><button class="btn-assign" onclick="openResolveModal('${i.ticket_number}','${i.description.replace(/'/g,"\\'")}','${i.priority}','${i.assigned_user?.full_name||'Unassigned'}')">Resolve</button></td>
    </tr>`).join('');
  } catch(e) { console.error('Active tickets:', e); }
}

let currentResolveTicket = '';
function openResolveModal(tn, desc, pri, asgn) {
  currentResolveTicket = tn;
  document.getElementById('resolveTicketNumber').textContent = tn;
  document.getElementById('resolveDescription').textContent  = desc;
  document.getElementById('resolvePriority').textContent     = pri;
  document.getElementById('resolveAssignedTo').textContent   = asgn;
  document.getElementById('resolveForm')?.reset();
  document.getElementById('resolveErrorMessage').textContent = '';
  document.getElementById('resolveModal').showModal();
}
function closeResolveModal() {
  document.getElementById('resolveModal').close();
  document.getElementById('resolveForm')?.reset();
  document.getElementById('resolveErrorMessage').textContent = '';
}
async function handleResolveIncident(event) {
  event.preventDefault();
  const notes   = document.getElementById('resolutionNotes').value.trim();
  const time    = document.getElementById('timeSpent').value;
  const intNote = document.getElementById('internalNotes')?.value.trim();
  const status  = document.getElementById('resolveStatus')?.value || 'resolved';
  const errEl   = document.getElementById('resolveErrorMessage');
  const successEl = document.getElementById('successMessage');
  const btn     = event.target.querySelector('button[type="submit"]');
  errEl.textContent = '';
  if (!notes||notes.length<20) { errEl.textContent='Resolution notes must be at least 20 characters.'; return; }
  if (!time) { errEl.textContent='Please select time spent.'; return; }
  btn.textContent='Submitting...'; btn.disabled=true;
  try {
    const data = await apiFetch(`/incidents/${currentResolveTicket}/resolve`, {
      method:'PATCH', body:JSON.stringify({ resolutionNotes:notes, internalNotes:intNote, timeSpent:time, resolutionStatus:status })
    });
    closeResolveModal();
    successEl.textContent=`Ticket ${currentResolveTicket} has been successfully marked as ${status}!`;
    successEl.style.display='block';
    setTimeout(() => { successEl.style.display='none'; loadActiveTickets(); }, 3000);
  } catch(err) {
    errEl.textContent = err.message || 'Failed to resolve ticket.';
  } finally { btn.textContent='Submit Resolution'; btn.disabled=false; }
}

// =====================================================
// UC6 — ESCALATE INCIDENT
// =====================================================
async function loadEscalateTickets() {
  try {
    const data = await apiFetch('/incidents');
    const inc  = (data.incidents||[]).filter(i=>['open','in_progress'].includes(i.status));
    const badge = document.querySelector('.badge-count');
    if (badge) badge.textContent = `${inc.length} tickets`;
    const tbody = document.querySelector('.tickets-table tbody');
    if (!tbody) return;
    if (!inc.length) { tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:20px;color:#999;">No tickets available.</td></tr>'; return; }
    tbody.innerHTML = inc.map(i => {
      const sla  = getSLAStatus(i);
      const slaL = sla==='breached'?'SLA Breached':sla==='approaching'?'Approaching':'Within SLA';
      const hrs  = Math.round(((new Date()-new Date(i.date_logged))/3600000)*10)/10;
      return `<tr>
        <td>${i.ticket_number}</td>
        <td>${i.description.substring(0,35)}${i.description.length>35?'...':''}</td>
        <td>${i.locations?.location_name||'—'}</td>
        <td><span class="badge ${i.priority}">${i.priority.charAt(0).toUpperCase()+i.priority.slice(1)}</span></td>
        <td><span class="badge ${i.status.replace('_','')}">${formatStatus(i.status)}</span></td>
        <td>${hrs}h</td>
        <td><span class="sla-badge ${sla}">${slaL}</span></td>
        <td><button class="btn-assign" onclick="openEscalateModal('${i.ticket_number}','${i.description.replace(/'/g,"\\'")}','${i.priority}','${sla}')">Escalate</button></td>
      </tr>`;
    }).join('');
  } catch(e) { console.error('Escalate tickets:', e); }
}

let currentEscalateTicket = '';
function openEscalateModal(tn, desc, pri, sla) {
  currentEscalateTicket = tn;
  document.getElementById('escalateTicketNumber').textContent = tn;
  document.getElementById('escalateDescription').textContent  = desc;
  document.getElementById('escalatePriority').textContent     = pri;
  document.getElementById('escalateSLAStatus').textContent    = sla==='breached'?'SLA Breached':sla==='approaching'?'Approaching Breach':'Within SLA';
  document.getElementById('escalateForm')?.reset();
  document.getElementById('escalateErrorMessage').textContent = '';
  if (sla==='breached') { const r=document.getElementById('escalationReason'); if(r) r.value='sla_breach'; }
  document.getElementById('escalateModal').showModal();
}
function closeEscalateModal() {
  document.getElementById('escalateModal').close();
  document.getElementById('escalateForm')?.reset();
  document.getElementById('escalateErrorMessage').textContent='';
}
async function handleEscalateIncident(event) {
  event.preventDefault();
  const reason  = document.getElementById('escalationReason').value;
  const dept    = document.getElementById('escalateTo').value;
  const notes   = document.getElementById('escalationNotes').value.trim();
  const priUpd  = document.getElementById('escalatePriorityUpdate')?.value;
  const errEl   = document.getElementById('escalateErrorMessage');
  const successEl = document.getElementById('successMessage');
  const btn     = event.target.querySelector('button[type="submit"]');
  errEl.textContent='';
  if (!reason) { errEl.textContent='Please select an escalation reason.'; return; }
  if (!dept)   { errEl.textContent='Please select a department to escalate to.'; return; }
  if (!notes||notes.length<15) { errEl.textContent='Please provide escalation notes.'; return; }
  btn.textContent='Escalating...'; btn.disabled=true;
  try {
    const data = await apiFetch(`/incidents/${currentEscalateTicket}/escalate`, {
      method:'PATCH', body:JSON.stringify({ escalationReason:reason, escalateTo:dept, escalationNotes:notes, priorityUpdate:priUpd })
    });
    closeEscalateModal();
    successEl.textContent=`Ticket ${currentEscalateTicket} has been successfully escalated!`;
    successEl.style.display='block';
    setTimeout(() => { successEl.style.display='none'; loadEscalateTickets(); }, 3000);
  } catch(err) {
    errEl.textContent=err.message||'Failed to escalate ticket.';
  } finally { btn.textContent='🚨 Confirm Escalation'; btn.disabled=false; }
}

// =====================================================
// UC2 — TRACK INCIDENT
// =====================================================
async function handleSearch(event) {
  event.preventDefault();
  const tn = document.getElementById('searchTicket').value.trim().toUpperCase();
  if (!tn) { alert('Please enter a ticket number.'); return; }
  try {
    const data = await apiFetch(`/incidents/${tn}`);
    const i = data.incident;
    document.getElementById('detailTicketNumber').textContent = i.ticket_number;
    document.getElementById('detailDescription').textContent  = i.description;
    document.getElementById('detailLocation').textContent     = i.locations?.location_name||'—';
    document.getElementById('detailCategory').textContent     = i.categories?.category_name||'—';
    document.getElementById('detailAssignedTo').textContent   = i.assigned_user?.full_name||'Unassigned';
    document.getElementById('detailDate').textContent         = `Logged: ${formatDate(i.date_logged)}`;
    const priEl = document.getElementById('detailPriority');
    const stEl  = document.getElementById('detailStatus');
    if (priEl) { priEl.textContent=i.priority.charAt(0).toUpperCase()+i.priority.slice(1); priEl.className=`badge ${i.priority}`; }
    if (stEl)  { stEl.textContent=formatStatus(i.status); stEl.className=`badge ${i.status.replace('_','')}`; }
    const auditList = document.querySelector('.audit-list');
    if (auditList && data.auditTrail?.length) {
      auditList.innerHTML = data.auditTrail.map(a => `
        <li class="audit-item">
          <span class="audit-dot open"></span>
          <section class="audit-content">
            <strong>${a.action_description}</strong>
            <p>By ${a.performer?.full_name||'System'}</p>
            <span class="audit-time">${new Date(a.action_time).toLocaleString('en-ZA')}</span>
          </section>
        </li>`).join('');
    }
    document.getElementById('ticketDetail')?.scrollIntoView({ behavior:'smooth' });
  } catch(err) { alert(err.message||'Ticket not found.'); }
}

function viewTicket(tn, desc, loc, cat, pri, st, asgn, date) {
  document.getElementById('detailTicketNumber').textContent = tn;
  document.getElementById('detailDescription').textContent  = desc;
  document.getElementById('detailLocation').textContent     = loc;
  document.getElementById('detailCategory').textContent     = cat;
  document.getElementById('detailPriority').textContent     = pri;
  document.getElementById('detailStatus').textContent       = st;
  document.getElementById('detailAssignedTo').textContent   = asgn;
  document.getElementById('detailDate').textContent         = `Logged: ${date}`;
  document.getElementById('ticketDetail')?.scrollIntoView({ behavior:'smooth' });
}

async function viewTicketDetail(tn) {
  try {
    const data = await apiFetch(`/incidents/${tn}`);
    const i = data.incident;
    viewTicket(i.ticket_number, i.description, i.locations?.location_name||'—', i.categories?.category_name||'—', i.priority, formatStatus(i.status), i.assigned_user?.full_name||'Unassigned', formatDate(i.date_logged));
  } catch(e) { console.error('View ticket:', e); }
}

// =====================================================
// REPORTS
// =====================================================
function handleFilter(event) {
  event.preventDefault();
  const df = document.getElementById('dateFrom')?.value;
  const dt = document.getElementById('dateTo')?.value;
  if (df && dt && df > dt) { alert('Date From cannot be after Date To.'); return; }
  alert('Report filters applied successfully!');
}

function generateReport(name) {
  document.getElementById('reportModalTitle').textContent   = name;
  document.getElementById('reportModalMessage').textContent = `Showing data for: ${name}.`;
  document.getElementById('reportModal').showModal();
}

function closeReportModal() { document.getElementById('reportModal').close(); }
function exportData(fmt) { alert(`Exporting data as ${fmt}...`); }
