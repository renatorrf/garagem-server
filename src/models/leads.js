// models/Lead.js
const db = require("../config/database");

class Lead {
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

    this.score = data.score ?? this.calculateScore();
    this.tags = data.tags || this.extractTags();
    this.createdAt = data.created_at || data.createdAt || new Date();
    this.updatedAt = data.updated_at || data.updatedAt || new Date();
  }

  static get tableName() {
    return "teste.leads";
  }

  calculateScore() {
    let score = 0;

    if (this.telefone && this.telefone.length >= 10) score += 20;
    if (this.nome && this.nome.length > 3) score += 10;
    if (this.veiculoInteresse) score += 15;

    const text = `${this.assunto || ""} ${this.mensagem || ""}`.toLowerCase();
    const urgentKeywords = ["urgente", "hoje", "imediato", "rápido", "agora"];

    if (urgentKeywords.some((keyword) => text.includes(keyword))) score += 25;
    if (this.mensagem && this.mensagem.length > 100) score += 10;

    return Math.min(score, 100);
  }

  extractTags() {
    const tags = [];
    const text =
      `${this.assunto || ""} ${this.mensagem || ""} ${this.veiculoInteresse || ""}`.toLowerCase();

    if (this.origem) tags.push(this.origem.toLowerCase());

    const interests = {
      financiamento: [
        "financiamento",
        "parcelamento",
        "entrada",
        "crédito",
        "pre-analisado",
      ],
      troca: ["troca", "permuta", "meu carro"],
      consorcio: ["consórcio", "consorcio", "carta"],
      "teste-drive": ["test drive", "teste drive", "experimentar", "dirigir"],
    };

    Object.entries(interests).forEach(([tag, keywords]) => {
      if (keywords.some((keyword) => text.includes(keyword))) tags.push(tag);
    });

    const vehicleTypes = {
      suv: ["suv", "4x4", "off-road"],
      hatch: ["hatch", "hatchback"],
      sedan: ["sedan"],
      pickup: ["pickup", "caminhonete"],
      luxo: ["bmw", "mercedes", "audi", "land rover"],
    };

    Object.entries(vehicleTypes).forEach(([tag, keywords]) => {
      if (keywords.some((keyword) => text.includes(keyword))) tags.push(tag);
    });

    return [...new Set(tags)];
  }

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
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  }

  async save() {
    const errors = this.validate();
    if (errors.length > 0) {
      throw new Error(`Validation failed: ${errors.join(", ")}`);
    }

    this.updatedAt = new Date();
    if (!this.createdAt) this.createdAt = new Date();

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
      score: this.score ?? 0,
      tags: this.tags || [],
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
    };

    const query = `
      INSERT INTO ${Lead.tableName} (
        email_id, remetente, email_remetente, assunto, telefone,
        nome, veiculo_interesse, mensagem, origem, status,
        prioridade, data_recebimento, data_contato, observacoes,
        vendedor_id, metadata, score, tags, created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
        $11, $12, $13, $14, $15, $16, $17, $18, $19, $20
      )
      ON CONFLICT (email_id) DO NOTHING
      RETURNING *;
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

    const result = await db.query(query, params);
    return result.rows[0] ? new Lead(result.rows[0]) : null;
  }

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

    for (const key of Object.keys(updates)) {
      if (!fieldMap[key]) continue;
      fields.push(`${fieldMap[key]} = $${paramCount}`);
      values.push(updates[key]);
      paramCount++;
    }

    if (updates.metadata) {
      const hasWaPatch =
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
      } else {
        fields.push(`metadata = $${paramCount}::jsonb`);
        values.push(JSON.stringify(updates.metadata));
      }
      paramCount++;
    }

    fields.push(`updated_at = $${paramCount}`);
    values.push(this.updatedAt);
    paramCount++;

    values.push(this.id);

    const query = `
      UPDATE ${Lead.tableName}
      SET ${fields.join(", ")}
      WHERE id = $${paramCount}
      RETURNING *;
    `;

    const result = await db.query(query, values);
    return result.rows[0] ? new Lead(result.rows[0]) : null;
  }

  static async findById(id) {
    const query = `SELECT * FROM ${Lead.tableName} WHERE id = $1 AND deleted_at IS NULL`;
    const result = await db.getOne(query, [id]);
    return result ? new Lead(result) : null;
  }

  static async findByEmailId(emailId) {
    const query = `SELECT * FROM ${Lead.tableName} WHERE email_id = $1 AND deleted_at IS NULL`;
    const result = await db.getOne(query, [emailId]);
    return result ? new Lead(result) : null;
  }

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
    let whereConditions = ["deleted_at IS NULL"];
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

    if (search) {
      whereConditions.push(`
        (
          to_tsvector('portuguese',
            COALESCE(assunto, '') || ' ' ||
            COALESCE(mensagem, '') || ' ' ||
            COALESCE(veiculo_interesse, '')
          ) @@ to_tsquery('portuguese', $${paramCount})
          OR email_remetente ILIKE $${paramCount + 1}
          OR telefone ILIKE $${paramCount + 1}
          OR nome ILIKE $${paramCount + 1}
        )
      `);
      const searchTerm = search.trim().split(/\s+/).join(" & ");
      params.push(searchTerm, `%${search}%`);
      paramCount += 2;
    }

    const whereClause = `WHERE ${whereConditions.join(" AND ")}`;

    const offset = (page - 1) * limit;
    params.push(limit, offset);

    const query = `
      SELECT *, COUNT(*) OVER() as total_count
      FROM ${Lead.tableName}
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

  static async countByStatus() {
    const query = `
      SELECT status, COUNT(*) as count
      FROM ${Lead.tableName}
      WHERE deleted_at IS NULL
      GROUP BY status
      ORDER BY count DESC
    `;
    const result = await db.query(query);
    return result.rows;
  }

  static async countByOrigem() {
    const query = `
      SELECT origem, COUNT(*) as count
      FROM ${Lead.tableName}
      WHERE deleted_at IS NULL
      GROUP BY origem
      ORDER BY count DESC
    `;
    const result = await db.query(query);
    return result.rows;
  }

  static async delete(id) {
    const query = `
      UPDATE ${Lead.tableName}
      SET deleted_at = NOW(), updated_at = NOW()
      WHERE id = $1
      RETURNING *;
    `;
    const result = await db.query(query, [id]);
    return result.rows[0] ? new Lead(result.rows[0]) : null;
  }

  static async getDashboardStats(dataInicio, dataFim) {
    const schema = process.env.SCHEMA_PADRAO || "teste";

    // garante tabela qualificada
    const leadTable =
      Lead.tableName && String(Lead.tableName).includes(".")
        ? Lead.tableName
        : `${schema}.${Lead.tableName || "leads"}`;

    const whereConditions = ["deleted_at IS NULL"];
    const params = [];
    let paramCount = 1;

    // intervalo: [inicio, fim)
    if (dataInicio) {
      whereConditions.push(`data_recebimento >= $${paramCount}`);
      params.push(dataInicio);
      paramCount++;
    }

    if (dataFim) {
      whereConditions.push(`data_recebimento < $${paramCount}`);
      params.push(dataFim);
      paramCount++;
    }

    const whereClause = `WHERE ${whereConditions.join(" AND ")}`;

    // ---------- STATS ----------
    const query = `
    WITH stats AS (
      SELECT
        COUNT(*)::int AS total_leads,
        COUNT(*) FILTER (WHERE status = 'novo')::int AS novos_leads,
        COUNT(*) FILTER (WHERE status = 'vendido')::int AS vendidos,
        COUNT(*) FILTER (
          WHERE (data_recebimento AT TIME ZONE 'America/Sao_Paulo')::date
                = (NOW() AT TIME ZONE 'America/Sao_Paulo')::date
        )::int AS leads_hoje,
        COUNT(*) FILTER (WHERE prioridade = 'alta')::int AS alta_prioridade,
        COUNT(*) FILTER (WHERE status = 'contatado')::int AS contatados
      FROM ${leadTable}
      ${whereClause}
    )
    SELECT * FROM stats;
  `;

    const result = await db.getOne(query, params);

    // ---------- TIMELINE (últimos 30 dias ou filtro do request) ----------
    const tlStart =
      dataInicio ||
      new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const tlEnd = dataFim || new Date().toISOString();

    const timelineQuery = `
    SELECT
      (data_recebimento AT TIME ZONE 'America/Sao_Paulo')::date AS date,
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE status = 'vendido')::int AS vendidos
    FROM ${leadTable}
    WHERE deleted_at IS NULL
      AND data_recebimento >= $1
      AND data_recebimento <  $2
    GROUP BY (data_recebimento AT TIME ZONE 'America/Sao_Paulo')::date
    ORDER BY date ASC;
  `;

    const timeline = await db.query(timelineQuery, [tlStart, tlEnd]);

    // ---------- LEADS POR PLATAFORMA ----------
    const leadsPorPlataformaQuery = `
    WITH base AS (
      SELECT
        COALESCE(
          NULLIF((metadata::jsonb ->> 'plataforma'), ''),
          NULLIF(origem, ''),
          NULLIF((metadata::jsonb #>> '{extras,fonte}'), ''),
          'Desconhecido'
        ) AS plataforma,
        status,
        prioridade,
        data_recebimento,
        data_contato
      FROM ${leadTable}
      ${whereClause}
    )
    SELECT
      plataforma,
      COUNT(*)::int AS leads,
      COUNT(*) FILTER (WHERE status = 'novo')::int AS novos,
      COUNT(*) FILTER (WHERE status = 'contatado')::int AS contatados,
      COUNT(*) FILTER (WHERE status = 'vendido')::int AS vendidos,
      COUNT(*) FILTER (WHERE prioridade = 'alta')::int AS alta_prioridade,
      COUNT(*) FILTER (
        WHERE (data_recebimento AT TIME ZONE 'America/Sao_Paulo')::date
              = (NOW() AT TIME ZONE 'America/Sao_Paulo')::date
      )::int AS leads_hoje,
      ROUND(
        (COUNT(*) FILTER (WHERE status = 'vendido')::numeric / NULLIF(COUNT(*),0)) * 100
      , 2) AS taxa_conversao_pct
    FROM base
    GROUP BY plataforma
    ORDER BY leads DESC;
  `;

    const leadsPorPlataforma = await db.query(leadsPorPlataformaQuery, params);

    // ---------- TIMELINE POR PLATAFORMA ----------
    const timeLinePlataformaQuery = `
    WITH base AS (
      SELECT
        COALESCE(
          NULLIF((metadata::jsonb ->> 'plataforma'), ''),
          NULLIF(origem, ''),
          'Desconhecido'
        ) AS plataforma,
        (data_recebimento AT TIME ZONE 'America/Sao_Paulo')::date AS dia,
        status
      FROM ${leadTable}
      ${whereClause}
    )
    SELECT
      plataforma,
      dia,
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE status = 'vendido')::int AS vendidos
    FROM base
    GROUP BY plataforma, dia
    ORDER BY dia ASC, plataforma ASC;
  `;

    const timeLinePlataforma = await db.query(timeLinePlataformaQuery, params);

    // ---------- CPL / CPA (requer ${schema}.marketing_spend_daily) ----------
    const LeadCPLCPAQuery = `
    WITH leads_plat AS (
      SELECT
        COALESCE(
          NULLIF((metadata::jsonb ->> 'plataforma'), ''),
          NULLIF(origem, ''),
          'Desconhecido'
        ) AS plataforma,
        COUNT(*)::int AS leads,
        COUNT(*) FILTER (WHERE status = 'vendido')::int AS vendidos
      FROM ${leadTable}
      WHERE deleted_at IS NULL
        AND data_recebimento >= $1
        AND data_recebimento <  $2
      GROUP BY 1
    ),
    spend_plat AS (
      SELECT
        plataforma,
        SUM(spend)::numeric(12,2) AS spend
      FROM ${schema}.marketing_spend_daily
      WHERE spend_date >= $1::date
        AND spend_date <  $2::date
      GROUP BY 1
    )
    SELECT
      COALESCE(l.plataforma, s.plataforma) AS plataforma,
      COALESCE(l.leads, 0) AS leads,
      COALESCE(l.vendidos, 0) AS vendidos,
      COALESCE(s.spend, 0) AS spend,
      ROUND(COALESCE(s.spend, 0) / NULLIF(COALESCE(l.leads, 0), 0), 2) AS cpl,
      ROUND(COALESCE(s.spend, 0) / NULLIF(COALESCE(l.vendidos, 0), 0), 2) AS cpa
    FROM leads_plat l
    FULL OUTER JOIN spend_plat s USING (plataforma)
    ORDER BY leads DESC, spend DESC;
  `;

    const leadCPLCPA = await db.query(LeadCPLCPAQuery, [tlStart, tlEnd]);

    const custoPlataformaLead = await db.query(
              `WITH base_leads AS (
          SELECT
            -- pega plataforma do metadata/origem e NORMALIZA para bater com a tabela de custos
            CASE
              WHEN lower(COALESCE(metadata::jsonb->>'plataforma', origem, '')) IN ('bv','napista') THEN 'BV/NaPista'
              WHEN lower(COALESCE(metadata::jsonb->>'plataforma', origem, '')) IN ('mobiauto') THEN 'MobiAuto'
              WHEN lower(COALESCE(metadata::jsonb->>'plataforma', origem, '')) IN ('icarros','i carros','i-carros') THEN 'iCarros'
              WHEN lower(COALESCE(metadata::jsonb->>'plataforma', origem, '')) IN ('olx') THEN 'OLX'
              WHEN lower(COALESCE(metadata::jsonb->>'plataforma', origem, '')) IN ('mercado livre','mercadolivre','ml','mercado_livre') THEN 'Mercado Livre'
              ELSE COALESCE(NULLIF(metadata::jsonb->>'plataforma',''), NULLIF(origem,''), 'Desconhecido')
            END AS plataforma,
            status
          FROM ${schema}.leads
          WHERE deleted_at IS NULL
            AND data_recebimento >= $1
            AND data_recebimento <  $2
        ),
        leads_plat AS (
          SELECT
            plataforma,
            COUNT(*)::int AS leads,
            COUNT(*) FILTER (WHERE status='vendido')::int AS vendidos
          FROM base_leads
          GROUP BY 1
        ),
        dias AS (
          SELECT
            d::date AS dia,
            EXTRACT(day FROM (date_trunc('month', d) + interval '1 month - 1 day'))::int AS dias_no_mes
          FROM generate_series($1::date, ($2::date - interval '1 day')::date, interval '1 day') d
        ),
        spend_plat AS (
          SELECT
            c.plataforma,
            ROUND(SUM(c.custo_mensal / dias.dias_no_mes), 2) AS spend_periodo
          FROM ${schema}.marketing_costs_monthly c
          CROSS JOIN dias
          GROUP BY c.plataforma
        )
        SELECT
          COALESCE(l.plataforma, s.plataforma) AS plataforma,
          COALESCE(l.leads, 0) AS leads,
          COALESCE(l.vendidos, 0) AS vendidos,
          COALESCE(s.spend_periodo, 0) AS spend,
          ROUND(COALESCE(s.spend_periodo, 0) / NULLIF(COALESCE(l.leads, 0), 0), 2) AS cpl,
          ROUND(COALESCE(s.spend_periodo, 0) / NULLIF(COALESCE(l.vendidos, 0), 0), 2) AS cpa
        FROM leads_plat l
        FULL OUTER JOIN spend_plat s USING (plataforma)
        ORDER BY leads DESC, spend DESC;`
    );
    const cplRows = await db.query(custoPlataformaLead, [tlStart, tlEnd]);

    // ---------- retorno ----------
    const total = Number(result?.total_leads ?? 0);
    const vendidos = Number(result?.vendidos ?? 0);

    return {
      ...result,
      taxaConversao: total > 0 ? ((vendidos / total) * 100).toFixed(2) : "0.00",
      timeline: timeline.rows,
      leadsPorPlataforma: leadsPorPlataforma.rows,
      timeLinePlataforma: timeLinePlataforma.rows,
      leadCPLCPA: leadCPLCPA.rows,
      cplRows: cplRows.rows
    };
  }

  static async searchAdvanced({
    filters = {},
    page = 1,
    limit = 50,
    sortBy = "dataRecebimento",
    order = "DESC",
  }) {
    let whereConditions = ["deleted_at IS NULL"];
    let params = [];
    let paramCount = 1;

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

    if (filters.search) {
      whereConditions.push(`
        (
          to_tsvector('portuguese',
            COALESCE(assunto, '') || ' ' ||
            COALESCE(mensagem, '') || ' ' ||
            COALESCE(veiculo_interesse, '')
          ) @@ to_tsquery('portuguese', $${paramCount})
          OR email_remetente ILIKE $${paramCount + 1}
          OR telefone ILIKE $${paramCount + 1}
          OR nome ILIKE $${paramCount + 1}
        )
      `);
      const searchTerm = filters.search.trim().split(/\s+/).join(" & ");
      params.push(searchTerm, `%${filters.search}%`);
      paramCount += 2;
    }

    if (
      filters.tags &&
      Array.isArray(filters.tags) &&
      filters.tags.length > 0
    ) {
      const tagConditions = filters.tags.map((tag, index) => {
        params.push(tag);
        return `$${paramCount + index} = ANY(tags)`;
      });
      whereConditions.push(`(${tagConditions.join(" OR ")})`);
      paramCount += filters.tags.length;
    }

    const whereClause = `WHERE ${whereConditions.join(" AND ")}`;
    const orderBy = this.getOrderBy(sortBy, order);

    const offset = (page - 1) * limit;
    params.push(limit, offset);

    const query = `
      SELECT *, COUNT(*) OVER() as total_count
      FROM ${Lead.tableName}
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

  static async assignToSeller(ids, vendedorId) {
    const query = `
      UPDATE ${Lead.tableName}
      SET vendedor_id = $1,
          status = 'contatado',
          data_contato = NOW(),
          updated_at = NOW()
      WHERE id = ANY($2::uuid[])
        AND deleted_at IS NULL
      RETURNING *;
    `;

    const result = await db.query(query, [vendedorId, ids]);

    return {
      updated: result.rowCount,
      leads: result.rows.map((row) => new Lead(row)),
    };
  }

  static async export({ dataInicio, dataFim, status, origem } = {}) {
    let whereConditions = ["deleted_at IS NULL"];
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

    const whereClause = `WHERE ${whereConditions.join(" AND ")}`;
    const query = `SELECT * FROM ${Lead.tableName} ${whereClause} ORDER BY data_recebimento DESC`;

    const result = await db.query(query, params);
    return result.rows.map((row) => new Lead(row));
  }

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
      lead.emailRemetente || "",
      lead.telefone || "",
      lead.veiculoInteresse || "",
      lead.origem || "",
      lead.status || "",
      lead.prioridade || "",
      lead.score ?? 0,
      lead.dataRecebimento
        ? new Date(lead.dataRecebimento).toLocaleString("pt-BR")
        : "",
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

  static async getByPeriod(startDate, endDate) {
    const query = `
      SELECT * FROM ${Lead.tableName}
      WHERE deleted_at IS NULL
        AND data_recebimento BETWEEN $1 AND $2
      ORDER BY data_recebimento DESC
    `;
    const result = await db.query(query, [startDate, endDate]);
    return result.rows.map((row) => new Lead(row));
  }

  static async getUnattended(limit = 50) {
    const query = `
      SELECT * FROM ${Lead.tableName}
      WHERE deleted_at IS NULL
        AND status = 'novo'
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
