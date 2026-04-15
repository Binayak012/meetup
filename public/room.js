/* ─── Setup ─────────────────────────────────────────── */
const roomId = window.location.pathname.slice(1);
const params = new URLSearchParams(window.location.search);
const myName = params.get('name') || 'Guest';

document.getElementById('room-id-display').textContent = roomId;
document.title = `MeetUp · ${roomId}`;

/* ─── State ─────────────────────────────────────────── */
let myStream = null;
let myPeer   = null;
const peers     = {};   // peerId → MediaConnection
const peerNames = {};   // peerId → name string

/* ─── DOM Refs ──────────────────────────────────────── */
const grid        = document.getElementById('video-grid');
const waitingMsg  = document.getElementById('waiting-msg');
const micBtn      = document.getElementById('mic-btn');
const camBtn      = document.getElementById('cam-btn');
const micLabel    = document.getElementById('mic-label');
const camLabel    = document.getElementById('cam-label');
const leaveBtn    = document.getElementById('leave-btn');
const copyBtn     = document.getElementById('copy-link-btn');
const countEl     = document.getElementById('participant-count');
const pluralEl    = document.getElementById('participant-plural');
const toast       = document.getElementById('toast');

let micOn = true;
let camOn = true;

/* ─── Helpers ───────────────────────────────────────── */
function showToast(msg, duration = 2500) {
  toast.textContent = msg;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), duration);
}

function updateCount() {
  const n = grid.querySelectorAll('.video-tile').length;
  countEl.textContent = n;
  pluralEl.textContent = n === 1 ? '' : 's';
  waitingMsg.style.display = n <= 1 ? 'block' : 'none';
}

function initials(name) {
  return name.split(' ').map(w => w[0]).join('').substring(0, 2).toUpperCase();
}

