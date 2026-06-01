"use strict";

const {
  ROOM_LEADS,
  resolveLeadRoomUser,
  isAllowedLeadRoomUser,
} = require("../utils/leadsRoom");

const usuarioInRoom = [];
const usuarioFinalizacao = [];
const roomMembers = new Map();
let ioInstance = null;

function normalizeRoom(room = ROOM_LEADS) {
  return String(room || ROOM_LEADS).trim().toLowerCase() || ROOM_LEADS;
}

function getRoomUsers(room = ROOM_LEADS) {
  const normalizedRoom = normalizeRoom(room);
  const members = [];
  const seen = new Set();

  for (const member of roomMembers.values()) {
    if (!member || member.room !== normalizedRoom) continue;
    if (seen.has(member.usuario)) continue;

    seen.add(member.usuario);
    members.push({
      usuario: member.usuario,
      room: member.room,
      socketCount: Array.from(roomMembers.values()).filter(
        (item) => item.room === normalizedRoom && item.usuario === member.usuario,
      ).length,
      connectedAt: member.connectedAt,
      lastSeenAt: member.lastSeenAt,
    });
  }

  return members.sort((a, b) => a.usuario.localeCompare(b.usuario));
}

function broadcastRoomUsers(room = ROOM_LEADS) {
  if (!ioInstance) return;

  const normalizedRoom = normalizeRoom(room);
  const users = getRoomUsers(normalizedRoom);

  ioInstance.to(normalizedRoom).emit("leads-room:users", {
    room: normalizedRoom,
    users,
    total: users.length,
    updatedAt: new Date().toISOString(),
  });
}

function emitLeadRoomEvent(event, payload, room = ROOM_LEADS) {
  if (!ioInstance) return false;

  ioInstance.to(normalizeRoom(room)).emit(event, payload);
  return true;
}

function registerLeadRoom(socket, data = {}) {
  const room = normalizeRoom(data.room || ROOM_LEADS);
  const usuario = resolveLeadRoomUser(data.usuario || data.user || data.username);

  if (!usuario || !isAllowedLeadRoomUser(usuario)) {
    socket.emit("leads-room:error", {
      message: "Usuário não autorizado para a room de leads.",
      room,
    });
    return false;
  }

  const now = new Date().toISOString();
  const existing = roomMembers.get(socket.id);

  if (existing && existing.room && existing.room !== room) {
    socket.leave(existing.room);
  }

  roomMembers.set(socket.id, {
    socketId: socket.id,
    room,
    usuario,
    connectedAt: existing?.connectedAt || now,
    lastSeenAt: now,
  });

  socket.data = socket.data || {};
  socket.data.leadsRoom = { room, usuario };
  socket.join(room);

  broadcastRoomUsers(room);

  socket.emit("leads-room:joined", {
    room,
    usuario,
    users: getRoomUsers(room),
    total: getRoomUsers(room).length,
    joinedAt: now,
  });

  socket.to(room).emit("leads-room:notification", {
    type: "presence",
    action: "join",
    room,
    usuario,
    message: `${usuario} entrou na room.`,
    timestamp: now,
  });

  console.log(`🟢 Room leads join: ${usuario} (${socket.id})`);
  return true;
}

function leaveLeadRoom(socket, data = {}) {
  const room = normalizeRoom(data.room || socket?.data?.leadsRoom?.room || ROOM_LEADS);
  const usuario = socket?.data?.leadsRoom?.usuario || null;

  socket.leave(room);

  if (roomMembers.has(socket.id)) {
    roomMembers.delete(socket.id);
    broadcastRoomUsers(room);
  }

  if (usuario) {
    socket.to(room).emit("leads-room:notification", {
      type: "presence",
      action: "leave",
      room,
      usuario,
      message: `${usuario} saiu da room.`,
      timestamp: new Date().toISOString(),
    });
  }
}

function cleanupSocket(socket) {
  const member = roomMembers.get(socket.id);
  if (!member) return;

  roomMembers.delete(socket.id);
  broadcastRoomUsers(member.room);

  if (member.usuario) {
    socket.to(member.room).emit("leads-room:notification", {
      type: "presence",
      action: "disconnect",
      room: member.room,
      usuario: member.usuario,
      message: `${member.usuario} desconectou.`,
      timestamp: new Date().toISOString(),
    });
  }
}

function registerWebsocket(io) {
  ioInstance = io;

  io.on("connection", (socket) => {
    console.log("Dispositivo registrado no servidor, ID: " + socket.id);

    socket.on("user-connected", (user) => {
      console.log("Dispositivo Efetuou login: " + user);
    });

    socket.on("logadoNoSistema", (data) => {
      const userInRoom = usuarioInRoom.find((row) => row.usuario == data.usuario);

      if (data.usuario === undefined) {
        return;
      }

      if (userInRoom) {
        userInRoom.socket_id = socket.id;
        userInRoom.room = data.room;
      } else {
        usuarioInRoom.push({
          room: data.room,
          usuario: data.usuario,
          socket_id: socket.id,
        });
      }

      socket.join(data.room);
      console.log(usuarioInRoom);
    });

    socket.on("exitSistema", (data) => {
      console.log("leave", data);
      socket.leave(data.room);
    });

    socket.on("atualizacaoTarefa", (data) => {
      console.log(data);
      io.to(data.room).emit("refresh", data);
    });

    socket.on("exitTelaTarefa", (data) => {
      console.log("leave", data);
      socket.leave(data.room);
    });

    socket.on("socketFinalizaHorarioArena", (data) => {
      console.log(data);

      const userInRoom = usuarioFinalizacao.find(
        (row) => row.usuario == data.usuario,
      );

      if (userInRoom) {
        userInRoom.socket_id = socket.id;
        userInRoom.room = data.room;
      } else {
        usuarioFinalizacao.push({
          room: data.room,
          usuario: data.usuario,
          socket_id: socket.id,
        });
      }

      socket.join(data.room);
      console.log(usuarioFinalizacao);
    });

    socket.on("atualizacaoFinalizacao", (data) => {
      console.log(data);
      io.to(data.room).emit("refreshHorario", data.room);
    });

    socket.on("exitFechamento", (data) => {
      console.log("leave", data);
      socket.leave(data.room);
    });

    socket.on("leads-room:join", (data = {}) => {
      registerLeadRoom(socket, data);
    });

    socket.on("leads-room:leave", (data = {}) => {
      leaveLeadRoom(socket, data);
    });

    socket.on("disconnect", () => {
      console.log("Dispositivo Desconectado, ID:" + socket.id);
      cleanupSocket(socket);
    });
  });
}

module.exports = {
  ROOM_LEADS,
  registerWebsocket,
  emitLeadRoomEvent,
  getRoomUsers,
  broadcastRoomUsers,
  normalizeRoom,
  resolveLeadRoomUser,
  isAllowedLeadRoomUser,
};
