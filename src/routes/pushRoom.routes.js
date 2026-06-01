"use strict";

const router = require("express-promise-router")();
const auth = require("../controllers/authGaragemweb.controller");
const pushRoomController = require("../controllers/pushRoom.controller");

router.get("/public-key", auth.verifyJwt, pushRoomController.getPublicKey);
router.get("/status", auth.verifyJwt, pushRoomController.getStatus);
router.post("/subscribe", auth.verifyJwt, pushRoomController.subscribe);
router.delete("/unsubscribe", auth.verifyJwt, pushRoomController.unsubscribe);

module.exports = router;
