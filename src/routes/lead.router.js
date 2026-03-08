const express = require('express');
const router = express.Router();
const EmailCaptureController = require('../controllers/EmailCaptureController');
const leads = require('../controllers/leadController')

// Status e controle do serviço
router.get('/email/status', EmailCaptureController.getEmailStatus);
router.post('/email/check-now', EmailCaptureController.checkEmailsNow);
router.post('/email/test-connection', EmailCaptureController.testEmailConnection);
router.post('/email/start-capture', EmailCaptureController.startCapture);
router.post('/email/stop-capture', EmailCaptureController.stopCapture);
router.get('/email/config', EmailCaptureController.getConfig);

// Backfill e histórico
router.post('/email/backfill', EmailCaptureController.backfillEmails);

// Estatísticas
router.get('/email/stats', EmailCaptureController.getCaptureStats);

// Cache
router.post('/email/invalidate-cache', EmailCaptureController.invalidateCache);

// Processamento manual (para testes)
router.post('/email/manual-process', EmailCaptureController.processManualEmail);

router.get('/leads', leads.getLeads);

router.get('/leads/dashboard', leads.getDashboardStats);

module.exports = router;