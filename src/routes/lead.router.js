const express = require('express');
const router = express.Router();
const EmailCaptureController = require('../controllers/EmailCaptureController');
const leads = require('../controllers/leadController')

const leadHandler = (methodName) => (req, res, next) =>
  leads[methodName](req, res, next);

// Status e controle do serviÃ§o
router.get('/email/status', EmailCaptureController.getEmailStatus);
router.post('/email/check-now', EmailCaptureController.checkEmailsNow);
router.post('/email/test-connection', EmailCaptureController.testEmailConnection);
router.post('/email/start-capture', EmailCaptureController.startCapture);
router.post('/email/stop-capture', EmailCaptureController.stopCapture);
router.get('/email/config', EmailCaptureController.getConfig);

// Backfill e histÃ³rico
router.post('/email/backfill', EmailCaptureController.backfillEmails);

// EstatÃ­sticas
router.get('/email/stats', EmailCaptureController.getCaptureStats);

// Cache
router.post('/email/invalidate-cache', EmailCaptureController.invalidateCache);

// Processamento manual (para testes)
router.post('/email/manual-process', EmailCaptureController.processManualEmail);

router.get('/leads', leadHandler('getLeads'));

router.get('/leads/dashboard', leadHandler('getDashboardStats'));
router.post('/leads/search', leadHandler('searchLeads'));
router.get('/leads/export', leadHandler('exportLeads'));
router.post('/leads/assign', leadHandler('assignToSeller'));

router.get('/vitrine/veiculos', leadHandler('getPublicVehicleShowcase'));
router.post('/leads/app-nextcar', leadHandler('createAppNextcarLead'));
router.post('/leads/interesse-cliente', leadHandler('createClientInterestLead'));
router.post('/leads/simulacao-compra', leadHandler('createSimulationLead'));
router.post('/leads/:id/retry-whatsapp', leadHandler('retryWhatsApp'));
router.post('/leads/:id/start-attendance', leadHandler('startAttendance'));
router.get('/leads/:id', leadHandler('getLeadById'));
router.put('/leads/:id', leadHandler('updateLead'));
router.patch('/leads/:id/status', leadHandler('updateLeadStatus'));
router.delete('/leads/:id', leadHandler('deleteLead'));

module.exports = router;
