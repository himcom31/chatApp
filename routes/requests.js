const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth');
const {
  sendRequest,
  getIncoming,
  acceptRequest,
  rejectRequest,
  getShareLink
} = require('../controllers/requestController');
const { getPreStatus, sendPreMessage } = require('../controllers/preMessageController');

router.get('/pre-status', authMiddleware, getPreStatus);
router.post('/pre-message', authMiddleware, sendPreMessage);
router.post('/send', authMiddleware, sendRequest);
router.get('/incoming', authMiddleware, getIncoming);
router.post('/:id/accept', authMiddleware, acceptRequest);
router.post('/:id/reject', authMiddleware, rejectRequest);
router.get('/share-link/:userId', authMiddleware, getShareLink);

module.exports = router;