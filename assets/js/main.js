// =====================================================
//  WITS CPS CALL LOGGING SYSTEM — FRONTEND API CLIENT
//  Team 20 · NEXUS · Iteration 3
//  Connects to Express API on Railway
// =====================================================

// ── API BASE URL ──
// Change this to your Railway URL after deployment
const API_BASE = 'https://wits-cps-api.up.railway.app/api';
// For local testing use:
// const API_BASE = 'http://localhost:3000/api';

// ── AUTH HELPERS ──
function getToken()    { return sessionStorage.getItem('cps_token'); }
function getUser()     { return JSON.parse(sessionStorage.getItem('cps_user') || 'null'); }
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
  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
    ...(options.headers || {})
  };

  const response = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || `Request failed: ${response.status}`);
  }

  return data;
}

// ── ROLE ACCESS MAP ──
const roleAccess = {
  admin:      ['dashboard.html','log-incident.html','assign-incident.html','resolve-incident.html','escalate-incident.html','confirm-incident.html','track-incident.html','reports.html'],
  officer:    ['officer-dashboard.html','log-incident.html','track-incident.html','confirm-incident.html'],
  technician: ['technician-dashboard.html','resolve-incident.html','escalate-incident.html','track-incident.html'],
  caller:     ['caller-dashboard.html','log-incident.html','track-incident.html','confirm-incident.html']
};

const roleSidebar = {
  admin: `
    <div class="sidebar-section-label">Main Navigation</div>
    <ul>
      <li><a href="dashboard.html"><span class="nav-icon">🏠</span> Dashboard</a></li>
      <li><a href="log-incident.html"><span class="nav-icon">📋</span> Log Incident</a></li>
      <li><a href="assign-incident.html"><span class="nav-icon">👤</span> Assign Incident</a></li>
      <li><a href="resolve-incident.html"><span class="nav-icon">✅</span> Resolve Incident</a></li>
      <li><a href="escalate-incident.html"><span class="nav-icon">🚨</span> Escalate Incident</a></li>
      <li><a href="confirm-incident.html"><span class="nav-icon">🔔</span> Confirm / Close</a></li>
      <li><a href="track-incident.html"><span class="nav-icon">🔍</span> Track Incident</a></li>
    </ul>
    <div class="sidebar-section-label">Reports</div>
    <ul>
      <li><a href="reports.html"><span class="nav-icon">📊</span> Reports & Analytics</a></li>
    </ul>`,
  officer: `
    <div class="sidebar-section-label">Navigation</div>
    <ul>
      <li><a href="officer-dashboard.html"><span class="nav-icon">🏠</span> Dashboard</a></li>
      <li><a href="log-incident.html"><span class="nav-icon">📋</span> Log Incident</a></li>
      <li><a href="track-incident.html"><span class="nav-icon">🔍</span> Track Incident</a></li>
      <li><a href="confirm-incident.html"><span class="nav-icon">🔔</span> Confirm / Close</a></li>
    </ul>`,
  technician: `
    <div class="sidebar-section-label">Navigation</div>
    <ul>
      <li><a href="technician-dashboard.html"><span class="nav-icon">🏠</span> Dashboard</a></li>
      <li><a href="resolve-incident.html"><span class="nav-icon">✅</span> Resolve Incident</a></li>
      <li><a href="escalate-incident.html"><span class="nav-icon">🚨</span> Escalate Incident</a></li>
      <li><a href="track-incident.html"><span class="nav-icon">🔍</span> Track Incident</a></li>
    </ul>`,
  caller: `
    <div class="sidebar-section-label">Navigation</div>
    <ul>
      <li><a href="caller-dashboard.html"><span class="nav-icon">🏠</span> My Tickets</a></li>
      <li><a href="log-incident.html"><span class="nav-icon">📋</span> Log Incident</a></li>
      <li><a href="track-incident.html"><span class="nav-icon">🔍</span> Track Incident</a></li>
      <li><a href="confirm-incident.html"><span class="nav-icon">🔔</span> Confirm / Close</a></li>
    </ul>`
};

const roleNames = {
  admin: 'Administrator', officer: 'Security Officer',
  technician: 'Technician', caller: 'Caller'
};

