const express = require("express");
const router = express.Router();
const auth = require("../controllers/authGaragemweb.controller");

router.post("/bootstrap-master", auth.bootstrapMaster);
router.post("/login", auth.login);
router.get("/me", auth.verifyJwt, auth.me);

router.post("/passkey/register/options", auth.passkeyRegisterOptions);
router.post("/passkey/register/verify", auth.passkeyRegisterVerify);
router.post("/passkey/authenticate/options", auth.passkeyAuthenticateOptions);
router.post("/passkey/authenticate/verify", auth.passkeyAuthenticateVerify);

module.exports = router;
