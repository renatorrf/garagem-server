const Lead = require("../models/leads");
const crypto = require("crypto");
const db = require("../config/database");
const LeadWorkflowService = require("../services/LeadWorkflowService");
const {
  isAllowedLeadRoomUser,
  resolveLeadRoomUser,
} = require("../utils/leadsRoom");
const {
  getSchemaFromReq,
  getTenantIdFromReq,
  resolveSchemaValue,
} = require("../utils/tenantContext");

class LeadController {
  resolvePublicSchema() {
    return resolveSchemaValue(
      process.env.PUBLIC_SHOWCASE_SCHEMA ||
        process.env.PUBLIC_INTEREST_SCHEMA ||
        process.env.SCHEMA_PADRAO ||
        "nextcar",
    );
  }

  parseCurrencyValue(value) {
    if (typeof value === "number") {
      return Number.isFinite(value) ? value : null;
    }

    const raw = String(value || "").trim().toLowerCase();
    if (!raw) return null;

    const hasMil = /\bmil\b/.test(raw);
    const numericText = raw.replace(/[^\d,.-]/g, "");
    if (!numericText) return null;

    const lastComma = numericText.lastIndexOf(",");
    const lastDot = numericText.lastIndexOf(".");
    let normalized = numericText;

    if (lastComma > lastDot) {
      normalized = numericText.replace(/\./g, "").replace(",", ".");
    } else if (lastDot > -1 && /[.,]\d{3}$/.test(numericText)) {
      normalized = numericText.replace(/[.,]/g, "");
    } else {
      normalized = numericText.replace(/,/g, "");
    }

    const parsed = Number(normalized);
    if (!Number.isFinite(parsed)) return null;

    return hasMil && parsed < 1000 ? parsed * 1000 : parsed;
  }

