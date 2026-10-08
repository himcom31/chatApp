const pool = require('../config/db');

const onlineUsers = new Map();

function socketHandler(io) {
  io.on('connection', (socket) => {
    console.log('New socket connected:', socket.id);

    socket.on('join', async ({ userId }) => {
      socket.userId = parseInt(userId); // ✅ integer store karo
      socket.join(`user_${userId}`);
      onlineUsers.set(userId, socket.id);
      socket.broadcast.emit('user_status', { userId, isOnline: true, lastSeen: null });
      console.log(`User ${userId} joined room user_${userId}`);
    });

    // ✅ senderId frontend se nahi, socket.userId se lo
    socket.on('send_message', async ({ convId, content }) => {
      const senderId = socket.userId;

      if (!senderId) {
        console.warn('send_message: userId nahi mila socket pe');
        return;
      }
      if (!convId || !content?.trim()) {
        console.warn('send_message: convId ya content missing');
        return;
      }

      try {
        // Verify karo ki ye user is conversation ka part hai
        const [conv] = await pool.query(
          'SELECT * FROM conversations WHERE id = ? AND (user1_id = ? OR user2_id = ?)',
          [convId, senderId, senderId]
        );

        if (conv.length === 0) {
          console.warn(`send_message: User ${senderId} conversation ${convId} ka part nahi`);
          return;
        }

        const [result] = await pool.query(
          'INSERT INTO messages (conversation_id, sender_id, content, status) VALUES (?, ?, ?, "sent")',
          [convId, senderId, content.trim()]
        );

        await pool.query(
          'UPDATE conversations SET last_message_at = NOW() WHERE id = ?',
          [convId]
        );

        const otherUserId =
          conv[0].user1_id === senderId ? conv[0].user2_id : conv[0].user1_id;

        const messagePayload = {
          id: result.insertId,
          conversation_id: parseInt(convId),
          sender_id: senderId,
          content: content.trim(),
          status: 'sent',
          created_at: new Date().toISOString(),
        };

        // ✅ Dusre user ko bhejo
        io.to(`user_${otherUserId}`).emit('new_message', messagePayload);

        // ✅ Sender ko confirmation bhejo (optimistic message replace hoga)
        socket.emit('new_message', messagePayload);

        console.log(`Message sent: conv=${convId} sender=${senderId} -> receiver=${otherUserId}`);
      } catch (err) {
        console.error('send_message error:', err);
      }
    });

    // ✅ Typing — otherUserId frontend se aata hai, wo sahi hai
    socket.on('typing', ({ convId, isTyping, otherUserId }) => {
      if (!otherUserId) return;
      io.to(`user_${otherUserId}`).emit('typing_indicator', {
        userId: socket.userId,
        isTyping,
      });
    });

    socket.on('message_read', async ({ messageId, convId }) => {
      try {
        await pool.query('UPDATE messages SET status = "read" WHERE id = ?', [messageId]);
        const [msgRows] = await pool.query('SELECT * FROM messages WHERE id = ?', [messageId]);
        if (msgRows.length > 0) {
          io.to(`user_${msgRows[0].sender_id}`).emit('message_status', {
            messageId: parseInt(messageId),
            status: 'read',
          });
        }
      } catch (err) {
        console.error('message_read error:', err);
      }
    });

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
          lastSeen: new Date().toISOString(),
        });
      }
    });
  });
}

module.exports = socketHandler;