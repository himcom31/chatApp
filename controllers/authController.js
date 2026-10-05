const pool = require('../config/db');
const { createAndSendOTP, verifyOTP } = require('../utils/otpHelper');
const { signToken } = require('../utils/jwtHelper');

// STEP 1: Signup — Send OTP to email
async function signup(req, res) {
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({ message: 'Email is required' });
  }

  try {
    // Check if email is already registered
    const [existing] = await pool.query('SELECT id FROM users WHERE email = ?', [email]);
    if (existing.length > 0) {
      return res.status(400).json({ message: 'This email is already registered' });
    }

    await createAndSendOTP(email, 'signup');
    res.json({ message: 'OTP has been sent to your email' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
}

// STEP 2: Verify Signup OTP + Create user
async function verifySignup(req, res) {
  const { email, otp, username, full_name } = req.body;

  console.log('=== VERIFY SIGNUP ===');
  console.log('email:', email);
  console.log('otp received:', otp);
  console.log('otp type:', typeof otp);
  console.log('otp length:', otp?.length);

  console.log('username:', username);
  console.log('full_name:', full_name);
  console.log('full body:', JSON.stringify(req.body));

  if (!email || !otp || !username || !full_name) {
    return res.status(400).json({ message: 'All fields are required' });
  }

  try {
    const result = await verifyOTP(email, 'signup', otp);
    if (!result.success) {
      return res.status(400).json({ message: result.message });
    }

    // Check if username is already taken
    const [existingUsername] = await pool.query('SELECT id FROM users WHERE username = ?', [username]);
    if (existingUsername.length > 0) {
      return res.status(400).json({ message: 'This username is already taken' });
    }

    const [insertResult] = await pool.query(
      'INSERT INTO users (username, email, full_name, is_verified) VALUES (?, ?, ?, 1)',
      [username, email, full_name]
    );

    const token = signToken(insertResult.insertId);
    res.json({
      message: 'Account created successfully',
      token,
      userId: insertResult.insertId,
      user: {
        id: insertResult.insertId,
        email,
        username,
        full_name,
        is_verified: 1,
      }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
}

// STEP 3: Login — Send OTP via email or username
async function login(req, res) {
  const { identifier } = req.body; // email or username

  if (!identifier) {
    return res.status(400).json({ message: 'Email or username is required' });
  }

  try {
    const [rows] = await pool.query(
      'SELECT * FROM users WHERE email = ? OR username = ?',
      [identifier, identifier]
    );

    if (rows.length === 0) {
      return res.status(404).json({ message: 'User not found' });
    }

    const user = rows[0];
    await createAndSendOTP(user.email, 'login');
    res.json({ message: 'OTP has been sent to your email' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
}

// STEP 4: Verify Login OTP + Issue JWT
async function verifyLogin(req, res) {
  const { identifier, otp } = req.body;

  if (!identifier || !otp) {
    return res.status(400).json({ message: 'All fields are required' });
  }

  try {
    const [rows] = await pool.query(
      'SELECT * FROM users WHERE email = ? OR username = ?',
      [identifier, identifier]
    );

    if (rows.length === 0) {
      return res.status(404).json({ message: 'User not found' });
    }

    const user = rows[0];
    const result = await verifyOTP(user.email, 'login', otp);
    if (!result.success) {
      return res.status(400).json({ message: result.message });
    }

    await pool.query('UPDATE users SET last_seen = NOW() WHERE id = ?', [user.id]);

    const token = signToken(user.id);
    res.json({ message: 'Login successful', token, userId: user.id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
}

// Logout — Token is deleted on the client side, server just sends a response
function logout(req, res) {
  res.json({ message: 'Logged out successfully' });
}

module.exports = { signup, verifySignup, login, verifyLogin, logout };