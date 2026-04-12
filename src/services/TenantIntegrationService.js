
"use strict";

const db = require("../config/database");
const { decryptText, encryptText } = require("../utils/tenantCrypto");
const { resolveSchemaValue } = require("../utils/tenantContext");

class TenantIntegrationService {
  static async ensureTenantIntegrationTable() {
    await db.query(`
      create table if not exists public.tenant_integrations (
        id bigserial primary key,
        tenant_id bigint references public.tenants(id),
        schema_name varchar(63),
        integration_type varchar(60) not null,
        integration_name varchar(120),
        is_active boolean not null default true,
        config_encrypted text,
        token_encrypted text,
        secret_encrypted text,
        external_id varchar(255),
        metadata jsonb,
        created_at timestamp without time zone default now(),
        updated_at timestamp without time zone default now()
      )
    `);
  }

  static async resolveTenantContext({ tenantId = null, schema = null } = {}) {
    if (tenantId) {
      const row = await db.getOne(
        `select id as tenant_id, schema_name, cnpj, nome_fantasia
           from public.tenants
          where id = $1
          limit 1`,
        [tenantId],
      );
      if (row) return row;
    }

    const normalizedSchema = schema ? resolveSchemaValue(schema) : null;

    if (normalizedSchema) {
      const row = await db.getOne(
        `select id as tenant_id, schema_name, cnpj, nome_fantasia
           from public.tenants
          where schema_name = $1
          limit 1`,
        [normalizedSchema],
      );
      if (row) return row;
      return { tenant_id: null, schema_name: normalizedSchema };
    }

    const fallbackSchema = process.env.SCHEMA_PADRAO || null;
    return fallbackSchema ? { tenant_id: null, schema_name: resolveSchemaValue(fallbackSchema) } : null;
  }

  static async getIntegration(integrationType, { tenantId = null, schema = null, externalId = null } = {}) {
    const tenant = await this.resolveTenantContext({ tenantId, schema });
    if (!tenant) return null;

    const clauses = ["integration_type = $1", "is_active = true"];
    const params = [integrationType];
    let p = 2;

    if (tenant.tenant_id) {
      clauses.push(`tenant_id = $${p++}`);
      params.push(tenant.tenant_id);
    } else if (tenant.schema_name) {
      clauses.push(`schema_name = $${p++}`);
      params.push(tenant.schema_name);
    }

    if (externalId) {
      clauses.push(`external_id = $${p++}`);
      params.push(externalId);
    }

    const row = await db.getOne(
      `select *
         from public.tenant_integrations
        where ${clauses.join(" and ")}
        order by updated_at desc, id desc
        limit 1`,
      params,
    );

    if (!row) return null;

    let config = {};
    try {
      config = row.config_encrypted ? JSON.parse(decryptText(row.config_encrypted)) : {};
    } catch (_) {
      config = {};
    }

    let secret = null;
    try {
      secret = row.secret_encrypted ? decryptText(row.secret_encrypted) : null;
    } catch (_) {
      secret = null;
    }

    let token = null;
    try {
      token = row.token_encrypted ? decryptText(row.token_encrypted) : null;
    } catch (_) {
      token = null;
    }

    return {
      ...row,
      tenant_id: row.tenant_id || tenant.tenant_id || null,
      schema_name: row.schema_name || tenant.schema_name || null,
      config,
      token,
      secret,
    };
  }

