/* ─── Room Identity ─────────────────────────────────── */
const roomId = window.location.pathname.slice(1);
const params = new URLSearchParams(window.location.search);
const myName = params.get('name') || 'Guest';

document.getElementById('room-id-display').textContent = roomId;
document.title = `MeetUp · ${roomId}`;

/* ─── State ─────────────────────────────────────────── */
let myStream        = null;
let myPeer          = null;
let socket          = null;
let isScreenSharing = false;
let screenStream    = null;
let micOn           = true;
let camOn           = true;
let chatOpen        = false;
let unreadCount     = 0;

const peers     = {};  // peerId → MediaConnection
const peerNames = {};  // peerId → display name

/* ─── DOM ───────────────────────────────────────────── */
const grid          = document.getElementById('video-grid');
const waitingMsg    = document.getElementById('waiting-msg');
const micBtn        = document.getElementById('mic-btn');
const camBtn        = document.getElementById('cam-btn');
const screenBtn     = document.getElementById('screen-btn');
const chatBtn       = document.getElementById('chat-btn');
const leaveBtn      = document.getElementById('leave-btn');
const micLabel      = document.getElementById('mic-label');
const camLabel      = document.getElementById('cam-label');
const screenLabel   = document.getElementById('screen-label');
const copyBtn       = document.getElementById('copy-link-btn');
const countEl       = document.getElementById('participant-count');
const pluralEl      = document.getElementById('participant-plural');
const toastEl       = document.getElementById('toast');
const chatPanel     = document.getElementById('chat-panel');
const chatCloseBtn  = document.getElementById('chat-close-btn');
const chatMessages  = document.getElementById('chat-messages');
const chatEmpty     = document.getElementById('chat-empty');
const chatInput     = document.getElementById('chat-input');
const chatSendBtn   = document.getElementById('chat-send-btn');
const chatBadge     = document.getElementById('chat-badge');

/* ─── Utilities ─────────────────────────────────────── */
let toastTimer;
function showToast(msg, duration = 2800) {
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), duration);
}

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function initials(name) {
  return name.split(' ').map(w => w[0] || '').join('').substring(0, 2).toUpperCase() || '?';
}

function updateCount() {
  const n = grid.querySelectorAll('.video-tile').length;
  countEl.textContent = n;
  pluralEl.textContent = n === 1 ? '' : 's';
  waitingMsg.style.display = n <= 1 ? 'block' : 'none';
  updateGridLayout(n);
}

function updateGridLayout(n) {
  if (n <= 1)      grid.style.gridTemplateColumns = '1fr';
  else if (n <= 2) grid.style.gridTemplateColumns = 'repeat(2, 1fr)';
  else if (n <= 4) grid.style.gridTemplateColumns = 'repeat(2, 1fr)';
  else             grid.style.gridTemplateColumns = 'repeat(3, 1fr)';
}

/* Brief audio chime via Web Audio API */
function playChime(type) {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = 'sine';
    osc.frequency.value = type === 'join' ? 880 : 660;
    gain.gain.setValueAtTime(0.25, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.4);
  } catch (_) { /* AudioContext blocked — silently ignore */ }
}

