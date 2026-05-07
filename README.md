# MeetUp — Video Conferencing App

A browser-based video conferencing app built with WebRTC, PeerJS, and Socket.IO. Users can create or join rooms instantly with no sign-up required.

## Features

- **Video & Audio** — real-time peer-to-peer streams via WebRTC
- **Screen Sharing** — share your screen with all participants
- **In-call Chat** — live text messaging with unread badge
- **Dynamic Layout** — video grid adjusts as participants join or leave
- **Join/Leave Chimes** — subtle audio feedback when participants enter or exit
- **Copy Invite Link** — one-click link sharing

## Tech Stack

| Layer | Technology |
|---|---|
| Server | Node.js + Express |
| Real-time signaling | Socket.IO |
| P2P media | WebRTC via PeerJS |
| Frontend | Vanilla HTML/CSS/JS |

## Getting Started

**Prerequisites:** Node.js 16+

```bash
# Install dependencies
npm install

# Start the server
npm start
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

## How It Works

1. Enter your name on the home page
2. Click **New Meeting** to create a room, or paste a room ID and click **Join**
3. Share the room URL with others to invite them
4. Use the bottom controls to toggle mic, camera, screen share, and chat

## Project Structure

```
zoom-clone/
├── server.js          # Express + Socket.IO + PeerJS signaling server
└── public/
    ├── index.html     # Home page (create/join room)
    ├── home.js        # Home page logic
    ├── room.html      # In-call UI
    ├── room.js        # WebRTC, PeerJS, chat, and controls logic
    └── style.css      # All styles
```

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | Port the server listens on |
