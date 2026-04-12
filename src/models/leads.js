const db = require("../config/database");
const { qualifyTable, resolveSchemaValue } = require("../utils/tenantContext");

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
    this.vendedorId = data.vendedor_id || data.vendedorId || null;
    this.vendedorWhatsapp =
      data.vendedor_whatsapp || data.vendedorWhatsapp || null;
    this.resultText = data.result_text || data.resultText || null;
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
    this._schema = data._schema || data.schema || null;
    this._tenantId = data._tenantId || data.tenantId || null;
  }

  static get tableName() {
    return this.resolveTableName();
  }

  static resolveTableName(options = {}) {
    const schema = resolveSchemaValue(
      options.schema || process.env.SCHEMA_PADRAO || "nextcar",
    );
    return qualifyTable(schema, "leads");
  }

  get tableName() {
    return Lead.resolveTableName({ schema: this._schema });
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

  async save(options = {}) {
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
      vendedorWhatsapp: this.vendedorWhatsapp || null,
      resultText: this.resultText || null,
      metadata: this.metadata || {},
      score: this.score ?? 0,
      tags: this.tags || [],
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
    };

    const tableName = Lead.resolveTableName({
      schema: options.schema || this._schema,
    });

    const query = `
      INSERT INTO ${tableName} (
        email_id, remetente, email_remetente, assunto, telefone,
        nome, veiculo_interesse, mensagem, origem, status,
        prioridade, data_recebimento, data_contato, observacoes,
        vendedor_id, vendedor_whatsapp, result_text,
        metadata, score, tags, created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
        $11, $12, $13, $14, $15, $16, $17,
        $18, $19, $20, $21, $22
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
      insertData.vendedorWhatsapp,
      insertData.resultText,
      JSON.stringify(insertData.metadata),
      insertData.score,
      insertData.tags,
      insertData.createdAt,
      insertData.updatedAt,
    ];

    const result = await db.query(query, params);
    return result.rows[0]
      ? new Lead({
          ...result.rows[0],
          _schema: options.schema || this._schema,
          _tenantId: options.tenantId || this._tenantId,
        })
      : null;
  }

  async update(updates = {}, options = {}) {
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
      vendedorWhatsapp: "vendedor_whatsapp",
      resultText: "result_text",
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

    const tableName = Lead.resolveTableName({
      schema: options.schema || this._schema,
    });

    const query = `
      UPDATE ${tableName}
      SET ${fields.join(", ")}
      WHERE id = $${paramCount}
      RETURNING *;
    `;

    const result = await db.query(query, values);
    return result.rows[0]
      ? new Lead({
          ...result.rows[0],
          _schema: options.schema || this._schema,
          _tenantId: options.tenantId || this._tenantId,
        })
      : null;
  }

  static async findById(id, options = {}) {
    const tableName = Lead.resolveTableName(options);
    const query = `SELECT * FROM ${tableName} WHERE id = $1 AND deleted_at IS NULL`;
    const result = await db.getOne(query, [id]);
    return result
      ? new Lead({
          ...result,
          _schema: options.schema || null,
          _tenantId: options.tenantId || null,
        })
      : null;
  }

  static async findByEmailId(emailId, options = {}) {
    const tableName = Lead.resolveTableName(options);
    const query = `SELECT * FROM ${tableName} WHERE email_id = $1 AND deleted_at IS NULL`;
    const result = await db.getOne(query, [emailId]);
    return result
      ? new Lead({
          ...result,
          _schema: options.schema || null,
          _tenantId: options.tenantId || null,
        })
      : null;
  }

  static async findAll({
    schema,
    tenantId,
    status,
    origem,
    prioridade,
    dataInicio,
    dataFim,
    search,
    vendedorId,
    page = 1,
    limit = 50,
    sortBy = "dataRecebimento",
    order = "DESC",
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
          COALESCE(veiculo_interesse, '') || ' ' ||
          COALESCE(result_text, '')
        ) @@ to_tsquery('portuguese', $${paramCount})
        OR email_remetente ILIKE $${paramCount + 1}
        OR telefone ILIKE $${paramCount + 1}
        OR nome ILIKE $${paramCount + 1}
        OR vendedor_whatsapp ILIKE $${paramCount + 1}
      )
    `);

      const searchTerm = search.trim().split(/\s+/).join(" & ");
      params.push(searchTerm, `%${search}%`);
      paramCount += 2;
    }

    const whereClause = `WHERE ${whereConditions.join(" AND ")}`;
    const orderBy = this.getOrderBy(sortBy, order);

    const offset = (page - 1) * limit;
    params.push(limit, offset);

    const tableName = Lead.resolveTableName({ schema });

    const query = `
    SELECT
      *,
      COUNT(*) OVER() as total_count,

      metadata->'wa'->>'sellerName' as wa_seller_name,
      metadata->'wa'->>'lastStatus' as wa_last_status,
      metadata->'wa'->>'claimedAt' as wa_claimed_at,
      metadata->'wa'->>'attendanceStartedAt' as wa_attendance_started_at,
      metadata->'wa'->>'feedbackRequestedAt' as wa_feedback_requested_at,
      metadata->'wa'->>'outcome' as wa_outcome,

      CASE
        WHEN regexp_replace(COALESCE(telefone, ''), '\\D', '', 'g') ~ '^(55)?\\d{10,11}$'
        THEN true
        ELSE false
      END as wa_phone_valid,

      CASE
        WHEN COALESCE(NULLIF(trim(nome), ''), NULL) IS NOT NULL
         AND regexp_replace(COALESCE(telefone, ''), '\\D', '', 'g') ~ '^(55)?\\d{10,11}$'
         AND COALESCE(metadata->'wa'->>'claimedAt', '') = ''
        THEN true
        ELSE false
      END as wa_can_retry_initial,

      CASE
        WHEN status = 'novo'
         AND COALESCE(metadata->'wa'->>'claimedAt', '') = ''
         AND regexp_replace(COALESCE(telefone, ''), '\\D', '', 'g') ~ '^(55)?\\d{10,11}$'
        THEN true
        ELSE false
      END as wa_can_force_reminder,

      CASE
        WHEN status IN ('novo', 'contatado')
         AND (
           COALESCE(metadata->'wa'->>'attendanceStartedAt', '') <> ''
           OR COALESCE(metadata->'wa'->>'claimedAt', '') <> ''
         )
        THEN true
        ELSE false
      END as wa_can_force_feedback

    FROM ${tableName}
    ${whereClause}
    ${orderBy}
    LIMIT $${paramCount}
    OFFSET $${paramCount + 1}
  `;

    const result = await db.query(query, params);

    const leads = result.rows.map(
      (row) =>
        new Lead({
          ...row,
          _schema: schema || null,
          _tenantId: tenantId || null,
        }),
    );
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

  static async getDashboardStats(dataInicio, dataFim, schema, options = {}) {
    const leadTable = Lead.resolveTableName(options);
    const schemaName = resolveSchemaValue(schema);

    console.log(leadTable);

    const whereConditions = ["deleted_at IS NULL"];
    const params = [];
    let paramCount = 1;

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

    const statsQuery = `
      WITH stats AS (
        SELECT
          COUNT(*)::int AS total_leads,
          COUNT(*) FILTER (WHERE status = 'novo')::int AS novos_leads,
          COUNT(*) FILTER (WHERE status = 'vendido')::int AS vendidos,
          COUNT(*) FILTER (
            WHERE data_recebimento >= date_trunc('day', NOW() AT TIME ZONE 'America/Sao_Paulo')
              AND data_recebimento <  date_trunc('day', NOW() AT TIME ZONE 'America/Sao_Paulo') + interval '1 day'
          )::int AS leads_hoje,
          COUNT(*) FILTER (WHERE prioridade = 'alta')::int AS alta_prioridade,
          COUNT(*) FILTER (WHERE status = 'contatado')::int AS contatados
        FROM ${leadTable}
        ${whereClause}
      )
      SELECT * FROM stats;
    `;

    const result = await db.getOne(statsQuery, params);

    const ini =
      dataInicio || new Date(Date.now() - 30 * 86400000).toISOString();
    const fim = dataFim || new Date().toISOString();

    const timelineWhere = [
      "deleted_at IS NULL",
      "data_recebimento >= $1",
      "data_recebimento < $2",
    ];

    const timelineQuery = `
      SELECT
        DATE(data_recebimento) as date,
        COUNT(*) as total,
        COUNT(CASE WHEN status = 'vendido' THEN 1 END) as vendidos
      FROM ${leadTable}
      WHERE ${timelineWhere.join(" AND ")}
      GROUP BY DATE(data_recebimento)
      ORDER BY date ASC
    `;
    const timeline = await db.query(timelineQuery, [ini, fim]);

    const leadsPorPlataformaQuery = `
      WITH base AS (
        SELECT
          public.try_jsonb(metadata::text) AS meta,
          origem,
          status,
          prioridade,
          data_recebimento
        FROM ${leadTable}
        WHERE deleted_at IS NULL
          AND data_recebimento >= $1
          AND data_recebimento <  $2
      )
      SELECT
        COALESCE(
          NULLIF(meta ->> 'plataforma', ''),
          NULLIF(origem, ''),
          NULLIF(meta #>> '{extras,fonte}', ''),
          'Desconhecido'
        ) AS plataforma,
        COUNT(*)::int AS leads,
        COUNT(*) FILTER (WHERE status = 'novo')::int AS novos,
        COUNT(*) FILTER (WHERE status = 'contatado')::int AS contatados,
        COUNT(*) FILTER (WHERE status = 'vendido')::int AS vendidos,
        COUNT(*) FILTER (WHERE prioridade = 'alta')::int AS alta_prioridade,
          COUNT(*) FILTER (
            WHERE data_recebimento >= date_trunc('day', NOW() AT TIME ZONE 'America/Sao_Paulo')
              AND data_recebimento <  date_trunc('day', NOW() AT TIME ZONE 'America/Sao_Paulo') + interval '1 day'
          )::int AS leads_hoje,
        ROUND(
          (COUNT(*) FILTER (WHERE status = 'vendido')::numeric / NULLIF(COUNT(*),0)) * 100
        , 2) AS taxa_conversao_pct
      FROM base
      GROUP BY plataforma
      ORDER BY leads DESC;
    `;
    const leadsPorPlataforma = await db.query(leadsPorPlataformaQuery, [
      ini,
      fim,
    ]);

    const custoPlataformaLeadQuery = `
      WITH base_leads AS (
        SELECT
          public.try_jsonb(metadata::text) AS meta,
          origem,
          status
        FROM ${leadTable}
        WHERE deleted_at IS NULL
          AND data_recebimento >= $1
          AND data_recebimento <  $2
      ),
      leads_plat AS (
        SELECT
          CASE
            WHEN lower(COALESCE(NULLIF(meta->>'plataforma',''), origem, '')) IN ('BV','napista') THEN 'BV/NaPista'
            WHEN lower(COALESCE(NULLIF(meta->>'plataforma',''), origem, '')) IN ('mobiauto', 'Mobiauto') THEN 'Mobiauto'
            WHEN lower(COALESCE(NULLIF(meta->>'plataforma',''), origem, '')) IN ('icarros','i carros','i-carros') THEN 'iCarros'
            WHEN lower(COALESCE(NULLIF(meta->>'plataforma',''), origem, '')) IN ('olx') THEN 'OLX'
            WHEN lower(COALESCE(NULLIF(meta->>'plataforma',''), origem, '')) IN ('mercado livre','mercadolivre','ml','mercado_livre') THEN 'Mercado Livre'
            ELSE COALESCE(NULLIF(meta->>'plataforma',''), NULLIF(origem,''), 'Desconhecido')
          END AS plataforma,
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
        FROM ${schemaName}.marketing_costs_monthly c
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
      ORDER BY leads DESC, spend DESC;
    `;
    const custoPlataformaLead = await db.query(custoPlataformaLeadQuery, [
      ini,
      fim,
    ]);

    const attendedBySellerQuery = `
      WITH base AS (
        SELECT
          vendedor_id,
          vendedor_whatsapp,
          COALESCE(result_text, metadata->'wa'->>'resultText') AS result_text,
          status,
          metadata,
          data_recebimento,
          data_contato
        FROM ${leadTable}
        WHERE deleted_at IS NULL
          AND data_recebimento >= $1
          AND data_recebimento < $2
          AND (vendedor_id IS NOT NULL OR vendedor_whatsapp IS NOT NULL OR metadata->'wa'->>'sellerName' IS NOT NULL)
      )
      SELECT
        vendedor_id,
        vendedor_whatsapp,
        COALESCE(metadata->'wa'->>'sellerName', 'Não definido') AS seller_name,
        COUNT(*)::int AS atendidos,
        COUNT(*) FILTER (WHERE status = 'vendido')::int AS vendidos,
        COUNT(*) FILTER (WHERE status = 'perdido')::int AS perdidos,
        ROUND(
          AVG(
            EXTRACT(EPOCH FROM (
              COALESCE((metadata->'wa'->>'attendanceStartedAt')::timestamptz, data_contato)
              - data_recebimento
            )) / 60
          )::numeric
        , 2) AS tempo_reacao_medio_min
      FROM base
      GROUP BY vendedor_id, vendedor_whatsapp, seller_name
      ORDER BY atendidos DESC, vendidos DESC;
    `;
    const attendedBySeller = await db.query(attendedBySellerQuery, [ini, fim]);

    const resultSummaryQuery = `
      SELECT
        COALESCE(result_text, metadata->'wa'->>'resultText', status) AS label,
        COUNT(*)::int AS count
      FROM ${leadTable}
      WHERE deleted_at IS NULL
        AND data_recebimento >= $1
        AND data_recebimento < $2
        AND COALESCE(result_text, metadata->'wa'->>'resultText', status) IS NOT NULL
      GROUP BY 1
      ORDER BY count DESC;
    `;
    const resultSummary = await db.query(resultSummaryQuery, [ini, fim]);

    return {
      ...result,
      taxaConversao:
        Number(result?.total_leads || 0) > 0
          ? Number(
              (
                (Number(result.vendidos || 0) /
                  Number(result.total_leads || 0)) *
                100
              ).toFixed(2),
            )
          : 0,
      timeline: timeline.rows,
      leadsPorPlataforma: leadsPorPlataforma.rows,
      custoPlataformaLead: custoPlataformaLead.rows,
      attendedBySeller: attendedBySeller.rows,
      resultSummary: resultSummary.rows,
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

  static async searchAdvanced({
    schema,
    tenantId,
    filters = {},
    page = 1,
    limit = 50,
    sortBy = "dataRecebimento",
    order = "DESC",
  }) {
    return this.findAll({
      schema,
      tenantId,
      ...filters,
      page,
      limit,
      sortBy,
      order,
    });
  }

  static async assignToSeller(ids, vendedorId, options = {}) {
    const tableName = Lead.resolveTableName({
      schema: options.schema || this._schema,
    });

    const query = `
      UPDATE ${tableName}
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

  static async export({
    schema,
    tenantId,
    dataInicio,
    dataFim,
    status,
    origem,
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
    const tableName = Lead.resolveTableName({ schema });
    const query = `SELECT * FROM ${tableName} ${whereClause} ORDER BY data_recebimento DESC`;

    const result = await db.query(query, params);
    return result.rows.map(
      (row) =>
        new Lead({
          ...row,
          _schema: schema || null,
          _tenantId: tenantId || null,
        }),
    );
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
      "Vendedor WhatsApp",
      "Resultado",
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
      lead.vendedorWhatsapp || "",
      lead.resultText || "",
      lead.tags?.join(", ") || "",
    ]);

    return [headers, ...rows]
      .map((row) =>
        row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","),
      )
      .join("\n");
  }

  static async delete(id, options = {}) {
    const tableName = Lead.resolveTableName({
      schema: options.schema || this._schema,
    });

    const query = `
      UPDATE ${tableName}
      SET deleted_at = NOW(), updated_at = NOW()
      WHERE id = $1
      RETURNING *;
    `;
    const result = await db.query(query, [id]);
    return result.rows[0] ? new Lead(result.rows[0]) : null;
  }

  static async requeueWhatsApp(id, mode = "initial", options = {}) {
    const allowedModes = ["initial", "reminder", "feedback"];

    if (!allowedModes.includes(mode)) {
      throw new Error("Modo de reenvio inválido");
    }

    const lead = await this.findById(id, options);

    if (!lead) {
      throw new Error("Lead não encontrado");
    }

    const phoneDigits = String(lead.telefone || "").replace(/\D/g, "");
    const hasValidPhone =
      phoneDigits.length === 10 ||
      phoneDigits.length === 11 ||
      phoneDigits.length === 12 ||
      phoneDigits.length === 13;

    if (!lead.nome || !lead.nome.trim()) {
      throw new Error("Lead sem nome válido");
    }

    if (!hasValidPhone) {
      throw new Error("Lead sem telefone válido");
    }

    const currentMetadata =
      lead.metadata && typeof lead.metadata === "object" ? lead.metadata : {};

    const wa = {
      ...(currentMetadata.wa || {}),
    };

    if (mode === "initial") {
      const newMetadata = {
        ...currentMetadata,
        wa: {
          ...wa,
          notifyWamid: null,
          sellerKey: null,
          sellerId: null,
          sellerName: null,
          sellerSelectedBy: null,
          sellerSelectedAt: null,
          claimedAt: null,
          attendanceStartedAt: null,
          estimatedEndAt: null,
          reminderCount: 0,
          nextReminderAt: null,
          lastReminderAt: null,
          lastReminderWamid: null,
          feedbackRequestedAt: null,
          feedbackRequestWamid: null,
          outcome: null,
          closedAt: null,
          lastStatus: null,
          lastStatusAt: null,
          openConversationWamid: null,
          messageStatuses: [],
        },
      };

      const updatedLead = await lead.update({
        metadata: newMetadata,
        status: "novo",
        dataContato: null,
      });

      return { lead: updatedLead, mode: "initial" };
    }

    if (mode === "reminder") {
      const newMetadata = {
        ...currentMetadata,
        wa: {
          ...wa,
          claimedAt: null,
          sellerKey: null,
          sellerId: null,
          sellerName: null,
          sellerSelectedBy: null,
          sellerSelectedAt: null,
          attendanceStartedAt: null,
          estimatedEndAt: null,
          reminderCount: 0,
          nextReminderAt: new Date(Date.now() - 60 * 1000).toISOString(),
          lastReminderAt: null,
          lastReminderWamid: null,
          feedbackRequestedAt: null,
          feedbackRequestWamid: null,
          outcome: null,
          closedAt: null,
          lastStatus: null,
          lastStatusAt: null,
          openConversationWamid: null,
        },
      };

      const updatedLead = await lead.update({
        metadata: newMetadata,
        status: "novo",
        dataContato: null,
      });

      return { lead: updatedLead, mode: "reminder" };
    }

    if (mode === "feedback") {
      const backDate = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();

      const newMetadata = {
        ...currentMetadata,
        wa: {
          ...wa,
          claimedAt: wa.claimedAt || backDate,
          attendanceStartedAt: wa.attendanceStartedAt || backDate,
          feedbackRequestedAt: null,
          feedbackRequestWamid: null,
          outcome: null,
          closedAt: null,
          lastStatus: null,
          lastStatusAt: null,
        },
      };

      const updatedLead = await lead.update({
        metadata: newMetadata,
        status: "contatado",
      });

      return { lead: updatedLead, mode: "feedback" };
    }

    throw new Error("Modo de reenvio inválido");
  }
}

module.exports = Lead;
