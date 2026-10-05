const express = require('express');
const router = express.Router();
const authLimiter = require('../middleware/rateLimit');
const {
  signup,
  verifySignup,
  login,
  verifyLogin,
  logout
} = require('../controllers/authController');

router.post('/signup', authLimiter, signup);
router.post('/verify-signup', authLimiter, verifySignup);
router.post('/login', authLimiter, login);
router.post('/verify-login', authLimiter, verifyLogin);
router.post('/logout', logout);

module.exports = router;