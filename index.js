require('dotenv').config();
const express = require('express');
const http = require('http');
const cors = require('cors');
const { Server } = require('socket.io');
const pool = require('./config/db');
const socketHandler = require('./socket/socketHandler');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.set('io', io); // controllers ke liye io accessible banao

app.use(cors());
app.use(express.json());

app.get('/', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT 1 + 1 AS result');
    res.json({ message: 'ChatNow backend chal raha hai ✅', dbTest: rows[0].result });
  } catch (err) {
    res.status(500).json({ message: 'DB connection fail ho gaya ❌', error: err.message });
  }
});

app.use('/api/auth', require('./routes/auth'));
app.use('/api/users', require('./routes/users'));
app.use('/api/requests', require('./routes/requests'));
app.use('/api/chats', require('./routes/chats'));

socketHandler(io);

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`Server chal raha hai http://localhost:${PORT} pe`);
});