// ── RBAC CHECK ──
function checkAccess() {
  const user = getUser();
  const token = getToken();
  const currentPage = window.location.pathname.split('/').pop();

  if (!user || !token) { window.location.href = '../index.html'; return; }

  const allowed = roleAccess[user.role] || [];
  if (!allowed.includes(currentPage)) { window.location.href = '../index.html'; return; }

  // Inject user info into navbar
  const navUser = document.querySelector('.nav-user');
  const navRole = document.querySelector('.nav-role');
  if (navUser) navUser.textContent = user.fullName;
  if (navRole) navRole.textContent = roleNames[user.role] || user.role;

  // Inject sidebar
  const sidebarNav = document.querySelector('.sidebar-nav');
  if (sidebarNav) {
    sidebarNav.innerHTML = roleSidebar[user.role] || '';
    sidebarNav.querySelectorAll('a').forEach(link => {
      if (link.getAttribute('href') === currentPage) {
        link.closest('li')?.classList.add('active');
      }
    });
  }

  const sidebarFooter = document.querySelector('.sidebar-footer p');
  if (sidebarFooter) sidebarFooter.textContent = `Logged in as ${user.fullName}`;
}

// ── LOGOUT ──
function logout() {
  clearSession();
  window.location.href = '../index.html';
}

// =====================================================
//  LOGIN — UC0
// =====================================================
async function handleLogin(event) {
  event.preventDefault();
  const email    = document.getElementById('email').value.trim();
  const password = document.getElementById('password').value.trim();
  const errEl    = document.getElementById('errorMessage');
  const btn      = event.target.querySelector('button[type="submit"]');

  errEl.textContent = '';
  btn.textContent = 'Signing in...';
  btn.disabled = true;

  try {
    const data = await apiFetch('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password })
    });

    setSession(data.token, data.user);

    const pages = {
      admin: 'pages/dashboard.html',
      officer: 'pages/officer-dashboard.html',
      technician: 'pages/technician-dashboard.html',
      caller: 'pages/caller-dashboard.html'
    };

    window.location.href = pages[data.user.role] || 'pages/dashboard.html';

  } catch (err) {
    errEl.textContent = err.message || 'Login failed. Please try again.';
    btn.textContent = 'Sign In →';
    btn.disabled = false;
  }
}

// =====================================================
//  DATE / TIME HELPERS
// =====================================================
function setDateTime() {
  const dateField = document.getElementById('incidentDate');
  const timeField = document.getElementById('incidentTime');
  if (dateField && timeField) {
    const now = new Date();
    dateField.value = now.toISOString().split('T')[0];
    const h = String(now.getHours()).padStart(2, '0');
    const m = String(now.getMinutes()).padStart(2, '0');
    timeField.value = `${h}:${m}`;
  }
}

// =====================================================
//  UC1 — LOG INCIDENT
// =====================================================
async function handleLogIncident(event) {
  event.preventDefault();
  const errEl    = document.getElementById('errorMessage');
  const successEl = document.getElementById('successMessage');
  const btn      = event.target.querySelector('button[type="submit"]');

  errEl.textContent = '';
  successEl.style.display = 'none';

  const callerName    = document.getElementById('callerName')?.value.trim();
  const callerContact = document.getElementById('callerContact')?.value.trim();
  const categoryId    = document.getElementById('category')?.value;
  const locationId    = document.getElementById('location')?.value;
  const priority      = document.getElementById('priority')?.value;
  const description   = document.getElementById('description')?.value.trim();
  const notes         = document.getElementById('notes')?.value.trim();

  if (!callerName || !callerContact || !categoryId || !locationId || !priority || !description) {
    errEl.textContent = 'Please complete all required fields before submitting.';
    return;
  }

  btn.textContent = 'Submitting...';
  btn.disabled = true;

  try {
    const data = await apiFetch('/incidents', {
      method: 'POST',
      body: JSON.stringify({ callerName, callerContact, categoryId, locationId, priority, description, additionalNotes: notes })
    });

    successEl.textContent = `✅ Incident logged successfully! Ticket: ${data.ticketNumber}`;
    if (data.duplicateWarning) successEl.textContent += ` ⚠️ ${data.duplicateWarning}`;
    successEl.style.display = 'block';

    document.getElementById('incidentForm').reset();
    setDateTime();
    // Update ticket number display
    const ticketEl = document.getElementById('ticketNumber');
    if (ticketEl) ticketEl.textContent = 'Generating...';

  } catch (err) {
    errEl.textContent = err.message || 'Failed to log incident. Please try again.';
  } finally {
    btn.textContent = '✅ Submit Incident';
    btn.disabled = false;
    setTimeout(() => { successEl.style.display = 'none'; }, 6000);
  }
}

