// models/Lead.js
const db = require("../config/database");

class Lead {
  /**
   * Construtor do lead
   */
  constructor(data = {}) {
    this.id = data.id;
    this.emailId = data.email_id || data.emailId;
    this.remetente = data.remetente;
    this.emailRemetente = data.email_remetente || data.emailRemetente;
    this.assunto = data.assunto;
    this.telefone = data.telefone;
    this.nome = data.nome;
    this.veiculoInteresse = data.veiculo_interesse || data.veiculoInteresse;
    this.mensagem = data.mensagem;
    this.origem = data.origem || "Email";
    this.status = data.status || "novo";
    this.prioridade = data.prioridade || "media";
    this.dataRecebimento =
      data.data_recebimento || data.dataRecebimento || new Date();
    this.dataContato = data.data_contato || data.dataContato;
    this.observacoes = data.observacoes;
    this.vendedorId = data.vendedor_id || data.vendedorId;
    this.metadata = data.metadata || {};
    if (typeof this.metadata === "string") {
      try {
        this.metadata = JSON.parse(this.metadata);
      } catch {
        this.metadata = {};
      }
    }
    this.score = data.score || this.calculateScore();
    this.tags = data.tags || this.extractTags();
    this.createdAt = data.created_at || data.createdAt || new Date();
    this.updatedAt = data.updated_at || data.updatedAt || new Date();
  }

  /**
   * Calcular score do lead
   */
  calculateScore() {
    let score = 0;

    // Telefone presente: +20 pontos
    if (this.telefone && this.telefone.length >= 10) score += 20;

    // Nome presente: +10 pontos
    if (this.nome && this.nome.length > 3) score += 10;

    // Veículo especificado: +15 pontos
    if (this.veiculoInteresse) score += 15;

    // Palavras-chave de urgência
    const urgentKeywords = ["urgente", "hoje", "imediato", "rápido", "agora"];
    const text = (this.assunto + " " + this.mensagem).toLowerCase();
    if (urgentKeywords.some((keyword) => text.includes(keyword))) score += 25;

    // Mensagem longa (mais detalhes): +10 pontos
    if (this.mensagem && this.mensagem.length > 100) score += 10;

    return Math.min(score, 100);
  }

  /**
   * Extrair tags automaticamente
   */
  extractTags() {
    const tags = [];
    const text = (
      (this.assunto || "") +
      " " +
      (this.mensagem || "")
    ).toLowerCase();

    // Tags por origem
    if (this.origem) tags.push(this.origem.toLowerCase());

    // Tags por tipo de interesse
    const interests = {
      financiamento: ["financiamento", "parcelamento", "entrada"],
      troca: ["troca", "permuta", "meu carro"],
      consórcio: ["consórcio", "carta"],
      "teste-drive": ["test drive", "experimentar", "dirigir"],
    };

    Object.entries(interests).forEach(([tag, keywords]) => {
      if (keywords.some((keyword) => text.includes(keyword))) {
        tags.push(tag);
      }
    });

    // Tags de veículo
    const vehicleTypes = {
      suv: ["suv", "4x4", "off-road"],
      hatch: ["hatch", "hatchback"],
      sedan: ["sedan"],
      pickup: ["pickup", "caminhonete"],
      luxo: ["bmw", "mercedes", "audi", "land rover"],
    };

    Object.entries(vehicleTypes).forEach(([tag, keywords]) => {
      if (keywords.some((keyword) => text.includes(keyword))) {
        tags.push(tag);
      }
    });

    return [...new Set(tags)]; // Remover duplicatas
  }

  /**
   * Validar lead
   */
  validate() {
    const errors = [];

    if (!this.emailId) errors.push("emailId é obrigatório");
    if (!this.remetente) errors.push("remetente é obrigatório");
    if (!this.emailRemetente) errors.push("emailRemetente é obrigatório");

    if (this.emailRemetente && !this.isValidEmail(this.emailRemetente)) {
      errors.push("emailRemetente inválido");
    }

    if (
      this.status &&
      !["novo", "contatado", "agendado", "vendido", "perdido"].includes(
        this.status,
      )
    ) {
      errors.push("status inválido");
    }

    if (
      this.prioridade &&
      !["alta", "media", "baixa"].includes(this.prioridade)
    ) {
      errors.push("prioridade inválida");
    }

    return errors;
  }

