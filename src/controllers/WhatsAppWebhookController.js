const LeadWorkflowService = require('../services/LeadWorkflowService');

class WhatsAppWebhookController {
  async verify(req, res) {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (
      mode === 'subscribe' &&
      token === process.env.WA_WEBHOOK_VERIFY_TOKEN
    ) {
      return res.status(200).send(challenge);
    }

    return res.sendStatus(403);
  }

  async handle(req, res) {
    try {
      const body = req.body;

      if (body?.object !== 'whatsapp_business_account') {
        return res.sendStatus(200);
      }

      const entries = body?.entry || [];

      for (const entry of entries) {
        const changes = entry?.changes || [];

        for (const change of changes) {
          if (change?.field !== 'messages') continue;

          const value = change?.value || {};

          const messages = value?.messages || [];

          for (const msg of messages) {
            const from = msg?.from || null;

            if (msg?.type === 'text') {
              console.log(
                `📩 Mensagem recebida de ${from}: ${msg?.text?.body || ''}`,
              );
            }

            if (msg?.type === 'interactive') {
              const interactive = msg?.interactive;

              if (interactive?.type === 'button_reply') {
                const id = interactive?.button_reply?.id || '';
                const title = interactive?.button_reply?.title || '';

                console.log('🔘 Button reply recebido:', { id, title, from });

                if (id.startsWith('claim:')) {
                  const [, leadId] = id.split(':');

                  if (leadId) {
                    await LeadWorkflowService.claimLead(leadId, from);
                    console.log(`✅ Lead assumido: ${leadId} por ${from}`);
                  }
                } else if (id.startsWith('ignore:')) {
                  const [, leadId] = id.split(':');

                  if (leadId) {
                    await LeadWorkflowService.ignoreLead(leadId, from);
                    console.log(`🚫 Lead ignorado: ${leadId}`);
                  }
                } else if (id.startsWith('seller:')) {
                  const [, sellerRaw, leadId] = id.split(':');
                  const sellerKey = (sellerRaw || '').toLowerCase().trim();
                  const sellerInfo =
                    LeadWorkflowService.sellerCatalog()[sellerKey];

                  if (leadId && sellerInfo) {
                    await LeadWorkflowService.assignSeller({
                      leadId,
                      sellerKey: sellerInfo.key,
                      sellerId: sellerInfo.id,
                      sellerName: sellerInfo.name,
                      from,
                    });

                    console.log(
                      `👤 Vendedor selecionado: ${sellerInfo.name} (ID ${sellerInfo.id}) para lead ${leadId}`,
                    );
                  } else {
                    console.warn('⚠️ Seller inválido ou leadId ausente:', {
                      sellerKey,
                      leadId,
                      from,
                    });
                  }
                } else {
                  console.warn('⚠️ Button reply não tratado:', {
                    id,
                    title,
                    from,
                  });
                }
              }

              if (interactive?.type === 'list_reply') {
                const id = interactive?.list_reply?.id || '';
                const title = interactive?.list_reply?.title || '';

                console.log('📋 List reply recebido:', { id, title, from });

                if (id.startsWith('outcome:')) {
                  const [, outcome, leadId] = id.split(':');

                  if (outcome && leadId) {
                    await LeadWorkflowService.setOutcome({ leadId, outcome });
                    console.log(
                      `📌 Outcome definido: lead ${leadId}, outcome ${outcome}`,
                    );
                  }
                } else {
                  console.warn('⚠️ List reply não tratado:', {
                    id,
                    title,
                    from,
                  });
                }
              }
            }
          }

          const statuses = value?.statuses || [];

          for (const s of statuses) {
            await LeadWorkflowService.recordMessageStatus({
              wamid: s?.id,
              status: s?.status,
              timestamp: s?.timestamp,
              recipientId: s?.recipient_id,
              raw: s,
            });

            if (s?.errors?.length) {
              console.error(
                '❌ WA status errors:',
                JSON.stringify(s.errors, null, 2),
              );
            }

            console.log('📩 WA status payload:', JSON.stringify(s, null, 2));
            console.log(`📩 WA status: ${s?.status} ${s?.id}`);
          }
        }
      }

      return res.sendStatus(200);
    } catch (e) {
      console.error('❌ WhatsApp webhook error:', e);
      return res.sendStatus(200);
    }
  }
}

module.exports = new WhatsAppWebhookController();