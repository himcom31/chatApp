const pool = require('../config/db');

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

// Safely extract interests from either a JSON column or a string
const parseInterests = (value) => {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

// Build clean interests from either an array or a JSON string
const cleanInterests = (value) => {
  let arr = value;
  if (typeof value === 'string') {
    try {
      arr = JSON.parse(value);
    } catch {
      arr = [];
    }
  }
  if (!Array.isArray(arr)) return [];
  return arr
    .map((i) => String(i).trim().slice(0, 30))
    .filter(Boolean)
    .slice(0, 20);
};

// Convert a relative upload path (/uploads/xyz.jpg) to a full URL
const toAbsoluteUrl = (req, path) => {
  if (!path) return null;
  if (/^https?:\/\//i.test(path)) return path;
  const clean = path.startsWith('/') ? path : `/${path}`;
  return `${req.protocol}://${req.get('host')}${clean}`;
};

const formatMe = (req, u) => ({
  id: u.id,
  username: u.username,
  email: u.email,
  full_name: u.full_name,
  dob: u.dob || null,
  gender: u.gender || null,
  location: u.location || null,
  bio: u.bio || u.about || null,
  interests: parseInterests(u.interests),
  avatar_url: u.avatar_url || toAbsoluteUrl(req, u.profile_photo),
  is_verified: u.is_verified,
  created_at: u.created_at,
  last_seen: u.last_seen,
});

const fetchMyProfile = async (req, userId) => {
  const [rows] = await pool.query(
    `SELECT id, username, email, full_name, dob, gender, location, bio, about, interests,
            profile_photo, avatar_url, is_verified, created_at, last_seen
     FROM users WHERE id = ?`,
    [userId]
  );
  return rows[0] ? formatMe(req, rows[0]) : null;
};

// Get my profile info (including all signup fields)
async function getMyProfile(req, res) {
  try {
    const me = await fetchMyProfile(req, req.user.userId);
    if (!me) return res.status(404).json({ message: 'User not found' });
    res.json({ user: me });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
}

// Update profile: all signup fields + avatar
async function updateProfile(req, res) {
  const userId = req.user.userId;
  const body = req.body || {};
  const fields = [];
  const values = [];
  const set = (col, val) => {
    fields.push(`${col} = ?`);
    values.push(val);
  };
  const fail = (message) => res.status(400).json({ message });

  try {
    if ('full_name' in body) {
      const name = String(body.full_name || '').trim().slice(0, 100);
      if (!name) return fail('Name cannot be empty');
      set('full_name', name);
    }

    if ('username' in body) {
      const username = String(body.username || '').trim().toLowerCase();
      if (!USERNAME_RE.test(username)) {
        return fail('Username must be 3-20 characters, only a-z, 0-9, and _');
      }
      const [rows] = await pool.query(
        'SELECT id FROM users WHERE username = ? AND id != ?',
        [username, userId]
      );
      if (rows.length > 0) return fail('This username is already taken');
      set('username', username);
    }

    if ('dob' in body) {
      const raw = String(body.dob || '').trim();
      if (!raw) {
        set('dob', null);
      } else {
        const age = getAge(raw);
        if (age === null) return fail('Invalid date of birth');
        if (age < 18) return fail('You must be 18 or older');
        set('dob', new Date(raw));
      }
    }

    if ('gender' in body) {
      set('gender', GENDERS.includes(body.gender) ? body.gender : null);
    }

    if ('location' in body) {
      set('location', String(body.location || '').trim().slice(0, 100) || null);
    }

    if ('bio' in body) {
      // Keep bio and about in sync so both show the same value
      const bio = String(body.bio || '').trim().slice(0, 300) || null;
      set('bio', bio);
      set('about', bio);
    }

    if ('interests' in body) {
      set('interests', JSON.stringify(cleanInterests(body.interests)));
    }

    // Cloudinary URL comes from the multer middleware
    if (req.file) {
      set('avatar_url', req.file.path);
    }

    if (fields.length === 0) {
      return fail('No fields provided to update');
    }

    values.push(userId);
    await pool.query(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`, values);

    const me = await fetchMyProfile(req, userId);
    res.json({
      message: 'Profile updated successfully',
      avatar_url: me?.avatar_url || null,
      user: me,
    });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return fail('This username is already taken');
    }
    console.error(err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
}

// Search users by username or email
async function searchUsers(req, res) {
  const { q } = req.query;

  if (!q) {
    return res.status(400).json({ message: 'Search query is required (?q=...)' });
  }

  try {
    const [rows] = await pool.query(
      `SELECT id, username, full_name, avatar_url FROM users
       WHERE (username LIKE ? OR email LIKE ?) AND id != ? LIMIT 20`,
      [`%${q}%`, `%${q}%`, req.user.userId]
    );

    res.json({ users: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
}

// Get any user's profile (public view)
async function getUserById(req, res) {
  const { id } = req.params;

  try {
    const [rows] = await pool.query(
      'SELECT id, username, full_name, avatar_url, about, last_seen FROM users WHERE id = ?',
      [id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ message: 'User not found' });
    }

    res.json({ user: rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
}

module.exports = { getMyProfile, updateProfile, searchUsers, getUserById };