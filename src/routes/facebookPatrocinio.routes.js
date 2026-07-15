const express = require("express");
const FacebookPatrocinioController = require("../controllers/FacebookPatrocinioController");

const router = express.Router();

router.get("/status", FacebookPatrocinioController.status);
router.get("/preview", FacebookPatrocinioController.preview);
router.post("/sync", FacebookPatrocinioController.sync);

module.exports = router;