  isValidEmail(email) {
    const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return re.test(email);
  }

  /**
   * Salvar lead no banco
   */
  // models/Lead.js - Atualize o método save()

  async save() {
    console.log("\n💾 INICIANDO SAVE DO LEAD");
    console.log(
      "Dados recebidos:",
      JSON.stringify(
        {
          emailId: this.emailId,
          remetente: this.remetente,
          emailRemetente: this.emailRemetente,
          assunto: this.assunto,
          telefone: this.telefone,
          nome: this.nome,
          veiculoInteresse: this.veiculoInteresse,
          mensagem: this.mensagem?.substring(0, 100),
          origem: this.origem,
          status: this.status,
          prioridade: this.prioridade,
        },
        null,
        2,
      ),
    );
    const errors = this.validate();
    if (errors.length > 0) {
      throw new Error(`Validation failed: ${errors.join(", ")}`);
    }

    // Atualizar timestamp
    this.updatedAt = new Date();
    if (!this.createdAt) {
      this.createdAt = new Date();
    }

    // Garantir valores padrão para campos obrigatórios
    const insertData = {
      emailId: this.emailId,
      remetente: this.remetente || "Não informado",
      emailRemetente: this.emailRemetente,
      assunto: this.assunto || "Sem assunto",
      telefone: this.telefone || null,
      nome: this.nome || this.remetente || "Não informado",
      veiculoInteresse: this.veiculoInteresse || "Veículo não especificado",
      mensagem: this.mensagem || "",
      origem: this.origem || "Email",
      status: this.status || "novo",
      prioridade: this.prioridade || "media",
      dataRecebimento: this.dataRecebimento || new Date(),
      dataContato: this.dataContato || null,
      observacoes: this.observacoes || null,
      vendedorId: this.vendedorId || null,
      metadata: this.metadata || {},
      score: this.score || 0,
      tags: this.tags || [],
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
    };

    const query = `
    INSERT INTO teste.leads (
      email_id, remetente, email_remetente, assunto, telefone, 
      nome, veiculo_interesse, mensagem, origem, status, 
      prioridade, data_recebimento, data_contato, observacoes, 
      vendedor_id, metadata, score, tags, created_at, updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
    ON CONFLICT (email_id) DO NOTHING
    RETURNING *
  `;

    const params = [
      insertData.emailId,
      insertData.remetente,
      insertData.emailRemetente,
      insertData.assunto,
      insertData.telefone,
      insertData.nome,
      insertData.veiculoInteresse,
      insertData.mensagem,
      insertData.origem,
      insertData.status,
      insertData.prioridade,
      insertData.dataRecebimento,
      insertData.dataContato,
      insertData.observacoes,
      insertData.vendedorId,
      JSON.stringify(insertData.metadata),
      insertData.score,
      insertData.tags,
      insertData.createdAt,
      insertData.updatedAt,
    ];

    console.log("💾 Tentando salvar lead com parâmetros:");
    console.log(`   Email ID: ${insertData.emailId}`);
    console.log(`   Nome: ${insertData.nome}`);
    console.log(`   Email: ${insertData.emailRemetente}`);
    console.log(`   Telefone: ${insertData.telefone}`);
    console.log(`   Veículo: ${insertData.veiculoInteresse}`);
    console.log(`   Origem: ${insertData.origem}`);

    try {
      const result = await db.query(query, params);

      if (result.rows.length === 0) {
        console.log("⚠️  Lead não inserido (provavelmente já existe)");
        return null;
      }

      console.log(`✅ Lead inserido com ID: ${result.rows[0].id}`);
      return new Lead(result.rows[0]);
    } catch (error) {
      console.error("❌ ERRO no INSERT:");
      console.error("   Query:", query);
      console.error(
        "   Parâmetros:",
        params.map((p, i) => `${i + 1}: ${p}`).join(", "),
      );
      console.error("   Erro PostgreSQL:", error.message);
      console.error("   Código:", error.code);
      console.error("   Detalhe:", error.detail);

      if (error.code === "23505") {
        // Unique violation
        throw new Error("Lead com este emailId já existe");
      }
      throw error;
    }
  }

