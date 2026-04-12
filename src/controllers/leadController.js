const Lead = require("../models/leads");
const LeadWorkflowService = require("../services/LeadWorkflowService");
const {
  getSchemaFromReq,
  getTenantIdFromReq,
} = require("../utils/tenantContext");

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
        sortBy = "dataRecebimento",
        order = "DESC",
      } = req.query;

      const schema = getSchemaFromReq(req);
      const result = await Lead.findAll({
        schema,
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
      console.error("Erro ao buscar leads:", error);
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
        sortBy = "dataRecebimento",
        order = "DESC",
      } = req.body;

      const schema = getSchemaFromReq(req);
      const result = await Lead.searchAdvanced({
        schema,
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
      console.error("Erro na busca avanÃƒÂ§ada:", error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  }

  async getLeadById(req, res) {
    try {
      const { id } = req.params;
      const schema = getSchemaFromReq(req);
      const lead = await Lead.findById(id, { schema });

      if (!lead) {
        return res.status(404).json({
          success: false,
          error: "Lead nÃƒÂ£o encontrado",
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
      const schema = getSchemaFromReq(req);
      const tenantId = getTenantIdFromReq(req);
      const lead = new Lead({
        ...leadData,
        _schema: schema,
        _tenantId: tenantId,
      });
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

  async createSimulationLead(req, res) {
    try {
      const {
        nome,
        whatsapp,
        veiculoInteresse,
        valorVeiculo,
        entrada,
        prazoMeses,
        valorFinanciado,
        inadimplencia,
        cenarios,
        origem,
        mensagem,
      } = req.body || {};

      const telefone = String(whatsapp || "").replace(/\D/g, "");

      if (telefone.length < 10) {
        return res.status(400).json({
          success: false,
          error: "WhatsApp invÃ¡lido.",
        });
      }

      const emailId = `sim-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const emailRemetente = `${telefone}@nextcar.local`;

      const leadData = {
        emailId,
        remetente: nome || telefone || "Simulador pÃºblico",
        emailRemetente,
        assunto: "SimulaÃ§Ã£o de compra de veÃ­culo",
        telefone,
        nome: nome || telefone || "Simulador pÃºblico",
        veiculoInteresse: veiculoInteresse || "Compra de veÃ­culo",
        mensagem: mensagem || "",
        origem: origem || "Simulador pÃºblico",
        status: "novo",
        prioridade: "media",
        dataRecebimento: new Date(),
        metadata: {
          tipoClassificacao: "lead",
          origem: "simulador-compra",
          fonte: "simulador-compra",
          simulacao: {
            valorVeiculo: Number(valorVeiculo || 0),
            entrada: Number(entrada || 0),
            prazoMeses: Number(prazoMeses || 0),
            valorFinanciado: Number(valorFinanciado || 0),
            inadimplencia: inadimplencia || null,
            cenarios: Array.isArray(cenarios) ? cenarios : [],
          },
        },
      };

      const schema = getSchemaFromReq(req);
      const tenantId = getTenantIdFromReq(req);
      const lead = new Lead({
        ...leadData,
        _schema: schema,
        _tenantId: tenantId,
      });
      const savedLead = await lead.save();

      if (!savedLead) {
        throw new Error("Nao foi possivel salvar a simulacao.");
      }

      let workflowResult = null;

      try {
        workflowResult = await LeadWorkflowService.onNewLead(savedLead);
      } catch (workflowError) {
        console.error(
          "Falha ao disparar WAPA da simulacao:",
          workflowError.message,
        );
      }

      return res.status(201).json({
        success: true,
        message: "Simulacao registrada com sucesso.",
        data: savedLead,
        workflowResult,
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

      const schema = getSchemaFromReq(req);
      const tenantId = getTenantIdFromReq(req);
      const lead = await Lead.findById(id, { schema, tenantId });
      if (!lead) {
        return res.status(404).json({
          success: false,
          error: "Lead nÃƒÂ£o encontrado",
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
          error: "Status ÃƒÂ© obrigatÃƒÂ³rio",
        });
      }

      const schema = getSchemaFromReq(req);
      const lead = await Lead.findById(id, { schema });
      if (!lead) {
        return res.status(404).json({
          success: false,
          error: "Lead nÃƒÂ£o encontrado",
        });
      }

      const updates = { status };
      if (observacao) updates.observacoes = observacao;
      if (status === "contatado") updates.dataContato = new Date();

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

      const schema = getSchemaFromReq(req);
      const lead = await Lead.findById(id, { schema });
      if (!lead) {
        return res.status(404).json({
          success: false,
          error: "Lead nÃƒÂ£o encontrado",
        });
      }

      const updatedLead = await LeadWorkflowService.startAttendanceManual({
        schema,
        tenantId,
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
      console.error("Erro ao iniciar atendimento:", error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  }

  async retryWhatsApp(req, res) {
    try {
      const { id } = req.params;
      const { mode = "initial" } = req.body || {};

      const allowedModes = ["initial", "reminder", "feedback"];

      if (!allowedModes.includes(mode)) {
        return res.status(400).json({
          success: false,
          error: "Modo invÃƒÂ¡lido. Use: initial, reminder ou feedback",
        });
      }

      const schema = getSchemaFromReq(req);
      const tenantId = getTenantIdFromReq(req);
      const result = await Lead.requeueWhatsApp(id, mode, { schema, tenantId });

      if (mode === "initial") {
        await LeadWorkflowService.onNewLead(result.lead, { schema, tenantId });
      }

      res.json({
        success: true,
        message: `Fluxo WhatsApp rearmado com sucesso (${mode})`,
        data: {
          id,
          mode,
        },
      });
    } catch (error) {
      console.error("Erro ao reprocessar WhatsApp:", error);
      res.status(400).json({
        success: false,
        error: error.message,
      });
    }
  }

  async deleteLead(req, res) {
    try {
      const { id } = req.params;
      const schema = getSchemaFromReq(req);
      const tenantId = getTenantIdFromReq(req);
      const lead = await Lead.delete(id, { schema, tenantId });

      if (!lead) {
        return res.status(404).json({
          success: false,
          error: "Lead nÃƒÂ£o encontrado",
        });
      }

      res.json({
        success: true,
        message: "Lead deletado com sucesso",
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
      const schema = getSchemaFromReq(req);
      const stats = await Lead.getDashboardStats(dataInicio, dataFim, schema, {
        schema,
      });

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
          error: "IDs e vendedorId sÃƒÂ£o obrigatÃƒÂ³rios",
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
        format = "json",
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

      if (format === "csv") {
        const csv = Lead.toCSV(leads);
        res.header("Content-Type", "text/csv");
        res.attachment("leads.csv");
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
