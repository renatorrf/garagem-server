const axios = require("axios");
const TenantIntegrationService = require("./TenantIntegrationService");

class WhatsAppService {
  static async getConfig(context = {}) {
    return TenantIntegrationService.getWhatsAppConfig(context);
  }

  static async api(context = {}) {
    const config = await this.getConfig(context);

    if (!config.phoneNumberId || !config.token) {
      throw new Error("WA_PHONE_NUMBER_ID / WA_ACCESS_TOKEN não configurados");
    }

    return axios.create({
      baseURL: `https://graph.facebook.com/${config.graphVersion}/${config.phoneNumberId}` ,
      headers: {
        Authorization: `Bearer ${config.token}` ,
        "Content-Type": "application/json",
      },
      timeout: 15000,
    });
  }


  static normalizePhone(phone) {
    return String(phone || "").replace(/\D/g, "");
  }

  static toWhatsAppPhone(phone) {
    const digits = this.normalizePhone(phone);
    if (!digits) return null;
    if (digits.startsWith("55")) return digits;
    return `55${digits}`;
  }

  static async postMessage(payload, context = {}) {
    try {
      const api = await this.api(context);
      const res = await api.post("/messages", payload);
      return res.data;
    } catch (err) {
      const status = err?.response?.status;
      const data = err?.response?.data;
      console.error(
        "❌ WhatsApp API error:",
        status,
        JSON.stringify(data || {}, null, 2),
      );
      throw err;
    }
  }

  static async sendText({ to, text, tenantId = null, schema = null }) {
    const sellerPhone = this.normalizePhone(to);

    const payload = {
      messaging_product: "whatsapp",
      to: sellerPhone,
      type: "text",
      text: {
        body: text,
      },
    };

    const api = await this.api({ tenantId, schema });
    const res = await api.post("/messages", payload);
    return res.data;
  }

  static buildCleanLeadData(lead) {
    const plataforma =
      lead?.metadata?.plataforma ||
      lead?.metadata?.extras?.fonte ||
      lead?.origem ||
      "Email";

    return {
      id: String(lead?.id || "sem-id"),
      origem: String(plataforma || "Email").toUpperCase(),
      cliente: lead?.nome || "Não informado",
      telefone: lead?.telefone || "",
      veiculo: lead?.veiculoInteresse || "Não informado",
      mensagem: lead?.assunto || "Novo lead recebido.",
    };
  }

  static buildLeadStartAttendanceBody(lead) {
    const data = this.buildCleanLeadData(lead);

    return [
      "*Novo lead - Next Car Uberlandia*",
      `ID: *${data.id}*`,
      `Origem: ${data.origem}`,
      `Cliente: ${data.cliente}`,
      data.telefone ? `Telefone: ${data.telefone}` : null,
      `Veiculo: ${data.veiculo}`,
      `Mensagem: ${data.mensagem}`,
      "",
      "Toque em *Iniciar atendimento* para assumir este lead.",
    ]
      .filter(Boolean)
      .join("\n");
  }

  static buildLeadStartAttendanceButtons(leadId) {
    return [
      {
        type: "reply",
        reply: {
          id: `lead:start-attendance:${leadId}`,
          title: "Iniciar atendimento",
        },
      },
    ];
  }

  static async sendLeadStartAttendanceNotification({
    to,
    lead,
    tenantId = null,
    schema = null,
  }) {
    const sellerPhone = this.toWhatsAppPhone(to);

    const payload = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: sellerPhone,
      type: "interactive",
      interactive: {
        type: "button",
        header: {
          type: "text",
          text: "Novo lead",
        },
        body: {
          text: this.buildLeadStartAttendanceBody(lead),
        },
        footer: {
          text: "Next Car Uberlandia",
        },
        action: {
          buttons: this.buildLeadStartAttendanceButtons(lead.id),
        },
      },
    };

    return this.postMessage(payload, {
      tenantId: tenantId || lead?._tenantId || null,
      schema: schema || lead?._schema || null,
    });
  }
}

module.exports = WhatsAppService;
