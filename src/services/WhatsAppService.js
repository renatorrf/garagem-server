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

  static buildLeadBody(lead) {
    const plataforma =
      lead?.metadata?.plataforma ||
      lead?.metadata?.extras?.fonte ||
      lead?.origem ||
      "Email";

    return [
      `🚗 *Novo Lead - Next Car Uberlândia*`,
      `ID: *${lead.id}*`,
      `📍 Plataforma: ${String(plataforma).toUpperCase()}`,
      lead?.nome ? `👤 Cliente: ${lead.nome}` : null,
      lead?.telefone ? `📞 Telefone: ${lead.telefone}` : null,
      lead?.veiculoInteresse ? `🚙 Veículo: ${lead.veiculoInteresse}` : null,
      lead?.assunto ? `🧾 Assunto: ${lead.assunto}` : null,
      "",
      "Selecione quem vai atender:",
    ]
      .filter(Boolean)
      .join("\n");
  }

  static buildReminderBody(lead, reminderCount) {
    const plataforma =
      lead?.metadata?.plataforma ||
      lead?.metadata?.extras?.fonte ||
      lead?.origem ||
      "Email";

    return [
      `⏱️ *Lembrete de atendimento (${reminderCount})*`,
      `ID: *${lead.id}*`,
      `📍 Plataforma: ${String(plataforma).toUpperCase()}`,
      lead?.nome ? `👤 Cliente: ${lead.nome}` : null,
      lead?.telefone ? `📞 Telefone: ${lead.telefone}` : null,
      lead?.veiculoInteresse ? `🚙 Veículo: ${lead.veiculoInteresse}` : null,
      "",
      "Lead ainda sem atendimento iniciado.",
    ]
      .filter(Boolean)
      .join("\n");
  }

  static buildSellerButtons(leadId) {
    return [
      {
        type: "reply",
        reply: {
          id: `seller:gustavo:${leadId}`,
          title: "Gustavo",
        },
      },
      {
        type: "reply",
        reply: {
          id: `seller:lucas:${leadId}`,
          title: "Lucas",
        },
      },
      {
        type: "reply",
        reply: {
          id: `seller:luis:${leadId}`,
          title: "Luis",
        },
      },
    ];
  }

  static buildOpenConversationUrl(lead) {
    const phone = this.toWhatsAppPhone(lead?.telefone || "");
    if (!phone) return null;

    const text = encodeURIComponent(
      `Olá${lead?.nome ? ` ${lead.nome}` : ""}, tudo bem? Aqui é da Next Car Uberlândia. Recebemos seu interesse${lead?.veiculoInteresse ? ` em ${lead.veiculoInteresse}` : ""} e vou dar sequência no seu atendimento agora.`,
    );

    return `https://wa.me/${phone}?text=${text}`;
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

  static async sendLeadNotification({ to, lead, tenantId = null, schema = null }) {
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
          text: "🚗 Novo Lead - Next Car Uberlândia",
        },
        body: {
          text: this.buildLeadBody(lead),
        },
        footer: {
          text: "Atendimento comercial",
        },
        action: {
          buttons: this.buildSellerButtons(lead.id),
        },
      },
    };

    return this.postMessage(payload, { tenantId: tenantId || lead?._tenantId || null, schema: schema || lead?._schema || null });
  }

  static async sendReminder({ to, lead, reminderCount, tenantId = null, schema = null }) {
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
          text: `⏱️ Lembrete ${reminderCount}`,
        },
        body: {
          text: this.buildReminderBody(lead, reminderCount),
        },
        footer: {
          text: "Next Car Uberlândia",
        },
        action: {
          buttons: this.buildSellerButtons(lead.id),
        },
      },
    };

    return this.postMessage(payload, { tenantId: tenantId || lead?._tenantId || null, schema: schema || lead?._schema || null });
  }

  static async sendStartConversationButton({ to, lead, sellerName, tenantId = null, schema = null }) {
    const sellerPhone = this.toWhatsAppPhone(to);
    const waUrl = this.buildOpenConversationUrl(lead);

    if (!waUrl) {
      const payload = {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: sellerPhone,
        type: "text",
        text: {
          body:
            `✅ Atendimento iniciado por ${sellerName}.\n` +
            `Cliente: ${lead?.nome || "Lead sem nome"}\n` +
            `Veículo: ${lead?.veiculoInteresse || "Não informado"}\n` +
            `⚠️ Este lead está sem telefone válido para abrir conversa automática.`,
        },
      };

      return this.postMessage(payload, { tenantId: tenantId || lead?._tenantId || null, schema: schema || lead?._schema || null });
    }

    const payload = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: sellerPhone,
      type: "interactive",
      interactive: {
        type: "cta_url",
        header: {
          type: "text",
          text: "✅ Atendimento iniciado",
        },
        body: {
          text:
            `Lead assumido por ${sellerName}.\n` +
            `Cliente: ${lead?.nome || "Lead sem nome"}\n` +
            `Telefone: ${lead?.telefone || "Sem telefone"}\n\n` +
            `Clique abaixo para falar com o cliente.`,
        },
        footer: {
          text: "Next Car Uberlândia",
        },
        action: {
          name: "cta_url",
          parameters: {
            display_text: "Abrir conversa",
            url: waUrl,
          },
        },
      },
    };

    return this.postMessage(payload, { tenantId: tenantId || lead?._tenantId || null, schema: schema || lead?._schema || null });
  }

  static async sendFeedbackRequest({ to, lead, tenantId = null, schema = null }) {
    const sellerPhone = this.toWhatsAppPhone(to);

    const payload = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: sellerPhone,
      type: "interactive",
      interactive: {
        type: "list",
        body: {
          text:
            `🧾 *Resultado da negociação*\n` +
            `ID: *${lead.id}*\n` +
            `${lead.nome || "Cliente"} - ${lead.telefone || "sem telefone"}\n` +
            `Como foi o atendimento?`,
        },
        footer: {
          text: "Next Car Uberlândia",
        },
        action: {
          button: "Selecionar resultado",
          sections: [
            {
              title: "Escolha uma opção",
              rows: [
                {
                  id: `outcome:WON:${lead.id}`,
                  title: "✅ Fechamos com ele",
                },
                {
                  id: `outcome:CREDIT_DENIED:${lead.id}`,
                  title: "🏦 Crédito negado",
                },
                {
                  id: `outcome:NO_REPLY:${lead.id}`,
                  title: "📵 Não respondeu",
                },
                {
                  id: `outcome:IMPOSSIBLE:${lead.id}`,
                  title: "⛔ Negociação impossível",
                },
              ],
            },
          ],
        },
      },
    };

    return this.postMessage(payload, { tenantId: tenantId || lead?._tenantId || null, schema: schema || lead?._schema || null });
  }
}

module.exports = WhatsAppService;
