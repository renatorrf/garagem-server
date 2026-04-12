const cron = require("node-cron");
const db = require("../config/database");
const Lead = require("../models/leads");
const WhatsAppService = require("./WhatsAppService");
const TenantIntegrationService = require("./TenantIntegrationService");

class LeadWorkflowService {
  static start() {
    cron.schedule("*/1 * * * *", async () => {
      try {
        await this.processRemindersTick();
      } catch (e) {
        console.error("❌ ReminderTick:", e.message);
      }
    });

    cron.schedule("*/5 * * * *", async () => {
      try {
        await this.processFeedbackTick();
      } catch (e) {
        console.error("❌ FeedbackTick:", e.message);
      }
    });

    console.log("✅ LeadWorkflowService iniciado (reminders + feedback)");
  }

  static async cfg(context = {}) {
    const waConfig = await TenantIntegrationService.getWhatsAppConfig(context);

    return {
      sellerPhone: waConfig.sellerPhone || process.env.WA_SELLER_PHONE || "5534991023869",
      reminderIntervalSec: parseInt(
        process.env.LEAD_REMINDER_INTERVAL_SEC || "120",
        10,
      ),
      reminderMax: parseInt(process.env.LEAD_REMINDER_MAX || "5", 10),
      feedbackDelaySec: parseInt(
        process.env.LEAD_FEEDBACK_DELAY_SEC || "3600",
        10,
      ),
      attendanceEstimateSec: parseInt(
        process.env.LEAD_ATTENDANCE_ESTIMATE_SEC || "1800",
        10,
      ),
      tenantId: waConfig.tenantId || context.tenantId || null,
      schema: waConfig.schema || context.schema || process.env.SCHEMA_PADRAO || "nextcar",
    };
  }

  static sellerCatalog() {
    return {
      gustavo: { id: 1, key: "gustavo", name: "Gustavo" },
      lucas: { id: 2, key: "lucas", name: "Lucas" },
      luis: { id: 3, key: "luis", name: "Luis" },
    };
  }

  static outcomeMap(outcome) {
    const map = {
      WON: "vendido",
      CREDIT_DENIED: "perdido",
      NO_REPLY: "perdido",
      IMPOSSIBLE: "perdido",
    };

    return map[outcome] || "perdido";
  }

  static getWaMeta(lead) {
    return lead?.metadata?.wa || {};
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

    return lead.update(payload, { schema: lead._schema, tenantId: lead._tenantId });
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
    const now = new Date();
    const nextReminderAt = new Date(
      now.getTime() + cfg.reminderIntervalSec * 1000,
    );

    const waResp = await WhatsAppService.sendLeadNotification({
      to: cfg.sellerPhone,
      lead: savedLead,
      tenantId: cfg.tenantId,
      schema: cfg.schema,
    });

    const notifyWamid = waResp?.messages?.[0]?.id || null;
    const lead = await Lead.findById(savedLead.id, { schema: context.schema || savedLead._schema, tenantId: context.tenantId || savedLead._tenantId });

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
      nextReminderAt: nextReminderAt.toISOString(),
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

    console.log(
      `📲 Lead ${savedLead.id} notificado no WhatsApp (${cfg.sellerPhone})`,
    );

    return lead;
  }

  static async processRemindersTick(context = {}) {
    const cfg = await this.cfg(context);

    const q = `
      SELECT *
      FROM ${Lead.resolveTableName({ schema: cfg.schema })}
      WHERE deleted_at IS NULL
        AND status = 'novo'
        AND (metadata->'wa'->>'claimedAt') IS NULL
        AND COALESCE((metadata->'wa'->>'reminderCount')::int, 0) < $1
        AND (metadata->'wa'->>'nextReminderAt') IS NOT NULL
        AND (metadata->'wa'->>'nextReminderAt')::timestamptz <= now()
      ORDER BY data_recebimento ASC
      LIMIT 50
    `;

    const rs = await db.query(q, [cfg.reminderMax]);

    for (const row of rs.rows) {
      const lead = new Lead({ ...row, _schema: cfg.schema, _tenantId: cfg.tenantId });
      const wa = this.getWaMeta(lead);
      const reminderCount = (parseInt(wa.reminderCount || 0, 10) || 0) + 1;

      const waResp = await WhatsAppService.sendReminder({
        to: cfg.sellerPhone,
        lead,
        reminderCount,
        tenantId: cfg.tenantId,
        schema: cfg.schema,
      });

      const lastReminderAt = new Date();
      const nextReminderAt = new Date(
        lastReminderAt.getTime() + cfg.reminderIntervalSec * 1000,
      );

      await this.updateLeadWa(lead, {
        lastReminderWamid: waResp?.messages?.[0]?.id || null,
        reminderCount,
        lastReminderAt: lastReminderAt.toISOString(),
        nextReminderAt: nextReminderAt.toISOString(),
      });

      console.log(`🔔 Reminder ${reminderCount} para lead ${lead.id}`);
    }
  }