  static async upsertIntegration(integrationType, payload = {}) {
    await this.ensureTenantIntegrationTable();

    const tenant = await this.resolveTenantContext({
      tenantId: payload.tenantId || null,
      schema: payload.schema || null,
    });

    if (!tenant?.tenant_id && !tenant?.schema_name) {
      throw new Error("Tenant não identificado para salvar integração.");
    }

    const existing = await this.getIntegration(integrationType, {
      tenantId: tenant.tenant_id,
      schema: tenant.schema_name,
      externalId: payload.externalId || null,
    });

    const sql = existing
      ? `update public.tenant_integrations
            set integration_name = $1,
                is_active = $2,
                config_encrypted = $3,
                token_encrypted = $4,
                secret_encrypted = $5,
                external_id = $6,
                metadata = $7::jsonb,
                updated_at = now()
          where id = $8
          returning *`
      : `insert into public.tenant_integrations (
            tenant_id, schema_name, integration_type, integration_name,
            is_active, config_encrypted, token_encrypted, secret_encrypted,
            external_id, metadata, created_at, updated_at
          ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,now(),now())
          returning *`;

    const configEncrypted = payload.config ? encryptText(JSON.stringify(payload.config)) : null;
    const tokenEncrypted = payload.token ? encryptText(payload.token) : null;
    const secretEncrypted = payload.secret ? encryptText(payload.secret) : null;

    const params = existing
      ? [
          payload.integrationName || existing.integration_name || integrationType,
          payload.isActive !== false,
          configEncrypted,
          tokenEncrypted,
          secretEncrypted,
          payload.externalId || null,
          JSON.stringify(payload.metadata || {}),
          existing.id,
        ]
      : [
          tenant.tenant_id || null,
          tenant.schema_name || null,
          integrationType,
          payload.integrationName || integrationType,
          payload.isActive !== false,
          configEncrypted,
          tokenEncrypted,
          secretEncrypted,
          payload.externalId || null,
          JSON.stringify(payload.metadata || {}),
        ];

    const result = await db.query(sql, params);
    return result.rows[0] || null;
  }

  static async getWhatsAppConfig(context = {}) {
    const integration = await this.getIntegration("whatsapp_meta", context);

    return {
      phoneNumberId:
        integration?.config?.phoneNumberId ||
        integration?.external_id ||
        process.env.WA_PHONE_NUMBER_ID ||
        null,
      token: integration?.token || process.env.WA_ACCESS_TOKEN || null,
      verifyToken:
        integration?.secret ||
        integration?.config?.verifyToken ||
        process.env.WA_WEBHOOK_VERIFY_TOKEN ||
        null,
      sellerPhone:
        integration?.config?.sellerPhone || process.env.WA_SELLER_PHONE || null,
      graphVersion:
        integration?.config?.graphVersion || process.env.WA_GRAPH_VERSION || "v22.0",
      businessAccountId: integration?.config?.businessAccountId || null,
      tenantId: integration?.tenant_id || context.tenantId || null,
      schema: integration?.schema_name || context.schema || process.env.SCHEMA_PADRAO || null,
      integration,
    };
  }

  static async getEmailConfig(context = {}) {
    const integration = await this.getIntegration("email_imap", context);
    const config = integration?.config || {};

    return {
      user: config.user || process.env.EMAIL_USER || null,
      password: integration?.secret || process.env.EMAIL_PASSWORD || null,
      host: config.host || process.env.EMAIL_HOST || "imap.gmail.com",
      port: Number(config.port || process.env.EMAIL_PORT || 993),
      tls: config.tls !== false,
      tlsOptions: { rejectUnauthorized: false },
      authTimeout: Number(config.authTimeout || process.env.EMAIL_AUTH_TIMEOUT || 10000),
      connTimeout: Number(config.connTimeout || process.env.EMAIL_CONN_TIMEOUT || 30000),
      tenantId: integration?.tenant_id || context.tenantId || null,
      schema: integration?.schema_name || context.schema || process.env.SCHEMA_PADRAO || null,
      integration,
    };
  }

  static async getAutosCarConfig(context = {}) {
    const integration = await this.getIntegration("autoscar", context);

    return {
      usuario: integration?.config?.usuario || null,
      senha: integration?.secret || null,
      token: integration?.token || null,
      mensagemPredefinida: integration?.config?.mensagemPredefinida || null,
      connected: integration?.metadata?.connected === true || !!integration?.token,
      integration,
    };
  }
}

module.exports = TenantIntegrationService;