function resetForm() {
  const form = document.getElementById('incidentForm');
  if (form) form.reset();
  const err = document.getElementById('errorMessage');
  if (err) err.textContent = '';
  setDateTime();
}

// =====================================================
//  LOAD CATEGORIES & LOCATIONS (for dropdowns)
// =====================================================
async function loadDropdowns() {
  try {
    const [catData, locData] = await Promise.all([
      apiFetch('/users/categories'),
      apiFetch('/users/locations')
    ]);

    const catEl = document.getElementById('category');
    if (catEl && catData.categories) {
      catEl.innerHTML = '<option value="" disabled selected>Select category</option>';
      catData.categories.forEach(c => {
        catEl.innerHTML += `<option value="${c.category_id}">${c.category_name}</option>`;
      });
    }

    const locEl = document.getElementById('location');
    if (locEl && locData.locations) {
      locEl.innerHTML = '<option value="" disabled selected>Select location</option>';
      locData.locations.forEach(l => {
        locEl.innerHTML += `<option value="${l.location_id}">${l.location_name}</option>`;
      });
    }
  } catch (err) {
    console.error('Failed to load dropdowns:', err);
  }
}

// =====================================================
//  LOAD DASHBOARD STATS
// =====================================================
async function loadDashboard() {
  try {
    const [summaryData, recentData] = await Promise.all([
      apiFetch('/dashboard/summary'),
      apiFetch('/dashboard/recent?limit=10')
    ]);

    const s = summaryData.summary;

    // Update stat cards
    const setEl = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    setEl('statTotal',      s.total);
    setEl('statOpen',       s.open);
    setEl('statInProgress', s.inProgress);
    setEl('statResolved',   s.resolved + s.closed);
    setEl('statSLA',        `${s.slaCompliance}%`);
    setEl('statAvgTime',    `${s.avgResolutionHrs}h`);
    setEl('statEscalated',  s.escalated);

    // SLA alert banner
    const alertBanner = document.getElementById('slaAlertBanner');
    if (alertBanner && summaryData.slaAlerts?.length > 0) {
      const alerts = summaryData.slaAlerts;
      const breached = alerts.filter(a => a.slaStatus === 'breached');
      const approaching = alerts.filter(a => a.slaStatus === 'approaching');
      let msg = '';
      if (breached.length > 0) msg += `${breached.length} ticket(s) have breached SLA. `;
      if (approaching.length > 0) msg += `${approaching.length} ticket(s) approaching SLA breach.`;
      alertBanner.style.display = msg ? 'flex' : 'none';
      const alertText = document.getElementById('slaAlertText');
      if (alertText) alertText.textContent = msg;
    }

    // Recent tickets table
    loadTicketsTable(recentData.incidents || []);

  } catch (err) {
    console.error('Dashboard load error:', err);
  }
}

