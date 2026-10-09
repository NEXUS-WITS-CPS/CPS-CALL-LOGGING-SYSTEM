// =====================================================
// AUTH ROUTES — /api/auth
// =====================================================
const express  = require('express');
const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');
const supabase = require('../supabaseClient');
const { authMiddleware } = require('../middleware/auth');

const { logUserAudit } = require('../lib/userAudit');

const router = express.Router();

// ── POST /api/auth/login ──
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required.' });
    }

    // Find user by email
    const { data: user, error } = await supabase
      .from('users')
      .select('*')
      .eq('email', email.toLowerCase().trim())
      .single();

    if (error || !user) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }
    if (user.account_status === 'pending' || user.account_status === 'rejected') {
      // only reveal the status once the right password is supplied
      const okPw = await bcrypt.compare(password, user.password_hash || '');
      if (!okPw) return res.status(401).json({ error: 'Invalid email or password.' });
      return res.status(403).json({ error: user.account_status === 'pending'
        ? 'Your access request is still waiting for approval by an administrator.'
        : 'Your access request was not approved. Please contact the CPS administrator.' });
    }
    if (!user.is_active) return res.status(401).json({ error: 'Invalid email or password.' });

    // All accounts (including demo accounts) are verified against their bcrypt hash
    const passwordValid = await bcrypt.compare(password, user.password_hash || '');

    if (!passwordValid) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    // Generate JWT
    const token = jwt.sign(
      {
        userId:   user.user_id,
        email:    user.email,
        fullName: user.full_name,
        role:     user.role,
        mustChange: !!user.must_change_password
      },
      process.env.JWT_SECRET,
      { expiresIn: '8h' }
    );

    // Return user info and token (never return password_hash)
    res.json({
      token,
      user: {
        userId:   user.user_id,
        fullName: user.full_name,
        email:    user.email,
        role:     user.role,
        mustChangePassword: !!user.must_change_password
      }
    });

  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Login failed. Please try again.' });
  }
});

// ── GET /api/auth/me — Get current user from token ──
router.get('/me', authMiddleware, async (req, res) => {
  try {
    const { data: user, error } = await supabase
      .from('users')
      .select('user_id, full_name, email, role, is_active, created_at')
      .eq('user_id', req.user.userId)
      .single();

    if (error || !user) {
      return res.status(404).json({ error: 'User not found.' });
    }

    res.json({ user });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get user info.' });
  }
});

// ── POST /api/auth/register — Create new user (Admin only) ──
router.post('/register', authMiddleware, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Only admins can create new users.' });
    }

    const { fullName, email, password, role } = req.body;

    if (!fullName || !email || !password || !role) {
      return res.status(400).json({ error: 'All fields are required.' });
    }

    if (String(fullName).trim().length < 3) return res.status(400).json({ error: 'Enter the person\'s full name.' });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email).trim())) return res.status(400).json({ error: 'Enter a valid email address.' });
    if (String(password).length < 8) return res.status(400).json({ error: 'The password must be at least 8 characters.' });

    const validRoles = ['admin','officer','technician'];
    if (!validRoles.includes(role)) {
      return res.status(400).json({ error: `Invalid role. Must be one of: ${validRoles.join(', ')}` });
    }

    // Check email not already used
    const { data: existing } = await supabase
      .from('users')
      .select('user_id')
      .eq('email', email.toLowerCase().trim())
      .single();

    if (existing) {
      return res.status(409).json({ error: 'A user with this email already exists.' });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const { data: newUser, error } = await supabase
      .from('users')
      .insert({
        full_name:     fullName,
        email:         email.toLowerCase().trim(),
        password_hash: passwordHash,
        role,
        is_active:     true,
        account_status: 'active',
        must_change_password: true
      })
      .select('user_id, full_name, email, role')
      .single();

    if (error) throw error;
    await logUserAudit(newUser.user_id, 'created', req.user.userId, `Account created with role ${role} by ${req.user.fullName}`);

    res.status(201).json({
      message: `User ${newUser.full_name} created successfully.`,
      user: newUser
    });

  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ error: 'Failed to create user.' });
  }
});

// ── POST /api/auth/request-access — public: ask for an account (no role, no login until approved) ──
router.post('/request-access', async (req, res) => {
  try {
    const { fullName, email, password } = req.body || {};
    const name = String(fullName || '').trim(), mail = String(email || '').toLowerCase().trim();
    if (name.length < 3) return res.status(400).json({ error: 'Enter your full name.' });
    if (!/^[^\s@]+@(students\.)?wits\.ac\.za$/.test(mail)) return res.status(400).json({ error: 'Use your Wits email address (name@wits.ac.za).' });
    if (String(password || '').length < 8) return res.status(400).json({ error: 'The password must be at least 8 characters.' });

    const { data: existing } = await supabase.from('users').select('user_id').eq('email', mail).single();
    if (existing) return res.status(409).json({ error: 'An account or request for this email already exists.' });

    const { data: u, error } = await supabase.from('users').insert({
      full_name: name, email: mail, password_hash: await bcrypt.hash(String(password), 10),
      role: 'officer', is_active: false, account_status: 'pending', requested_at: new Date().toISOString()
    }).select('user_id').single();
    if (error) throw error;
    await logUserAudit(u.user_id, 'requested', null, `Access requested by ${name} (${mail})`);
    res.status(201).json({ message: 'Request received. An administrator will review it and assign your role. You can sign in once it is approved.' });
  } catch (err) {
    console.error('Request-access error:', err);
    res.status(500).json({ error: 'Could not submit your request. Please try again.' });
  }
});

// ── POST /api/auth/change-password — signed-in user sets their own password ──
router.post('/change-password', authMiddleware, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body || {};
    if (String(newPassword || '').length < 8) return res.status(400).json({ error: 'The new password must be at least 8 characters.' });
    const { data: user } = await supabase.from('users').select('*').eq('user_id', req.user.userId).single();
    if (!user) return res.status(404).json({ error: 'User not found.' });
    if (!(await bcrypt.compare(String(currentPassword || ''), user.password_hash || ''))) return res.status(401).json({ error: 'Your current password is incorrect.' });
    if (String(newPassword) === String(currentPassword)) return res.status(400).json({ error: 'Choose a password different from the current one.' });
    await supabase.from('users').update({ password_hash: await bcrypt.hash(String(newPassword), 10), must_change_password: false }).eq('user_id', user.user_id);
    await logUserAudit(user.user_id, 'password_changed', user.user_id, 'Changed own password');
    const token = jwt.sign({ userId: user.user_id, email: user.email, fullName: user.full_name, role: user.role, mustChange: false }, process.env.JWT_SECRET, { expiresIn: '8h' });
    res.json({ message: 'Password updated.', token, user: { userId: user.user_id, fullName: user.full_name, email: user.email, role: user.role, mustChangePassword: false } });
  } catch (err) {
    res.status(500).json({ error: 'Failed to change password.' });
  }
});

module.exports = router;
