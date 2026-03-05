// services/LeadWorkflowService.js
const cron = require("node-cron");
const db = require("../config/database");
const Lead = require("../models/leads");
const WhatsAppService = require("./WhatsAppService");

class LeadWorkflowService {
  static start() {
    // lembretes: checa a cada 1 minuto
    cron.schedule("*/1 * * * *", async () => {
      try {
        await this.processRemindersTick();
      } catch (e) {
        console.error("❌ ReminderTick:", e.message);
      }
    });

    // feedback: checa a cada 5 minutos
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
    };
  }

  static async onNewLead(savedLead) {
    const cfg = this.cfg();

    const now = new Date();
    const nextReminderAt = new Date(
      now.getTime() + cfg.reminderIntervalSec * 1000,
    );

    // Envia notificação pro vendedor
    const waResp = await WhatsAppService.sendLeadNotification({
      to: cfg.sellerPhone,
      lead: savedLead,
    });

    const notifyWamid = waResp?.messages?.[0]?.id || null;

    // Carrega lead do banco pra garantir metadata atual e atualizar com merge
    const lead = await Lead.findById(savedLead.id);
    if (!lead) return;

    const waPrev = lead.metadata?.wa || {};

    lead.metadata = {
      ...(lead.metadata || {}),
      wa: {
        ...waPrev,
        assignedTo: cfg.sellerPhone,
        notifyWamid,
        claimedAt: null,
        reminderCount: 0,
        nextReminderAt: nextReminderAt.toISOString(),
        lastReminderAt: null,
        feedbackRequestedAt: null,
        outcome: null,
        closedAt: null,
        ignoredAt: null,
      },
    };

    await lead.update({ metadata: lead.metadata });

    console.log(
      `📲 Lead ${savedLead.id} notificado no WhatsApp (${cfg.sellerPhone})`,
    );
  }

  static async processRemindersTick() {
    const cfg = this.cfg();

    // Pegamos apenas leads NOTIFICADOS (tem wa.nextReminderAt) e ainda não assumidos/ignorados
    const q = `
      SELECT *
      FROM teste.leads
      WHERE status = 'novo'
        AND (metadata->'wa'->>'nextReminderAt') IS NOT NULL
        AND (metadata->'wa'->>'claimedAt') IS NULL
        AND (metadata->'wa'->>'ignoredAt') IS NULL
        AND COALESCE((metadata->'wa'->>'reminderCount')::int, 0) < $1
        AND (metadata->'wa'->>'nextReminderAt')::timestamptz <= now()
      ORDER BY data_recebimento ASC
      LIMIT 50;
    `;

    const rs = await db.query(q, [cfg.reminderMax]);

    for (const row of rs.rows) {
      const lead = new Lead(row);
      const wa = lead.metadata?.wa || {};
      const reminderCount = (parseInt(wa.reminderCount || 0, 10) || 0) + 1;

      const waResp = await WhatsAppService.sendReminder({
        to: cfg.sellerPhone,
        lead,
        reminderCount,
      });

      const lastReminderAt = new Date();
      const nextReminderAt = new Date(
        lastReminderAt.getTime() + cfg.reminderIntervalSec * 1000,
      );

      lead.metadata = {
        ...(lead.metadata || {}),
        wa: {
          ...wa,
          lastReminderWamid: waResp?.messages?.[0]?.id || null,
          reminderCount,
          lastReminderAt: lastReminderAt.toISOString(),
          nextReminderAt: nextReminderAt.toISOString(),
        },
      };

      await lead.update({ metadata: lead.metadata });

      console.log(`🔔 Reminder ${reminderCount} para lead ${lead.id}`);
    }
  }

  static async processFeedbackTick() {
    const cfg = this.cfg();

    // ⚠️ Aqui o parâmetro é SEGUNDOS (não ms)
    const q = `
      SELECT *
      FROM teste.leads
      WHERE status = 'contatado'
        AND (metadata->'wa'->>'claimedAt') IS NOT NULL
        AND (metadata->'wa'->>'feedbackRequestedAt') IS NULL
        AND ((metadata->'wa'->>'claimedAt')::timestamptz + ($1::text || ' seconds')::interval) <= now()
      ORDER BY data_recebimento ASC
      LIMIT 50;
    `;

    const rs = await db.query(q, [cfg.feedbackDelaySec.toString()]);

    for (const row of rs.rows) {
      const lead = new Lead(row);
      const wa = lead.metadata?.wa || {};

      const waResp = await WhatsAppService.sendFeedbackRequest({
        to: cfg.sellerPhone,
        lead,
      });

      const feedbackWamid = waResp?.messages?.[0]?.id || null;

      lead.metadata = {
        ...(lead.metadata || {}),
        wa: {
          ...wa,
          feedbackRequestedAt: new Date().toISOString(),
          feedbackWamid,
        },
      };

      await lead.update({ metadata: lead.metadata });

      console.log(`🧾 Feedback solicitado para lead ${lead.id}`);
    }
  }

  static async claimLead(leadId, from) {
    const lead = await Lead.findById(leadId);
    if (!lead) return null;

    const wa = lead.metadata?.wa || {};
    const now = new Date();

    lead.metadata = {
      ...(lead.metadata || {}),
      wa: {
        ...wa,
        claimedAt: now.toISOString(),
        claimedBy: from || null,
        ignoredAt: null,
      },
    };

    const updated = await lead.update({
      status: "contatado",
      dataContato: now,
      metadata: lead.metadata,
    });

    return updated;
  }

  static async ignoreLead(leadId) {
    const lead = await Lead.findById(leadId);
    if (!lead) return null;

    const wa = lead.metadata?.wa || {};
    const now = new Date();

    lead.metadata = {
      ...(lead.metadata || {}),
      wa: {
        ...wa,
        ignoredAt: now.toISOString(),
        outcome: "IGNORED",
        closedAt: now.toISOString(),
      },
    };

    // Ignorado = perdido (ou você pode criar status próprio, mas sua CHECK constraint não tem)
    const updated = await lead.update({
      status: "perdido",
      metadata: lead.metadata,
    });

    return updated;
  }

  static async setOutcome({ leadId, outcome }) {
    const lead = await Lead.findById(leadId);
    if (!lead) return null;

    const wa = lead.metadata?.wa || {};
    const now = new Date();

    const newStatus = outcome === "WON" ? "vendido" : "perdido";

    lead.metadata = {
      ...(lead.metadata || {}),
      wa: {
        ...wa,
        outcome,
        closedAt: now.toISOString(),
      },
    };

    const updated = await lead.update({
      status: newStatus,
      metadata: lead.metadata,
    });

    return updated;
  }

  static async recordMessageStatus({
    wamid,
    status,
    timestamp,
    recipientId,
    raw,
  }) {
    if (!wamid || !status) return;

    // timestamp do webhook vem como unix string (segundos)
    const ts = timestamp
      ? new Date(parseInt(timestamp, 10) * 1000).toISOString()
      : new Date().toISOString();

    // Atualiza metadata.wa:
    // - messageStatusById[wamid] = {status, ts, recipientId, raw}
    // - lastStatus
    // - lastStatusAt
    // - lastReadAt (se status === 'read')
    const patch = {
      messageStatusById: {
        [wamid]: {
          status,
          ts,
          recipientId: recipientId || null,
          raw: raw || null,
        },
      },
      lastStatus: status,
      lastStatusAt: ts,
      ...(status === "read" ? { lastReadAt: ts } : {}),
    };

    // Atualiza leads que tenham qualquer um desses wamids salvos no metadata.wa
    // (notifyWamid, lastReminderWamid, feedbackWamid...)
    const q = `
      UPDATE teste.leads
  SET
    metadata = jsonb_set(
      COALESCE(metadata,'{}'::jsonb),
      '{wa}',
      (
        COALESCE(metadata->'wa','{}'::jsonb)
        ||
        jsonb_build_object(
          'lastStatus', $1::text,
          'lastStatusAt', $2::text
        )
        ||
        CASE WHEN $1::text = 'read'
          THEN jsonb_build_object('lastReadAt', $2::text)
          ELSE '{}'::jsonb
        END
        ||
        jsonb_build_object(
          'messageStatusById',
          COALESCE(metadata->'wa'->'messageStatusById','{}'::jsonb) || $3::jsonb
        )
      ),
      true
    ),
    updated_at = now()
  WHERE deleted_at IS NULL
    AND (
      (metadata->'wa'->>'notifyWamid') = $4
      OR (metadata->'wa'->>'lastReminderWamid') = $4
      OR (metadata->'wa'->>'feedbackWamid') = $4
        );
    `;

    // $3 precisa ser um json com { "<wamid>": {...} }
    const wamidObj = JSON.stringify(patch.messageStatusById);

    await db.query(q, [status, ts, wamidObj, wamid]);
  }
}

module.exports = LeadWorkflowService;
