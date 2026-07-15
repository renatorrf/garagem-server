const FacebookPatrocinioSheetService = require("../services/FacebookPatrocinioSheetService");
const {
  getSchemaFromReq,
  getTenantIdFromReq,
} = require("../utils/tenantContext");

class FacebookPatrocinioController {
  validateSyncSecret(req) {
    const expected = String(process.env.FACEBOOK_PATROCINIO_SYNC_SECRET || "")
      .trim();

    if (!expected) return;

    const received = String(
      req.headers["x-sync-secret"] ||
        req.query.syncSecret ||
        req.body?.syncSecret ||
        "",
    ).trim();

    if (received !== expected) {
      const error = new Error("Sync secret invalido.");
      error.statusCode = 401;
      throw error;
    }
  }

  async status(req, res) {
    try {
      return res.json({
        success: true,
        data: FacebookPatrocinioSheetService.getStatus(),
      });
    } catch (error) {
      return res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  }

  async preview(req, res) {
    try {
      this.validateSyncSecret(req);

      const schema = getSchemaFromReq(req, { allowDefault: false });
      const tenantId = getTenantIdFromReq(req);
      const limit = Math.min(Number(req.query.limit || 10) || 10, 50);
      const result = await FacebookPatrocinioSheetService.preview({
        schema,
        tenantId,
        limit,
      });

      return res.json({
        success: true,
        data: result,
      });
    } catch (error) {
      return res.status(error.statusCode || 500).json({
        success: false,
        error: error.message,
      });
    }
  }

  async sync(req, res) {
    try {
      this.validateSyncSecret(req);

      const schema = getSchemaFromReq(req, { allowDefault: false });
      const tenantId = getTenantIdFromReq(req);
      const result = await FacebookPatrocinioSheetService.sync({
        schema,
        tenantId,
      });

      return res.json({
        success: true,
        data: result,
      });
    } catch (error) {
      return res.status(error.statusCode || 500).json({
        success: false,
        error: error.message,
      });
    }
  }
}

module.exports = new FacebookPatrocinioController();
