const db = require("../config/database");
const Lead = require("../models/leads");
const WhatsAppService = require("./WhatsAppService");
const TenantIntegrationService = require("./TenantIntegrationService");

class LeadWorkflowService {
  static start() {
    console.log("LeadWorkflowService iniciado (lead dispatch)");
    return;
  }

  static async cfg(context = {}) {
    const waConfig = await TenantIntegrationService.getWhatsAppConfig(context);

    return {
      sellerPhone:
        waConfig.sellerPhone || process.env.WA_SELLER_PHONE || "5534991023869",
      tenantId: waConfig.tenantId || context.tenantId || null,
      schema:
        waConfig.schema ||
        context.schema ||
        process.env.SCHEMA_PADRAO ||
        "nextcar",
    };
  }

  static getWaMeta(lead) {
    return lead?.metadata?.wa || {};
  }

  static normalizeLeadText(value) {
    return String(value || "")
      .trim()
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");
  }

  static isEmailOrigin(lead) {
    const candidates = [
      lead?.origem,
      lead?.metadata?.origem,
      lead?.metadata?.plataforma,
      lead?.metadata?.extras?.fonte,
      lead?.metadata?.source,
      lead?.metadata?.canal,
    ];

    return candidates.some((value) => {
      const normalized = this.normalizeLeadText(value);
      return normalized === "email" || normalized.startsWith("email");
    });
  }

  static async updateLeadWa(lead, waPatch, leadPatch = {}) {
    const currentWa = this.getWaMeta(lead);

    lead.metadata = {
      ...(lead.metadata || {}),
      wa: {
        ...currentWa,
        ...waPatch,
      },
    };

    const payload = {
      metadata: lead.metadata,
      ...leadPatch,
    };

    return lead.update(payload, {
      schema: lead._schema,
      tenantId: lead._tenantId,
    });
  }

  static async onChatEvent(lead, context = {}) {
    const cfg = await this.cfg(context);

    const mensagem =
      `💬 *Nova mensagem no chat da OLX!*\n\n` +
      `Tem cliente aguardando resposta no chat.\n\n` +
      `👉 Acesse agora:\nhttps://chat.olx.com.br/`;

    await WhatsAppService.sendText({
      to: cfg.sellerPhone,
      text: mensagem,
      tenantId: cfg.tenantId,
      schema: cfg.schema,
    });

    console.log(`💬 Alerta de chat OLX enviado para lead ${lead.id}`);
  }

  static async onNewLead(savedLead, context = {}) {
    const cfg = await this.cfg(context);

    if (this.isEmailOrigin(savedLead)) {
      console.log(
        `📧 Lead ${savedLead.id} com origem Email: sem disparo de WhatsApp.`,
      );
      return savedLead;
    }

    let waResp = null;
    try {
      waResp = await WhatsAppService.sendLeadStartAttendanceNotification({
        to: cfg.sellerPhone,
        lead: savedLead,
        tenantId: cfg.tenantId,
        schema: cfg.schema,
      });
    } catch (e) {
      console.error(
        `⚠️ Falha ao enviar lead ${savedLead.id} com botao de atendimento:`,
        e.message,
      );
    }

    const notifyWamid = waResp?.messages?.[0]?.id || null;
    const lead = await Lead.findById(savedLead.id, {
      schema: context.schema || savedLead._schema,
      tenantId: context.tenantId || savedLead._tenantId,
    });

    if (!lead) return null;

    await this.updateLeadWa(lead, {
      dispatchPhone: cfg.sellerPhone,
      notifyWamid,
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
      messageStatuses: [],
    });

    if (notifyWamid) {
      console.log(
        `📲 Lead ${savedLead.id} notificado no WhatsApp (${cfg.sellerPhone})`,
      );
    } else {
      console.log(
        `📲 Lead ${savedLead.id} processado para WhatsApp (${cfg.sellerPhone}) sem envio confirmado`,
      );
    }

    return lead;
  }

  static async claimLead(leadId, from = null, context = {}) {
    const lead = await Lead.findById(leadId, {
      schema: context.schema,
      tenantId: context.tenantId,
    });
    if (!lead) return null;

    const now = new Date();
    const sellerMarker = from || "nextcar";

    return this.updateLeadWa(
      lead,
      {
        claimedAt: now.toISOString(),
        attendanceStartedAt: now.toISOString(),
        openConversationAt: now.toISOString(),
        sellerSelectedBy: sellerMarker,
        sellerKey: null,
        sellerId: null,
        sellerName: null,
        sellerSelectedAt: null,
        estimatedEndAt: null,
        nextReminderAt: null,
      },
      {
        status: "contatado",
        dataContato: now,
      },
    );
  }

  static async recordMessageStatus(
    { wamid, status, timestamp, recipientId, raw },
    context = {},
  ) {
    if (!wamid) return null;

    const cfg = await this.cfg(context);
    const q = `
      SELECT *
      FROM ${Lead.resolveTableName({ schema: cfg.schema })}
      WHERE deleted_at IS NULL
        AND metadata->'wa'->>'notifyWamid' = $1
      ORDER BY data_recebimento DESC
      LIMIT 1
    `;

    const rs = await db.query(q, [wamid]);

    if (!rs.rows?.length) {
      if (process.env.WA_LOG_UNMATCHED_STATUS === "true") {
        console.warn(`Status WhatsApp sem lead vinculado para o wamid ${wamid}`);
      }
      return null;
    }

    const lead = new Lead({
      ...rs.rows[0],
      _schema: cfg.schema,
      _tenantId: cfg.tenantId,
    });
    const wa = this.getWaMeta(lead);
    const statuses = Array.isArray(wa.messageStatuses)
      ? wa.messageStatuses
      : [];

    const nextStatuses = [
      ...statuses,
      {
        wamid,
        status,
        timestamp,
        recipientId,
        raw,
      },
    ].slice(-20);

    const shouldMarkAsRead = status === "read" && lead.status !== "contatado";
    const leadPatch =
      shouldMarkAsRead
        ? {
            status: "lido",
            dataContato: timestamp
              ? new Date(Number(timestamp) * 1000)
              : new Date(),
          }
        : {};

    return this.updateLeadWa(
      lead,
      {
        lastStatus: status,
        lastStatusAt: timestamp
          ? new Date(Number(timestamp) * 1000).toISOString()
          : new Date().toISOString(),
        messageStatuses: nextStatuses,
        closedAt: wa.closedAt || null,
        nextReminderAt: status === "read" ? null : wa.nextReminderAt || null,
      },
      leadPatch,
    );
  }
}

module.exports = LeadWorkflowService;
