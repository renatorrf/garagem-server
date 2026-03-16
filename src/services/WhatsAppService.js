const axios = require('axios');

class WhatsAppService {
  static get phoneNumberId() {
    return process.env.WA_PHONE_NUMBER_ID;
  }

  static get token() {
    return process.env.WA_ACCESS_TOKEN;
  }

  static get graphVersion() {
    return process.env.WA_GRAPH_VERSION || 'v22.0';
  }

  static api() {
    if (!this.phoneNumberId || !this.token) {
      throw new Error('WA_PHONE_NUMBER_ID / WA_ACCESS_TOKEN não configurados');
    }

    return axios.create({
      baseURL: `https://graph.facebook.com/${this.graphVersion}/${this.phoneNumberId}`,
      headers: {
        Authorization: `Bearer ${this.token}`,
        'Content-Type': 'application/json',
      },
      timeout: 15000,
    });
  }

  static normalizePhone(phone) {
    return String(phone || '').replace(/\D/g, '');
  }

  static toWhatsAppPhone(phone) {
    const digits = this.normalizePhone(phone);

    if (!digits) return null;
    if (digits.startsWith('55')) return digits;

    return `55${digits}`;
  }

  static buildLeadText(lead) {
    const origem = lead?.origem || 'Email';
    const nome = lead?.nome || 'Lead sem nome';
    const telefone = lead?.telefone || 'Sem telefone';
    const veiculo = lead?.veiculoInteresse || lead?.veiculo || null;
    const assunto = lead?.assunto || null;

    return [
      `🚗 *Novo Lead - Next Car Uberlândia*`,
      `ID: *${lead.id}*`,
      `📍 Origem: ${origem}`,
      `👤 Cliente: ${nome}`,
      `📞 Telefone: ${telefone}`,
      veiculo ? `🚙 Veículo: ${veiculo}` : null,
      assunto ? `🧾 Observação: ${assunto}` : null,
      '',
      'Selecione abaixo quem vai iniciar o atendimento:',
    ]
      .filter(Boolean)
      .join('\n');
  }

  static buildReminderText(lead, reminderCount) {
    const nome = lead?.nome || 'Lead sem nome';
    const telefone = lead?.telefone || 'Sem telefone';
    const veiculo = lead?.veiculoInteresse || lead?.veiculo || null;

    return [
      `⏱️ *Lembrete de atendimento (${reminderCount})*`,
      `ID: *${lead.id}*`,
      `👤 Cliente: ${nome}`,
      `📞 Telefone: ${telefone}`,
      veiculo ? `🚙 Veículo: ${veiculo}` : null,
      '',
      'Ainda não houve atendimento registrado.',
      'Selecione abaixo quem vai iniciar o atendimento:',
    ]
      .filter(Boolean)
      .join('\n');
  }

  static buildSellerButtons(leadId) {
    return [
      {
        type: 'reply',
        reply: {
          id: `seller:gustavo:${leadId}`,
          title: 'Gustavo',
        },
      },
      {
        type: 'reply',
        reply: {
          id: `seller:lucas:${leadId}`,
          title: 'Lucas',
        },
      },
      {
        type: 'reply',
        reply: {
          id: `seller:luis:${leadId}`,
          title: 'Luis',
        },
      },
    ];
  }

  static buildOpenConversationUrl(lead) {
    const leadPhone = this.toWhatsAppPhone(lead?.telefone || '');

    if (!leadPhone) return null;

    const veiculo = lead?.veiculoInteresse || lead?.veiculo || 'veículo de interesse';
    const text = encodeURIComponent(
      `Olá, tudo bem? Sou da Next Car Uberlândia. Recebemos seu interesse no ${veiculo} e vou dar sequência no seu atendimento agora.`,
    );

    return `https://wa.me/${leadPhone}?text=${text}`;
  }

