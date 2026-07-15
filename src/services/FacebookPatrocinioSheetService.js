const axios = require("axios");
const crypto = require("crypto");
const Lead = require("../models/leads");
const LeadWorkflowService = require("./LeadWorkflowService");
const { resolveSchemaValue } = require("../utils/tenantContext");

const PLATFORM = "facebook-patrocinio";
const DEFAULT_SHEET_URL =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vQfkm6ekG6Vq6xSbchTONHWB9eHTIsS0TJzGUyC4gb_eNEYtWHcUD6iCrEvbMEGqB38ckwAu0JOWdoa/pubhtml";

class FacebookPatrocinioSheetService {
  constructor() {
    this.timer = null;
    this.running = false;
    this.lastRun = null;
    this.lastResult = null;
    this.lastError = null;
  }

  start() {
    const autoSync =
      String(process.env.FACEBOOK_PATROCINIO_AUTO_SYNC || "")
        .trim()
        .toLowerCase() === "true";

    if (!autoSync || this.timer) return;

    const intervalSec = Math.max(
      60,
      Number(process.env.FACEBOOK_PATROCINIO_SYNC_INTERVAL_SEC || 120) || 120,
    );

    this.timer = setInterval(() => {
      this.sync().catch((error) => {
        this.lastError = error.message;
        console.error("Erro no sync facebook-patrocinio:", error.message);
      });
    }, intervalSec * 1000);

    this.sync().catch((error) => {
      this.lastError = error.message;
      console.error("Erro no sync inicial facebook-patrocinio:", error.message);
    });

    console.log(`FacebookPatrocinioSheetService iniciado (${intervalSec}s).`);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  getStatus() {
    return {
      platform: PLATFORM,
      configured: Boolean(this.resolveSheetUrl()),
      autoSync:
        String(process.env.FACEBOOK_PATROCINIO_AUTO_SYNC || "")
          .trim()
          .toLowerCase() === "true",
      running: this.running,
      lastRun: this.lastRun,
      lastResult: this.lastResult,
      lastError: this.lastError,
    };
  }

  resolveSheetUrl() {
    return String(
      process.env.FACEBOOK_PATROCINIO_SHEET_URL || DEFAULT_SHEET_URL,
    ).trim();
  }

  buildCsvUrl(sheetUrl = this.resolveSheetUrl()) {
    if (!sheetUrl) {
      throw new Error("FACEBOOK_PATROCINIO_SHEET_URL nao configurada.");
    }

    const parsed = new URL(sheetUrl);

    if (parsed.pathname.includes("/pub")) {
      parsed.pathname = parsed.pathname.replace(/\/pubhtml$/, "/pub");
      parsed.searchParams.set("output", "csv");
      return parsed.toString();
    }

    const match = parsed.pathname.match(/\/spreadsheets\/d\/([^/]+)/);

    if (!match) {
      throw new Error("URL da planilha Google invalida.");
    }

    const spreadsheetId = match[1];
    const gid =
      parsed.searchParams.get("gid") ||
      String(process.env.FACEBOOK_PATROCINIO_SHEET_GID || "0").trim() ||
      "0";

    return `https://docs.google.com/spreadsheets/d/${spreadsheetId}/export?format=csv&gid=${encodeURIComponent(gid)}`;
  }

  async fetchCsv() {
    const timeout = Number(process.env.FACEBOOK_PATROCINIO_TIMEOUT_MS || 20000);
    const response = await axios.get(this.buildCsvUrl(), {
      responseType: "text",
      timeout: Number.isFinite(timeout) ? timeout : 20000,
      transformResponse: [(data) => data],
      validateStatus: (status) => status >= 200 && status < 400,
    });

    return String(response.data || "");
  }

  parseCsv(text) {
    const rows = [];
    let row = [];
    let cell = "";
    let inQuotes = false;

    for (let index = 0; index < text.length; index += 1) {
      const char = text[index];
      const next = text[index + 1];

      if (char === '"') {
        if (inQuotes && next === '"') {
          cell += '"';
          index += 1;
        } else {
          inQuotes = !inQuotes;
        }
        continue;
      }

      if (char === "," && !inQuotes) {
        row.push(cell);
        cell = "";
        continue;
      }

      if ((char === "\n" || char === "\r") && !inQuotes) {
        if (char === "\r" && next === "\n") index += 1;
        row.push(cell);
        rows.push(row);
        row = [];
        cell = "";
        continue;
      }

      cell += char;
    }

    row.push(cell);
    rows.push(row);

    return rows.filter((items) =>
      items.some((item) => String(item || "").trim() !== ""),
    );
  }

  normalizeKey(value) {
    return String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");
  }

  csvToObjects(csv) {
    const parsedRows = this.parseCsv(csv);
    if (parsedRows.length < 2) return [];

    const headers = parsedRows[0].map((header, index) => {
      const normalized = this.normalizeKey(header);
      return normalized || `coluna_${index + 1}`;
    });

    return parsedRows.slice(1).map((row, rowIndex) => {
      const output = {
        _rowNumber: rowIndex + 2,
        _raw: {},
      };

      headers.forEach((key, index) => {
        const value = String(row[index] || "").trim();
        output[key] = value;
        output._raw[key] = value;
      });

      return output;
    });
  }

  firstValue(row, aliases) {
    for (const alias of aliases) {
      const key = this.normalizeKey(alias);
      if (row[key]) return row[key];
    }

    return null;
  }

  firstValueByMatch(row, matcher) {
    for (const [key, value] of Object.entries(row)) {
      if (key.startsWith("_")) continue;
      if (value && matcher(key)) return value;
    }

    return null;
  }

  resolveDate(value) {
    if (!value) return new Date();

    const trimmed = String(value).trim();
    const brDate = trimmed.match(
      /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/,
    );

    if (brDate) {
      const year = Number(
        brDate[3].length === 2 ? `20${brDate[3]}` : brDate[3],
      );
      const parsed = new Date(
        year,
        Number(brDate[2]) - 1,
        Number(brDate[1]),
        Number(brDate[4] || 0),
        Number(brDate[5] || 0),
        Number(brDate[6] || 0),
      );

      if (!Number.isNaN(parsed.getTime())) return parsed;
    }

    const parsed = new Date(trimmed);
    return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
  }

  rowHash(row) {
    return crypto
      .createHash("sha1")
      .update(JSON.stringify(row._raw || row))
      .digest("hex")
      .slice(0, 16);
  }

  buildMessage(row) {
    return Object.entries(row._raw || {})
      .filter(([, value]) => String(value || "").trim())
      .map(([key, value]) => `${key}: ${value}`)
      .join("\n");
  }

  buildLeadData(row) {
    const externalId =
      this.firstValue(row, [
        "id",
        "lead_id",
        "leadgen_id",
        "facebook_lead_id",
        "meta_lead_id",
      ]) || this.rowHash(row);
    const nome =
      this.firstValue(row, [
        "full_name",
        "nome",
        "name",
        "nome_completo",
        "cliente",
        "lead",
      ]) || "Lead Facebook Patrocinio";
    const telefone =
      this.firstValue(row, [
        "whatsapp_number",
        "telefone",
        "phone",
        "phone_number",
        "whatsapp",
        "celular",
        "numero_de_telefone",
      ]) || this.firstValueByMatch(row, (key) => key.includes("telefone"));
    const email =
      this.firstValue(row, ["email", "e_mail", "email_address"]) || null;
    const veiculo =
      this.firstValue(row, [
        "veiculo",
        "veiculo_interesse",
        "vehicle",
        "modelo",
        "carro",
        "produto",
        "ad_name",
        "anuncio",
      ]) ||
      this.firstValueByMatch(
        row,
        (key) =>
          key.includes("veiculo") ||
          key.includes("modelo") ||
          key.includes("carro") ||
          key.includes("anuncio"),
      ) ||
      "Facebook Patrocinio";
    const createdAt =
      this.firstValue(row, [
        "created_time",
        "data",
        "timestamp",
        "carimbo_de_data_hora",
        "data_de_criacao",
        "submitted_at",
      ]) || null;
    const campaignName =
      this.firstValue(row, ["campaign_name", "campanha"]) || null;
    const adName = this.firstValue(row, ["ad_name", "anuncio"]) || null;
    const phoneDigits = String(telefone || "").replace(/\D/g, "");
    const emailValue =
      email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email).trim())
        ? String(email).trim()
        : `${String(externalId).replace(/[^a-zA-Z0-9_.-]/g, "_")}@facebook-patrocinio.local`;