// =====================================================
//  RENDER TICKETS TABLE
// =====================================================
function loadTicketsTable(incidents) {
  const tbody = document.getElementById('incidentsTableBody');
  if (!tbody) return;

  if (!incidents.length) {
    tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;color:var(--grey-400);padding:28px;">No tickets found.</td></tr>';
    return;
  }

  tbody.innerHTML = incidents.map(i => {
    const category  = i.categories?.category_name || '—';
    const location  = i.locations?.location_name  || '—';
    const assignedTo = i.assigned_user?.full_name  || 'Unassigned';
    const date       = new Date(i.date_logged).toLocaleDateString('en-ZA', { day:'numeric', month:'short', year:'numeric' });
    const slaClass   = i.slaStatus === 'breached' ? 'breached' : i.slaStatus === 'approaching' ? 'approaching' : 'within';
    const slaLabel   = i.slaStatus === 'breached' ? 'SLA Breached' : i.slaStatus === 'approaching' ? 'Approaching' : 'Within SLA';

    let actionBtn = '';
    if (i.status === 'open') {
      actionBtn = `<a href="assign-incident.html" class="btn-assign">Assign</a>`;
    } else if (i.status === 'in_progress') {
      actionBtn = `<a href="resolve-incident.html" class="btn-assign">Resolve</a>`;
    } else if (i.status === 'pending_confirmation') {
      actionBtn = `<a href="confirm-incident.html" class="btn-assign" style="background:#e0f2fe;color:#0369a1;border-color:#bae6fd;">Confirm</a>`;
    } else if (i.status === 'escalated') {
      actionBtn = `<a href="escalate-incident.html" class="btn-assign" style="background:#fee2e2;color:#991b1b;border-color:#fca5a5;">Escalate</a>`;
    } else {
      actionBtn = `<button class="btn-assign" onclick="viewTicketDetail('${i.ticket_number}')">View</button>`;
    }

    return `<tr>
      <td><strong style="font-family:monospace;">${i.ticket_number}</strong></td>
      <td>${i.description.substring(0, 45)}${i.description.length > 45 ? '...' : ''}</td>
      <td>${location}</td>
      <td><span class="badge ${i.priority}">${i.priority.charAt(0).toUpperCase() + i.priority.slice(1)}</span></td>
      <td><span class="badge ${i.status.replace('_','')}">${formatStatus(i.status)}</span></td>
      <td>${assignedTo}</td>
      <td><span class="sla-badge ${slaClass}">${slaLabel}</span></td>
      <td>${date}</td>
      <td>${actionBtn}</td>
    </tr>`;
  }).join('');
}

function formatStatus(status) {
  const map = {
    open: 'Open', in_progress: 'In Progress', resolved: 'Resolved',
    pending_confirmation: 'Pending Confirmation',
    closed: 'Closed', escalated: 'Escalated', cancelled: 'Cancelled'
  };
  return map[status] || status;
}

// =====================================================
//  LOAD TECHNICIANS (for assign page)
// =====================================================
async function loadTechnicians() {
  try {
    const data = await apiFetch('/users/technicians');
    const select = document.getElementById('assignTo');
    if (!select || !data.technicians) return;

    const available  = data.technicians.filter(t => t.availability === 'available');
    const moderate   = data.technicians.filter(t => t.availability === 'moderate');
    const busy       = data.technicians.filter(t => t.availability === 'busy');

    select.innerHTML = '<option value="" disabled selected>Select officer / technician</option>';

    if (available.length) {
      select.innerHTML += `<optgroup label="✅ Available">
        ${available.map(t => `<option value="${t.user_id}">${t.full_name} — ${t.activeTickets} tickets</option>`).join('')}
      </optgroup>`;
    }
    if (moderate.length) {
      select.innerHTML += `<optgroup label="🟡 Moderate Load">
        ${moderate.map(t => `<option value="${t.user_id}">${t.full_name} — ${t.activeTickets} tickets</option>`).join('')}
      </optgroup>`;
    }
    if (busy.length) {
      select.innerHTML += `<optgroup label="🔴 Busy">
        ${busy.map(t => `<option value="${t.user_id}">${t.full_name} — ${t.activeTickets} tickets</option>`).join('')}
      </optgroup>`;
    }

    // Also update the availability table
    loadAvailabilityTable(data.technicians);

  } catch (err) {
    console.error('Failed to load technicians:', err);
  }
}

function loadAvailabilityTable(technicians) {
  const tbody = document.getElementById('availabilityTableBody');
  if (!tbody) return;
  tbody.innerHTML = technicians.map(t => {
    const pct = Math.min(t.activeTickets * 20, 100);
    const color = t.availability === 'available' ? 'var(--green)'
      : t.availability === 'moderate' ? 'var(--orange)' : 'var(--red)';
    const badgeClass = t.availability === 'available' ? 'low'
      : t.availability === 'moderate' ? 'medium' : 'critical';
    const badgeLabel = t.availability.charAt(0).toUpperCase() + t.availability.slice(1);
    return `<tr>
      <td><strong>${t.full_name}</strong></td>
      <td>
        <div style="background:var(--grey-200);border-radius:4px;height:8px;width:120px;overflow:hidden;">
          <div style="background:${color};height:100%;width:${pct}%;"></div>
        </div>
      </td>
      <td>${t.activeTickets} ticket${t.activeTickets !== 1 ? 's' : ''}</td>
      <td>${t.role}</td>
      <td><span class="badge ${badgeClass}">${badgeLabel}</span></td>
    </tr>`;
  }).join('');
}

