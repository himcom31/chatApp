const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');

const authLimiter = require('../middleware/rateLimit');
const auth = require('../middleware/auth');
const {
  signup,
  checkUsername,
  verifySignup,
  uploadPhotos,
  login,
  verifyLogin,
  logout,
} = require('../controllers/authController');

// uploads folder auto ban jayega
const UPLOAD_DIR = path.join(__dirname, '..', 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (req, file, cb) =>
      cb(null, crypto.randomBytes(12).toString('hex') + (path.extname(file.originalname) || '.jpg')),
  }),
  limits: { fileSize: 5 * 1024 * 1024, files: 6 },
  fileFilter: (req, file, cb) => cb(null, file.mimetype.startsWith('image/')),
});

// Username check ke liye alag, thoda loose limiter (typing pe baar baar call hota hai)
const usernameLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 40,
  message: { message: 'Too many requests, thoda ruko' },
});

router.post('/signup', authLimiter, signup);
router.get('/check-username', usernameLimiter, checkUsername);
router.post('/verify-signup', authLimiter, verifySignup);
router.post('/login', authLimiter, login);
router.post('/verify-login', authLimiter, verifyLogin);
router.post('/logout', logout);

router.post(
  '/upload-photos',
  auth,
  (req, res, next) =>
    upload.array('photos', 6)(req, res, (err) => {
      if (err) return res.status(400).json({ message: err.message });
      next();
    }),
  uploadPhotos
);

module.exports = router;