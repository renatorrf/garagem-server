const cron = require("node-cron");
const db = require("../config/database");
const PushNotificationService = require("./PushNotificationService");

class SessionExpirationNotificationService {
  static started = false;

  static async start() {
    if (this.started) return;
    this.started = true;

    await this.ensureInfrastructure();
    await this.notifyExpiringSessions();

    const schedule =
      process.env.AUTH_SESSION_NOTIFICATION_CRON || "*/15 * * * *";

    cron.schedule(schedule, () => {
      this.notifyExpiringSessions().catch((error) => {
        console.error("Falha ao verificar expiraÃ§Ã£o de sessÃµes:", error.message);
      });
    });

    console.log(`Avisos de expiraÃ§Ã£o de sessÃ£o ativos (${schedule}).`);
  }

  static async ensureInfrastructure() {
    await db.query(`
      ALTER TABLE public.login_sessions
      ADD COLUMN IF NOT EXISTS expiration_notified_at timestamp NULL
    `);

    await db.query(`
      ALTER TABLE public.login_sessions
      ALTER COLUMN expires_at DROP NOT NULL
    `);
  }

  static async notifyExpiringSessions() {
    const warningHours = Math.max(
      1,
      Number(process.env.AUTH_SESSION_EXPIRY_WARNING_HOURS || 24),
    );

    const result = await db.query(
      `
        SELECT
          u.username,
          t.schema_name,
          MIN(ls.expires_at) AS expires_at,
          ARRAY_AGG(ls.id) AS session_ids
        FROM public.login_sessions ls
        INNER JOIN public.users u ON u.id = ls.user_id
        INNER JOIN public.tenants t ON t.id = ls.tenant_id
        WHERE ls.ativo = true
          AND ls.expiration_notified_at IS NULL
          AND ls.expires_at > NOW()
          AND ls.expires_at <= NOW() + ($1 * INTERVAL '1 hour')
          AND u.ativo = true
          AND t.ativo = true
        GROUP BY u.id, u.username, t.schema_name
      `,
      [warningHours],
    );

    for (const session of result.rows || []) {
      const deliveries =
        await PushNotificationService.sendSessionExpirationNotification({
          schemaName: session.schema_name,
          usuario: session.username,
          expiresAt: session.expires_at,
        });

      if (!deliveries.some((delivery) => delivery.success)) continue;

      await db.query(
        `
          UPDATE public.login_sessions
             SET expiration_notified_at = NOW()
           WHERE id = ANY($1)
        `,
        [session.session_ids],
      );
    }
  }
}

module.exports = SessionExpirationNotificationService;
