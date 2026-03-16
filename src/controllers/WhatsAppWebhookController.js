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

      if (body?.object !== "whatsapp_business_account") {
        return res.sendStatus(200);
      }

      const entries = body?.entry || [];

      for (const entry of entries) {
        const changes = entry?.changes || [];

        for (const change of changes) {
          if (change?.field !== "messages") continue;

          const value = change?.value || {};

          // 1) mensagens recebidas
          const messages = value?.messages || [];

          for (const msg of messages) {
            const from = msg?.from || null;

            // texto normal
            if (msg?.type === "text") {
              console.log(
                `📩 Mensagem recebida de ${from}: ${msg?.text?.body || ""}`,
              );
            }

            // interativo
            if (msg?.type === "interactive") {
              const interactive = msg?.interactive;

              // botão (button_reply)
              if (interactive?.type === "button_reply") {
                const id = interactive?.button_reply?.id || "";

                if (id.startsWith("claim:")) {
                  const [, leadId] = id.split(":");

                  if (leadId) {
                    await LeadWorkflowService.claimLead(leadId, from);
                    console.log(`✅ Lead assumido: ${leadId} por ${from}`);
                  }
                } else if (id.startsWith("ignore:")) {
                  const [, leadId] = id.split(":");

                  if (leadId) {
                    await LeadWorkflowService.ignoreLead(leadId);
                    console.log(`🚫 Lead ignorado: ${leadId}`);
                  }
                } else if (id.startsWith("seller:")) {
                  const [, sellerRaw, leadId] = id.split(":");
                  const seller = (sellerRaw || "").toLowerCase().trim();
                  const allowedSellers = ["gustavo", "lucas", "luis"];

                  if (leadId && allowedSellers.includes(seller)) {
                    if (
                      typeof LeadWorkflowService.assignSeller === "function"
                    ) {
                      await LeadWorkflowService.assignSeller({
                        leadId,
                        seller,
                        from,
                      });
                    } else {
                      console.log("👤 Seleção de vendedor recebida:", {
                        leadId,
                        seller,
                        from,
                      });
                    }

                    console.log(
                      `👤 Vendedor selecionado: ${seller} para lead ${leadId}`,
                    );
                  } else {
                    console.warn("⚠️ Seller inválido ou leadId ausente:", {
                      seller,
                      leadId,
                      from,
                    });
                  }
                }
              }

              // lista (list_reply)
              if (interactive?.type === "list_reply") {
                const id = interactive?.list_reply?.id || "";

                if (id.startsWith("outcome:")) {
                  const [, outcome, leadId] = id.split(":");

                  if (outcome && leadId) {
                    await LeadWorkflowService.setOutcome({ leadId, outcome });
                    console.log(
                      `📌 Outcome definido: lead ${leadId}, outcome ${outcome}`,
                    );
                  }
                }
              }
            }
          }

          // 2) status de mensagens (sent/delivered/read/failed)
          const statuses = value?.statuses || [];

          for (const s of statuses) {
            await LeadWorkflowService.recordMessageStatus({
              wamid: s?.id,
              status: s?.status,
              timestamp: s?.timestamp,
              recipientId: s?.recipient_id,
              raw: s,
            });

            console.log(`📩 WA status: ${s?.status} ${s?.id}`);
          }
        }
      }

      return res.sendStatus(200);
    } catch (e) {
      console.error("❌ WhatsApp webhook error:", e);
      return res.sendStatus(200); // evita retries agressivos da Meta
    }
  }
}

module.exports = new WhatsAppWebhookController();
