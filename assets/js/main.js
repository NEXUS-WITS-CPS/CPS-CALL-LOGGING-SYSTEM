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
    window.location.href = 'pages/dashboard.html';
  } else if (email === 'officer@wits.ac.za' && password === 'officer123') {
    window.location.href = 'pages/dashboard.html';
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