const PushNotificationService = require("../services/PushNotificationService");
const { getSchemaFromReq } = require("../utils/tenantContext");

function resolveScope(req) {
  return String(req?.query?.scope || req?.body?.scope || "agenda")
    .trim()
    .toLowerCase();
}

exports.getPublicKey = async (req, res) => {
  try {
    if (!PushNotificationService.isConfigured()) {
      return res.status(503).json({
        success: false,
        message: "Push notifications não configuradas.",
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
    const schemaName = getSchemaFromReq(req);
    if (!schemaName) {
      return res.status(400).json({
        success: false,
        message: "Schema não especificado.",
      });
    }

    await PushNotificationService.ensureInfrastructure();

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
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

exports.subscribe = async (req, res) => {
  try {
    const schemaName = getSchemaFromReq(req);
    if (!schemaName) {
      return res.status(400).json({
        success: false,
        message: "Schema não especificado.",
      });
    }

    const { subscription, deviceName } = req.body || {};
    const scope = resolveScope(req);

    if (!subscription) {
      return res.status(400).json({
        success: false,
        message: "Subscription não informada.",
      });
    }

    const saved = await PushNotificationService.saveSubscription({
      schemaName,
      scope,
      subscription,
      deviceName: deviceName || req.headers["x-device-name"] || null,
      userAgent: req.headers["user-agent"] || null,
    });

    return res.json({
      success: true,
      message: "Subscription salva com sucesso.",
      data: saved,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

exports.unsubscribe = async (req, res) => {
  try {
    const schemaName = getSchemaFromReq(req);
    if (!schemaName) {
      return res.status(400).json({
        success: false,
        message: "Schema não especificado.",
      });
    }

    const scope = resolveScope(req);
    const endpoint = String(req?.body?.endpoint || req?.query?.endpoint || "").trim();

    if (!endpoint) {
      return res.status(400).json({
        success: false,
        message: "Endpoint não informado.",
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
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};
