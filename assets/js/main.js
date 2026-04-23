// =====================
// ROLE BASED ACCESS
// =====================

// Pages each role can access
const roleAccess = {
  admin: [
    'dashboard.html',
    'log-incident.html',
    'assign-incident.html',
    'resolve-incident.html',
    'escalate-incident.html',
    'track-incident.html',
    'reports.html'
  ],
  officer: [
    'officer-dashboard.html',
    'log-incident.html',
    'track-incident.html'
  ],
  technician: [
    'technician-dashboard.html',
    'resolve-incident.html',
    'escalate-incident.html'
  ]
};

// Sidebar links per role
const roleSidebar = {
  admin: `
    <ul>
      <li><a href="dashboard.html">🏠 Dashboard</a></li>
      <li><a href="log-incident.html">📋 Log Incident</a></li>
      <li><a href="assign-incident.html">👤 Assign Incident</a></li>
      <li><a href="resolve-incident.html">✅ Resolve Incident</a></li>
      <li><a href="escalate-incident.html">🚨 Escalate Incident</a></li>
      <li><a href="track-incident.html">🔍 Track Incident</a></li>
      <li><a href="reports.html">📊 Reports</a></li>
    </ul>
  `,
  officer: `
    <ul>
      <li><a href="officer-dashboard.html">🏠 Dashboard</a></li>
      <li><a href="log-incident.html">📋 Log Incident</a></li>
      <li><a href="track-incident.html">🔍 Track Incident</a></li>
    </ul>
  `,
  technician: `
    <ul>
      <li><a href="technician-dashboard.html">🏠 Dashboard</a></li>
      <li><a href="resolve-incident.html">✅ Resolve Incident</a></li>
      <li><a href="escalate-incident.html">🚨 Escalate Incident</a></li>
    </ul>
  `
};

function checkAccess() {
  const role = localStorage.getItem('userRole');
  const userName = localStorage.getItem('userName');
  const currentPage = window.location.pathname.split('/').pop();

  // If no role stored redirect to login
  if (!role) {
    window.location.href = '../index.html';
    return;
  }

  // Check if current page is allowed for this role
  if (!roleAccess[role].includes(currentPage)) {
    window.location.href = '../index.html';
    return;
  }

  // Update welcome name in navbar
  const navUser = document.querySelector('.nav-user');
  if (navUser) {
    navUser.textContent = `Welcome, ${userName}`;
  }

  // Update sidebar based on role
  const sidebarNav = document.querySelector('.sidebar-nav');
  if (sidebarNav) {
    sidebarNav.innerHTML = roleSidebar[role];

    // Set active link
    const links = sidebarNav.querySelectorAll('a');
    links.forEach(link => {
      if (link.getAttribute('href') === currentPage) {
        link.parentElement.classList.add('active');
      }
    });
  }
}

// Clear session on logout
function logout() {
  localStorage.removeItem('userRole');
  localStorage.removeItem('userName');
  window.location.href = '../index.html';
}

// =====================
// LOGIN HANDLER
// =====================
function handleLogin(event) {
  event.preventDefault();

  const email = document.getElementById('email').value.trim();
  const password = document.getElementById('password').value.trim();
  const errorMessage = document.getElementById('errorMessage');

  // Clear previous error
  errorMessage.textContent = '';

  // Dummy role-based login for prototype
if (email === 'admin@wits.ac.za' && password === 'admin123') {
  localStorage.setItem('userRole', 'admin');
  localStorage.setItem('userName', 'Admin');
  window.location.href = 'pages/dashboard.html';
} else if (email === 'officer@wits.ac.za' && password === 'officer123') {
  localStorage.setItem('userRole', 'officer');
  localStorage.setItem('userName', 'Officer');
  window.location.href = 'pages/officer-dashboard.html';
} else if (email === 'tech@wits.ac.za' && password === 'tech123') {
  localStorage.setItem('userRole', 'technician');
  localStorage.setItem('userName', 'Technician');
  window.location.href = 'pages/technician-dashboard.html';
} else {
  errorMessage.textContent = 'Invalid email or password. Please try again.';
}
}
// =====================
// AUTO SET DATE & TIME
// =====================
window.onload = function () {
  const dateField = document.getElementById('incidentDate');
  const timeField = document.getElementById('incidentTime');

  if (dateField && timeField) {
    const now = new Date();

    // Set date
    const date = now.toISOString().split('T')[0];
    dateField.value = date;

    // Set time
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    timeField.value = `${hours}:${minutes}`;
  }
};

