// =====================================================
// AUTH ROUTES — /api/auth
// =====================================================
const express  = require('express');
const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');
const supabase = require('../supabaseClient');
const { authMiddleware } = require('../middleware/auth');

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
      .eq('is_active', true)
      .single();

    if (error || !user) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    // For demo accounts use simple password check
    // In production all passwords are bcrypt hashed
    const demoPasswords = {
      'admin@wits.ac.za':    'admin123',
      'officer@wits.ac.za':  'officer123',
      'tech@wits.ac.za':     'tech123',
      'caller@wits.ac.za':   'caller123',
      'dlamini@wits.ac.za':  'password123',
      'mokoena@wits.ac.za':  'password123',
      'nkosi@wits.ac.za':    'password123',
      'khumalo@wits.ac.za':  'password123',
    };

    let passwordValid = false;

    if (demoPasswords[email.toLowerCase()]) {
      passwordValid = password === demoPasswords[email.toLowerCase()];
    } else {
      passwordValid = await bcrypt.compare(password, user.password_hash);
    }

    if (!passwordValid) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    // Generate JWT
    const token = jwt.sign(
      {
        userId:   user.user_id,
        email:    user.email,
        fullName: user.full_name,
        role:     user.role
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
        role:     user.role
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

    const validRoles = ['admin','officer','technician','caller'];
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
        role
      })
      .select('user_id, full_name, email, role')
      .single();

    if (error) throw error;

    res.status(201).json({
      message: `User ${newUser.full_name} created successfully.`,
      user: newUser
    });

  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ error: 'Failed to create user.' });
  }
});

module.exports = router;
