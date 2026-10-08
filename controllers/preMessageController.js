const pool = require('../config/db');

const PRE_LIMIT = 5;
const MAX_LEN = 300;

// Dono direction ki sabse relevant request ek row mein
const findRequest = async (a, b) => {
  const [rows] = await pool.query(
    `SELECT id, sender_id, receiver_id, status FROM chat_requests
     WHERE (sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?)
     ORDER BY (status = 'accepted') DESC, (status = 'pending') DESC, id DESC
     LIMIT 1`,
    [a, b, b, a]
  );
  return rows[0] || null;
};

const countSent = async (me, them) => {
  const [[row]] = await pool.query(
    'SELECT COUNT(*) AS c FROM pre_request_messages WHERE sender_id = ? AND receiver_id = ?',
    [me, them]
  );
  return Number(row.c);
};

const mapStatus = (row, me) => {
  if (!row) return null;
  if (row.status === 'accepted') return 'accepted';
  if (row.status === 'pending') return row.sender_id === me ? 'pending' : 'incoming';
  return null; // rejected
};

// GET /api/requests/pre-status?receiverId=
async function getPreStatus(req, res) {
  const me = Number(req.user.userId);
  const them = Number(req.query.receiverId);
  if (!them) return res.status(400).json({ message: 'receiverId required' });

  try {
    const row = await findRequest(me, them);
    const sent = await countSent(me, them);
    res.json({
      sent,
      limit: PRE_LIMIT,
      requestStatus: mapStatus(row, me),
      canMessage: !row && sent < PRE_LIMIT,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
}

// POST /api/requests/pre-message  { receiverId, content }
async function sendPreMessage(req, res) {
  const me = Number(req.user.userId);
  const them = Number(req.body.receiverId);
  const content = String(req.body.content || '').trim();

  if (!them || them === me) return res.status(400).json({ message: 'Invalid receiver' });
  if (!content) return res.status(400).json({ message: 'Message khali nahi ho sakta' });
  if (content.length > MAX_LEN) {
    return res.status(400).json({ message: `Message ${MAX_LEN} characters se zyada nahi ho sakta` });
  }

  try {
    const [[exists]] = await pool.query('SELECT id FROM users WHERE id = ?', [them]);
    if (!exists) return res.status(404).json({ message: 'User not found' });

    const row = await findRequest(me, them);
    if (row) {
      return res.status(400).json({ message: 'Request already exists. Chat accept hone par hi message bhej sakte ho.' });
    }

    const sent = await countSent(me, them);
    if (sent >= PRE_LIMIT) {
      return res.status(403).json({
        code: 'LIMIT_REACHED',
        message: `Aap ${PRE_LIMIT} messages bhej chuke ho. Ab request bhejo.`,
        sent,
        limit: PRE_LIMIT,
      });
    }

    await pool.query(
      'INSERT INTO pre_request_messages (sender_id, receiver_id, content) VALUES (?, ?, ?)',
      [me, them, content]
    );

    res.json({ message: 'Sent', sent: sent + 1, limit: PRE_LIMIT });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
}

// Accept hone par call karo: pre-messages ko naye conversation mein move karta hai
// Usage: await movePreMessages(userA, userB, convId);
async function movePreMessages(a, b, convId) {
  const [rows] = await pool.query(
    `SELECT sender_id, content, created_at FROM pre_request_messages
     WHERE (sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?)
     ORDER BY created_at ASC, id ASC`,
    [a, b, b, a]
  );

  if (rows.length) {
    const values = rows.map((r) => [convId, r.sender_id, r.content, r.created_at]);
    await pool.query(
      'INSERT INTO messages (conversation_id, sender_id, content, created_at) VALUES ?',
      [values]
    );
  }

  await pool.query(
    `DELETE FROM pre_request_messages
     WHERE (sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?)`,
    [a, b, b, a]
  );
}

module.exports = { getPreStatus, sendPreMessage, movePreMessages };