    return {
      emailId: `${PLATFORM}-${externalId}`,
      remetente: String(nome || phoneDigits || "Lead Facebook Patrocinio"),
      emailRemetente: emailValue,
      assunto: PLATFORM,
      telefone: phoneDigits || null,
      nome: String(nome || phoneDigits || "Lead Facebook Patrocinio"),
      veiculoInteresse: String(veiculo || adName || "Facebook Patrocinio"),
      mensagem: this.buildMessage(row),
      origem: PLATFORM,
      status: "novo",
      prioridade: String(
        process.env.FACEBOOK_PATROCINIO_DEFAULT_PRIORITY || "media",
      ),
      dataRecebimento: this.resolveDate(createdAt),
      metadata: {
        plataforma: PLATFORM,
        origem: PLATFORM,
        fonte: PLATFORM,
        tipoClassificacao: "lead",
        classificadoComo: "lead",
        facebookPatrocinio: {
          externalId,
          rowNumber: row._rowNumber,
          sheetUrl: this.resolveSheetUrl(),
          leadStatus: this.firstValue(row, ["lead_status", "status"]) || null,
          platform: this.firstValue(row, ["platform"]) || null,
          formId: this.firstValue(row, ["form_id"]) || null,
          formName: this.firstValue(row, ["form_name"]) || null,
          adId: this.firstValue(row, ["ad_id"]) || null,
          adName,
          adsetId: this.firstValue(row, ["adset_id"]) || null,
          adsetName: this.firstValue(row, ["adset_name"]) || null,
          campaignId: this.firstValue(row, ["campaign_id"]) || null,
          campaignName,
          intent: this.firstValue(row, ["intencao", "intent"]) || null,
          region: this.firstValue(row, ["regiao", "region"]) || null,
          raw: row._raw,
        },
      },
      tags: [PLATFORM, "facebook"],
    };
  }

  shouldImportLead(leadData) {
    return Boolean(
      leadData.telefone ||
        (leadData.emailRemetente &&
          !String(leadData.emailRemetente).endsWith(
            "@facebook-patrocinio.local",
          )),
    );
  }

  async loadRows() {
    const csv = await this.fetchCsv();
    return this.csvToObjects(csv);
  }

  resolveSchema(schema) {
    return resolveSchemaValue(
      schema ||
        process.env.FACEBOOK_PATROCINIO_SCHEMA ||
        process.env.SCHEMA_PADRAO,
    );
  }

  async preview({ schema, tenantId, limit = 10 } = {}) {
    const rows = await this.loadRows();
    const preview = rows.slice(0, limit).map((row) => {
      const lead = this.buildLeadData(row);
      return {
        emailId: lead.emailId,
        nome: lead.nome,
        telefone: lead.telefone,
        emailRemetente: lead.emailRemetente,
        veiculoInteresse: lead.veiculoInteresse,
        origem: lead.origem,
        plataforma: lead.metadata.plataforma,
        rowNumber: lead.metadata.facebookPatrocinio.rowNumber,
      };
    });

    return {
      schema: this.resolveSchema(schema),
      tenantId: tenantId || null,
      totalRows: rows.length,
      preview,
    };
  }

  async sync({ schema, tenantId } = {}) {
    if (this.running) {
      throw new Error("Sincronizacao facebook-patrocinio ja em andamento.");
    }

    this.running = true;
    this.lastRun = new Date().toISOString();
    this.lastError = null;

    const result = {
      platform: PLATFORM,
      schema: this.resolveSchema(schema),
      tenantId: tenantId || null,
      totalRows: 0,
      imported: 0,
      duplicates: 0,
      skipped: 0,
      errors: [],
    };

    try {
      const rows = await this.loadRows();
      result.totalRows = rows.length;

      for (const row of rows) {
        try {
          const leadData = this.buildLeadData(row);

          if (!this.shouldImportLead(leadData)) {
            result.skipped += 1;
            continue;
          }

          const lead = new Lead({
            ...leadData,
            _schema: result.schema,
            _tenantId: result.tenantId,
          });
          const savedLead = await lead.save({
            schema: result.schema,
            tenantId: result.tenantId,
          });

          if (!savedLead) {
            result.duplicates += 1;
            continue;
          }

          result.imported += 1;

          try {
            await LeadWorkflowService.onNewLead(savedLead, {
              schema: result.schema,
              tenantId: result.tenantId,
            });
          } catch (workflowError) {
            result.errors.push({
              rowNumber: row._rowNumber,
              emailId: leadData.emailId,
              error: `workflow: ${workflowError.message}`,
            });
          }
        } catch (rowError) {
          result.errors.push({
            rowNumber: row._rowNumber,
            error: rowError.message,
          });
        }
      }

      this.lastResult = result;
      return result;
    } catch (error) {
      this.lastError = error.message;
      throw error;
    } finally {
      this.running = false;
    }
  }
}

module.exports = new FacebookPatrocinioSheetService();
