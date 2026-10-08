const pool = require('../config/db');
const { createAndSendOTP, verifyOTP } = require('../utils/otpHelper');
const { signToken } = require('../utils/jwtHelper');

const USERNAME_RE = /^[a-z0-9_]{3,20}$/;
const GENDERS = ['male', 'female', 'other'];

const getAge = (dob) => {
  const d = new Date(dob);
  if (isNaN(d)) return null;
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age--;
  return age;
};

const publicUser = (u) => ({
  id: u.id,
  email: u.email,
  username: u.username,
  full_name: u.full_name,
  is_verified: u.is_verified,
  dob: u.dob || null,
  gender: u.gender || null,
  location: u.location || null,
  bio: u.bio || null,
  interests: u.interests || [],
  profile_photo: u.profile_photo || null,
});

// STEP 1: Signup — Send OTP to email
async function signup(req, res) {
  const email = String(req.body.email || '').trim().toLowerCase();

  if (!email) {
    return res.status(400).json({ message: 'Email is required' });
  }
  if (!/\S+@\S+\.\S+/.test(email)) {
    return res.status(400).json({ message: 'Invalid email' });
  }

  try {
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

// Username availability (live check from app)
async function checkUsername(req, res) {
  const u = String(req.query.u || '').trim().toLowerCase();
  if (!USERNAME_RE.test(u)) return res.json({ available: false });

  try {
    const [rows] = await pool.query('SELECT id FROM users WHERE username = ?', [u]);
    res.json({ available: rows.length === 0 });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
}

// STEP 2: Verify Signup OTP + Create user with full profile
async function verifySignup(req, res) {
  const { otp, full_name, dob, gender, location, bio, interests } = req.body;
  const email = String(req.body.email || '').trim().toLowerCase();
  const username = String(req.body.username || '').trim().toLowerCase();

  if (!email || !otp || !username || !full_name) {
    return res.status(400).json({ message: 'All fields are required' });
  }
  if (!USERNAME_RE.test(username)) {
    return res.status(400).json({ message: 'Invalid username' });
  }
  if (dob) {
    const age = getAge(dob);
    if (age === null) return res.status(400).json({ message: 'Invalid date of birth' });
    if (age < 18) return res.status(400).json({ message: 'You must be 18 or older' });
  }

  try {
    // Check before verifying OTP so the OTP isn't wasted due to an email/username conflict
    const [emailRows] = await pool.query('SELECT id FROM users WHERE email = ?', [email]);
    if (emailRows.length > 0) {
      return res.status(400).json({ message: 'This email is already registered' });
    }
    const [nameRows] = await pool.query('SELECT id FROM users WHERE username = ?', [username]);
    if (nameRows.length > 0) {
      return res.status(400).json({ message: 'This username is already taken' });
    }

    const result = await verifyOTP(email, 'signup', otp);
    if (!result.success) {
      return res.status(400).json({ message: result.message });
    }

    const cleanInterests = Array.isArray(interests)
      ? interests.map((i) => String(i).slice(0, 30)).slice(0, 20)
      : [];

    const [insertResult] = await pool.query(
      `INSERT INTO users
        (username, email, full_name, dob, gender, location, bio, interests, is_verified)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      [
        username,
        email,
        String(full_name).trim().slice(0, 100),
        dob ? new Date(dob) : null,
        GENDERS.includes(gender) ? gender : null,
        location ? String(location).trim().slice(0, 100) : null,
        bio ? String(bio).slice(0, 300) : null,
        JSON.stringify(cleanInterests),
      ]
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
        dob: dob || null,
        gender: GENDERS.includes(gender) ? gender : null,
        location: location || null,
        bio: bio || null,
        interests: cleanInterests,
        profile_photo: null,
      },
    });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(400).json({ message: 'Username or email already taken' });
    }
    console.error(err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
}

// Upload profile + extra photos (token required)
async function uploadPhotos(req, res) {
  try {
    const userId = req.user.userId;
    const files = req.files || [];
    if (!files.length) return res.json({ message: 'No photos' });

    const urls = files.map((f) => `/uploads/${f.filename}`);

    await pool.query('DELETE FROM user_photos WHERE user_id = ?', [userId]);
    await pool.query('UPDATE users SET profile_photo = ? WHERE id = ?', [urls[0], userId]);

    for (let i = 0; i < urls.length; i++) {
      await pool.query(
        'INSERT INTO user_photos (user_id, url, position) VALUES (?, ?, ?)',
        [userId, urls[i], i]
      );
    }

    res.json({ message: 'Photos uploaded', profile_photo: urls[0], photos: urls });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
}

// STEP 3: Login — Send OTP via email or username
async function login(req, res) {
  const identifier = String(req.body.identifier || '').trim().toLowerCase();

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
  const identifier = String(req.body.identifier || '').trim().toLowerCase();
  const { otp } = req.body;

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
    res.json({
      message: 'Login successful',
      token,
      userId: user.id,
      user: publicUser(user),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
}

// Logout — Token is deleted client side
function logout(req, res) {
  res.json({ message: 'Logged out successfully' });
}

module.exports = {
  signup,
  checkUsername,
  verifySignup,
  uploadPhotos,
  login,
  verifyLogin,
  logout,
};