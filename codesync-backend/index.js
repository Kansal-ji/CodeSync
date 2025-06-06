// index.js
const express = require('express');
const axios = require('axios');
const cors = require('cors');
require('dotenv').config();
const http = require('http');
const { Server } = require('socket.io');
const pty = require('node-pty');
const os = require('os');
const mongoose = require('mongoose');
const Session = require('express-session');


const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' },
});

const PORT = 3000;

app.use(cors());
app.use(express.json());

// MongoDB connection
mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
}).then(() => {
  console.log('✅ MongoDB connected');
}).catch((err) => {
  console.error('❌ MongoDB connection error:', err);
});

// Judge0 API
const JUDGE0_API = 'https://judge0-ce.p.rapidapi.com/submissions';
const headers = {
  'Content-Type': 'application/json',
  'X-RapidAPI-Host': 'judge0-ce.p.rapidapi.com',
  'X-RapidAPI-Key': process.env.JUDGE0_API_KEY,
};

app.post('/run', async (req, res) => {
  const { source_code, language_id, stdin } = req.body;
  try {
    const submission = await axios.post(
      JUDGE0_API + '?base64_encoded=false&wait=true',
      { source_code, language_id, stdin: stdin || '' },
      { headers }
    );
    res.json(submission.data);
  } catch (err) {
    console.error(err.response?.data || err.message);
    res.status(500).json({ error: err.message });
  }
});

// Save session
app.post('/save', async (req, res) => {
  const { roomId, language, code, files } = req.body;
  try {
    const session = new Session({ roomId, language, code, files });
    await session.save();
    res.json({ message: '✅ Session saved successfully' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: '❌ Failed to save session' });
  }
});

// Load session
app.get('/session/:roomId', async (req, res) => {
  try {
    const session = await Session.findOne({ roomId: req.params.roomId });
    if (!session) return res.status(404).json({ error: 'Session not found' });
    res.json(session);
  } catch (err) {
    res.status(500).json({ error: '❌ Failed to load session' });
  }
});

// Socket.IO
io.on('connection', (socket) => {
  console.log('✅ User connected:', socket.id);

  const shell = os.platform() === 'win32' ? 'powershell.exe' : 'bash';
  const ptyProcess = pty.spawn(shell, [], {
    name: 'xterm-color',
    cols: 80,
    rows: 24,
    cwd: process.env.HOME,
    env: process.env,
  });

  ptyProcess.on('data', (data) => {
    socket.emit('terminal-data', data);
  });

  socket.on('terminal-data', ({ data }) => {
    ptyProcess.write(data);
  });

  socket.on('resize-terminal', ({ cols, rows }) => {
    ptyProcess.resize(cols, rows);
  });

  socket.on('join', (roomId) => {
    socket.join(roomId);
    console.log(`➡️  ${socket.id} joined room: ${roomId}`);
    socket.to(roomId).emit('user-joined', socket.id);
  });

  socket.on('code-change', ({ roomId, code }) => {
    socket.to(roomId).emit('code-update', code);
  });

  socket.on('signal', ({ to, from, signal }) => {
    io.to(to).emit('signal', { from, signal });
  });

  socket.on('chat-message', (msg) => {
    socket.broadcast.emit('chat-message', msg);
  });

  socket.on('disconnect', () => {
    console.log('❌ User disconnected:', socket.id);
    ptyProcess.kill();
  });
});

server.listen(PORT, () => console.log(`🚀 Server running at http://localhost:${PORT}`));