// =====================================================
//  UC4 — ASSIGN INCIDENT (modal)
// =====================================================
let currentTicket = '';

function openAssignModal(ticketNumber, description, priority) {
  currentTicket = ticketNumber;
  document.getElementById('modalTicketNumber').textContent = ticketNumber;
  document.getElementById('modalDescription').textContent  = description;
  document.getElementById('modalPriority').textContent     = priority;
  const prioritySelect = document.getElementById('updatePriority');
  if (prioritySelect) prioritySelect.value = priority.toLowerCase();
  document.getElementById('assignModal').showModal();
}

function closeAssignModal() {
  document.getElementById('assignModal').close();
  document.getElementById('assignForm').reset();
  document.getElementById('assignErrorMessage').textContent = '';
}

async function handleAssignIncident(event) {
  event.preventDefault();
  const assignTo         = document.getElementById('assignTo').value;
  const priority         = document.getElementById('updatePriority')?.value;
  const assignmentNotes  = document.getElementById('assignmentNotes')?.value.trim();
  const errEl            = document.getElementById('assignErrorMessage');
  const successEl        = document.getElementById('successMessage');
  const btn              = event.target.querySelector('button[type="submit"]');

  errEl.textContent = '';

  if (!assignTo) { errEl.textContent = 'Please select an officer to assign this ticket to.'; return; }

  btn.textContent = 'Assigning...';
  btn.disabled = true;

  try {
    const data = await apiFetch(`/incidents/${currentTicket}/assign`, {
      method: 'PATCH',
      body: JSON.stringify({ assignTo, priority, assignmentNotes })
    });

    closeAssignModal();
    successEl.textContent = `✅ ${data.message}`;
    successEl.style.display = 'block';
    setTimeout(() => { successEl.style.display = 'none'; loadDashboard(); }, 4000);

  } catch (err) {
    errEl.textContent = err.message || 'Failed to assign ticket.';
  } finally {
    btn.textContent = '✅ Confirm Assignment';
    btn.disabled = false;
  }
}

// =====================================================
//  UC5 — RESOLVE INCIDENT (modal)
// =====================================================
let currentResolveTicket = '';

function openResolveModal(ticketNumber, description, priority, assignedTo) {
  currentResolveTicket = ticketNumber;
  document.getElementById('resolveTicketNumber').textContent = ticketNumber;
  document.getElementById('resolveDescription').textContent  = description;
  document.getElementById('resolvePriority').textContent     = priority;
  document.getElementById('resolveAssignedTo').textContent   = assignedTo;
  document.getElementById('resolveForm').reset();
  document.getElementById('resolveErrorMessage').textContent = '';

  const slaWarning = document.getElementById('resolveSLAWarning');
  if (slaWarning) slaWarning.style.display = ['Critical','High'].includes(priority) ? 'block' : 'none';

  document.getElementById('resolveModal').showModal();
}

function closeResolveModal() {
  document.getElementById('resolveModal').close();
  document.getElementById('resolveErrorMessage').textContent = '';
}