  /**
   * Atualizar lead
   */
  async update(updates = {}) {
    Object.assign(this, updates);
    this.updatedAt = new Date();

    if (
      updates.assunto ||
      updates.mensagem ||
      updates.status ||
      updates.prioridade
    ) {
      this.score = this.calculateScore();
      this.tags = this.extractTags();
    }

    const fields = [];
    const values = [];
    let paramCount = 1;

    const fieldMap = {
      emailId: "email_id",
      remetente: "remetente",
      emailRemetente: "email_remetente",
      assunto: "assunto",
      telefone: "telefone",
      nome: "nome",
      veiculoInteresse: "veiculo_interesse",
      mensagem: "mensagem",
      origem: "origem",
      status: "status",
      prioridade: "prioridade",
      dataRecebimento: "data_recebimento",
      dataContato: "data_contato",
      observacoes: "observacoes",
      vendedorId: "vendedor_id",
      score: "score",
      tags: "tags",
    };

    // campos simples
    for (const key of Object.keys(updates)) {
      if (!fieldMap[key]) continue;

      fields.push(`${fieldMap[key]} = $${paramCount}`);
      values.push(updates[key]);
      paramCount++;
    }

    // metadata (merge específico do wa quando vier metadata.wa)
    if (updates.metadata) {
      const hasWaPatch =
        updates.metadata &&
        typeof updates.metadata === "object" &&
        updates.metadata.wa &&
        typeof updates.metadata.wa === "object";

      if (hasWaPatch) {
        fields.push(`
        metadata = jsonb_set(
          COALESCE(metadata,'{}'::jsonb),
          '{wa}',
          COALESCE(metadata->'wa','{}'::jsonb) || $${paramCount}::jsonb,
          true
        )
      `);
        values.push(JSON.stringify(updates.metadata.wa));
        paramCount++;
      } else {
        fields.push(`metadata = $${paramCount}::jsonb`);
        values.push(JSON.stringify(updates.metadata));
        paramCount++;
      }
    }

    // updated_at sempre
    fields.push(`updated_at = $${paramCount}`);
    values.push(this.updatedAt);
    paramCount++;

    // WHERE
    values.push(this.id);

    const query = `
    UPDATE teste.leads
    SET ${fields.join(", ")}
    WHERE id = $${paramCount}
    RETURNING *;
  `;

    const result = await db.query(query, values);
    return result.rows[0] ? new Lead(result.rows[0]) : null;
  }
  /**
   * Métodos estáticos
   */

  /**
   * Buscar lead por ID
   */
  static async findById(id) {
    const query =
      "SELECT * FROM teste.leads WHERE id = $1 AND deleted_at IS NULL";
    const result = await db.getOne(query, [id]);
    return result ? new Lead(result) : null;
  }

  /**
   * Buscar lead por emailId
   */
  static async findByEmailId(emailId) {
    const query =
      "SELECT * FROM teste.leads WHERE id = $1 AND deleted_at IS NULL";
    const result = await db.getOne(query, [emailId]);
    return result ? new Lead(result) : null;
  }

