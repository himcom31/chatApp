const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth');
const upload = require('../middleware/upload');
const {
  getMyProfile,
  updateProfile,
  searchUsers,
  getUserById
} = require('../controllers/userController');

router.get('/me', authMiddleware, getMyProfile);
router.put('/me', authMiddleware, upload.single('avatar'), updateProfile);
router.get('/search', authMiddleware, searchUsers);
router.get('/:id', authMiddleware, getUserById);

module.exports = router;