async function handleResolveIncident(event) {
  event.preventDefault();
  const resolutionNotes  = document.getElementById('resolutionNotes').value.trim();
  const internalNotes    = document.getElementById('internalNotes')?.value.trim();
  const timeSpent        = document.getElementById('timeSpent').value;
  const rootCause        = document.getElementById('rootCause')?.value;
  const resolutionStatus = document.getElementById('resolveStatus').value;
  const errEl            = document.getElementById('resolveErrorMessage');
  const successEl        = document.getElementById('successMessage');
  const btn              = event.target.querySelector('button[type="submit"]');

  errEl.textContent = '';

  if (!resolutionStatus) { errEl.textContent = 'Please select a resolution status.'; return; }
  if (!resolutionNotes || resolutionNotes.length < 20) { errEl.textContent = 'Resolution notes must be at least 20 characters.'; return; }
  if (!timeSpent) { errEl.textContent = 'Please select the time spent.'; return; }

  btn.textContent = 'Submitting...';
  btn.disabled = true;

  try {
    const data = await apiFetch(`/incidents/${currentResolveTicket}/resolve`, {
      method: 'PATCH',
      body: JSON.stringify({ resolutionNotes, internalNotes, timeSpent, rootCause, resolutionStatus })
    });

    closeResolveModal();
    successEl.textContent = `✅ ${data.message}`;
    successEl.style.display = 'block';
    setTimeout(() => { successEl.style.display = 'none'; loadActiveTickets(); }, 5000);

  } catch (err) {
    errEl.textContent = err.message || 'Failed to resolve ticket.';
  } finally {
    btn.textContent = '✅ Submit Resolution';
    btn.disabled = false;
  }
}

// =====================================================
//  UC6 — ESCALATE INCIDENT (modal)
// =====================================================
let currentEscalateTicket = '';

function openEscalateModal(ticketNumber, description, priority, slaStatus) {
  currentEscalateTicket = ticketNumber;
  document.getElementById('escalateTicketNumber').textContent = ticketNumber;
  document.getElementById('escalateDescription').textContent  = description;
  document.getElementById('escalatePriority').textContent     = priority;
  document.getElementById('escalateForm').reset();
  document.getElementById('escalateErrorMessage').textContent = '';

  if (slaStatus === 'breached') {
    const reasonEl = document.getElementById('escalationReason');
    const priEl    = document.getElementById('escalatePriorityUpdate');
    if (reasonEl) reasonEl.value = 'sla_breach';
    if (priEl) priEl.value = 'critical';
  }

  document.getElementById('escalateModal').showModal();
}

function closeEscalateModal() {
  document.getElementById('escalateModal').close();
  document.getElementById('escalateErrorMessage').textContent = '';
}

async function handleEscalateIncident(event) {
  event.preventDefault();
  const escalationReason = document.getElementById('escalationReason').value;
  const escalateTo       = document.getElementById('escalateTo').value;
  const escalationNotes  = document.getElementById('escalationNotes').value.trim();
  const priorityUpdate   = document.getElementById('escalatePriorityUpdate')?.value;
  const notifyParties    = document.getElementById('notifyParties')?.value;
  const errEl            = document.getElementById('escalateErrorMessage');
  const successEl        = document.getElementById('successMessage');
  const btn              = event.target.querySelector('button[type="submit"]');

  errEl.textContent = '';

  if (!escalationReason)                          { errEl.textContent = 'Please select an escalation reason.'; return; }
  if (!escalateTo)                                { errEl.textContent = 'Please select a department to escalate to.'; return; }
  if (!escalationNotes || escalationNotes.length < 15) { errEl.textContent = 'Escalation notes must be at least 15 characters.'; return; }

  btn.textContent = 'Escalating...';
  btn.disabled = true;

  try {
    const data = await apiFetch(`/incidents/${currentEscalateTicket}/escalate`, {
      method: 'PATCH',
      body: JSON.stringify({ escalationReason, escalateTo, escalationNotes, priorityUpdate, notifyParties })
    });

    closeEscalateModal();
    successEl.textContent = `🚨 ${data.message}`;
    successEl.style.display = 'block';
    setTimeout(() => { successEl.style.display = 'none'; loadActiveTickets(); }, 5000);

  } catch (err) {
    errEl.textContent = err.message || 'Failed to escalate ticket.';
  } finally {
    btn.textContent = '🚨 Confirm Escalation';
    btn.disabled = false;
  }
}

