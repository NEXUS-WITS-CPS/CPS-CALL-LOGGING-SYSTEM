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