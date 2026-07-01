const express = require("express");
const FacebookLeadAdsController = require("../controllers/FacebookLeadAdsController");

const router = express.Router();

router.get("/webhook", FacebookLeadAdsController.verifyWebhook);
router.post("/webhook", FacebookLeadAdsController.receiveWebhook);

module.exports = router;
