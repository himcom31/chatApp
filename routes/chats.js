const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth');
const {
  getChats,
  getMessages,
  sendMessage,
  markAsRead
} = require('../controllers/chatController');

router.get('/', authMiddleware, getChats);
router.get('/:convId/messages', authMiddleware, getMessages);
router.post('/:convId/messages', authMiddleware, sendMessage);
router.put('/messages/:id/read', authMiddleware, markAsRead);

module.exports = router;