  static async processFeedbackTick(context = {}) {
    const cfg = await this.cfg(context);
    const delayMs = cfg.feedbackDelaySec * 1000;

    const q = `
      SELECT *
      FROM ${Lead.resolveTableName({ schema: cfg.schema })}
      WHERE deleted_at IS NULL
        AND status IN ('contatado','novo')
        AND COALESCE(
          (metadata->'wa'->>'attendanceStartedAt')::timestamptz,
          (metadata->'wa'->>'claimedAt')::timestamptz
        ) IS NOT NULL
        AND (metadata->'wa'->>'feedbackRequestedAt') IS NULL
        AND (
          COALESCE(
            (metadata->'wa'->>'attendanceStartedAt')::timestamptz,
            (metadata->'wa'->>'claimedAt')::timestamptz
          ) + ($1::text || ' milliseconds')::interval
        ) <= now()
      ORDER BY data_recebimento ASC
      LIMIT 50
    `;

    const rs = await db.query(q, [String(delayMs)]);

    for (const row of rs.rows) {
      const lead = new Lead({ ...row, _schema: cfg.schema, _tenantId: cfg.tenantId });
      const waResp = await WhatsAppService.sendFeedbackRequest({
        to: cfg.sellerPhone,
        lead,
        tenantId: cfg.tenantId,
        schema: cfg.schema,
      });

      await this.updateLeadWa(lead, {
        feedbackRequestedAt: new Date().toISOString(),
        feedbackRequestWamid: waResp?.messages?.[0]?.id || null,
      });

      console.log(`🧾 Feedback solicitado para lead ${lead.id}`);
    }
  }

  static async claimLead(leadId, from = null, context = {}) {
    const lead = await Lead.findById(leadId, { schema: context.schema, tenantId: context.tenantId });
    if (!lead) return null;

    const now = new Date();

    return this.updateLeadWa(
      lead,
      {
        claimedAt: now.toISOString(),
        sellerSelectedBy: from,
      },
      {
        status: "contatado",
        dataContato: now,
      },
    );
  }

  static async assignSeller({ leadId, sellerKey, sellerId, sellerName, from }, context = {}) {
    const cfg = await this.cfg(context);
    const lead = await Lead.findById(leadId, { schema: context.schema, tenantId: context.tenantId });
    if (!lead) return null;

    const now = new Date();
    const estimatedEndAt = new Date(
      now.getTime() + cfg.attendanceEstimateSec * 1000,
    );

    const updated = await this.updateLeadWa(
      lead,
      {
        sellerKey,
        sellerId,
        sellerName,
        sellerSelectedBy: from,
        sellerSelectedAt: now.toISOString(),
        claimedAt: now.toISOString(),
        attendanceStartedAt: now.toISOString(),
        estimatedEndAt: estimatedEndAt.toISOString(),
        nextReminderAt: null,
      },
      {
        status: "contatado",
        dataContato: now,
      },
    );

    try {
      const waResp = await WhatsAppService.sendStartConversationButton({
        to: cfg.sellerPhone,
        lead,
        sellerName,
      });

      await this.updateLeadWa(lead, {
        openConversationWamid: waResp?.messages?.[0]?.id || null,
      });
    } catch (e) {
      console.error(
        `⚠️ Falha ao enviar CTA de início de conversa para lead ${leadId}:`,
        e.message,
      );
    }

    return updated;
  }

  static async ignoreLead(leadId, from = null, context = {}) {
    const lead = await Lead.findById(leadId, { schema: context.schema, tenantId: context.tenantId });
    if (!lead) return null;

    return this.updateLeadWa(
      lead,
      {
        sellerSelectedBy: from,
        claimedAt: "IGNORED",
        closedAt: new Date().toISOString(),
      },
      {
        status: "perdido",
      },
    );
  }

  static async setOutcome({ leadId, outcome }, context = {}) {
    const lead = await Lead.findById(leadId);
    if (!lead) return null;

    const now = new Date();
    const newStatus = this.outcomeMap(outcome);

    return this.updateLeadWa(
      lead,
      {
        outcome,
        closedAt: now.toISOString(),
      },
      {
        status: newStatus,
      },
    );
  }

  static async recordMessageStatus({
    wamid,
    status,
    timestamp,
    recipientId,
    raw,
  }) {
    const q = `
      SELECT *
      FROM ${Lead.tableName}
      WHERE deleted_at IS NULL
        AND (
          metadata->'wa'->>'notifyWamid' = $1
          OR metadata->'wa'->>'lastReminderWamid' = $1
          OR metadata->'wa'->>'feedbackRequestWamid' = $1
          OR metadata->'wa'->>'openConversationWamid' = $1
        )
      ORDER BY data_recebimento DESC
      LIMIT 1
    `;

    const rs = await db.query(q, [wamid]);

    if (!rs.rows?.length) {
      console.warn(`⚠️ Nenhum lead encontrado para o wamid ${wamid}`);
      return null;
    }

    const lead = new Lead(rs.rows[0]);
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

    return this.updateLeadWa(lead, {
      lastStatus: status,
      lastStatusAt: timestamp
        ? new Date(Number(timestamp) * 1000).toISOString()
        : new Date().toISOString(),
      messageStatuses: nextStatuses,
    });
  }
}

module.exports = LeadWorkflowService;