/* ─── Video Tiles ───────────────────────────────────── */
function createTile(id, name, stream, isLocal) {
  removeTile(id);

  const tile = document.createElement('div');
  tile.className = 'video-tile' + (isLocal ? ' local' : '');
  tile.id = `tile-${id}`;

  const video = document.createElement('video');
  video.autoplay = true;
  video.playsInline = true;
  if (isLocal) video.muted = true;
  video.srcObject = stream;

  // Camera-off placeholder
  const placeholder = document.createElement('div');
  placeholder.className = 'video-off-placeholder';
  const avatar = document.createElement('div');
  avatar.className = 'avatar-circle';
  avatar.textContent = initials(name);
  const avatarNameEl = document.createElement('span');
  avatarNameEl.className = 'avatar-name';
  avatarNameEl.textContent = name;
  placeholder.append(avatar, avatarNameEl);

  // Name tag
  const nameTag = document.createElement('div');
  nameTag.className = 'name-tag';
  nameTag.textContent = isLocal ? `${name} (You)` : name;

  // Muted indicator
  const mutedIcon = document.createElement('div');
  mutedIcon.className = 'muted-icon';
  mutedIcon.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
    <line x1="1" y1="1" x2="23" y2="23"/>
    <path d="M9 9v3a3 3 0 0 0 5.12 2.12"/>
    <rect x="9" y="2" width="6" height="8" rx="3"/>
    <path d="M5 10a7 7 0 0 0 12.95 2.23"/>
    <line x1="12" y1="19" x2="12" y2="22"/>
    <line x1="8" y1="22" x2="16" y2="22"/>
  </svg>`;

  tile.append(video, placeholder, nameTag, mutedIcon);
  grid.appendChild(tile);
  updateCount();
}

function removeTile(id) {
  const el = document.getElementById(`tile-${id}`);
  if (el) {
    el.style.animation = 'none';
    el.style.opacity = '0';
    el.style.transform = 'scale(0.95)';
    el.style.transition = 'opacity 0.2s, transform 0.2s';
    setTimeout(() => { el.remove(); updateCount(); }, 200);
  }
}

/* ─── Media Access ──────────────────────────────────── */
navigator.mediaDevices.getUserMedia({ video: true, audio: true })
  .then(stream => {
    myStream = stream;
    createTile('local', myName, stream, true);
    startConnection();
  })
  .catch(() => {
    showToast('Camera/mic unavailable — joining without media', 4000);
    myStream = new MediaStream();
    createTile('local', myName, myStream, true);
    startConnection();
  });

/* ─── PeerJS + Socket.io Connection ─────────────────── */
function startConnection() {
  socket = io();

  myPeer = new Peer(undefined, {
    host: window.location.hostname,
    port: window.location.port || (window.location.protocol === 'https:' ? 443 : 3000),
    path: '/peerjs',
    secure: window.location.protocol === 'https:',
  });

  myPeer.on('error', err => {
    console.error('PeerJS:', err);
    showToast(`Connection error: ${err.type}`);
  });

  myPeer.on('open', peerId => {
    socket.emit('join-room', roomId, peerId, myName);

    // ── Answer incoming calls ──
    myPeer.on('call', call => {
      call.answer(myStream);
      call.on('stream', remote => {
        createTile(call.peer, peerNames[call.peer] || 'Guest', remote, false);
      });
      call.on('close', () => removeTile(call.peer));
      peers[call.peer] = call;
    });

    // ── A new participant joined ──
    socket.on('user-connected', (userId, userName) => {
      peerNames[userId] = userName;
      playChime('join');
      showToast(`${userName} joined`);

      setTimeout(() => {
        const call = myPeer.call(userId, myStream);
        if (!call) return;
        call.on('stream', remote => createTile(userId, userName, remote, false));
        call.on('close', () => removeTile(userId));
        peers[userId] = call;
      }, 500);
    });

    // ── A participant left ──
    socket.on('user-disconnected', userId => {
      const name = peerNames[userId] || 'A participant';
      if (peers[userId]) { peers[userId].close(); delete peers[userId]; }
      delete peerNames[userId];
      removeTile(userId);
      playChime('leave');
      showToast(`${name} left`);
    });

    // ── Incoming chat message ──
    socket.on('receive-message', (text, senderName, timestamp) => {
      appendMessage(text, senderName, timestamp, senderName === myName);
      if (!chatOpen) {
        unreadCount++;
        chatBadge.textContent = unreadCount > 9 ? '9+' : unreadCount;
        chatBadge.classList.add('visible');
      }
    });
  });
}

/* ─── Controls ──────────────────────────────────────── */

/* Mic */
micBtn.addEventListener('click', () => {
  micOn = !micOn;
  myStream.getAudioTracks().forEach(t => { t.enabled = micOn; });
  micBtn.className = `ctrl-btn ${micOn ? 'on' : 'off'}`;
  micLabel.textContent = micOn ? 'Mute' : 'Unmute';
  document.getElementById('tile-local')?.classList.toggle('mic-off', !micOn);

  micBtn.innerHTML = micOn
    ? `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <rect x="9" y="2" width="6" height="11" rx="3"/>
        <path d="M5 10a7 7 0 0 0 14 0"/>
        <line x1="12" y1="19" x2="12" y2="22"/>
        <line x1="8" y1="22" x2="16" y2="22"/>
       </svg>`
    : `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <line x1="1" y1="1" x2="23" y2="23"/>
        <path d="M9 9v3a3 3 0 0 0 5.12 2.12"/>
        <rect x="9" y="2" width="6" height="8" rx="3"/>
        <path d="M5 10a7 7 0 0 0 12.95 2.23"/>
        <line x1="12" y1="19" x2="12" y2="22"/>
        <line x1="8" y1="22" x2="16" y2="22"/>
       </svg>`;
});

/* Camera */
camBtn.addEventListener('click', () => {
  camOn = !camOn;
  myStream.getVideoTracks().forEach(t => { t.enabled = camOn; });
  camBtn.className = `ctrl-btn ${camOn ? 'on' : 'off'}`;
  camLabel.textContent = camOn ? 'Stop Video' : 'Start Video';
  document.getElementById('tile-local')?.classList.toggle('cam-off', !camOn);

  camBtn.innerHTML = camOn
    ? `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <polygon points="23 7 16 12 23 17 23 7"/>
        <rect x="1" y="5" width="15" height="14" rx="2"/>
       </svg>`
    : `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <line x1="1" y1="1" x2="23" y2="23"/>
        <path d="M17 17H3a2 2 0 0 1-2-2V7m4-2h11a2 2 0 0 1 2 2v4"/>
        <polygon points="23 7 16 12 23 17 23 7"/>
       </svg>`;
});

/* Screen Share */
screenBtn.addEventListener('click', () => {
  isScreenSharing ? stopScreenShare() : startScreenShare();
});

async function startScreenShare() {
  try {
    screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
    const screenTrack = screenStream.getVideoTracks()[0];

    // Replace video track for every connected peer
    Object.values(peers).forEach(call => {
      const sender = call.peerConnection?.getSenders().find(s => s.track?.kind === 'video');
      if (sender) sender.replaceTrack(screenTrack);
    });

    // Update local preview
    const localVideo = document.querySelector('#tile-local video');
    if (localVideo) {
      const display = new MediaStream([screenTrack]);
      myStream.getAudioTracks().forEach(t => display.addTrack(t));
      localVideo.srcObject = display;
    }

    // Show screen-share banner on local tile
    const localTile = document.getElementById('tile-local');
    if (localTile) {
      localTile.classList.add('screen-sharing');
      const banner = document.createElement('div');
      banner.className = 'screen-share-banner';
      banner.id = 'screen-banner';
      banner.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><rect x="2" y="3" width="20" height="14" rx="2"/></svg> Sharing screen`;
      localTile.appendChild(banner);
    }

    screenTrack.addEventListener('ended', stopScreenShare);
    isScreenSharing = true;
    screenBtn.classList.replace('on', 'active');
    screenLabel.textContent = 'Stop Share';
    showToast('Screen sharing started');
  } catch (err) {
    if (err.name !== 'NotAllowedError') showToast('Could not share screen');
  }
}