// =====================================================
//  UC3 — CONFIRM / CLOSE INCIDENT
// =====================================================
async function confirmResolution(ticketNumber, action) {
  const feedbackEl       = document.getElementById(`feedback-${ticketNumber}`);
  const rejectFeedbackEl = document.getElementById(`reject-feedback-${ticketNumber}`);
  const ratingEl         = document.getElementById(`rating-${ticketNumber}`);
  const errEl            = document.getElementById(`error-${ticketNumber}`) || document.getElementById(`reject-error-${ticketNumber}`);
  const successEl        = document.getElementById('successMessage');

  const feedback         = feedbackEl?.value.trim() || '';
  const rejectionReason  = rejectFeedbackEl?.value.trim() || '';
  const satisfactionRating = ratingEl?.value || null;

  if (action === 'reject' && !rejectionReason) {
    if (errEl) errEl.textContent = 'Please provide a reason for rejecting the resolution.';
    return;
  }

  try {
    const data = await apiFetch(`/incidents/${ticketNumber}/confirm`, {
      method: 'PATCH',
      body: JSON.stringify({ action, satisfactionRating, feedback, rejectionReason })
    });

    successEl.textContent = action === 'accept'
      ? `✅ Ticket ${ticketNumber} confirmed and closed. Thank you for your feedback!`
      : `🔄 Ticket ${ticketNumber} has been reopened. The technician has been notified.`;
    successEl.style.display = 'block';

    const row = document.getElementById(`ticket-row-${ticketNumber}`);
    if (row) { row.style.opacity = '0.4'; row.style.pointerEvents = 'none'; }

    window.scrollTo({ top: 0, behavior: 'smooth' });
    setTimeout(() => { successEl.style.display = 'none'; }, 6000);

  } catch (err) {
    if (errEl) errEl.textContent = err.message || 'Failed to process confirmation.';
  }
}

