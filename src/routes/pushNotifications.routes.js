const router = require("express-promise-router")();
const auth = require("../controllers/authGaragemweb.controller");
const pushController = require("../controllers/pushNotifications.controller");

// A chave VAPID pública não precisa de JWT.
router.get("/public-key", pushController.getPublicKey);

// Rotas que consultam ou gravam inscrição continuam protegidas.
router.get("/status", auth.verifyJwt, pushController.getStatus);
router.post("/subscribe", auth.verifyJwt, pushController.subscribe);
router.delete("/subscribe", auth.verifyJwt, pushController.unsubscribe);

module.exports = router;
