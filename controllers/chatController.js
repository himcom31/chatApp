const pool = require('../config/db');

// Get all my conversations (latest first)
async function getChats(req, res) {
  const userId = req.user.userId;

  try {
    const [rows] = await pool.query(
      `SELECT 
        c.id AS convId,
        c.last_message_at,
        u.id AS otherUserId,
        u.username,
        u.full_name,
        u.avatar_url,
        (SELECT content FROM messages WHERE conversation_id = c.id ORDER BY created_at DESC LIMIT 1) AS lastMessage,
        (SELECT COUNT(*) FROM messages WHERE conversation_id = c.id AND sender_id != ? AND status != 'read') AS unreadCount
       FROM conversations c
       JOIN users u ON u.id = IF(c.user1_id = ?, c.user2_id, c.user1_id)
       WHERE c.user1_id = ? OR c.user2_id = ?
       ORDER BY c.last_message_at DESC`,
      [userId, userId, userId, userId]
    );

    res.json({ chats: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
}

// Get all messages in a conversation
async function getMessages(req, res) {
  const userId = req.user.userId;
  const { convId } = req.params;

  try {
    // Verify this conversation belongs to the current user
    const [conv] = await pool.query(
      'SELECT * FROM conversations WHERE id = ? AND (user1_id = ? OR user2_id = ?)',
      [convId, userId, userId]
    );

    if (conv.length === 0) {
      return res.status(404).json({ message: 'Conversation not found' });
    }

    const [messages] = await pool.query(
      'SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC',
      [convId]
    );

    res.json({ messages });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
}

// Send a message — REST fallback (primary method is Socket.io)
async function sendMessage(req, res) {
  const userId = req.user.userId;
  const { convId } = req.params;
  const { content } = req.body;

  if (!content) {
    return res.status(400).json({ message: 'Message content is required' });
  }

  try {
    const [conv] = await pool.query(
      'SELECT * FROM conversations WHERE id = ? AND (user1_id = ? OR user2_id = ?)',
      [convId, userId, userId]
    );

    if (conv.length === 0) {
      return res.status(404).json({ message: 'Conversation not found' });
    }

    const [result] = await pool.query(
      'INSERT INTO messages (conversation_id, sender_id, content, status) VALUES (?, ?, ?, "sent")',
      [convId, userId, content]
    );

    await pool.query('UPDATE conversations SET last_message_at = NOW() WHERE id = ?', [convId]);

    const otherUserId = conv[0].user1_id === userId ? conv[0].user2_id : conv[0].user1_id;
    const io = req.app.get('io');
    io.to(`user_${otherUserId}`).emit('new_message', {
      id: result.insertId,
      conversation_id: convId,
      sender_id: userId,
      content,
      status: 'sent',
      created_at: new Date()
    });

    res.json({ message: 'Message sent successfully', messageId: result.insertId });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
}

// Mark a message as read
async function markAsRead(req, res) {
  const { id } = req.params;

  try {
    await pool.query('UPDATE messages SET status = "read" WHERE id = ?', [id]);

    const [msgRows] = await pool.query('SELECT * FROM messages WHERE id = ?', [id]);
    if (msgRows.length > 0) {
      const io = req.app.get('io');
      io.to(`user_${msgRows[0].sender_id}`).emit('message_status', { messageId: id, status: 'read' });
    }

    res.json({ message: 'Message marked as read' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
}

module.exports = { getChats, getMessages, sendMessage, markAsRead };