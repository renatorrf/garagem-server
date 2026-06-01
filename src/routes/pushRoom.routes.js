"use strict";

const router = require("express-promise-router")();
const pushRoomController = require("../controllers/pushRoom.controller");

router.get("/public-key", pushRoomController.getPublicKey);
router.get("/status", pushRoomController.getStatus);
router.post("/subscribe", pushRoomController.subscribe);
router.delete("/unsubscribe", pushRoomController.unsubscribe);

module.exports = router;
