const newMeetingBtn = document.getElementById('new-meeting-btn');
const joinBtn       = document.getElementById('join-btn');
const nameInput     = document.getElementById('display-name');
const roomInput     = document.getElementById('room-id-input');

function generateRoomId() {
  return Math.random().toString(36).substring(2, 8);
}

function getName() {
  return nameInput.value.trim() || 'Guest';
}

function goToRoom(roomId) {
  window.location.href = `/${roomId}?name=${encodeURIComponent(getName())}`;
}

newMeetingBtn.addEventListener('click', () => goToRoom(generateRoomId()));

joinBtn.addEventListener('click', () => {
  const id = roomInput.value.trim();
  if (!id) { roomInput.focus(); shake(roomInput); return; }
  goToRoom(id);
});

roomInput.addEventListener('keydown', e => { if (e.key === 'Enter') joinBtn.click(); });
nameInput.addEventListener('keydown', e => { if (e.key === 'Enter') newMeetingBtn.click(); });

function shake(el) {
  el.style.animation = 'none';
  el.getBoundingClientRect(); // reflow
  el.style.animation = 'shake 0.3s ease';
}

// Add shake keyframes dynamically
const style = document.createElement('style');
style.textContent = `@keyframes shake {
  0%,100%{transform:translateX(0)}25%{transform:translateX(-6px)}75%{transform:translateX(6px)}
}`;
document.head.appendChild(style);
