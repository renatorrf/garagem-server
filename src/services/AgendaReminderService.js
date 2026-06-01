const cron = require("node-cron");
const moment = require("moment");
const db = require("../config/database");
const PushNotificationService = require("./PushNotificationService");
const { assertValidSchemaName } = require("../utils/tenantContext");

class AgendaReminderService {
  static started = false;
  static running = false;
  static job = null;

  static async start() {
    if (this.started) return;
    this.started = true;

    if (!PushNotificationService.isConfigured()) {
      console.log(
        "⚠️ Push notifications desativadas: VAPID não configurado.",
      );
      return;
    }

    await PushNotificationService.ensureInfrastructure();
    await PushNotificationService.configureVapid();

    const cronExpression = String(
      process.env.PUSH_AGENDA_CRON || "*/5 * * * *",
    ).trim();

    this.job = cron.schedule(cronExpression, () => {
      this.run().catch((error) => {
        console.error("Erro no agendamento de lembretes:", error);
      });
    });

    console.log(
      `✅ AgendaReminderService iniciado (${cronExpression})`,
    );

    setImmediate(() => {
      this.run().catch((error) => {
        console.error("Erro na execução inicial de lembretes:", error);
      });
    });
  }

  static async run() {
    if (this.running) return;
    this.running = true;

    try {
      const schemasResult = await db.query(`
        SELECT DISTINCT schema_name
          FROM public.tab_push_subscription
         WHERE ind_active = true
         ORDER BY schema_name ASC
      `);

      for (const row of schemasResult.rows || []) {
        const schemaName = String(row.schema_name || "").trim();
        if (!schemaName) continue;
        await this.processSchema(schemaName);
      }
    } finally {
      this.running = false;
    }
  }

  static async processSchema(schemaName) {
    const schema = assertValidSchemaName(schemaName);
    await PushNotificationService.ensureAgendaReminderColumn(schema);

    const remindersResult = await db.query(
      `
        SELECT
          seq_registro,
          titulo,
          hora,
          dia,
          descricao,
          concluido,
          ind_cancelado,
          notificado_em
        FROM ${schema}.tab_agenda
        WHERE COALESCE(concluido, false) = false
          AND COALESCE(ind_cancelado, false) = false
          AND notificado_em IS NULL
          AND dia IS NOT NULL
          AND hora IS NOT NULL
        ORDER BY dia ASC, hora ASC, seq_registro ASC
      `,
    );

    for (const agenda of remindersResult.rows || []) {
      await this.processAgendaReminder(schema, agenda);
    }
  }

  static parseAgendaMoment(agenda) {
    return moment(
      `${agenda.dia} ${agenda.hora}`,
      ["YYYY-MM-DD HH:mm", "YYYY-MM-DD HH:mm:ss", moment.ISO_8601],
      true,
    );
  }

  static async processAgendaReminder(schemaName, agenda) {
    const appointmentAt = this.parseAgendaMoment(agenda);

    if (!appointmentAt.isValid()) {
      console.warn(
        `⚠️ Agenda ${agenda.seq_registro} com data/hora inválida em ${schemaName}`,
      );
      return;
    }

    const reminderAt = appointmentAt.clone().subtract(1, "day");
    const now = moment();

    if (now.isBefore(reminderAt) || now.isSameOrAfter(appointmentAt)) {
      return;
    }

    const subscriptions =
      await PushNotificationService.getActiveSubscriptions(schemaName, "agenda");

    if (!subscriptions.length) {
      await this.markAsNotified(schemaName, agenda.seq_registro);
      return;
    }

    const payload = PushNotificationService.buildReminderPayload({
      agenda,
      schemaName,
    });

    let successCount = 0;

    for (const subscription of subscriptions) {
      try {
        await PushNotificationService.sendNotificationToSubscription(
          subscription,
          payload,
        );
        successCount++;
      } catch (error) {
        const statusCode = Number(
          error?.statusCode || error?.status || error?.response?.status || 0,
        );
        console.error(
          `⚠️ Falha ao enviar lembrete ${agenda.seq_registro} (${schemaName}) para ${subscription.endpoint.slice(0, 40)}...`,
          statusCode || error.message,
        );
      }
    }

    const remainingSubscriptions =
      await PushNotificationService.getActiveSubscriptions(schemaName, "agenda");

    if (successCount > 0 || remainingSubscriptions.length === 0) {
      await this.markAsNotified(schemaName, agenda.seq_registro);
    }
  }

  static async markAsNotified(schemaName, seqRegistro) {
    const schema = assertValidSchemaName(schemaName);

    await db.query(
      `
        UPDATE ${schema}.tab_agenda
           SET notificado_em = NOW()
         WHERE seq_registro = $1
           AND notificado_em IS NULL
      `,
      [seqRegistro],
    );
  }
}

module.exports = AgendaReminderService;