function stopScreenShare() {
  if (screenStream) { screenStream.getTracks().forEach(t => t.stop()); screenStream = null; }

  // Restore camera track
  const cameraTrack = myStream.getVideoTracks()[0];
  Object.values(peers).forEach(call => {
    const sender = call.peerConnection?.getSenders().find(s => s.track?.kind === 'video');
    if (sender && cameraTrack) sender.replaceTrack(cameraTrack);
  });

  // Restore local preview
  const localVideo = document.querySelector('#tile-local video');
  if (localVideo) localVideo.srcObject = myStream;

  const localTile = document.getElementById('tile-local');
  if (localTile) {
    localTile.classList.remove('screen-sharing');
    document.getElementById('screen-banner')?.remove();
  }

  isScreenSharing = false;
  screenBtn.classList.replace('active', 'on');
  screenLabel.textContent = 'Share';
  showToast('Screen sharing stopped');
}

/* Chat toggle */
function openChat() {
  chatOpen = true;
  chatPanel.classList.add('open');
  chatBtn.classList.replace('on', 'active');
  unreadCount = 0;
  chatBadge.classList.remove('visible');
  chatInput.focus();
}

function closeChat() {
  chatOpen = false;
  chatPanel.classList.remove('open');
  chatBtn.classList.replace('active', 'on');
}

chatBtn.addEventListener('click',      () => chatOpen ? closeChat() : openChat());
chatCloseBtn.addEventListener('click', closeChat);

/* Chat send */
function sendMessage() {
  const text = chatInput.value.trim();
  if (!text || !socket) return;
  socket.emit('send-message', roomId, text, myName);
  chatInput.value = '';
  chatInput.style.height = 'auto';
}

chatSendBtn.addEventListener('click', sendMessage);
chatInput.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
});

// Auto-grow textarea
chatInput.addEventListener('input', () => {
  chatInput.style.height = 'auto';
  chatInput.style.height = Math.min(chatInput.scrollHeight, 100) + 'px';
});

function appendMessage(text, senderName, timestamp, isOwn) {
  chatEmpty.style.display = 'none';

  const msg = document.createElement('div');
  msg.className = 'chat-msg' + (isOwn ? ' own' : '');

  const time = new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  msg.innerHTML = `
    <div class="msg-header">
      <span class="msg-name">${escapeHtml(senderName)}</span>
      <span class="msg-time">${time}</span>
    </div>
    <div class="msg-body">${escapeHtml(text)}</div>
  `;

  chatMessages.appendChild(msg);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

/* Copy link */
copyBtn.addEventListener('click', () => {
  navigator.clipboard.writeText(`${window.location.origin}/${roomId}`).then(() => {
    copyBtn.classList.add('copied');
    showToast('Invite link copied!');
    setTimeout(() => copyBtn.classList.remove('copied'), 2000);
  });
});

/* Leave */
leaveBtn.addEventListener('click', () => {
  myStream?.getTracks().forEach(t => t.stop());
  screenStream?.getTracks().forEach(t => t.stop());
  Object.values(peers).forEach(c => c.close());
  myPeer?.destroy();
  window.location.href = '/';
});
