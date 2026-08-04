"use strict";

const express = require("express");
const controller = require("../controllers/vehicleCreditSimulation.controller");

const router = express.Router();

router.get("/bancos", controller.listBanks);
router.post("/simular", controller.simulate);

module.exports = router;
