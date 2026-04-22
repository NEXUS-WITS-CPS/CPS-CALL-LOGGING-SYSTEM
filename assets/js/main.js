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