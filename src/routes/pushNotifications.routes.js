const router = require("express-promise-router")();
const auth = require("../controllers/authGaragemweb.controller");
const pushController = require("../controllers/pushNotifications.controller");

router.get("/public-key", auth.verifyJwt, pushController.getPublicKey);
router.get("/status", auth.verifyJwt, pushController.getStatus);
router.post("/subscribe", auth.verifyJwt, pushController.subscribe);
router.delete("/subscribe", auth.verifyJwt, pushController.unsubscribe);

module.exports = router;
