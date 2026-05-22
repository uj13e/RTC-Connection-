const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: true, // ローカル開発用（本番は絞る）
    methods: ["GET", "POST"]
  }
});

io.on("connection", (socket) => {
  socket.on("join", ({ roomId, name }) => {
    socket.data.roomId = roomId;
    socket.data.name = name || "Anonymous";
    socket.join(roomId);

    // 入室通知
    socket.to(roomId).emit("system", {
      type: "join",
      message: `${socket.data.name} joined`,
      id: socket.id
    });
  });

  // チャット中継
  socket.on("chat", ({ roomId, name, text }) => {
    io.to(roomId).emit("chat", {
      name: name || "Anonymous",
      text: String(text || "")
    });
  });

  // WebRTC: offer/answer/ice を中継
  socket.on("webrtc-offer", ({ roomId, offer }) => {
    socket.to(roomId).emit("webrtc-offer", { from: socket.id, offer });
  });

  socket.on("webrtc-answer", ({ roomId, answer, to }) => {
    // 返答は特定相手へ（1対1想定）
    io.to(to).emit("webrtc-answer", { from: socket.id, answer });
  });

  socket.on("webrtc-ice", ({ roomId, candidate, to }) => {
    if (to) {
      io.to(to).emit("webrtc-ice", { from: socket.id, candidate });
    } else {
      socket.to(roomId).emit("webrtc-ice", { from: socket.id, candidate });
    }
  });

  socket.on("disconnect", () => {
    const roomId = socket.data.roomId;
    if (roomId) {
      socket.to(roomId).emit("system", {
        type: "leave",
        message: `${socket.data.name || "Anonymous"} left`,
        id: socket.id
      });
    }
  });
});

server.listen(3000, () => {
  console.log("Signaling server running on http://localhost:3000");
});