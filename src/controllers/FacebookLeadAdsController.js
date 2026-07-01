const FacebookLeadAdsService = require("../services/FacebookLeadAdsService");
const {
  getSchemaFromReq,
  getTenantIdFromReq,
} = require("../utils/tenantContext");

class FacebookLeadAdsController {
  async verifyWebhook(req, res) {
    try {
      const mode = req.query["hub.mode"];
      const token = req.query["hub.verify_token"];
      const challenge = req.query["hub.challenge"];
      const expectedToken = String(process.env.META_WEBHOOK_VERIFY_TOKEN || "")
        .trim();

      if (!expectedToken) {
        return res.status(500).send("META_WEBHOOK_VERIFY_TOKEN not configured");
      }

      if (mode === "subscribe" && token === expectedToken && challenge) {
        return res.status(200).send(String(challenge));
      }

      return res.sendStatus(403);
    } catch (error) {
      console.error("Erro ao validar webhook Facebook Lead Ads:", error);
      return res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  }

  async receiveWebhook(req, res) {
    try {
      FacebookLeadAdsService.validateWebhookSignature(req);

      const events = FacebookLeadAdsService.extractLeadgenEvents(req.body);

      if (!events.length) {
        return res.status(200).json({
          success: true,
          received: true,
          processed: 0,
        });
      }

      const schema = getSchemaFromReq(req, { allowDefault: false });
      const tenantId = getTenantIdFromReq(req);
      const results = [];

      for (const event of events) {
        const result = await FacebookLeadAdsService.ingestLeadgenEvent(event, {
          schema,
          tenantId,
        });
        results.push(result);
      }

      return res.status(200).json({
        success: true,
        received: true,
        processed: results.length,
        duplicates: results.filter((item) => item.duplicate).length,
        leads: results.map((item) => ({
          id: item.lead?.id || null,
          emailId: item.emailId,
          duplicate: item.duplicate,
          schema: item.schema,
        })),
      });
    } catch (error) {
      console.error("Erro ao receber webhook Facebook Lead Ads:", error);
      return res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  }
}

module.exports = new FacebookLeadAdsController();
