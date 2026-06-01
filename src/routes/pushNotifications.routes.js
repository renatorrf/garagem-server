const router = require("express-promise-router")();
const auth = require("../controllers/authGaragemweb.controller");
const pushController = require("../controllers/pushNotifications.controller");

// A chave pública VAPID precisa ser lida pelo navegador antes da inscrição.
// Ela não é segredo; quem precisa ficar protegido é status/subscribe/unsubscribe.
router.get("/public-key", pushController.getPublicKey);

router.get("/status", auth.verifyJwt, pushController.getStatus);
router.post("/subscribe", auth.verifyJwt, pushController.subscribe);
router.delete("/subscribe", auth.verifyJwt, pushController.unsubscribe);

module.exports = router;
