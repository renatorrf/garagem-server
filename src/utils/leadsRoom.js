"use strict";

const ROOM_LEADS = "leads-room";
const ALLOWED_LEADS_ROOM_USERS = [
  "lucas",
  "gustavo",
  "luis",
  "renato",
  "kassio",
  "wando",
];

function normalizeLeadRoomUser(value = "") {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function isAllowedLeadRoomUser(value = "") {
  const normalized = normalizeLeadRoomUser(value);
  return ALLOWED_LEADS_ROOM_USERS.includes(normalized);
}

function resolveLeadRoomUser(value = "") {
  const normalized = normalizeLeadRoomUser(value);
  return isAllowedLeadRoomUser(normalized) ? normalized : null;
}

module.exports = {
  ROOM_LEADS,
  ALLOWED_LEADS_ROOM_USERS,
  normalizeLeadRoomUser,
  isAllowedLeadRoomUser,
  resolveLeadRoomUser,
};