// =====================================================
//  UC2 — TRACK INCIDENT
// =====================================================
async function handleSearch(event) {
  event.preventDefault();
  const ticketNumber = document.getElementById('searchTicket').value.trim().toUpperCase();
  if (!ticketNumber) { alert('Please enter a ticket number.'); return; }

  try {
    const data = await apiFetch(`/incidents/${ticketNumber}`);
    displayTicketDetail(data);
    document.getElementById('ticketDetail')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (err) {
    alert(err.message || 'Ticket not found.');
  }
}

function displayTicketDetail(data) {
  const i = data.incident;
  if (!i) return;

  document.getElementById('detailTicketNumber').textContent = i.ticket_number;
  document.getElementById('detailDescription').textContent  = i.description;
  document.getElementById('detailLocation').textContent     = i.locations?.location_name || '—';
  document.getElementById('detailCategory').textContent     = i.categories?.category_name || '—';
  document.getElementById('detailAssignedTo').textContent   = i.assigned_user?.full_name || 'Unassigned';
  document.getElementById('detailDate').textContent         = `Logged: ${new Date(i.date_logged).toLocaleDateString('en-ZA')}`;

  const priEl = document.getElementById('detailPriority');
  const stEl  = document.getElementById('detailStatus');
  if (priEl) { priEl.textContent = i.priority; priEl.className = `badge ${i.priority}`; }
  if (stEl)  { stEl.textContent  = formatStatus(i.status); stEl.className = `badge ${i.status.replace('_','')}`; }

  // SLA bar
  if (data.sla) {
    const slaBar   = document.getElementById('slaProgressBar');
    const slaLabel = document.getElementById('detailSLA');
    const colors   = { within:'var(--green)', approaching:'var(--orange)', breached:'var(--red)' };
    if (slaBar) { slaBar.style.width = `${data.sla.percentage}%`; slaBar.style.background = colors[data.sla.status] || 'var(--green)'; }
    if (slaLabel) slaLabel.textContent = `${data.sla.status === 'breached' ? '⛔ SLA Breached' : data.sla.status === 'approaching' ? '⚠️ Approaching' : '✅ Within SLA'} · ${data.sla.hoursOpen}h open of ${data.sla.limitHours}h limit`;
  }

  // Audit trail
  const auditList = document.getElementById('auditList');
  if (auditList && data.auditTrail?.length) {
    auditList.innerHTML = data.auditTrail.map(a => `
      <li class="audit-item">
        <span class="audit-dot open"></span>
        <div class="audit-content">
          <strong>${a.action_description}</strong>
          <p>By ${a.performer?.full_name || 'System'}</p>
          <span class="audit-time">${new Date(a.action_time).toLocaleString('en-ZA')}</span>
        </div>
      </li>`).join('');
  }
}

// =====================================================
//  LOAD ACTIVE TICKETS (for resolve/escalate pages)
// =====================================================
async function loadActiveTickets() {
  try {
    const user = getUser();
    const status = user?.role === 'technician' ? 'in_progress' : null;
    const url = status ? `/incidents?status=${status}` : '/incidents?status=in_progress';
    const data = await apiFetch(url);
    loadTicketsTable(data.incidents || []);
  } catch (err) {
    console.error('Failed to load active tickets:', err);
  }
}

// =====================================================
//  LOAD PENDING CONFIRMATION TICKETS
// =====================================================
async function loadPendingConfirmations() {
  try {
    const data = await apiFetch('/incidents/status/pending-confirmation');
    const incidents = data.incidents || [];

    const container = document.getElementById('pendingConfirmationsContainer');
    if (!container) return;

    if (!incidents.length) {
      container.innerHTML = '<div class="info-message">ℹ️ No tickets are currently awaiting your confirmation.</div>';
      return;
    }

    // Incidents are rendered by the HTML — this just updates count badge
    const badge = document.getElementById('pendingCount');
    if (badge) badge.textContent = incidents.length;

  } catch (err) {
    console.error('Failed to load pending confirmations:', err);
  }
}

// =====================================================
//  FILTER HANDLER (reports page)
// =====================================================
function handleFilter(event) {
  event.preventDefault();
  const dateFrom = document.getElementById('dateFrom')?.value;
  const dateTo   = document.getElementById('dateTo')?.value;

  if (dateFrom && dateTo && dateFrom > dateTo) {
    alert('Date From cannot be after Date To.');
    return;
  }

  const successEl = document.getElementById('filterSuccess');
  if (successEl) {
    successEl.textContent = '✅ Report filters applied successfully.';
    successEl.style.display = 'block';
    setTimeout(() => { successEl.style.display = 'none'; }, 3000);
  }
}

function exportData(format) {
  const btn = event?.target;
  if (btn) { const orig = btn.textContent; btn.textContent = `Preparing ${format}...`; btn.disabled = true; setTimeout(() => { btn.textContent = orig; btn.disabled = false; }, 1500); }
  alert(`✅ Export as ${format} initiated. In the live system, your file would download automatically.`);
}

// =====================================================
//  SLA UTILITIES
// =====================================================
const SLA_LIMITS = { critical:2, high:4, medium:8, low:24 };

function getSLAStatus(priority, hoursOpen) {
  const limit = SLA_LIMITS[priority?.toLowerCase()] || 24;
  if (hoursOpen >= limit)        return 'breached';
  if (hoursOpen >= limit * 0.75) return 'approaching';
  return 'within';
}

function viewTicketDetail(ticketNumber) {
  window.location.href = `track-incident.html?ticket=${ticketNumber}`;
}

// =====================================================
//  INIT ON DOM READY
// =====================================================
document.addEventListener('DOMContentLoaded', () => {
  setDateTime();

  // Auto-load dropdowns if on log-incident page
  if (document.getElementById('category') && document.getElementById('location')) {
    loadDropdowns();
  }

  // Close modals on backdrop click
  document.querySelectorAll('dialog').forEach(dialog => {
    dialog.addEventListener('click', e => {
      const rect = dialog.getBoundingClientRect();
      if (e.clientX < rect.left || e.clientX > rect.right ||
          e.clientY < rect.top  || e.clientY > rect.bottom) {
        dialog.close();
      }
    });
  });

  // Auto-load dashboard data
  if (document.getElementById('statTotal') || document.getElementById('incidentsTableBody')) {
    loadDashboard();
  }

  // Auto-load technicians on assign page
  if (document.getElementById('availabilityTableBody')) {
    loadTechnicians();
  }

  // Track page — check for ticket param in URL
  const urlParams = new URLSearchParams(window.location.search);
  const ticketParam = urlParams.get('ticket');
  if (ticketParam && document.getElementById('searchTicket')) {
    document.getElementById('searchTicket').value = ticketParam;
    handleSearch(new Event('submit'));
  }
});