  /**
   * Buscar todos os leads com filtros
   */
  static async findAll({
    status,
    origem,
    prioridade,
    dataInicio,
    dataFim,
    search,
    vendedorId,
    page = 1,
    limit = 50,
  } = {}) {
    let whereConditions = [];
    let params = [];
    let paramCount = 1;

    // Build WHERE clause
    if (status) {
      whereConditions.push(`status = $${paramCount}`);
      params.push(status);
      paramCount++;
    }

    if (origem) {
      whereConditions.push(`origem = $${paramCount}`);
      params.push(origem);
      paramCount++;
    }

    if (prioridade) {
      whereConditions.push(`prioridade = $${paramCount}`);
      params.push(prioridade);
      paramCount++;
    }

    if (vendedorId) {
      whereConditions.push(`vendedor_id = $${paramCount}`);
      params.push(vendedorId);
      paramCount++;
    }

    if (dataInicio) {
      whereConditions.push(`data_recebimento >= $${paramCount}`);
      params.push(dataInicio);
      paramCount++;
    }

    if (dataFim) {
      whereConditions.push(`data_recebimento <= $${paramCount}`);
      params.push(dataFim);
      paramCount++;
    }

    // Busca textual
    if (search) {
      whereConditions.push(`
        (to_tsvector('portuguese', 
          COALESCE(assunto, '') || ' ' || 
          COALESCE(mensagem, '') || ' ' || 
          COALESCE(veiculo_interesse, '')
        ) @@ to_tsquery('portuguese', $${paramCount})
        OR email_remetente ILIKE $${paramCount + 1}
        OR telefone ILIKE $${paramCount + 1}
        OR nome ILIKE $${paramCount + 1})
      `);
      const searchTerm = search.split(" ").join(" & ");
      params.push(searchTerm, `%${search}%`);
      paramCount += 2;
    }

    const whereClause =
      whereConditions.length > 0
        ? `WHERE ${whereConditions.join(" AND ")}`
        : "";

    // Calcular offset
    const offset = (page - 1) * limit;
    params.push(limit, offset);

    // Query para dados
    const query = `
      SELECT *, COUNT(*) OVER() as total_count
      FROM teste.leads 
      ${whereClause}
      ORDER BY 
        CASE WHEN status = 'novo' THEN 1 ELSE 2 END,
        CASE prioridade 
          WHEN 'alta' THEN 1 
          WHEN 'media' THEN 2 
          WHEN 'baixa' THEN 3 
        END,
        data_recebimento DESC
      LIMIT $${paramCount} 
      OFFSET $${paramCount + 1}
    `;

    const result = await db.query(query, params);

    const leads = result.rows.map((row) => new Lead(row));
    const totalCount =
      result.rows.length > 0 ? parseInt(result.rows[0].total_count) : 0;

    return {
      leads,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: totalCount,
        pages: Math.ceil(totalCount / limit),
      },
    };
  }

  /**
   * Contar leads por status
   */
  static async countByStatus() {
    const query = `
      SELECT status, COUNT(*) as count
      FROM teste.leads
      GROUP BY status
      ORDER BY count DESC
    `;

    const result = await db.query(query);
    return result.rows;
  }

  /**
   * Contar leads por origem
   */
  static async countByOrigem() {
    const query = `
      SELECT origem, COUNT(*) as count
      FROM teste.leads
      GROUP BY origem
      ORDER BY count DESC
    `;

    const result = await db.query(query);
    return result.rows;
  }

  /**
   * Deletar lead (soft delete)
   */
  static async delete(id) {
    const query = `
      UPDATE teste.leads 
      SET deleted_at = NOW(), updated_at = NOW()
      WHERE id = $1
      RETURNING *
    `;

    const result = await db.query(query, [id]);
    return result.rows[0] ? new Lead(result.rows[0]) : null;
  }

  /**
   * Dashboard statistics
   */
  static async getDashboardStats(dataInicio, dataFim) {
    const whereConditions = [];
    const params = [];
    let paramCount = 1;

    if (dataInicio) {
      whereConditions.push(`data_recebimento >= $${paramCount}`);
      params.push(dataInicio);
      paramCount++;
    }

    if (dataFim) {
      whereConditions.push(`data_recebimento <= $${paramCount}`);
      params.push(dataFim);
      paramCount++;
    }

    const whereClause =
      whereConditions.length > 0
        ? `WHERE ${whereConditions.join(" AND ")}`
        : "";

    const query = `
      WITH stats AS (
        SELECT 
          COUNT(*) as total_leads,
          COUNT(CASE WHEN status = 'novo' THEN 1 END) as novos_leads,
          COUNT(CASE WHEN status = 'vendido' THEN 1 END) as vendidos,
          COUNT(CASE WHEN data_recebimento >= CURRENT_DATE THEN 1 END) as leads_hoje,
          COUNT(CASE WHEN prioridade = 'alta' THEN 1 END) as alta_prioridade,
          COUNT(CASE WHEN status = 'contatado' THEN 1 END) as contatados
        FROM teste.leads
        ${whereClause}
      )
      SELECT * FROM stats
    `;

    const result = await db.getOne(query, params);

    // Timeline (últimos 30 dias)
    const timelineQuery = `
      SELECT 
        DATE(data_recebimento) as date,
        COUNT(*) as total,
        COUNT(CASE WHEN status = 'vendido' THEN 1 END) as vendidos
      FROM teste.leads
      WHERE data_recebimento >= CURRENT_DATE - INTERVAL '30 days'
      GROUP BY DATE(data_recebimento)
      ORDER BY date ASC
    `;

    const timeline = await db.query(timelineQuery);

    return {
      ...result,
      taxaConversao:
        result.total_leads > 0
          ? ((result.vendidos / result.total_leads) * 100).toFixed(2)
          : 0,
      timeline: timeline.rows,
    };
  }

  static async searchAdvanced({
    filters = {},
    page = 1,
    limit = 50,
    sortBy = "dataRecebimento",
    order = "DESC",
  }) {
    const db = require("../config/database");

    let whereConditions = [];
    let params = [];
    let paramCount = 1;

    // Filtros dinâmicos
    if (filters.status) {
      whereConditions.push(`status = $${paramCount}`);
      params.push(filters.status);
      paramCount++;
    }

    if (filters.origem) {
      whereConditions.push(`origem = $${paramCount}`);
      params.push(filters.origem);
      paramCount++;
    }

    if (filters.vendedorId) {
      whereConditions.push(`vendedor_id = $${paramCount}`);
      params.push(filters.vendedorId);
      paramCount++;
    }

    if (filters.dataInicio) {
      whereConditions.push(`data_recebimento >= $${paramCount}`);
      params.push(filters.dataInicio);
      paramCount++;
    }

    if (filters.dataFim) {
      whereConditions.push(`data_recebimento <= $${paramCount}`);
      params.push(filters.dataFim);
      paramCount++;
    }

    // Busca textual
    if (filters.search) {
      whereConditions.push(`
        (to_tsvector('portuguese', 
          COALESCE(assunto, '') || ' ' || 
          COALESCE(mensagem, '') || ' ' || 
          COALESCE(veiculo_interesse, '')
        ) @@ to_tsquery('portuguese', $${paramCount})
        OR email_remetente ILIKE $${paramCount + 1}
        OR telefone ILIKE $${paramCount + 1}
        OR nome ILIKE $${paramCount + 1})
      `);
      const searchTerm = filters.search.split(" ").join(" & ");
      params.push(searchTerm, `%${filters.search}%`);
      paramCount += 2;
    }

    // Filtro por tags
    if (filters.tags && Array.isArray(filters.tags)) {
      const tagConditions = filters.tags.map((tag, index) => {
        params.push(tag);
        return `$${paramCount + index} = ANY(tags)`;
      });
      whereConditions.push(`(${tagConditions.join(" OR ")})`);
      paramCount += filters.tags.length;
    }

    const whereClause =
      whereConditions.length > 0
        ? `WHERE ${whereConditions.join(" AND ")}`
        : "";

    // Ordenação
    const orderBy = this.getOrderBy(sortBy, order);

    // Paginação
    const offset = (page - 1) * limit;
    params.push(limit, offset);

    const query = `
      SELECT *, COUNT(*) OVER() as total_count
      FROM teste.leads 
      ${whereClause}
      ${orderBy}
      LIMIT $${paramCount} 
      OFFSET $${paramCount + 1}
    `;

    const result = await db.query(query, params);

    const leads = result.rows.map((row) => new Lead(row));
    const totalCount =
      result.rows.length > 0 ? parseInt(result.rows[0].total_count) : 0;

    return {
      leads,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: totalCount,
        pages: Math.ceil(totalCount / limit),
      },
    };
  }

  static getOrderBy(sortBy, order) {
    const fieldMap = {
      dataRecebimento: "data_recebimento",
      score: "score",
      prioridade: "prioridade",
      status: "status",
      nome: "nome",
    };

    const field = fieldMap[sortBy] || "data_recebimento";
    const dir = order.toUpperCase() === "ASC" ? "ASC" : "DESC";

    // Ordenação especial para prioridade
    if (sortBy === "prioridade") {
      return `
        ORDER BY 
          CASE prioridade 
            WHEN 'alta' THEN 1 
            WHEN 'media' THEN 2 
            WHEN 'baixa' THEN 3 
          END ${dir},
          data_recebimento DESC
      `;
    }

    // Ordenação especial para status (novos primeiro)
    if (sortBy === "status") {
      return `
        ORDER BY 
          CASE status 
            WHEN 'novo' THEN 1 
            WHEN 'contatado' THEN 2 
            WHEN 'agendado' THEN 3 
            WHEN 'vendido' THEN 4 
            WHEN 'perdido' THEN 5 
          END ${dir},
          data_recebimento DESC
      `;
    }

    return `ORDER BY ${field} ${dir}`;
  }

  /**
   * Atribuir múltiplos leads a um vendedor
   */
  static async assignToSeller(ids, vendedorId) {
    const db = require("../config/database");

    const query = `
      UPDATE teste.leads 
      SET vendedor_id = $1, 
          status = 'contatado', 
          data_contato = NOW(),
          updated_at = NOW()
      WHERE id = ANY($2::uuid[])
      RETURNING *
    `;

    const result = await db.query(query, [vendedorId, ids]);

    return {
      updated: result.rowCount,
      leads: result.rows.map((row) => new Lead(row)),
    };
  }

  /**
   * Exportar leads
   */
  static async export({ dataInicio, dataFim, status, origem } = {}) {
    const db = require("../config/database");

    let whereConditions = [];
    let params = [];
    let paramCount = 1;

    if (status) {
      whereConditions.push(`status = $${paramCount}`);
      params.push(status);
      paramCount++;
    }

    if (origem) {
      whereConditions.push(`origem = $${paramCount}`);
      params.push(origem);
      paramCount++;
    }

    if (dataInicio) {
      whereConditions.push(`data_recebimento >= $${paramCount}`);
      params.push(dataInicio);
      paramCount++;
    }

    if (dataFim) {
      whereConditions.push(`data_recebimento <= $${paramCount}`);
      params.push(dataFim);
      paramCount++;
    }

    const whereClause =
      whereConditions.length > 0
        ? `WHERE ${whereConditions.join(" AND ")}`
        : "";

    const query = `SELECT * FROM teste.leads ${whereClause} ORDER BY data_recebimento DESC`;
    const result = await db.query(query, params);

    return result.rows.map((row) => new Lead(row));
  }

  /**
   * Converter leads para CSV
   */
  static toCSV(leads) {
    const headers = [
      "ID",
      "Nome",
      "Email",
      "Telefone",
      "Veículo de Interesse",
      "Origem",
      "Status",
      "Prioridade",
      "Score",
      "Data Recebimento",
      "Data Contato",
      "Vendedor ID",
      "Tags",
    ];

    const rows = leads.map((lead) => [
      lead.id,
      lead.nome || "",
      lead.emailRemetente,
      lead.telefone || "",
      lead.veiculoInteresse || "",
      lead.origem,
      lead.status,
      lead.prioridade,
      lead.score,
      new Date(lead.dataRecebimento).toLocaleString("pt-BR"),
      lead.dataContato
        ? new Date(lead.dataContato).toLocaleString("pt-BR")
        : "",
      lead.vendedorId || "",
      lead.tags?.join(", ") || "",
    ]);

    return [headers, ...rows]
      .map((row) =>
        row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","),
      )
      .join("\n");
  }

  /**
   * Obter leads por período
   */
  static async getByPeriod(startDate, endDate) {
    const db = require("../config/database");

    const query = `
      SELECT * FROM teste.leads 
      WHERE data_recebimento BETWEEN $1 AND $2
      ORDER BY data_recebimento DESC
    `;

    const result = await db.query(query, [startDate, endDate]);
    return result.rows.map((row) => new Lead(row));
  }

  /**
   * Obter leads não atendidos
   */
  static async getUnattended(limit = 50) {
    const db = require("../config/database");

    const query = `
      SELECT * FROM teste.leads 
      WHERE status = 'novo'
      ORDER BY 
        CASE prioridade 
          WHEN 'alta' THEN 1 
          WHEN 'media' THEN 2 
          WHEN 'baixa' THEN 3 
        END,
        data_recebimento ASC
      LIMIT $1
    `;

    const result = await db.query(query, [limit]);
    return result.rows.map((row) => new Lead(row));
  }
}

module.exports = Lead;
