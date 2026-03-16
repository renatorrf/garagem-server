// services/WhatsAppService.js
const axios = require("axios");

class WhatsAppService {
  static get phoneNumberId() {
    return process.env.WA_PHONE_NUMBER_ID;
  }

  static get token() {
    return process.env.WA_ACCESS_TOKEN;
  }

  static api() {
    if (!this.phoneNumberId || !this.token) {
      throw new Error("WA_PHONE_NUMBER_ID / WA_ACCESS_TOKEN não configurados");
    }

    return axios.create({
      baseURL: `https://graph.facebook.com/v25.0/${this.phoneNumberId}`,
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
      },
      timeout: 15000,
    });
  }

  static normalizePhone(phone) {
    return (phone || "").replace(/\D/g, "");
  }

  static async sendLeadNotification({ to, lead }) {
    const sellerPhone = this.normalizePhone(to);
    const leadPhone = this.normalizePhone(lead.telefone || "");
    const waMe = lead.telefone ? this.toWaMe(lead.telefone) : null;

    const textLines = [
      `🔥 *LEAD NOVO* (${lead.origem || "Email"})`,
      `ID: *${lead.id}*`,
      lead.nome ? `👤 ${lead.nome}` : null,
      lead.veiculoInteresse ? `🚗 ${lead.veiculoInteresse}` : null,
      lead.telefone ? `📞 ${lead.telefone}` : null,
      waMe ? `👉 Abrir conversa: ${waMe}` : null,
      lead.assunto ? `🧾 ${lead.assunto}` : null,
    ].filter(Boolean);

    const payload = {
      messaging_product: "whatsapp",
      to: sellerPhone,
      type: "interactive",
      interactive: {
        type: "button",
        body: { text: textLines.join("\n") },
        action: {
          buttons: [
            {
              type: "reply",
              reply: { id: `claim:${lead.id}`, title: "✅ ASSUMIR" },
            },
            {
              type: "reply",
              reply: { id: `ignore:${lead.id}`, title: "❌ IGNORAR" },
            },
          ],
        },
      },
    };

    const resData = await this.postMessages(payload);
    return resData;
  }

  static async postMessages(payload) {
    try {
      const res = await this.postMessages(payload);
      return res.data;
    } catch (err) {
      const meta = err?.response?.data || null;
      const status = err?.response?.status || null;
      console.error("❌ WhatsApp API error:", status, JSON.stringify(meta));
      throw err;
    }
  }

  static async sendReminder({ to, lead, reminderCount }) {
    const sellerPhone = this.normalizePhone(to);
    const leadPhone = this.normalizePhone(lead.telefone || "");
    const waMe = lead.telefone ? this.toWaMe(lead.telefone) : null;

    const payload = {
      messaging_product: "whatsapp",
      to: sellerPhone,
      type: "interactive",
      interactive: {
        type: "button",
        body: {
          text:
            `⏱️ *LEMBRETE (${reminderCount})*\n` +
            `Não perca essa venda.\n` +
            `ID: *${lead.id}*\n` +
            (lead.nome ? `👤 ${lead.nome}\n` : "") +
            (lead.veiculoInteresse ? `🚗 ${lead.veiculoInteresse}\n` : "") +
            (lead.telefone ? `📞 ${lead.telefone}\n` : "") +
            (waMe ? `👉 ${waMe}\n` : ""),
        },
        action: {
          buttons: [
            {
              type: "reply",
              reply: { id: `claim:${lead.id}`, title: "✅ ASSUMIR" },
            },
            {
              type: "reply",
              reply: { id: `ignore:${lead.id}`, title: "❌ IGNORAR" },
            },
          ],
        },
      },
    };

    const resData = await this.postMessages(payload);
    return resData;
  }

  static toWaMe(phone) {
    let p = this.normalizePhone(phone);
    if (!p) return null;

    // remove zeros à esquerda
    p = p.replace(/^0+/, "");

    // se já começa com 55, mantém; senão adiciona
    if (!p.startsWith("55")) p = `55${p}`;

    // wa.me não aceita "+"
    return `https://wa.me/${p}`;
  }

  static async sendFeedbackRequest({ to, lead }) {
    const sellerPhone = this.normalizePhone(to);

    // LIST suporta 4 opções (botão rápido só 3)
    const payload = {
      messaging_product: "whatsapp",
      to: sellerPhone,
      type: "interactive",
      interactive: {
        type: "list",
        body: {
          text:
            `🧾 *Resultado da negociação*\n` +
            `ID: *${lead.id}*\n` +
            `${lead.nome || "Cliente"} - ${lead.telefone || "sem telefone"}\n` +
            `Como foi?`,
        },
        action: {
          button: "Selecionar",
          sections: [
            {
              title: "Escolha uma opção",
              rows: [
                { id: `outcome:WON:${lead.id}`, title: "✅ Fechamos com ele" },
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

    const resData = await this.postMessages(payload);
    return resData;
  }

  static toWaMe(phone) {
    let p = this.normalizePhone(phone);
    if (!p) return null;
    p = p.replace(/^0+/, "");
    if (!p.startsWith("55")) p = `55${p}`;
    return `https://wa.me/${p}`;
  }

  static async postMessages(payload) {
    try {
      const res = await this.api().post("/messages", payload);
      return res.data;
    } catch (err) {
      const meta = err?.response?.data || null;
      const status = err?.response?.status || null;
      console.error("❌ WhatsApp API error:", status, JSON.stringify(meta));
      throw err;
    }
  }
}

module.exports = WhatsAppService;
