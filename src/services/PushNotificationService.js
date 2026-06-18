const db = require("../config/database");
const webpush = require("web-push");
const moment = require("moment");
const { assertValidSchemaName } = require("../utils/tenantContext");

class PushNotificationService {
  static infrastructureReady = false;
  static vapidConfigured = false;
  static started = false;

  static normalizeScope(scope = "agenda") {
    return (
      String(scope || "agenda")
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_-]/g, "")
        .slice(0, 50) || "agenda"
    );
  }

  static normalizeUsuario(usuario = "sistema") {
    return (
      String(usuario || "sistema")
        .trim()
        .toLowerCase()
        .replace(/\s+/g, " ")
        .replace(/[^a-z0-9_.@ -]/g, "")
        .slice(0, 80) || "sistema"
    );
  }

  static normalizeNotificationText(value = "") {
    return String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^\x20-\x7E]/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  static normalizeNotificationPayload(payload = {}) {
    if (!payload?.notification) return payload;

    return {
      ...payload,
      notification: {
        ...payload.notification,
        title: this.normalizeNotificationText(payload.notification.title),
        body: this.normalizeNotificationText(payload.notification.body),
      },
    };
  }

  static getConfig() {
    const publicKey = String(process.env.PUSH_VAPID_PUBLIC_KEY || "").trim();
    const privateKey = String(process.env.PUSH_VAPID_PRIVATE_KEY || "").trim();
    const subject = String(process.env.PUSH_VAPID_SUBJECT || "").trim();
    const appUrl = String(
      process.env.PUSH_APP_URL ||
        process.env.APP_PUBLIC_URL ||
        "https://nextcarltda.web.app",
    ).replace(/\/+$/, "");

    const iconUrl = String(
      process.env.PUSH_NOTIFICATION_ICON_URL || `${appUrl}/assets/icon/julius.webp`,
    ).trim();

    const badgeUrl = String(
      process.env.PUSH_NOTIFICATION_BADGE_URL ||
        `${appUrl}/assets/icon/next_simbolo_rem_bg.png`,
    ).trim();

    const defaultOpenUrl = String(
      process.env.PUSH_DEFAULT_OPEN_URL || `${appUrl}/agenda`,
    ).replace(/\/+$/, "");

    const roomOpenUrl = String(
      process.env.PUSH_LEADS_ROOM_OPEN_URL || `${appUrl}/painel-leads`,
    ).replace(/\/+$/, "");

    return {
      publicKey,
      privateKey,
      subject,
      appUrl,
      iconUrl,
      badgeUrl,
      defaultOpenUrl,
      roomOpenUrl,
    };
  }

  static isConfigured() {
    const cfg = this.getConfig();
    return Boolean(cfg.publicKey && cfg.privateKey && cfg.subject);
  }

  static async start() {
    if (this.started) return;
    this.started = true;

    await this.ensureInfrastructure();

    if (!this.configureVapid()) {
      console.log("⚠️ Push notifications aguardando configuração VAPID no ambiente.");
      return;
    }

    console.log("✅ PushNotificationService configurado");
  }

  static configureVapid() {
    if (this.vapidConfigured) return true;

    const cfg = this.getConfig();
    if (!cfg.publicKey || !cfg.privateKey || !cfg.subject) {
      return false;
    }

    webpush.setVapidDetails(cfg.subject, cfg.publicKey, cfg.privateKey);
    this.vapidConfigured = true;
    return true;
  }

  static async ensureInfrastructure() {
    if (this.infrastructureReady) return;

    await db.query(`
      CREATE TABLE IF NOT EXISTS public.tab_push_subscription (
        seq_registro serial PRIMARY KEY,
        schema_name varchar(50) NOT NULL,
        scope varchar(50) NOT NULL DEFAULT 'agenda',
        usuario varchar(80) NOT NULL DEFAULT 'sistema',
        endpoint text NOT NULL,
        p256dh text NOT NULL,
        auth text NOT NULL,
        subscription_json jsonb,
        device_name varchar(120),
        user_agent text,
        expiration_time timestamp NULL,
        ind_active boolean NOT NULL DEFAULT true,
        created_at timestamp NOT NULL DEFAULT NOW(),
        updated_at timestamp NOT NULL DEFAULT NOW(),
        last_seen_at timestamp NULL
      );
    `);

    await db.query(`
      ALTER TABLE public.tab_push_subscription
      ADD COLUMN IF NOT EXISTS usuario varchar(80);
    `);

    await db.query(`
      UPDATE public.tab_push_subscription
         SET usuario = 'sistema'
       WHERE usuario IS NULL OR btrim(usuario) = '';
    `);

    await db.query(`
      ALTER TABLE public.tab_push_subscription
      ALTER COLUMN usuario SET DEFAULT 'sistema';
    `);

    await db.query(`
      ALTER TABLE public.tab_push_subscription
      ALTER COLUMN usuario SET NOT NULL;
    `);

    await db.query(`
      ALTER TABLE public.tab_push_subscription
      DROP CONSTRAINT IF EXISTS tab_push_subscription_schema_scope_endpoint_uniq;
    `);

    await db.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS tab_push_subscription_schema_scope_usuario_endpoint_uniq
      ON public.tab_push_subscription (schema_name, scope, usuario, endpoint);
    `);

    this.infrastructureReady = true;
  }

  static async ensureAgendaReminderColumn(schemaName) {
    const schema = assertValidSchemaName(schemaName);
    const check = await db.query(
      `
        SELECT 1
          FROM information_schema.columns
         WHERE table_schema = $1
           AND table_name = 'tab_agenda'
           AND column_name = 'notificado_em'
         LIMIT 1
      `,
      [schema],
    );

    if (check.rowCount > 0) return;

    await db.query(
      `ALTER TABLE ${schema}.tab_agenda ADD COLUMN notificado_em timestamp NULL`,
    );
  }

  static normalizeSubscription(subscription = {}) {
    const endpoint = String(subscription.endpoint || "").trim();
    const keys = subscription.keys || {};
    const p256dh = String(keys.p256dh || "").trim();
    const auth = String(keys.auth || "").trim();
    const expirationTime =
      subscription.expirationTime == null
        ? null
        : new Date(subscription.expirationTime);

    if (!endpoint || !p256dh || !auth) {
      throw new Error("Subscription inválida.");
    }

    return {
      endpoint,
      p256dh,
      auth,
      expirationTime,
    };
  }

  static async saveSubscription({
    schemaName,
    scope = "agenda",
    usuario = "sistema",
    subscription,
    deviceName = null,
    userAgent = null,
  }) {
    await this.ensureInfrastructure();
    this.configureVapid();

    const schema = assertValidSchemaName(schemaName);
    const normalizedScope = this.normalizeScope(scope);
    const normalizedUsuario = this.normalizeUsuario(usuario);
    const normalized = this.normalizeSubscription(subscription);
    const payload = JSON.stringify(subscription);

    const sql = `
      INSERT INTO public.tab_push_subscription (
        schema_name,
        scope,
        usuario,
        endpoint,
        p256dh,
        auth,
        subscription_json,
        device_name,
        user_agent,
        expiration_time,
        ind_active,
        updated_at,
        last_seen_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10, true, NOW(), NOW()
      )
      ON CONFLICT (schema_name, scope, usuario, endpoint)
      DO UPDATE SET
        p256dh = EXCLUDED.p256dh,
        auth = EXCLUDED.auth,
        subscription_json = EXCLUDED.subscription_json,
        device_name = EXCLUDED.device_name,
        user_agent = EXCLUDED.user_agent,
        expiration_time = EXCLUDED.expiration_time,
        ind_active = true,
        updated_at = NOW(),
        last_seen_at = NOW()
      RETURNING *;
    `;

    const result = await db.query(sql, [
      schema,
      normalizedScope,
      normalizedUsuario,
      normalized.endpoint,
      normalized.p256dh,
      normalized.auth,
      payload,
      deviceName ? String(deviceName).slice(0, 120) : null,
      userAgent || null,
      normalized.expirationTime,
    ]);

    return result.rows[0] || null;
  }

  static async deactivateSubscription({
    schemaName,
    scope = "agenda",
    usuario = null,
    endpoint,
  }) {
    await this.ensureInfrastructure();

    const schema = assertValidSchemaName(schemaName);
    const normalizedScope = this.normalizeScope(scope);
    const normalizedEndpoint = String(endpoint || "").trim();
    const normalizedUsuario = usuario ? this.normalizeUsuario(usuario) : null;

    if (!normalizedEndpoint) return 0;

    const params = [schema, normalizedScope, normalizedEndpoint];
    let usuarioFilter = "";

    if (normalizedUsuario) {
      params.push(normalizedUsuario);
      usuarioFilter = ` AND usuario = $${params.length}`;
    }

    const result = await db.query(
      `
        UPDATE public.tab_push_subscription
           SET ind_active = false,
               updated_at = NOW()
         WHERE schema_name = $1
           AND scope = $2
           AND endpoint = $3
           ${usuarioFilter}
      `,
      params,
    );

    return result.rowCount || 0;
  }

  static async getSubscriptionStatus({
    schemaName,
    scope = "agenda",
    usuario = null,
    endpoint = null,
  }) {
    await this.ensureInfrastructure();

    const schema = assertValidSchemaName(schemaName);
    const normalizedScope = this.normalizeScope(scope);
    const normalizedEndpoint = String(endpoint || "").trim();
    const normalizedUsuario = usuario ? this.normalizeUsuario(usuario) : null;

    const params = [schema, normalizedScope];
    let endpointFilter = "";
    let usuarioFilter = "";

    if (normalizedEndpoint) {
      params.push(normalizedEndpoint);
      endpointFilter = ` AND endpoint = $${params.length}`;
    }

    if (normalizedUsuario) {
      params.push(normalizedUsuario);
      usuarioFilter = ` AND usuario = $${params.length}`;
    }

    const result = await db.query(
      `
        SELECT COUNT(*)::int AS total
          FROM public.tab_push_subscription
         WHERE schema_name = $1
           AND scope = $2
           AND ind_active = true
           ${endpointFilter}
           ${usuarioFilter}
      `,
      params,
    );

    const total = Number(result.rows?.[0]?.total || 0);

    return {
      active: total > 0,
      total,
    };
  }

  static buildReminderPayload({ agenda, schemaName }) {
    const cfg = this.getConfig();
    const appointmentAt = moment(
      `${agenda.dia} ${agenda.hora}`,
      ["YYYY-MM-DD HH:mm", "YYYY-MM-DD HH:mm:ss", moment.ISO_8601],
      true,
    );

    const title = "Lembrete da agenda";
    const subject = String(agenda.titulo || "Compromisso").trim();
    const bodyParts = [
      `Amanha as ${appointmentAt.isValid() ? appointmentAt.format("HH:mm") : agenda.hora}`,
      subject,
    ].filter(Boolean);

    if (agenda.descricao) {
      bodyParts.push(String(agenda.descricao).slice(0, 90));
    }

    const openUrl = cfg.defaultOpenUrl || `${cfg.appUrl}/agenda`;

    return {
      notification: {
        title,
        body: bodyParts.join(" - "),
        icon: cfg.iconUrl,
        badge: cfg.badgeUrl,
        tag: `agenda-${schemaName}-${agenda.seq_registro}`,
        renotify: true,
        requireInteraction: true,
        data: {
          url: openUrl,
          schema: schemaName,
          scope: "agenda",
          agendaId: agenda.seq_registro,
          onActionClick: {
            default: {
              operation: "openWindow",
              url: openUrl,
            },
          },
        },
      },
    };
  }

  static buildLeadRoomPayload({ lead, schemaName, claimedBy = null }) {
    const cfg = this.getConfig();
    const clientName = String(lead?.nome || lead?.remetente || "Cliente").trim();
    const vehicleName = String(
      lead?.veiculoInteresse || lead?.assunto || "Novo lead",
    ).trim();
    const status = String(lead?.status || "novo").trim().toLowerCase();
    const origin = String(
      lead?.metadata?.plataforma || lead?.origem || "Lead",
    ).trim();
    const openUrl = cfg.roomOpenUrl || `${cfg.appUrl}/painel-leads`;

    const title = status === "contatado" ? "Lead assumido" : "Novo lead no painel";
    const bodyParts = [
      clientName,
      vehicleName,
      claimedBy ? `Assumido por ${claimedBy}` : null,
    ].filter(Boolean);

    return {
      notification: {
        title,
        body: bodyParts.join(" - "),
        icon: cfg.iconUrl,
        badge: cfg.badgeUrl,
        tag: `painel-leads-${schemaName}-${lead?.id || "lead"}`,
        renotify: true,
        requireInteraction: true,
        data: {
          url: openUrl,
          schema: schemaName,
          scope: "painel-leads",
          leadId: lead?.id || null,
          origin,
          claimedBy,
          onActionClick: {
            default: {
              operation: "openWindow",
              url: openUrl,
            },
          },
        },
      },
    };
  }

  static buildSessionExpirationPayload({ expiresAt }) {
    const cfg = this.getConfig();
    const openUrl = cfg.roomOpenUrl || `${cfg.appUrl}/painel-leads`;
    const expiration = moment(expiresAt);
    const expirationLabel = expiration.isValid()
      ? expiration.format("DD/MM [as] HH:mm")
      : "em breve";

    return {
      notification: {
        title: "Reconecte-se ao Painel de Leads",
        body: `Sua sessao expira em breve (${expirationLabel}). Entre novamente para continuar conectado.`,
        icon: cfg.iconUrl,
        badge: cfg.badgeUrl,
        tag: "painel-leads-session-expiring",
        renotify: true,
        requireInteraction: true,
        data: {
          url: openUrl,
          scope: "painel-leads",
          type: "session-expiring",
          expiresAt,
          onActionClick: {
            default: {
              operation: "openWindow",
              url: openUrl,
            },
          },
        },
      },
    };
  }

  static buildSubscriptionObject(subscriptionRow) {
    return {
      endpoint: subscriptionRow.endpoint,
      expirationTime: subscriptionRow.expiration_time
        ? new Date(subscriptionRow.expiration_time).getTime()
        : null,
      keys: {
        p256dh: subscriptionRow.p256dh,
        auth: subscriptionRow.auth,
      },
    };
  }

  static async sendNotificationToSubscription(subscriptionRow, payload) {
    const subscription = this.buildSubscriptionObject(subscriptionRow);
    const normalizedPayload = this.normalizeNotificationPayload(payload);

    try {
      await webpush.sendNotification(
        subscription,
        JSON.stringify(normalizedPayload),
      );
      return { success: true, endpoint: subscriptionRow.endpoint };
    } catch (error) {
      const statusCode = Number(
        error?.statusCode ||
          error?.status ||
          error?.response?.status ||
          error?.statusCode?.status ||
          0,
      );

      if (statusCode === 404 || statusCode === 410) {
        await this.deactivateSubscription({
          schemaName: subscriptionRow.schema_name,
          scope: subscriptionRow.scope,
          usuario: subscriptionRow.usuario,
          endpoint: subscriptionRow.endpoint,
        });
      }

      throw error;
    }
  }

  static async getActiveSubscriptions(schemaName, scope = "agenda") {
    await this.ensureInfrastructure();

    const schema = assertValidSchemaName(schemaName);
    const normalizedScope = this.normalizeScope(scope);

    const result = await db.query(
      `
        SELECT *
          FROM public.tab_push_subscription
         WHERE schema_name = $1
           AND scope = $2
           AND ind_active = true
         ORDER BY seq_registro ASC
      `,
      [schema, normalizedScope],
    );

    return result.rows || [];
  }

  static async getActiveSubscriptionsForScopes(
    schemaName,
    scopes = [],
    usuario = null,
  ) {
    await this.ensureInfrastructure();

    const schema = assertValidSchemaName(schemaName);
    const normalizedScopes = [
      ...new Set(scopes.map((scope) => this.normalizeScope(scope))),
    ];

    if (!normalizedScopes.length) return [];

    const normalizedUsuario = usuario
      ? this.normalizeUsuario(usuario)
      : null;
    const params = [schema, normalizedScopes];
    let usuarioFilter = "";

    if (normalizedUsuario) {
      params.push(normalizedUsuario);
      usuarioFilter = ` AND usuario = $${params.length}`;
    }

    const result = await db.query(
      `
        SELECT *
          FROM public.tab_push_subscription
         WHERE schema_name = $1
           AND scope = ANY($2::text[])
           AND ind_active = true
           ${usuarioFilter}
         ORDER BY seq_registro ASC
      `,
      params,
    );

    const uniqueByEndpoint = new Map();
    for (const subscription of result.rows || []) {
      if (!uniqueByEndpoint.has(subscription.endpoint)) {
        uniqueByEndpoint.set(subscription.endpoint, subscription);
      }
    }

    return [...uniqueByEndpoint.values()];
  }

  static async sendNotificationToSubscriptions(subscriptions, payload) {
    const results = [];

    for (const subscriptionRow of subscriptions) {
      try {
        const result = await this.sendNotificationToSubscription(
          subscriptionRow,
          payload,
        );
        results.push(result);
      } catch (error) {
        results.push({
          success: false,
          endpoint: subscriptionRow.endpoint,
          error: error.message,
        });
      }
    }

    return results;
  }

  static async sendNotificationToScope(schemaName, scope, payload) {
    if (!this.configureVapid()) {
      return [];
    }

    const subscriptions = await this.getActiveSubscriptions(schemaName, scope);
    return this.sendNotificationToSubscriptions(subscriptions, payload);
  }

  static async sendLeadRoomNotification({
    lead,
    schemaName,
    claimedBy = null,
    scope = "painel-leads",
  }) {
    if (!schemaName || !lead) return [];

    const normalizedScope = this.normalizeScope(scope || "painel-leads");

    if (!this.configureVapid()) return [];

    const scopes = [normalizedScope];
    if (normalizedScope === "painel-leads") {
      scopes.push("leads-room");
    }

    const subscriptions = await this.getActiveSubscriptionsForScopes(
      schemaName,
      scopes,
    );
    const results = await this.sendNotificationToSubscriptions(
      subscriptions,
      this.buildLeadRoomPayload({ lead, schemaName, claimedBy }),
    );
    const delivered = results.filter((result) => result.success).length;
    const failed = results.length - delivered;

    console.log(
      `Push painel-leads ${lead.id}: ${delivered} entregue(s), ${failed} falha(s).`,
    );

    if (failed) {
      console.error(
        "Falhas no push painel-leads:",
        results
          .filter((result) => !result.success)
          .map((result) => result.error),
      );
    }

    return results;
  }

  static async sendSessionExpirationNotification({
    schemaName,
    usuario,
    expiresAt,
  }) {
    if (!schemaName || !usuario || !expiresAt || !this.configureVapid()) {
      return [];
    }

    const subscriptions = await this.getActiveSubscriptionsForScopes(
      schemaName,
      ["painel-leads"],
      usuario,
    );

    return this.sendNotificationToSubscriptions(
      subscriptions,
      this.buildSessionExpirationPayload({ expiresAt }),
    );
  }
}

module.exports = PushNotificationService;
