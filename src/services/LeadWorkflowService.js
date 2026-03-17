const cron = require("node-cron");
const db = require("../config/database");
const Lead = require("../models/leads");
const WhatsAppService = require("./WhatsAppService");

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

  static cfg() {
    return {
      sellerPhone: process.env.WA_SELLER_PHONE || "5534991023869",
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
    };
  }

  static sellerCatalog() {
    return {
      lucas: {
        key: "lucas",
        id: 1,
        name: "LUCAS FELIPE CAMPOS",
        whatsapp: process.env.SELLER_LUCAS_WHATSAPP || null,
      },
      gustavo: {
        key: "gustavo",
        id: 2,
        name: "GUSTAVO ADRIANO SILVA",
        whatsapp: process.env.SELLER_GUSTAVO_WHATSAPP || null,
      },
      luis: {
        key: "luis",
        id: 4,
        name: "LUIS FERNANDO ARAUJO",
        whatsapp: process.env.SELLER_LUIS_WHATSAPP || null,
      },
    };
  }

  static outcomeLabel(outcome) {
    const map = {
      WON: "Fechamos com ele",
      CREDIT_DENIED: "Crédito negado",
      NO_REPLY: "Não respondeu",
      IMPOSSIBLE: "Negociação impossível",
    };

    return map[outcome] || outcome || null;
  }

  static outcomeToStatus(outcome) {
    if (outcome === "WON") return "vendido";
    return "perdido";
  }

  static getWaMeta(lead) {
    return lead?.metadata?.wa || {};
  }

  static async updateLeadCoreAndWa(lead, corePatch = {}, waPatch = {}) {
    const currentWa = this.getWaMeta(lead);

    return lead.update({
      ...corePatch,
      metadata: {
        wa: {
          ...currentWa,
          ...waPatch,
        },
      },
    });
  }

  static async assignSeller({
    leadId,
    sellerKey,
    sellerId,
    sellerName,
    sellerWhatsapp,
    from,
  }) {
    const cfg = this.cfg();
    const lead = await Lead.findById(leadId);
    if (!lead) return null;

    const now = new Date();
    const estimatedEndAt = new Date(
      now.getTime() + cfg.attendanceEstimateSec * 1000,
    );

    const updated = await this.updateLeadCoreAndWa(
      lead,
      {
        status: "contatado",
        dataContato: now,
        vendedorId: sellerId || null,
        vendedorWhatsapp: sellerName || null,
      },
      {
        sellerKey,
        sellerId: sellerId || null,
        sellerName: sellerName || null,
        sellerWhatsapp: sellerWhatsapp || from || null,
        sellerSelectedBy: from || null,
        sellerSelectedAt: now.toISOString(),
        claimedAt: now.toISOString(),
        attendanceStartedAt: now.toISOString(),
        estimatedEndAt: estimatedEndAt.toISOString(),
        nextReminderAt: null,
      },
    );

    try {
      const waResp = await WhatsAppService.sendStartConversationButton({
        to: cfg.sellerPhone,
        lead,
        sellerName,
      });

      await this.updateLeadCoreAndWa(
        lead,
        {},
        {
          openConversationWamid: waResp?.messages?.[0]?.id || null,
        },
      );
    } catch (e) {
      console.error(
        `⚠️ Falha ao enviar CTA de conversa para lead ${leadId}:`,
        e.message,
      );
    }

    return updated;
  }

  static async setOutcome({ leadId, outcome }) {
    const lead = await Lead.findById(leadId);
    if (!lead) return null;

    const now = new Date();
    const resultText = this.outcomeLabel(outcome);
    const newStatus = this.outcomeToStatus(outcome);

    return this.updateLeadCoreAndWa(
      lead,
      {
        status: newStatus,
        resultText,
      },
      {
        outcome,
        resultText,
        closedAt: now.toISOString(),
      },
    );
  }

  static async startAttendanceManual({
    leadId,
    sellerId = null,
    sellerName = null,
    sellerWhatsapp = null,
  }) {
    const lead = await Lead.findById(leadId);
    if (!lead) return null;

    const now = new Date();

    return this.updateLeadCoreAndWa(
      lead,
      {
        status: "contatado",
        dataContato: now,
        vendedorId: sellerId,
        vendedorWhatsapp: sellerWhatsapp,
      },
      {
        sellerId,
        sellerName,
        sellerWhatsapp,
        attendanceStartedAt: now.toISOString(),
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
      FROM teste.leads
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

    if (!rs.rows?.length) return null;

    const lead = new Lead(rs.rows[0]);
    const wa = this.getWaMeta(lead);
    const statuses = Array.isArray(wa.messageStatuses)
      ? wa.messageStatuses
      : [];

    const nextStatuses = [
      ...statuses,
      { wamid, status, timestamp, recipientId, raw },
    ].slice(-20);

    return this.updateLeadCoreAndWa(
      lead,
      {},
      {
        lastStatus: status,
        lastStatusAt: timestamp
          ? new Date(Number(timestamp) * 1000).toISOString()
          : new Date().toISOString(),
        messageStatuses: nextStatuses,
      },
    );
  }

  static async processRemindersTick() {
    return;
  }

  static async processFeedbackTick() {
    return;
  }
}

module.exports = LeadWorkflowService;
