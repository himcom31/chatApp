const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth');
const { discoverUsers } = require('../controllers/discoverController');

router.get('/', authMiddleware, discoverUsers);

module.exports = router;