  static async postMessage(payload) {
    try {
      const res = await this.api().post('/messages', payload);
      return res.data;
    } catch (err) {
      const status = err?.response?.status;
      const data = err?.response?.data;
      console.error(
        '❌ WhatsApp API error:',
        status,
        JSON.stringify(data || {}, null, 2),
      );
      throw err;
    }
  }

  static async sendLeadNotification({ to, lead }) {
    const sellerPhone = this.toWhatsAppPhone(to);

    const payload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: sellerPhone,
      type: 'interactive',
      interactive: {
        type: 'button',
        header: {
          type: 'text',
          text: '🚗 Novo Lead - Next Car Uberlândia',
        },
        body: {
          text: this.buildLeadText(lead),
        },
        footer: {
          text: 'Atendimento comercial',
        },
        action: {
          buttons: this.buildSellerButtons(lead.id),
        },
      },
    };

    return this.postMessage(payload);
  }

  static async sendReminder({ to, lead, reminderCount }) {
    const sellerPhone = this.toWhatsAppPhone(to);

    const payload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: sellerPhone,
      type: 'interactive',
      interactive: {
        type: 'button',
        header: {
          type: 'text',
          text: `⏱️ Lembrete ${reminderCount}`,
        },
        body: {
          text: this.buildReminderText(lead, reminderCount),
        },
        footer: {
          text: 'Next Car Uberlândia',
        },
        action: {
          buttons: this.buildSellerButtons(lead.id),
        },
      },
    };

    return this.postMessage(payload);
  }

  static async sendStartConversationButton({ to, lead, sellerName }) {
    const sellerPhone = this.toWhatsAppPhone(to);
    const waUrl = this.buildOpenConversationUrl(lead);

    if (!waUrl) {
      throw new Error(`Lead ${lead.id} sem telefone válido para abrir conversa`);
    }

    const payload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: sellerPhone,
      type: 'interactive',
      interactive: {
        type: 'cta_url',
        header: {
          type: 'text',
          text: '✅ Atendimento iniciado',
        },
        body: {
          text:
            `Lead assumido por ${sellerName}.\n` +
            `Cliente: ${lead?.nome || 'Lead sem nome'}\n` +
            `Telefone: ${lead?.telefone || 'Sem telefone'}\n\n` +
            `Clique abaixo para iniciar a conversa com o cliente agora.`,
        },
        footer: {
          text: 'Next Car Uberlândia',
        },
        action: {
          name: 'cta_url',
          parameters: {
            display_text: 'Iniciar conversa agora',
            url: waUrl,
          },
        },
      },
    };

    return this.postMessage(payload);
  }

  static async sendFeedbackRequest({ to, lead }) {
    const sellerPhone = this.toWhatsAppPhone(to);

    const payload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: sellerPhone,
      type: 'interactive',
      interactive: {
        type: 'list',
        body: {
          text:
            `🧾 *Resultado da negociação*\n` +
            `ID: *${lead.id}*\n` +
            `${lead.nome || 'Cliente'} - ${lead.telefone || 'sem telefone'}\n` +
            `Como foi o atendimento?`,
        },
        footer: {
          text: 'Next Car Uberlândia',
        },
        action: {
          button: 'Selecionar resultado',
          sections: [
            {
              title: 'Escolha uma opção',
              rows: [
                {
                  id: `outcome:WON:${lead.id}`,
                  title: '✅ Fechamos com ele',
                },
                {
                  id: `outcome:CREDIT_DENIED:${lead.id}`,
                  title: '🏦 Crédito negado',
                },
                {
                  id: `outcome:NO_REPLY:${lead.id}`,
                  title: '📵 Não respondeu',
                },
                {
                  id: `outcome:IMPOSSIBLE:${lead.id}`,
                  title: '⛔ Negociação impossível',
                },
              ],
            },
          ],
        },
      },
    };

    return this.postMessage(payload);
  }
}

module.exports = WhatsAppService;