// =====================
// LOG INCIDENT HANDLER
// =====================
function handleLogIncident(event) {
  event.preventDefault();

  const callerName = document.getElementById('callerName').value.trim();
  const callerContact = document.getElementById('callerContact').value.trim();
  const category = document.getElementById('category').value;
  const location = document.getElementById('location').value;
  const priority = document.getElementById('priority').value;
  const description = document.getElementById('description').value.trim();
  const errorMessage = document.getElementById('errorMessage');
  const successMessage = document.getElementById('successMessage');

  // Clear previous messages
  errorMessage.textContent = '';
  successMessage.style.display = 'none';

  // Validation
  if (!callerName || !callerContact || !category || 
      !location || !priority || !description) {
    errorMessage.textContent = 
      'Please complete all required fields before submitting.';
    return;
  }

  // Show success message
  successMessage.textContent = 
    `Incident successfully logged! 
     Ticket Number: ${document.getElementById('ticketNumber').textContent}`;
  successMessage.style.display = 'block';

  // Reset form after 3 seconds
  setTimeout(() => {
    document.getElementById('incidentForm').reset();
    successMessage.style.display = 'none';

    // Reset date and time
    window.onload();
  }, 3000);
}

// =====================
// RESET FORM
// =====================
function resetForm() {
  document.getElementById('incidentForm').reset();
  document.getElementById('errorMessage').textContent = '';
  document.getElementById('successMessage').style.display = 'none';
  window.onload();
}
// =====================
// ASSIGN INCIDENT
// =====================
let currentTicket = '';

function openAssignModal(ticketNumber, description, priority) {
  currentTicket = ticketNumber;

  document.getElementById('modalTicketNumber').textContent = ticketNumber;
  document.getElementById('modalDescription').textContent = description;
  document.getElementById('modalPriority').textContent = priority;

  // Set priority dropdown to match ticket priority
  const prioritySelect = document.getElementById('updatePriority');
  prioritySelect.value = priority.toLowerCase();

  document.getElementById('assignModal').showModal();
}

function closeAssignModal() {
  document.getElementById('assignModal').close();
  document.getElementById('assignForm').reset();
  document.getElementById('assignErrorMessage').textContent = '';
}

function handleAssignIncident(event) {
  event.preventDefault();

  const assignTo = document.getElementById('assignTo').value;
  const errorMessage = document.getElementById('assignErrorMessage');
  const successMessage = document.getElementById('successMessage');

  // Clear previous errors
  errorMessage.textContent = '';

  // Validation
  if (!assignTo) {
    errorMessage.textContent = 'Please select an officer to assign this ticket to.';
    return;
  }

  // Close modal
  closeAssignModal();

  // Show success message
  successMessage.textContent = 
    `Ticket ${currentTicket} successfully assigned to ${assignTo.replace('_', '. ').toUpperCase()}!`;
  successMessage.style.display = 'block';

  // Hide success message after 3 seconds
  setTimeout(() => {
    successMessage.style.display = 'none';
  }, 3000);
}

// =====================
// RESOLVE INCIDENT
// =====================
let currentResolveTicket = '';

function openResolveModal(ticketNumber, description, priority, assignedTo) {
  currentResolveTicket = ticketNumber;

  document.getElementById('resolveTicketNumber').textContent = ticketNumber;
  document.getElementById('resolveDescription').textContent = description;
  document.getElementById('resolvePriority').textContent = priority;
  document.getElementById('resolveAssignedTo').textContent = assignedTo;

  document.getElementById('resolveModal').showModal();
}

function closeResolveModal() {
  document.getElementById('resolveModal').close();
  document.getElementById('resolveForm').reset();
  document.getElementById('resolveErrorMessage').textContent = '';
}

function handleResolveIncident(event) {
  event.preventDefault();

  const status = document.getElementById('resolveStatus').value;
  const resolutionNotes = document.getElementById('resolutionNotes').value.trim();
  const timeSpent = document.getElementById('timeSpent').value;
  const errorMessage = document.getElementById('resolveErrorMessage');
  const successMessage = document.getElementById('successMessage');

  // Clear previous errors
  errorMessage.textContent = '';

  // Validation
  if (!status) {
    errorMessage.textContent = 'Please select a status.';
    return;
  }

  if (!resolutionNotes) {
    errorMessage.textContent = 
      'Resolution notes are mandatory. Please describe the steps taken.';
    return;
  }

  if (!timeSpent) {
    errorMessage.textContent = 'Please select the time spent on this ticket.';
    return;
  }

  // Close modal
  closeResolveModal();

  // Show success message
  successMessage.textContent = 
    `Ticket ${currentResolveTicket} has been successfully marked as ${status}!`;
  successMessage.style.display = 'block';

  // Hide after 3 seconds
  setTimeout(() => {
    successMessage.style.display = 'none';
  }, 3000);
}

