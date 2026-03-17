const Lead = require('../models/leads');
const LeadWorkflowService = require('../services/LeadWorkflowService');

class LeadController {
  async getLeads(req, res) {
    try {
      const {
        page = 1,
        limit = 20,
        status,
        origem,
        prioridade,
        dataInicio,
        dataFim,
        search,
        vendedorId,
        sortBy = 'dataRecebimento',
        order = 'DESC',
      } = req.query;

      const result = await Lead.findAll({
        status,
        origem,
        prioridade,
        dataInicio,
        dataFim,
        search,
        vendedorId,
        page: parseInt(page, 10),
        limit: parseInt(limit, 10),
        sortBy,
        order,
      });

      res.json({
        success: true,
        data: result.leads,
        pagination: result.pagination,
      });
    } catch (error) {
      console.error('Erro ao buscar leads:', error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  }

  async searchLeads(req, res) {
    try {
      const {
        filters = {},
        page = 1,
        limit = 50,
        sortBy = 'dataRecebimento',
        order = 'DESC',
      } = req.body;

      const result = await Lead.searchAdvanced({
        filters,
        page: parseInt(page, 10),
        limit: parseInt(limit, 10),
        sortBy,
        order,
      });

      res.json({
        success: true,
        data: result.leads,
        pagination: result.pagination,
      });
    } catch (error) {
      console.error('Erro na busca avançada:', error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  }

  async getLeadById(req, res) {
    try {
      const { id } = req.params;
      const lead = await Lead.findById(id);

      if (!lead) {
        return res.status(404).json({
          success: false,
          error: 'Lead não encontrado',
        });
      }

      res.json({
        success: true,
        data: lead,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  }

  async createLead(req, res) {
    try {
      const leadData = req.body;
      const lead = new Lead(leadData);
      const savedLead = await lead.save();

      res.status(201).json({
        success: true,
        data: savedLead,
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        error: error.message,
      });
    }
  }

  async updateLead(req, res) {
    try {
      const { id } = req.params;
      const updates = req.body;

      const lead = await Lead.findById(id);
      if (!lead) {
        return res.status(404).json({
          success: false,
          error: 'Lead não encontrado',
        });
      }

      const updatedLead = await lead.update(updates);

      res.json({
        success: true,
        data: updatedLead,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  }

  async updateLeadStatus(req, res) {
    try {
      const { id } = req.params;
      const { status, observacao } = req.body;

      if (!status) {
        return res.status(400).json({
          success: false,
          error: 'Status é obrigatório',
        });
      }

      const lead = await Lead.findById(id);
      if (!lead) {
        return res.status(404).json({
          success: false,
          error: 'Lead não encontrado',
        });
      }

      const updates = { status };
      if (observacao) updates.observacoes = observacao;
      if (status === 'contatado') updates.dataContato = new Date();

      const updatedLead = await lead.update(updates);

      res.json({
        success: true,
        data: updatedLead,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  }

  async startAttendance(req, res) {
    try {
      const { id } = req.params;
      const { sellerId, sellerName, sellerWhatsapp } = req.body;

      const lead = await Lead.findById(id);
      if (!lead) {
        return res.status(404).json({
          success: false,
          error: 'Lead não encontrado',
        });
      }

      const updatedLead = await LeadWorkflowService.startAttendanceManual({
        leadId: id,
        sellerId: sellerId || null,
        sellerName: sellerName || null,
        sellerWhatsapp: sellerWhatsapp || null,
      });

      res.json({
        success: true,
        data: updatedLead,
      });
    } catch (error) {
      console.error('Erro ao iniciar atendimento:', error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  }

  async deleteLead(req, res) {
    try {
      const { id } = req.params;
      const lead = await Lead.delete(id);

      if (!lead) {
        return res.status(404).json({
          success: false,
          error: 'Lead não encontrado',
        });
      }

      res.json({
        success: true,
        message: 'Lead deletado com sucesso',
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  }

  async getDashboardStats(req, res) {
    try {
      const { dataInicio, dataFim } = req.query;
      const stats = await Lead.getDashboardStats(dataInicio, dataFim);

      res.json({
        success: true,
        data: stats,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  }

  async assignToSeller(req, res) {
    try {
      const { ids, vendedorId } = req.body;

      if (!Array.isArray(ids) || ids.length === 0 || !vendedorId) {
        return res.status(400).json({
          success: false,
          error: 'IDs e vendedorId são obrigatórios',
        });
      }

      const result = await Lead.assignToSeller(ids, vendedorId);

      res.json({
        success: true,
        data: result,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  }

  async exportLeads(req, res) {
    try {
      const {
        format = 'json',
        dataInicio,
        dataFim,
        status,
        origem,
      } = req.query;

      const leads = await Lead.export({
        dataInicio,
        dataFim,
        status,
        origem,
      });

      if (format === 'csv') {
        const csv = Lead.toCSV(leads);
        res.header('Content-Type', 'text/csv');
        res.attachment('leads.csv');
        return res.send(csv);
      }

      res.json({
        success: true,
        data: leads,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  }
}

module.exports = new LeadController();