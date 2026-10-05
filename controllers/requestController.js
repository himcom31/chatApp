const pool = require('../config/db');
require('dotenv').config();

// Send a chat request to someone
async function sendRequest(req, res) {
  const senderId = req.user.userId;
  const { receiverId } = req.body;

  if (!receiverId) {
    return res.status(400).json({ message: 'receiverId is required' });
  }

  if (parseInt(receiverId) === senderId) {
    return res.status(400).json({ message: 'You cannot send a request to yourself' });
  }

  try {
    // Check if receiver exists
    const [receiver] = await pool.query('SELECT id FROM users WHERE id = ?', [receiverId]);
    if (receiver.length === 0) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Check if a pending or accepted request already exists
    const [existing] = await pool.query(
      `SELECT * FROM chat_requests 
       WHERE ((sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?))
       AND status IN ('pending', 'accepted')`,
      [senderId, receiverId, receiverId, senderId]
    );

    if (existing.length > 0) {
      return res.status(400).json({ message: 'Request already sent or connection already exists' });
    }

    const [result] = await pool.query(
      'INSERT INTO chat_requests (sender_id, receiver_id, status) VALUES (?, ?, "pending")',
      [senderId, receiverId]
    );

    // Use socket instance from app to send real-time notification
    const io = req.app.get('io');
    io.to(`user_${receiverId}`).emit('chat_request', { from: senderId, requestId: result.insertId });

    res.json({ message: 'Request sent successfully', requestId: result.insertId });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
}

// Get all incoming pending requests
async function getIncoming(req, res) {
  const userId = req.user.userId;

  try {
    const [rows] = await pool.query(
      `SELECT cr.id, cr.sender_id, cr.created_at, u.username, u.full_name, u.avatar_url
       FROM chat_requests cr
       JOIN users u ON cr.sender_id = u.id
       WHERE cr.receiver_id = ? AND cr.status = 'pending'
       ORDER BY cr.created_at DESC`,
      [userId]
    );

    res.json({ requests: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
}

// Accept a request — also creates a conversation
async function acceptRequest(req, res) {
  const userId = req.user.userId;
  const { id } = req.params;

  try {
    const [rows] = await pool.query(
      'SELECT * FROM chat_requests WHERE id = ? AND receiver_id = ? AND status = "pending"',
      [id, userId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ message: 'Request not found' });
    }

    const request = rows[0];
    await pool.query('UPDATE chat_requests SET status = "accepted" WHERE id = ?', [id]);

    // Create conversation — user1_id is always the smaller ID
    const user1 = Math.min(request.sender_id, request.receiver_id);
    const user2 = Math.max(request.sender_id, request.receiver_id);

    const [convResult] = await pool.query(
      'INSERT INTO conversations (user1_id, user2_id, last_message_at) VALUES (?, ?, NOW())',
      [user1, user2]
    );

    const io = req.app.get('io');
    io.to(`user_${request.sender_id}`).emit('request_accepted', {
      convId: convResult.insertId,
      by: userId
    });

    res.json({ message: 'Request accepted successfully', convId: convResult.insertId });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
}

// Reject a request (sender is not notified)
async function rejectRequest(req, res) {
  const userId = req.user.userId;
  const { id } = req.params;

  try {
    const [rows] = await pool.query(
      'SELECT * FROM chat_requests WHERE id = ? AND receiver_id = ? AND status = "pending"',
      [id, userId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ message: 'Request not found' });
    }

    await pool.query('UPDATE chat_requests SET status = "rejected" WHERE id = ?', [id]);
    res.json({ message: 'Request rejected successfully' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
}

// Share link fallback — when the receiver doesn't know the User ID
function getShareLink(req, res) {
  const { userId } = req.params;
  const link = `${process.env.CLIENT_URL}/add/${userId}`;
  res.json({ link });
}

module.exports = { sendRequest, getIncoming, acceptRequest, rejectRequest, getShareLink };