// =====================
// REPORTS
// =====================
function handleFilter(event) {
  event.preventDefault();
  const dateFrom = document.getElementById('dateFrom').value;
  const dateTo = document.getElementById('dateTo').value;

  if (dateFrom && dateTo && dateFrom > dateTo) {
    alert('Date From cannot be after Date To.');
    return;
  }

  alert('Report filters applied successfully!');
}

function generateReport(reportName) {
  document.getElementById('reportModalTitle').textContent = reportName;
  document.getElementById('reportModalMessage').textContent =
    `Showing data for: ${reportName}. 
     In a live system this would pull real data from the database.`;
  document.getElementById('reportModal').showModal();
}

function closeReportModal() {
  document.getElementById('reportModal').close();
}

function exportData(format) {
  alert(`Exporting data as ${format}... 
    In a live system this would download a real ${format} file.`);
}
// =====================
// ESCALATE INCIDENT
// =====================
let currentEscalateTicket = '';

function openEscalateModal(ticketNumber, description, priority, slaStatus) {
  currentEscalateTicket = ticketNumber;

  document.getElementById('escalateTicketNumber').textContent = ticketNumber;
  document.getElementById('escalateDescription').textContent = description;
  document.getElementById('escalatePriority').textContent = priority;
  document.getElementById('escalateSLAStatus').textContent = 
    slaStatus === 'breached' ? 'SLA Breached' : 
    slaStatus === 'approaching' ? 'Approaching Breach' : 'Within SLA';

  // Auto select SLA breach reason if breached
  if (slaStatus === 'breached') {
    document.getElementById('escalationReason').value = 'sla_breach';
  }

  document.getElementById('escalateModal').showModal();
}

function closeEscalateModal() {
  document.getElementById('escalateModal').close();
  document.getElementById('escalateForm').reset();
  document.getElementById('escalateErrorMessage').textContent = '';
}

function handleEscalateIncident(event) {
  event.preventDefault();

  const reason = document.getElementById('escalationReason').value;
  const escalateTo = document.getElementById('escalateTo').value;
  const notes = document.getElementById('escalationNotes').value.trim();
  const errorMessage = document.getElementById('escalateErrorMessage');
  const successMessage = document.getElementById('successMessage');

  // Clear errors
  errorMessage.textContent = '';

  // Validation
  if (!reason) {
    errorMessage.textContent = 'Please select an escalation reason.';
    return;
  }

  if (!escalateTo) {
    errorMessage.textContent = 'Please select a department to escalate to.';
    return;
  }

  if (!notes) {
    errorMessage.textContent = 'Please provide escalation notes.';
    return;
  }

  // Close modal
  closeEscalateModal();

  // Show success
  successMessage.textContent = 
    `Ticket ${currentEscalateTicket} has been successfully escalated!`;
  successMessage.style.display = 'block';

  setTimeout(() => {
    successMessage.style.display = 'none';
  }, 3000);
}

// =====================
// TRACK INCIDENT
// =====================
function handleSearch(event) {
  event.preventDefault();
  const ticketNumber = document.getElementById('searchTicket').value.trim();

  if (!ticketNumber) {
    alert('Please enter a ticket number to search.');
    return;
  }

  alert(`Searching for ticket: ${ticketNumber}. 
    In a live system this would query the database.`);
}

function viewTicket(
  ticketNumber, description, location,
  category, priority, status, assignedTo, date
) {
  document.getElementById('detailTicketNumber').textContent = ticketNumber;
  document.getElementById('detailDescription').textContent = description;
  document.getElementById('detailLocation').textContent = location;
  document.getElementById('detailCategory').textContent = category;
  document.getElementById('detailPriority').textContent = priority;
  document.getElementById('detailStatus').textContent = status;
  document.getElementById('detailAssignedTo').textContent = assignedTo;
  document.getElementById('detailDate').textContent = `Logged: ${date}`;

  // Scroll to ticket detail
  document.getElementById('ticketDetail').scrollIntoView({ 
    behavior: 'smooth' 
  });
}