/* ─── Video Tile Creation ───────────────────────────── */
function createTile(id, name, stream, isLocal) {
  // Remove existing tile for same id if any
  removeTile(id);

  const tile = document.createElement('div');
  tile.className = 'video-tile' + (isLocal ? ' local' : '');
  tile.id = `tile-${id}`;

  const video = document.createElement('video');
  video.autoplay = true;
  video.playsInline = true;
  if (isLocal) video.muted = true;
  video.srcObject = stream;

  // Video-off placeholder
  const placeholder = document.createElement('div');
  placeholder.className = 'video-off-placeholder';
  const avatarCircle = document.createElement('div');
  avatarCircle.className = 'avatar-circle';
  avatarCircle.textContent = initials(name);
  const avatarName = document.createElement('span');
  avatarName.style.cssText = 'font-size:0.85rem;color:#94a3b8;';
  avatarName.textContent = name;
  placeholder.append(avatarCircle, avatarName);

  // Name tag
  const nameTag = document.createElement('div');
  nameTag.className = 'name-tag';
  nameTag.textContent = isLocal ? `${name} (You)` : name;

  // Muted icon
  const mutedIcon = document.createElement('div');
  mutedIcon.className = 'muted-icon';
  mutedIcon.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
    <line x1="1" y1="1" x2="23" y2="23"/><path d="M9 9v3a3 3 0 0 0 5.12 2.12"/>
    <rect x="9" y="2" width="6" height="8" rx="3"/>
    <path d="M5 10a7 7 0 0 0 12.95 2.23"/><line x1="12" y1="19" x2="12" y2="22"/>
    <line x1="8" y1="22" x2="16" y2="22"/>
  </svg>`;

  tile.append(video, placeholder, nameTag, mutedIcon);
  grid.appendChild(tile);
  updateCount();
  return tile;
}

function removeTile(id) {
  const el = document.getElementById(`tile-${id}`);
  if (el) el.remove();
  updateCount();
}

/* ─── Get User Media ────────────────────────────────── */
navigator.mediaDevices.getUserMedia({ video: true, audio: true })
  .then(stream => {
    myStream = stream;
    createTile('local', myName, stream, true);
    startPeer();
  })
  .catch(err => {
    console.error('Camera/mic access denied:', err);
    showToast('Could not access camera/microphone', 4000);
    // Still join with no stream
    myStream = new MediaStream();
    createTile('local', myName, myStream, true);
    startPeer();
  });

/* ─── PeerJS + Socket.io ────────────────────────────── */
function startPeer() {
  const socket = io();

  myPeer = new Peer(undefined, {
    host: window.location.hostname,
    port: window.location.port || (window.location.protocol === 'https:' ? 443 : 3000),
    path: '/peerjs',
    secure: window.location.protocol === 'https:',
  });

  myPeer.on('open', peerId => {
    socket.emit('join-room', roomId, peerId, myName);
  });

  myPeer.on('error', err => {
    console.error('PeerJS error:', err);
    showToast('Connection error: ' + err.type);
  });

  // ── Receive a call from another peer ──
  myPeer.on('call', call => {
    call.answer(myStream);
    const callerId = call.peer;

    call.on('stream', remoteStream => {
      createTile(callerId, peerNames[callerId] || 'Guest', remoteStream, false);
    });

    call.on('close', () => removeTile(callerId));
    call.on('error', err => console.error('Call error:', err));
    peers[callerId] = call;
  });

  // ── Someone new joined ──
  socket.on('user-connected', (userId, userName) => {
    peerNames[userId] = userName;

    // Small delay so their peer server is ready
    setTimeout(() => {
      const call = myPeer.call(userId, myStream);
      if (!call) return;

      call.on('stream', remoteStream => {
        createTile(userId, userName, remoteStream, false);
      });

      call.on('close', () => removeTile(userId));
      call.on('error', err => console.error('Outgoing call error:', err));
      peers[userId] = call;
    }, 500);
  });

  // ── Someone left ──
  socket.on('user-disconnected', userId => {
    if (peers[userId]) {
      peers[userId].close();
      delete peers[userId];
    }
    delete peerNames[userId];
    removeTile(userId);
    showToast(`${peerNames[userId] || 'A participant'} left the meeting`);
  });
}

/* ─── Controls ──────────────────────────────────────── */
micBtn.addEventListener('click', () => {
  micOn = !micOn;
  myStream.getAudioTracks().forEach(t => { t.enabled = micOn; });

  micBtn.classList.toggle('on',  micOn);
  micBtn.classList.toggle('off', !micOn);
  micLabel.textContent = micOn ? 'Mute' : 'Unmute';

  const localTile = document.getElementById('tile-local');
  if (localTile) localTile.classList.toggle('mic-off', !micOn);

  micBtn.innerHTML = micOn
    ? `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <rect x="9" y="2" width="6" height="11" rx="3"/>
        <path d="M5 10a7 7 0 0 0 14 0"/>
        <line x1="12" y1="19" x2="12" y2="22"/>
        <line x1="8" y1="22" x2="16" y2="22"/>
       </svg>`
    : `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <line x1="1" y1="1" x2="23" y2="23"/>
        <path d="M9 9v3a3 3 0 0 0 5.12 2.12"/>
        <rect x="9" y="2" width="6" height="8" rx="3"/>
        <path d="M5 10a7 7 0 0 0 12.95 2.23"/>
        <line x1="12" y1="19" x2="12" y2="22"/>
        <line x1="8" y1="22" x2="16" y2="22"/>
       </svg>`;
});

camBtn.addEventListener('click', () => {
  camOn = !camOn;
  myStream.getVideoTracks().forEach(t => { t.enabled = camOn; });

  camBtn.classList.toggle('on',  camOn);
  camBtn.classList.toggle('off', !camOn);
  camLabel.textContent = camOn ? 'Stop Video' : 'Start Video';

  const localTile = document.getElementById('tile-local');
  if (localTile) localTile.classList.toggle('cam-off', !camOn);

  camBtn.innerHTML = camOn
    ? `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <polygon points="23 7 16 12 23 17 23 7"/>
        <rect x="1" y="5" width="15" height="14" rx="2"/>
       </svg>`
    : `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <line x1="1" y1="1" x2="23" y2="23"/>
        <path d="M19 7l-7 5-7-5"/>
        <rect x="1" y="5" width="15" height="14" rx="2"/>
       </svg>`;
});

leaveBtn.addEventListener('click', () => {
  // Stop all tracks
  if (myStream) myStream.getTracks().forEach(t => t.stop());
  Object.values(peers).forEach(call => call.close());
  if (myPeer) myPeer.destroy();
  window.location.href = '/';
});

/* ─── Copy Link ─────────────────────────────────────── */
copyBtn.addEventListener('click', () => {
  const url = `${window.location.origin}/${roomId}`;
  navigator.clipboard.writeText(url).then(() => {
    copyBtn.classList.add('copied');
    showToast('Invite link copied!');
    setTimeout(() => copyBtn.classList.remove('copied'), 2000);
  });
});
