const logEl = document.getElementById("log");
const chatBox = document.getElementById("chatBox");

const roomIdEl = document.getElementById("roomId");
const nameEl = document.getElementById("name");

const joinBtn = document.getElementById("joinBtn");
const callBtn = document.getElementById("callBtn");
const hangupBtn = document.getElementById("hangupBtn");

const muteBtn = document.getElementById("muteBtn");
const camBtn = document.getElementById("camBtn");

const sendBtn = document.getElementById("sendBtn");
const chatInput = document.getElementById("chatInput");

const localVideo = document.getElementById("localVideo");
const remoteVideo = document.getElementById("remoteVideo");

function log(msg) {
  const t = new Date().toLocaleTimeString();
  logEl.textContent += `[${t}] ${msg}\n`;
  logEl.scrollTop = logEl.scrollHeight;
}
function addChat(msg) {
  const div = document.createElement("div");
  div.textContent = msg;
  chatBox.appendChild(div);
  chatBox.scrollTop = chatBox.scrollHeight;
}

const socket = io("http://192.168.0.21:3000");

let localStream = null;
let pc = null;
let joined = false;
let isMuted = false;
let isCamOff = false;

// 1対1想定：相手のsocket.idを保持（offer受信時などで更新）
let peerId = null;

const rtcConfig = {
  iceServers: [
    // ローカル同士なら不要なことも多いが、あった方が安定
    { urls: "stun:stun.l.google.com:19302" }
  ]
};

async function ensureLocalStream() {
  if (localStream) return localStream;

  // 音声+ビデオ（不要なら video:false に）
  localStream = await navigator.mediaDevices.getUserMedia({
    audio: true,
    video: true
  });
  localVideo.srcObject = localStream;
  return localStream;
}

function createPeerConnection() {
  const _pc = new RTCPeerConnection(rtcConfig);

  _pc.onicecandidate = (ev) => {
    if (ev.candidate) {
      socket.emit("webrtc-ice", {
        roomId: roomIdEl.value,
        candidate: ev.candidate,
        to: peerId // 相手がわかってるなら直接
      });
    }
  };

  _pc.ontrack = (ev) => {
    // 受信したストリームを表示
    remoteVideo.srcObject = ev.streams[0];
  };

  _pc.onconnectionstatechange = () => {
    log(`pc.connectionState = ${_pc.connectionState}`);
  };

  return _pc;
}

async function setupPeer() {
  if (pc) return pc;

  await ensureLocalStream();
  pc = createPeerConnection();

  // ローカルトラックを追加
  for (const track of localStream.getTracks()) {
    pc.addTrack(track, localStream);
  }

  return pc;
}

function setUIJoined(state) {
  joined = state;
  callBtn.disabled = !state;
  sendBtn.disabled = !state;
  muteBtn.disabled = !state;
  camBtn.disabled = !state;
}

function setUIInCall(inCall) {
  hangupBtn.disabled = !inCall;
  callBtn.disabled = !joined || inCall;
}

joinBtn.onclick = async () => {
  const roomId = roomIdEl.value.trim();
  const name = nameEl.value.trim() || "Anonymous";
  if (!roomId) return alert("roomId required");

  // 先にメディア許可（ここで許可しておくと通話開始がスムーズ）
  try {
    await ensureLocalStream();
  } catch (e) {
    console.error(e);
    alert("マイク/カメラ許可が必要です。ブラウザ設定を確認してください。");
    return;
  }

  socket.emit("join", { roomId, name });
  setUIJoined(true);
  log(`Joined room: ${roomId} as ${name}`);
};

callBtn.onclick = async () => {
  try {
    await setupPeer();
    setUIInCall(true);

    // offer作成
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    socket.emit("webrtc-offer", {
      roomId: roomIdEl.value,
      offer
    });

    log("Sent offer");
  } catch (e) {
    console.error(e);
    log("Call failed: " + e.message);
    setUIInCall(false);
  }
};

hangupBtn.onclick = async () => {
  if (pc) {
    pc.close();
    pc = null;
  }
  peerId = null;
  remoteVideo.srcObject = null;
  setUIInCall(false);
  log("Hangup");
};

muteBtn.onclick = () => {
  if (!localStream) return;
  isMuted = !isMuted;
  for (const t of localStream.getAudioTracks()) t.enabled = !isMuted;
  muteBtn.textContent = isMuted ? "Unmute" : "Mute";
  log(isMuted ? "Muted" : "Unmuted");
};

camBtn.onclick = () => {
  if (!localStream) return;
  isCamOff = !isCamOff;
  for (const t of localStream.getVideoTracks()) t.enabled = !isCamOff;
  camBtn.textContent = isCamOff ? "Camera On" : "Camera Off";
  log(isCamOff ? "Camera Off" : "Camera On");
};

sendBtn.onclick = () => {
  const text = chatInput.value.trim();
  if (!text) return;
  socket.emit("chat", {
    roomId: roomIdEl.value,
    name: nameEl.value || "Anonymous",
    text
  });
  chatInput.value = "";
};

chatInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") sendBtn.click();
});

// --- socket events ---

socket.on("system", (payload) => {
  log(`[system] ${payload.message}`);
});

socket.on("chat", (msg) => {
  addChat(`${msg.name}: ${msg.text}`);
});

socket.on("webrtc-offer", async ({ from, offer }) => {
  // 相手を記録（answerやiceを返す先）
  peerId = from;

  await setupPeer();
  setUIInCall(true);

  await pc.setRemoteDescription(offer);
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);

  socket.emit("webrtc-answer", {
    roomId: roomIdEl.value,
    to: from,
    answer
  });

  log("Received offer -> sent answer");
});

socket.on("webrtc-answer", async ({ from, answer }) => {
  peerId = from;
  if (!pc) return;

  await pc.setRemoteDescription(answer);
  log("Received answer");
});

socket.on("webrtc-ice", async ({ from, candidate }) => {
  peerId = peerId || from;
  if (!pc) return;
  try {
    await pc.addIceCandidate(candidate);
  } catch (e) {
    console.warn("addIceCandidate failed", e);
  }
});

log("Ready. Start Node server, then Join.");