// controllers/WhatsAppWebhookController.js
const LeadWorkflowService = require("../services/LeadWorkflowService");

class WhatsAppWebhookController {
  // GET /webhooks/whatsapp
  async verify(req, res) {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];

    if (mode === "subscribe" && token === process.env.WA_WEBHOOK_VERIFY_TOKEN) {
      return res.status(200).send(challenge);
    }
    return res.sendStatus(403);
  }

  // POST /webhooks/whatsapp
  async handle(req, res) {
    try {
      const body = req.body;

      const entry = body?.entry?.[0];
      const change = entry?.changes?.[0];
      const value = change?.value;

      // 1) mensagens recebidas (cliques / texto)
      const msg = value?.messages?.[0];

      if (msg) {
        const from = msg.from || null;

        // texto normal (opcional)
        if (msg.type === "text") {
          console.log(`📩 Mensagem recebida de ${from}: ${msg.text?.body}`);
        }

        // interativo
        if (msg.type === "interactive") {
          const interactive = msg.interactive;

          // botão (ASSUMIR / IGNORAR)
          if (interactive?.type === "button_reply") {
            const id = interactive.button_reply?.id || "";

            if (id.startsWith("claim:")) {
              const leadId = id.split(":")[1];
              await LeadWorkflowService.claimLead(leadId, from);
            }

            if (id.startsWith("ignore:")) {
              const leadId = id.split(":")[1];
              await LeadWorkflowService.ignoreLead(leadId);
            }
          }

          // lista (OUTCOME)
          if (interactive?.type === "list_reply") {
            const id = interactive.list_reply?.id || ""; // outcome:WON:<leadId>

            if (id.startsWith("outcome:")) {
              const [, outcome, leadId] = id.split(":");
              await LeadWorkflowService.setOutcome({ leadId, outcome });
            }
          }
        }
      }

      // 2) status de mensagens (sent/delivered/read/failed)
      if (value?.statuses?.length) {
        for (const s of value.statuses) {
          await LeadWorkflowService.recordMessageStatus({
            wamid: s.id,
            status: s.status,
            timestamp: s.timestamp,
            recipientId: s.recipient_id,
            raw: s,
          });

          console.log(`📩 WA status: ${s.status} ${s.id}`);
        }
      }

      return res.sendStatus(200);
    } catch (e) {
      console.error("❌ WhatsApp webhook error:", e.message);
      return res.sendStatus(200); // evita retries agressivos da Meta
    }
  }
}

module.exports = new WhatsAppWebhookController();