  formatCurrencyBR(value) {
    const parsed = Number(value || 0);
    if (!Number.isFinite(parsed) || parsed <= 0) return null;

    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL",
      maximumFractionDigits: 0,
    }).format(parsed);
  }

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
        dataCampo,
        search,
        vendedorId,
        sortBy = "dataRecebimento",
        order = "DESC",
      } = req.query;

      if (status && !["novo", "lido", "contatado"].includes(status)) {
        return res.status(400).json({
          success: false,
          error: "Status invalido. Use: novo, lido ou contatado",
        });
      }

      const schema = getSchemaFromReq(req);
      const result = await Lead.findAll({
        schema,
        status,
        origem,
        prioridade,
        dataInicio,
        dataFim,
        dataCampo,
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
      const schema = resolveSchemaValue(
        process.env.PUBLIC_INTEREST_SCHEMA ||
          process.env.SCHEMA_PADRAO ||
          "nextcar",
      );
      const tenantId = null;
      const lead = await Lead.findById(id, { schema, tenantId });

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

  async createClientInterestLead(req, res) {
    try {
      const body = req.body || {};
      const nome = String(body.nome || body.name || "")
        .trim()
        .replace(/\s+/g, " ");
      const telefone = String(body.whatsapp || body.telefone || body.phone || "")
        .replace(/\D/g, "");
      const mensagem = String(body.mensagem || body.message || "")
        .trim()
        .slice(0, 1200);
      const pageUrl = String(body.pageUrl || body.url || "")
        .trim()
        .slice(0, 500);
      const tipoInteresseRaw = String(
        body.tipoInteresse || body.tipo_interesse || body.tipo || "interesse",
      )
        .trim()
        .toLowerCase();
      const isCounterOffer = [
        "contra-proposta",
        "contra_proposta",
        "contraproposta",
        "retencao",
      ].includes(tipoInteresseRaw);
      const valorContraProposta = this.parseCurrencyValue(
        body.valorContraProposta ||
          body.valor_contra_proposta ||
          body.valorProposto ||
          body.proposta,
      );

      if (nome.length < 3) {
        return res.status(400).json({
          success: false,
          error: "Nome invalido.",
        });
      }

      if (telefone.length < 10 || telefone.length > 13) {
        return res.status(400).json({
          success: false,
          error: "WhatsApp invalido.",
        });
      }

      if (mensagem.length < 5) {
        return res.status(400).json({
          success: false,
          error: "Mensagem invalida.",
        });
      }

      const schema = getSchemaFromReq(req);
      const tenantId = getTenantIdFromReq(req);
      const publicId = `${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
      const emailId = `not-lead-facebook-${publicId}`;
      const receivedAt = new Date();

      const leadData = {
        emailId,
        remetente: nome,
        emailRemetente: `${emailId}@not-lead-facebook.local`,
        assunto: "Interesse manual Facebook Ads",
        telefone,
        nome,
        veiculoInteresse: "Interesse informado pelo cliente",
        mensagem,
        origem: "not-lead-facebook",
        status: "novo",
        prioridade: "media",
        dataRecebimento: receivedAt,
        metadata: {
          plataforma: "Facebook formulario manual",
          origem: "not-lead-facebook",
          fonte: "interesse-cliente",
          tipoClassificacao: "not-lead-facebook",
          classificadoComo: "not-lead-facebook",
          publicForm: {
            route: "interesse-cliente",
            pageUrl: pageUrl || null,
            submittedAt: receivedAt.toISOString(),
            userAgent: String(req.headers["user-agent"] || "").slice(0, 250),
          },
        },
        tags: ["not-lead-facebook", "facebook", "formulario-publico"],
      };

      const lead = new Lead({
        ...leadData,
        _schema: schema,
        _tenantId: tenantId,
      });
      const savedLead = await lead.save({ schema, tenantId });

      if (!savedLead) {
        throw new Error("Nao foi possivel registrar o interesse.");
      }

      let workflowResult = null;

      try {
        workflowResult = await LeadWorkflowService.onNewLead(savedLead, {
          schema,
          tenantId,
        });
      } catch (workflowError) {
        console.error(
          `Falha ao iniciar workflow do interesse publico ${savedLead.id}:`,
          workflowError.message,
        );
      }

      return res.status(201).json({
        success: true,
        message: "Interesse registrado com sucesso.",
        data: workflowResult || savedLead,
      });
    } catch (error) {
      return res.status(400).json({
        success: false,
        error: error.message,
      });
    }
  }

  async getPublicVehicleShowcase(req, res) {
    try {
      const schema = this.resolvePublicSchema();
      const limit = Math.min(
        Math.max(parseInt(req.query.limit || "60", 10) || 60, 1),
        120,
      );

      const query = `
        WITH imagens AS (
          SELECT
            seq_veiculo,
            ARRAY_REMOVE(ARRAY[
              img_1_url, img_2_url, img_3_url, img_4_url,
              img_5_url, img_6_url, img_7_url, img_8_url,
              img_9_url, img_10_url, img_11_url, img_12_url
            ], NULL) AS imagens
          FROM ${schema}.tab_veiculo_imagem
        )
        SELECT
          v.seq_veiculo,
          v.des_veiculo,
          v.marca,
          v.modelo,
          v.modelo_completo,
          v.ano_fabricacao,
          v.ano_modelo,
          v.km,
          v.val_venda_esperado,
          v.cor,
          v.combustivel,
          v.cambio,
          v.portas,
          COALESCE(v.cliques, 0) AS cliques,
          COALESCE(v.negociacoes_enviadas, 0) AS negociacoes_enviadas,
          v.img_veiculo_capa_url,
          COALESCE(i.imagens, ARRAY[]::text[]) AS imagens
        FROM ${schema}.tab_veiculo v
        LEFT JOIN imagens i ON i.seq_veiculo = v.seq_veiculo
        WHERE v.ind_status = 'A'
          AND COALESCE(v.ind_importado, false) = true
          AND COALESCE(v.ind_excluido_garage, false) = false
        ORDER BY v.seq_veiculo DESC
        LIMIT $1;
      `;

      const result = await db.query(query, [limit]);
      const veiculos = result.rows.map((row) => {
        const imagens = Array.isArray(row.imagens)
          ? row.imagens.filter(Boolean)
          : [];
        const imagemCapa = row.img_veiculo_capa_url || imagens[0] || null;
        const descricao = [
          row.marca,
          row.modelo,
          row.modelo_completo,
        ]
          .filter(Boolean)
          .join(" ")
          .replace(/\s+/g, " ")
          .trim();

        return {
          seqVeiculo: row.seq_veiculo,
          descricao: descricao || row.des_veiculo || "Veiculo Next Car",
          marca: row.marca || null,
          modelo: row.modelo || null,
          versao: row.modelo_completo || null,
          valor: row.val_venda_esperado,
          km: row.km,
          anoFabricacao: row.ano_fabricacao,
          anoModelo: row.ano_modelo,
          cor: row.cor || null,
          combustivel: row.combustivel || null,
          cambio: row.cambio || null,
          portas: row.portas || null,
          cliques: Number(row.cliques || 0),
          negociacoesEnviadas: Number(row.negociacoes_enviadas || 0),
          imagemCapa,
          imagens,
        };
      });

      return res.json({
        success: true,
        data: veiculos,
        count: veiculos.length,
      });
    } catch (error) {
      console.error("Erro ao buscar vitrine publica:", error);
      return res.status(500).json({
        success: false,
        error: "Falha ao carregar vitrine de veiculos.",
        details: error.message,
      });
    }
  }

  async registerVehicleShowcaseClick(req, res) {
    try {
      const schema = this.resolvePublicSchema();
      const seqVeiculo =
        Number(req.params.seqVeiculo || req.body?.seqVeiculo || req.body?.seq_veiculo || 0) ||
        null;

      if (!seqVeiculo) {
        return res.status(400).json({
          success: false,
          error: "Veiculo nao informado.",
        });
      }

      const result = await db.query(
        `
        UPDATE ${schema}.tab_veiculo
           SET cliques = COALESCE(cliques, 0) + 1
         WHERE seq_veiculo = $1
           AND ind_status = 'A'
           AND COALESCE(ind_importado, false) = true
           AND COALESCE(ind_excluido_garage, false) = false
         RETURNING
           COALESCE(cliques, 0) AS cliques,
           COALESCE(negociacoes_enviadas, 0) AS negociacoes_enviadas;
        `,
        [seqVeiculo],
      );

      if (result.rowCount === 0) {
        return res.status(404).json({
          success: false,
          error: "Veiculo nao encontrado na vitrine.",
        });
      }

      const row = result.rows[0];

      return res.json({
        success: true,
        data: {
          seqVeiculo,
          cliques: Number(row.cliques || 0),
          negociacoesEnviadas: Number(row.negociacoes_enviadas || 0),
        },
      });
    } catch (error) {
      console.error("Erro ao registrar clique da vitrine:", error);
      return res.status(500).json({
        success: false,
        error: "Falha ao registrar clique.",
        details: error.message,
      });
    }
  }

  async createAppNextcarLead(req, res) {
    try {
      const body = req.body || {};
      const nome = String(body.nome || body.name || "")
        .trim()
        .replace(/\s+/g, " ");
      const telefone = String(body.whatsapp || body.telefone || body.phone || "")
        .replace(/\D/g, "");
      const seqVeiculo = Number(body.seqVeiculo || body.seq_veiculo || 0) || null;
      const veiculoInteresse = String(
        body.veiculoInteresse || body.descricaoVeiculo || body.vehicle || "",
      )
        .trim()
        .replace(/\s+/g, " ");
      const pageUrl = String(body.pageUrl || body.url || "")
        .trim()
        .slice(0, 500);
      const tipoInteresseRaw = String(
        body.tipoInteresse || body.tipo_interesse || body.tipo || "interesse",
      )
        .trim()
        .toLowerCase();
      const isCounterOffer = [
        "contra-proposta",
        "contra_proposta",
        "contraproposta",
        "retencao",
      ].includes(tipoInteresseRaw);
      const valorContraProposta = this.parseCurrencyValue(
        body.valorContraProposta ||
          body.valor_contra_proposta ||
          body.valorProposto ||
          body.proposta,
      );

      if (nome.length < 3) {
        return res.status(400).json({
          success: false,
          error: "Nome invalido.",
        });
      }

      if (telefone.length < 10 || telefone.length > 13) {
        return res.status(400).json({
          success: false,
          error: "WhatsApp invalido.",
        });
      }

      if (!veiculoInteresse && !seqVeiculo) {
        return res.status(400).json({
          success: false,
          error: "Veiculo de interesse nao informado.",
        });
      }

      if (isCounterOffer && (!valorContraProposta || valorContraProposta <= 0)) {
        return res.status(400).json({
          success: false,
          error: "Valor da contra-proposta nao informado.",
        });
      }

      const schema = this.resolvePublicSchema();
      const tenantId = null;
      let vehicleSnapshot = null;

      if (seqVeiculo) {
        const vehicle = await db.getOne(
          `
          SELECT
            seq_veiculo,
            des_veiculo,
            marca,
            modelo,
            modelo_completo,
            ano_fabricacao,
            ano_modelo,
            km,
            val_venda_esperado,
            cor,
            combustivel,
            cambio,
            img_veiculo_capa_url
          FROM ${schema}.tab_veiculo
          WHERE seq_veiculo = $1
            AND ind_status = 'A'
            AND COALESCE(ind_importado, false) = true
            AND COALESCE(ind_excluido_garage, false) = false
          LIMIT 1
          `,
          [seqVeiculo],
        );

        if (vehicle) {
          const descricao = [
            vehicle.marca,
            vehicle.modelo,
            vehicle.modelo_completo,
          ]
            .filter(Boolean)
            .join(" ")
            .replace(/\s+/g, " ")
            .trim();

          vehicleSnapshot = {
            seqVeiculo: vehicle.seq_veiculo,
            descricao: descricao || vehicle.des_veiculo || veiculoInteresse,
            marca: vehicle.marca || null,
            modelo: vehicle.modelo || null,
            versao: vehicle.modelo_completo || null,
            anoFabricacao: vehicle.ano_fabricacao || null,
            anoModelo: vehicle.ano_modelo || null,
            km: vehicle.km || null,
            valor: vehicle.val_venda_esperado || null,
            cor: vehicle.cor || null,
            combustivel: vehicle.combustivel || null,
            cambio: vehicle.cambio || null,
            imagemCapa: vehicle.img_veiculo_capa_url || null,
          };
        }
      }

      const descricaoFinal =
        vehicleSnapshot?.descricao ||
        veiculoInteresse ||
        "Veiculo Next Car";
      const publicId = `${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
      const emailId = `app-nextcar-${publicId}`;
      const receivedAt = new Date();
      const valorTexto = vehicleSnapshot?.valor
        ? `Valor anunciado: ${vehicleSnapshot.valor}`
        : "Valor anunciado: nao informado";
      const valorContraPropostaTexto = this.formatCurrencyBR(valorContraProposta);
      const kmTexto = vehicleSnapshot?.km
        ? `KM: ${vehicleSnapshot.km}`
        : "KM: nao informado";
      const anoTexto = vehicleSnapshot?.anoModelo || vehicleSnapshot?.anoFabricacao
        ? `Ano: ${vehicleSnapshot?.anoFabricacao || ""}/${vehicleSnapshot?.anoModelo || ""}`
        : "Ano: nao informado";
      const mensagemLead = [
        isCounterOffer
          ? "Cliente saiu do formulario principal e enviou uma contra-proposta pela vitrine publica Next Car."
          : "Cliente demonstrou interesse pela vitrine publica Next Car.",
        `Veiculo: ${descricaoFinal}`,
        valorTexto,
        ...(isCounterOffer
          ? [
              `Contra-proposta: ${valorContraPropostaTexto}`,
              "Contexto: cliente fechou o formulario inicial e informou um valor para negociacao.",
            ]
          : []),
        kmTexto,
        anoTexto,
      ].join("\n");

      const leadData = {
        emailId,
        remetente: nome,
        emailRemetente: `${emailId}@app-nextcar.local`,
        assunto: isCounterOffer
          ? "Contra-proposta na vitrine Next Car"
          : "Interesse na vitrine Next Car",
        telefone,
        nome,
        veiculoInteresse: descricaoFinal,
        mensagem: mensagemLead,
        origem: "app-nextcar",
        status: "novo",
        prioridade: "media",
        dataRecebimento: receivedAt,
        metadata: {
          plataforma: "app-nextcar",
          origem: "app-nextcar",
          fonte: "vitrine-veiculos",
          tipoClassificacao: "lead",
          classificadoComo: "lead",
          appNextcar: {
            route: "vitrine-veiculos",
            tipoInteresse: isCounterOffer ? "contra-proposta" : "interesse",
            pageUrl: pageUrl || null,
            submittedAt: receivedAt.toISOString(),
            userAgent: String(req.headers["user-agent"] || "").slice(0, 250),
            vehicle: vehicleSnapshot || {
              seqVeiculo,
              descricao: descricaoFinal,
            },
            ...(isCounterOffer
              ? {
                  contraProposta: {
                    valorProposto: valorContraProposta,
                    valorPropostoTexto: valorContraPropostaTexto,
                    valorAnunciado: vehicleSnapshot?.valor || null,
                    valorAnunciadoTexto: this.formatCurrencyBR(vehicleSnapshot?.valor),
                    origem: "modal-retencao",
                  },
                }
              : {}),
          },
        },
        tags: isCounterOffer
          ? ["app-nextcar", "vitrine", "garaje", "contra-proposta"]
          : ["app-nextcar", "vitrine", "garaje"],
      };

      const lead = new Lead({
        ...leadData,
        _schema: schema,
        _tenantId: tenantId,
      });
      const savedLead = await lead.save({ schema, tenantId });

      if (!savedLead) {
        throw new Error("Nao foi possivel registrar o interesse.");
      }

      if (seqVeiculo && vehicleSnapshot) {
        try {
          await db.query(
            `
            UPDATE ${schema}.tab_veiculo
               SET negociacoes_enviadas = COALESCE(negociacoes_enviadas, 0) + 1
             WHERE seq_veiculo = $1
               AND ind_status = 'A'
               AND COALESCE(ind_importado, false) = true
               AND COALESCE(ind_excluido_garage, false) = false
            `,
            [seqVeiculo],
          );
        } catch (counterError) {
          console.error(
            `Falha ao atualizar contador de negociacao do veiculo ${seqVeiculo}:`,
            counterError.message,
          );
        }
      }

      let workflowResult = null;

      try {
        workflowResult = await LeadWorkflowService.onNewLead(savedLead, {
          schema,
          tenantId,
        });
      } catch (workflowError) {
        console.error(
          `Falha ao iniciar workflow app-nextcar ${savedLead.id}:`,
          workflowError.message,
        );
      }

      return res.status(201).json({
        success: true,
        message: "Interesse registrado com sucesso.",
        data: workflowResult || savedLead,
      });
    } catch (error) {
      return res.status(400).json({
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

      if (!["novo", "lido", "contatado"].includes(status)) {
        return res.status(400).json({
          success: false,
          error: "Status invalido. Use: novo, lido ou contatado",
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
      if (status === "lido" || status === "contatado") {
        updates.dataContato = new Date();
      }
      if (status === "novo") updates.dataContato = null;

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
      const body = req.body || {};
      const schema = getSchemaFromReq(req);
      const tenantId = getTenantIdFromReq(req);
      const lead = await Lead.findById(id, { schema, tenantId });
      if (!lead) {
        return res.status(404).json({
          success: false,
          error: "Lead nÃƒÂ£o encontrado",
        });
      }

      const requestedSeller = resolveLeadRoomUser(
        body.vendedorId || body.usuario || body.vendedor || body.claimant,
      );
      const sellerMarker =
        requestedSeller ||
        String(body.vendedorId || body.usuario || body.vendedor || "").trim() ||
        "nextcar";

      if (
        (body.vendedorId || body.usuario || body.vendedor || body.claimant) &&
        !isAllowedLeadRoomUser(sellerMarker)
      ) {
        return res.status(400).json({
          success: false,
          error: "Vendedor invalido para a room.",
        });
      }

      const updatedLead = await LeadWorkflowService.claimLead(id, sellerMarker, {
        schema,
        tenantId,
        channel: "room",
      });

      if (!updatedLead) {
        return res.status(409).json({
          success: false,
          error: "Lead ja foi assumido por outro usuario.",
        });
      }

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

      const allowedModes = ["initial"];

      if (!allowedModes.includes(mode)) {
        return res.status(400).json({
          success: false,
          error: "Modo invalido. Use: initial",
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
      return res.status(410).json({
        success: false,
        error: "Atribuicao de vendedor desativada no fluxo atual",
      });

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
