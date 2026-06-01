"use strict";

const router = require("express-promise-router")();
const auth = require("../controllers/authGaragemweb.controller");
const pushRoomController = require("../controllers/pushRoom.controller");

// Compatibilidade com fluxo antigo da room.
// A chave pública pode ser aberta; subscription/status continuam protegidos.
router.get("/public-key", pushRoomController.getPublicKey);
router.get("/status", auth.verifyJwt, pushRoomController.getStatus);
router.post("/subscribe", auth.verifyJwt, pushRoomController.subscribe);
router.delete("/unsubscribe", auth.verifyJwt, pushRoomController.unsubscribe);

module.exports = router;
