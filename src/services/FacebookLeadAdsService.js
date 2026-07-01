const crypto = require("crypto");
const axios = require("axios");
const Lead = require("../models/leads");
const LeadWorkflowService = require("./LeadWorkflowService");
const {
  assertValidSchemaName,
  resolveSchemaValue,
} = require("../utils/tenantContext");

const PLATFORM = "facebook-ads";
const DEFAULT_GRAPH_FIELDS = [
  "id",
  "created_time",
  "field_data",
  "ad_id",
  "ad_name",
  "adset_name",
  "campaign_id",
  "campaign_name",
  "form_id",
  "is_organic",
  "platform",
].join(",");
const MINIMAL_GRAPH_FIELDS = ["id", "created_time", "field_data", "form_id"].join(",");

class FacebookLeadAdsService {
  static parseJsonEnv(name) {
    const value = String(process.env[name] || "").trim();
    if (!value) return {};

    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? parsed
        : {};
    } catch (error) {
      throw new Error(`${name} contem JSON invalido: ${error.message}`);
    }
  }

  static graphVersion() {
    const version = String(process.env.META_GRAPH_VERSION || "v25.0").trim();
    return version.startsWith("v") ? version : `v${version}`;
  }

  static validateWebhookSignature(req) {
    const skipValidation =
      String(process.env.META_SKIP_SIGNATURE_VALIDATION || "")
        .trim()
        .toLowerCase() === "true";

    if (skipValidation) {
      console.warn("Facebook Lead Ads: validacao de assinatura desativada.");
      return true;
    }

    const appSecret = String(process.env.META_APP_SECRET || "").trim();
    if (!appSecret) {
      throw new Error("META_APP_SECRET nao configurado.");
    }

    const signatureHeader = String(
      req.headers["x-hub-signature-256"] || "",
    ).trim();

    if (!signatureHeader.startsWith("sha256=")) {
      throw new Error("Assinatura X-Hub-Signature-256 ausente ou invalida.");
    }

    if (!req.rawBody || !Buffer.isBuffer(req.rawBody)) {
      throw new Error("Corpo bruto da requisicao indisponivel para assinatura.");
    }

    const expectedHex = crypto
      .createHmac("sha256", appSecret)
      .update(req.rawBody)
      .digest("hex");
    const receivedHex = signatureHeader.slice("sha256=".length);

    const expected = Buffer.from(expectedHex, "hex");
    const received = Buffer.from(receivedHex, "hex");

    if (
      expected.length !== received.length ||
      !crypto.timingSafeEqual(expected, received)
    ) {
      throw new Error("Assinatura do webhook Facebook Lead Ads invalida.");
    }

    return true;
  }

  static extractLeadgenEvents(payload = {}) {
    const events = [];
    const entries = Array.isArray(payload.entry) ? payload.entry : [];

    for (const entry of entries) {
      const changes = Array.isArray(entry.changes) ? entry.changes : [];

      for (const change of changes) {
        if (String(change.field || "").toLowerCase() !== "leadgen") continue;

        const value = change.value || {};
        const leadgenId =
          value.leadgen_id || value.leadgenId || value.lead_id || value.id;

        if (!leadgenId) continue;

        events.push({
          ...value,
          leadgen_id: String(leadgenId),
          page_id: value.page_id || entry.id || null,
          entry_id: entry.id || null,
          entry_time: entry.time || null,
        });
      }
    }

    return events;
  }

  static resolveAccessToken(event = {}) {
    const pageTokenMap = this.parseJsonEnv("META_LEAD_ADS_PAGE_TOKEN_MAP");
    const formTokenMap = this.parseJsonEnv("META_LEAD_ADS_FORM_TOKEN_MAP");
    const pageId = String(event.page_id || "").trim();
    const formId = String(event.form_id || "").trim();
    const token =
      (formId && formTokenMap[formId]) ||
      (pageId && pageTokenMap[pageId]) ||
      process.env.META_PAGE_ACCESS_TOKEN ||
      process.env.META_LEAD_ADS_ACCESS_TOKEN ||
      "";

    if (!String(token).trim()) {
      throw new Error(
        "Token Meta nao configurado. Defina META_PAGE_ACCESS_TOKEN ou mapas por pagina/formulario.",
      );
    }

    return String(token).trim();
  }

  static resolveSchemaForEvent(event = {}, requestedSchema = null) {
    if (requestedSchema) return assertValidSchemaName(requestedSchema);

    const pageSchemaMap = this.parseJsonEnv("META_LEAD_ADS_PAGE_SCHEMA_MAP");
    const formSchemaMap = this.parseJsonEnv("META_LEAD_ADS_FORM_SCHEMA_MAP");
    const pageId = String(event.page_id || "").trim();
    const formId = String(event.form_id || "").trim();
    const schema =
      (formId && formSchemaMap[formId]) ||
      (pageId && pageSchemaMap[pageId]) ||
      process.env.META_LEAD_ADS_SCHEMA ||
      process.env.SCHEMA_PADRAO;

    return resolveSchemaValue(schema);
  }

  static async fetchLeadDetails(event = {}) {
    const leadgenId = String(event.leadgen_id || "").trim();
    if (!leadgenId) throw new Error("leadgen_id ausente no evento.");

    const accessToken = this.resolveAccessToken(event);
    const fields = String(process.env.META_LEAD_ADS_FIELDS || "").trim() ||
      DEFAULT_GRAPH_FIELDS;
    const timeout = Number(process.env.META_LEAD_ADS_TIMEOUT_MS || 15000);
    const url = `https://graph.facebook.com/${this.graphVersion()}/${encodeURIComponent(
      leadgenId,
    )}`;

    const request = async (requestedFields) => {
      const response = await axios.get(url, {
        params: {
          access_token: accessToken,
          fields: requestedFields,
        },
        timeout: Number.isFinite(timeout) ? timeout : 15000,
      });

      return response.data || {};
    };

    try {
      return await request(fields);
    } catch (error) {
      if (fields === MINIMAL_GRAPH_FIELDS) throw error;

      const graphMessage =
        error?.response?.data?.error?.message || error.message;
      console.warn(
        `Facebook Lead Ads: falha ao buscar campos completos do lead ${leadgenId}. Tentando campos minimos. Motivo: ${graphMessage}`,
      );

      return request(MINIMAL_GRAPH_FIELDS);
    }
  }

  static normalizeKey(value) {
    return String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");
  }

  static fieldDataToMap(fieldData = []) {
    const fields = {};

    for (const item of Array.isArray(fieldData) ? fieldData : []) {
      const name = String(item.name || item.key || item.question || "").trim();
      if (!name) continue;

      const values = Array.isArray(item.values)
        ? item.values
        : item.value != null
          ? [item.value]
          : [];
      const normalizedValues = values
        .map((value) => String(value || "").trim())
        .filter(Boolean);
      const key = this.normalizeKey(name);

      fields[key] = {
        name,
        values: normalizedValues,
        value: normalizedValues.join(", "),
      };
    }

    return fields;
  }

  static findField(fields, aliases = []) {
    for (const alias of aliases) {
      const key = this.normalizeKey(alias);
      if (fields[key]?.value) return fields[key].value;
    }

    return null;
  }

  static findFieldByKeyMatch(fields, predicate) {
    for (const [key, field] of Object.entries(fields)) {
      if (predicate(key, field) && field.value) return field.value;
    }

    return null;
  }

  static isValidEmail(value) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim());
  }

  static resolveDate(value) {
    if (value == null || value === "") return new Date();

    if (typeof value === "number") {
      const ms = value < 1000000000000 ? value * 1000 : value;
      const dt = new Date(ms);
      return Number.isNaN(dt.getTime()) ? new Date() : dt;
    }

    const dt = new Date(value);
    return Number.isNaN(dt.getTime()) ? new Date() : dt;
  }

  static buildCustomMessage(fields) {
    return Object.values(fields)
      .filter((field) => field.value)
      .map((field) => `${field.name}: ${field.value}`)
      .join("\n");
  }

  static buildLeadData(event = {}, leadDetails = {}) {
    const leadgenId = String(
      leadDetails.id || event.leadgen_id || event.id || "",
    ).trim();

    if (!leadgenId) throw new Error("ID do lead Facebook Ads ausente.");

    const fields = this.fieldDataToMap(leadDetails.field_data);
    const firstName = this.findField(fields, ["first_name", "primeiro_nome"]);
    const lastName = this.findField(fields, ["last_name", "sobrenome"]);
    const fullName =
      this.findField(fields, [
        "full_name",
        "name",
        "nome",
        "nome_completo",
        "seu_nome",
      ]) ||
      [firstName, lastName].filter(Boolean).join(" ").trim();
    const phone =
      this.findField(fields, [
        "phone_number",
        "phone",
        "telefone",
        "whatsapp",
        "celular",
        "numero_de_telefone",
      ]) || this.findFieldByKeyMatch(fields, (key) => key.includes("telefone"));
    const email = this.findField(fields, [
      "email",
      "email_address",
      "e_mail",
    ]);
    const vehicle =
      this.findField(fields, [
        "vehicle",
        "veiculo",
        "veiculo_interesse",
        "modelo",
        "carro",
      ]) ||
      this.findFieldByKeyMatch(
        fields,
        (key) =>
          key.includes("veiculo") ||
          key.includes("modelo") ||
          key.includes("carro"),
      ) ||
      leadDetails.ad_name ||
      leadDetails.campaign_name ||
      "Facebook Ads";
    const message = this.buildCustomMessage(fields);
    const emailRemetente = this.isValidEmail(email)
      ? String(email).trim()
      : `${leadgenId}@facebook-ads.local`;
    const nome = String(fullName || phone || "Lead Facebook Ads").trim();

    return {
      emailId: `${PLATFORM}-${leadgenId}`,
      remetente: nome,
      emailRemetente,
      assunto: `Lead Facebook Ads${leadDetails.campaign_name ? ` - ${leadDetails.campaign_name}` : ""}`,
      telefone: phone ? String(phone).replace(/\D/g, "") : null,
      nome,
      veiculoInteresse: String(vehicle || "Facebook Ads").trim(),
      mensagem: message,
      origem: PLATFORM,
      status: "novo",
      prioridade: String(process.env.META_LEAD_ADS_DEFAULT_PRIORITY || "media"),
      dataRecebimento: this.resolveDate(
        leadDetails.created_time || event.created_time || event.entry_time,
      ),
      metadata: {
        plataforma: PLATFORM,
        origem: PLATFORM,
        fonte: PLATFORM,
        tipoClassificacao: "lead",
        classificadoComo: "lead",
        facebookAds: {
          leadgenId,
          pageId: event.page_id || null,
          formId: leadDetails.form_id || event.form_id || null,
          adId: leadDetails.ad_id || event.ad_id || null,
          adName: leadDetails.ad_name || null,
          adsetId: leadDetails.adset_id || event.adgroup_id || null,
          adsetName: leadDetails.adset_name || null,
          campaignId: leadDetails.campaign_id || null,
          campaignName: leadDetails.campaign_name || null,
          isOrganic: leadDetails.is_organic ?? null,
          createdTime: leadDetails.created_time || event.created_time || null,
          rawEvent: event,
          rawFields: leadDetails.field_data || [],
        },
      },
      tags: [PLATFORM, "facebook"],
    };
  }

  static async ingestLeadgenEvent(event = {}, options = {}) {
    const leadDetails = await this.fetchLeadDetails(event);
    const eventWithDetails = {
      ...event,
      form_id: event.form_id || leadDetails.form_id,
    };
    const schema = this.resolveSchemaForEvent(
      eventWithDetails,
      options.schema,
    );
    const tenantId = options.tenantId || null;
    const leadData = this.buildLeadData(eventWithDetails, leadDetails);
    const lead = new Lead({
      ...leadData,
      _schema: schema,
      _tenantId: tenantId,
    });

    const savedLead = await lead.save({ schema, tenantId });

    if (!savedLead) {
      const existingLead = await Lead.findByEmailId(leadData.emailId, {
        schema,
        tenantId,
      });

      return {
        duplicate: true,
        emailId: leadData.emailId,
        lead: existingLead,
        schema,
      };
    }

    try {
      await LeadWorkflowService.onNewLead(savedLead, { schema, tenantId });
    } catch (workflowError) {
      console.error(
        `Falha ao iniciar workflow Facebook Ads lead ${savedLead.id}:`,
        workflowError.message,
      );
    }

    return {
      duplicate: false,
      emailId: leadData.emailId,
      lead: savedLead,
      schema,
    };
  }
}

module.exports = FacebookLeadAdsService;
