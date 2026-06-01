const PushNotificationService = require("../services/PushNotificationService");
const { getSchemaFromReq } = require("../utils/tenantContext");

function resolveScope(req, defaultScope = "agenda") {
  return PushNotificationService.normalizeScope(
    req?.query?.scope || req?.body?.scope || defaultScope,
  );
}

function resolveUsuario(req) {
  const raw =
    req?.usuario?.usuario ||
    req?.usuario?.username ||
    req?.usuario?.cod_usuario ||
    req?.usuario?.cod_vendedor ||
    req?.user?.usuario ||
    req?.user?.username ||
    req?.user?.cod_usuario ||
    req?.user?.cod_vendedor ||
    req?.auth?.usuario ||
    req?.auth?.username ||
    req?.body?.usuario ||
    req?.query?.usuario ||
    req?.headers?.["x-push-user"] ||
    "sistema";

  return PushNotificationService.normalizeUsuario(raw);
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

    const scope = resolveScope(req);
    const usuario = resolveUsuario(req);
    const endpoint = String(req?.query?.endpoint || "").trim();

    const status = await PushNotificationService.getSubscriptionStatus({
      schemaName,
      scope,
      usuario,
      endpoint: endpoint || null,
    });

    return res.json({
      success: true,
      schemaName,
      scope,
      usuario,
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
    const usuario = resolveUsuario(req);

    if (!subscription) {
      return res.status(400).json({
        success: false,
        message: "Subscription não informada.",
      });
    }

    const saved = await PushNotificationService.saveSubscription({
      schemaName,
      scope,
      usuario,
      subscription,
      deviceName: deviceName || req.headers["x-device-name"] || usuario,
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
    const usuario = resolveUsuario(req);
    const endpoint = String(
      req?.body?.endpoint || req?.query?.endpoint || "",
    ).trim();

    if (!endpoint) {
      return res.status(400).json({
        success: false,
        message: "Endpoint não informado.",
      });
    }

    await PushNotificationService.deactivateSubscription({
      schemaName,
      scope,
      usuario,
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
