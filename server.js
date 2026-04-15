const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { ExpressPeerServer } = require('peer');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// PeerJS signaling server mounted at /peerjs
const peerServer = ExpressPeerServer(server, { debug: true });
app.use('/peerjs', peerServer);

// Serve static files from /public
app.use(express.static(path.join(__dirname, 'public')));

// Track users per room: { roomId: { userId: userName } }
const rooms = {};

io.on('connection', socket => {
  socket.on('join-room', (roomId, userId, userName) => {
    if (!rooms[roomId]) rooms[roomId] = {};
    rooms[roomId][userId] = userName;

    socket.join(roomId);

    // Tell everyone else in the room a new user joined
    socket.to(roomId).emit('user-connected', userId, userName);

    socket.on('disconnect', () => {
      if (rooms[roomId]) {
        delete rooms[roomId][userId];
        if (Object.keys(rooms[roomId]).length === 0) {
          delete rooms[roomId];
        }
      }
      socket.to(roomId).emit('user-disconnected', userId);
    });
  });
});

// Serve room.html for any /:room path (must come after static middleware)
app.get('/:room', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'room.html'));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
