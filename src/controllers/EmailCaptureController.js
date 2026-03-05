/**
 * controllers/EmailCaptureController.js
 * Controlador que usa o EmailCaptureService para servir API REST
 */

const EmailCaptureService = require('../services/EmailCaptureService');

class EmailCaptureController {
  
  /**
   * GET /api/leads/email/status
   * Status do serviço de email
   */
  async getEmailStatus(req, res) {
    try {
      const status = await EmailCaptureService.getStatus();
      res.json({
        success: true,
        data: status
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }

  /**
   * POST /api/leads/email/check-now
   * Forçar verificação de emails agora
   */
  async checkEmailsNow(req, res) {
    try {
      const result = await EmailCaptureService.checkNow();
      res.json({
        success: true,
        data: result
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }

  /**
   * POST /api/leads/email/test-connection
   * Testar conexão com email
   */
  async testEmailConnection(req, res) {
    try {
      const result = await EmailCaptureService.testConnection();
      res.json({
        success: true,
        data: result
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }

  /**
   * POST /api/leads/email/backfill
   * Buscar emails antigos
   */
  async backfillEmails(req, res) {
    try {
      const { days = 7 } = req.body;
      
      // Limitar dias por segurança
      const safeDays = Math.min(parseInt(days), 30);
      
      const result = await EmailCaptureService.fetchHistoricalEmails(safeDays);
      res.json({
        success: true,
        data: result
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }

  /**
   * POST /api/leads/email/start-capture
   * Iniciar captura agendada
   */
  async startCapture(req, res) {
    try {
      EmailCaptureService.startScheduledCapture();
      res.json({
        success: true,
        message: 'Captura agendada iniciada'
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }

  /**
   * POST /api/leads/email/stop-capture
   * Parar captura agendada
   */
  async stopCapture(req, res) {
    try {
      EmailCaptureService.stopScheduledCapture();
      res.json({
        success: true,
        message: 'Captura agendada parada'
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }

  /**
   * GET /api/leads/email/stats
   * Estatísticas de captura
   */
  async getCaptureStats(req, res) {
    try {
      const { dataInicio, dataFim } = req.query;
      const stats = await EmailCaptureService.getDashboardStats(dataInicio, dataFim);
      res.json({
        success: true,
        data: stats
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }

  /**
   * POST /api/leads/email/invalidate-cache
   * Invalidar cache
   */
  async invalidateCache(req, res) {
    try {
      EmailCaptureService.invalidateCache();
      res.json({
        success: true,
        message: 'Cache invalidado com sucesso'
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }

  /**
   * GET /api/leads/email/config
   * Obter configuração atual (sem senha)
   */
  async getConfig(req, res) {
    try {
      res.json({
        success: true,
        data: {
          user: EmailCaptureService.config.user,
          host: EmailCaptureService.config.host,
          port: EmailCaptureService.config.port,
          connected: EmailCaptureService.isConnected
        }
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }

  /**
   * POST /api/leads/email/manual-process
   * Processar email manualmente (para testes)
   */
  async processManualEmail(req, res) {
    try {
      const { subject, from, body, origem } = req.body;
      
      if (!subject || !from || !body) {
        return res.status(400).json({
          success: false,
          error: 'subject, from e body são obrigatórios'
        });
      }

      // Criar objeto simulado de email
      const fakeEmailData = {
        subject,
        from: {
          text: from.name || from.email || 'Remetente',
          value: [{ address: from.email || 'teste@example.com' }]
        },
        text: body.text || body,
        html: body.html || body,
        messageId: `manual-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        date: new Date()
      };

      // Processar como lead
      const lead = await EmailCaptureService.saveLeadFromEmail(fakeEmailData, { uid: 0 });
      
      if (lead) {
        res.json({
          success: true,
          data: lead,
          message: 'Email processado manualmente e salvo como lead'
        });
      } else {
        res.status(400).json({
          success: false,
          error: 'Não foi possível salvar o lead'
        });
      }
      
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }
}

module.exports = new EmailCaptureController();