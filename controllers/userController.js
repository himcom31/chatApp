const pool = require('../config/db');

// Get my profile info
async function getMyProfile(req, res) {
  try {
    const [rows] = await pool.query(
      'SELECT id, username, email, full_name, avatar_url, about, created_at, last_seen FROM users WHERE id = ?',
      [req.user.userId]
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

// Update profile (name, about, avatar)
async function updateProfile(req, res) {
  const { full_name, about } = req.body;
  const userId = req.user.userId;

  try {
    // If a file was uploaded, Cloudinary URL will be available in req.file.path
    const avatarUrl = req.file ? req.file.path : null;

    const fields = [];
    const values = [];

    if (full_name) {
      fields.push('full_name = ?');
      values.push(full_name);
    }
    if (about) {
      fields.push('about = ?');
      values.push(about);
    }
    if (avatarUrl) {
      fields.push('avatar_url = ?');
      values.push(avatarUrl);
    }

    if (fields.length === 0) {
      return res.status(400).json({ message: 'No fields provided to update' });
    }

    values.push(userId);
    await pool.query(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`, values);

    res.json({ message: 'Profile updated successfully', avatar_url: avatarUrl });
  } catch (err) {
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