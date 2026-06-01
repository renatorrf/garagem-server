"use strict";

const PushNotificationService = require("../services/PushNotificationService");
const { assertValidSchemaName } = require("../utils/tenantContext");
const {
  resolveLeadRoomUser,
  isAllowedLeadRoomUser,
} = require("../utils/leadsRoom");

function resolveScope(req) {
  return PushNotificationService.normalizeScope(
    String(req?.query?.scope || req?.body?.scope || "leads-room"),
  );
}

function resolveSchemaName(req) {
  const raw =
    req?.body?.schemaName ||
    req?.query?.schemaName ||
    process.env.SCHEMA_PADRAO ||
    "nextcar";

  return assertValidSchemaName(raw);
}

function resolveRoomCredentials(req) {
  const vendor = resolveLeadRoomUser(
    req?.body?.vendor || req?.body?.usuario || req?.query?.vendor || req?.query?.usuario,
  );
  const password = String(
    req?.body?.password || req?.query?.password || req?.headers?.["x-room-password"] || "",
  )
    .trim()
    .toLowerCase();

  if (!vendor || !isAllowedLeadRoomUser(vendor) || password !== vendor) {
    const error = new Error("Credenciais da room invalidas.");
    error.statusCode = 401;
    throw error;
  }

  return { vendor };
}

exports.getPublicKey = async (req, res) => {
  try {
    if (!PushNotificationService.isConfigured()) {
      return res.status(503).json({
        success: false,
        message: "Push notifications nao configuradas.",
      });
    }

    return res.json({
      success: true,
      publicKey: PushNotificationService.getConfig().publicKey,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

exports.getStatus = async (req, res) => {
  try {
    resolveRoomCredentials(req);

    const schemaName = resolveSchemaName(req);
    const scope = resolveScope(req);
    const endpoint = String(req?.query?.endpoint || "").trim();

    const status = await PushNotificationService.getSubscriptionStatus({
      schemaName,
      scope,
      endpoint: endpoint || null,
    });

    return res.json({
      success: true,
      schemaName,
      scope,
      ...status,
    });
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message,
    });
  }
};

exports.subscribe = async (req, res) => {
  try {
    const { vendor } = resolveRoomCredentials(req);
    const schemaName = resolveSchemaName(req);
    const scope = resolveScope(req);
    const { subscription, deviceName } = req.body || {};

    if (!subscription) {
      return res.status(400).json({
        success: false,
        message: "Subscription nao informada.",
      });
    }

    const saved = await PushNotificationService.saveSubscription({
      schemaName,
      scope,
      subscription,
      deviceName: deviceName || vendor,
      userAgent: req.headers["user-agent"] || null,
    });

    return res.json({
      success: true,
      message: "Subscription salva com sucesso.",
      data: saved,
    });
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message,
    });
  }
};

exports.unsubscribe = async (req, res) => {
  try {
    resolveRoomCredentials(req);

    const schemaName = resolveSchemaName(req);
    const scope = resolveScope(req);
    const endpoint = String(
      req?.body?.endpoint || req?.query?.endpoint || "",
    ).trim();

    if (!endpoint) {
      return res.status(400).json({
        success: false,
        message: "Endpoint nao informado.",
      });
    }

    await PushNotificationService.deactivateSubscription({
      schemaName,
      scope,
      endpoint,
    });

    return res.json({
      success: true,
      message: "Subscription desativada.",
    });
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message,
    });
  }
};
