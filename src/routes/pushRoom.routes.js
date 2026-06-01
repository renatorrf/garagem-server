"use strict";

const router = require("express-promise-router")();
const auth = require("../controllers/authGaragemweb.controller");
const pushRoomController = require("../controllers/pushRoom.controller");

// Compatibilidade da rota antiga de room.
// A chave pública VAPID não é segredo; deixar pública evita 401 antes da inscrição.
router.get("/public-key", pushRoomController.getPublicKey);

router.get("/status", auth.verifyJwt, pushRoomController.getStatus);
router.post("/subscribe", auth.verifyJwt, pushRoomController.subscribe);
router.delete("/unsubscribe", auth.verifyJwt, pushRoomController.unsubscribe);

module.exports = router;
