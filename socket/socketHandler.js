const pool = require('../config/db');

// Online users track karne ke liye simple in-memory map
const onlineUsers = new Map(); // userId -> socketId

function socketHandler(io) {
  io.on('connection', (socket) => {
    console.log('New socket connected:', socket.id);

    // User apna personal room join kare (login ke turant baad frontend se call hoga)
    socket.on('join', async ({ userId }) => {
      socket.userId = userId;
      socket.join(`user_${userId}`);
      onlineUsers.set(userId, socket.id);

      // Sabko batao ye user online hai
      socket.broadcast.emit('user_status', { userId, isOnline: true, lastSeen: null });
      console.log(`User ${userId} joined room user_${userId}`);
    });

    // Message bhejna (real-time primary way)
    socket.on('send_message', async ({ convId, content, senderId }) => {
      try {
        const [conv] = await pool.query('SELECT * FROM conversations WHERE id = ?', [convId]);
        if (conv.length === 0) return;

        const [result] = await pool.query(
          'INSERT INTO messages (conversation_id, sender_id, content, status) VALUES (?, ?, ?, "sent")',
          [convId, senderId, content]
        );

        await pool.query('UPDATE conversations SET last_message_at = NOW() WHERE id = ?', [convId]);

        const otherUserId = conv[0].user1_id === senderId ? conv[0].user2_id : conv[0].user1_id;

        io.to(`user_${otherUserId}`).emit('new_message', {
          id: result.insertId,
          conversation_id: convId,
          sender_id: senderId,
          content,
          status: 'sent',
          created_at: new Date()
        });

        // Sender ko bhi confirmation bhejo (uska apna UI update ho)
        socket.emit('new_message', {
          id: result.insertId,
          conversation_id: convId,
          sender_id: senderId,
          content,
          status: 'sent',
          created_at: new Date()
        });
      } catch (err) {
        console.error('send_message error:', err);
      }
    });

    // Typing indicator
    socket.on('typing', ({ convId, isTyping, userId, otherUserId }) => {
      io.to(`user_${otherUserId}`).emit('typing_indicator', { userId, isTyping });
    });

    // Read receipt real-time update
    socket.on('message_read', async ({ messageId, convId }) => {
      try {
        await pool.query('UPDATE messages SET status = "read" WHERE id = ?', [messageId]);

        const [msgRows] = await pool.query('SELECT * FROM messages WHERE id = ?', [messageId]);
        if (msgRows.length > 0) {
          io.to(`user_${msgRows[0].sender_id}`).emit('message_status', { messageId, status: 'read' });
        }
      } catch (err) {
        console.error('message_read error:', err);
      }
    });

    // Disconnect — offline mark karo, last_seen update karo
    socket.on('disconnect', async () => {
      console.log('Socket disconnected:', socket.id);

      if (socket.userId) {
        onlineUsers.delete(socket.userId);
        try {
          await pool.query('UPDATE users SET last_seen = NOW() WHERE id = ?', [socket.userId]);
        } catch (err) {
          console.error('last_seen update error:', err);
        }

        socket.broadcast.emit('user_status', {
          userId: socket.userId,
          isOnline: false,
          lastSeen: new Date()
        });
      }
    });
  });
}

module.exports = socketHandler;