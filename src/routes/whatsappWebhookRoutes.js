// routes/whatsappWebhookRoutes.js
const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/WhatsAppWebhookController');

router.get('/', (req, res) => ctrl.verify(req, res));
router.post('/', (req, res) => ctrl.handle(req, res));

module.exports = router;