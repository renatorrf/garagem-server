const LeadWorkflowService = require('../services/LeadWorkflowService');
const TenantIntegrationService = require('../services/TenantIntegrationService');

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
          const metadata = value?.metadata || {};
          const waConfig = await TenantIntegrationService.getWhatsAppConfig({ externalId: metadata?.phone_number_id || null });
          const context = { tenantId: waConfig?.tenantId || null, schema: waConfig?.schema || null };
          const messages = value?.messages || [];

          for (const msg of messages) {
            const from = msg?.from || null;

            if (msg?.type === 'interactive') {
              const interactive = msg?.interactive;

              if (interactive?.type === 'button_reply') {
                const id = interactive?.button_reply?.id || '';
                const title = interactive?.button_reply?.title || '';

                if (id.startsWith('lead:start-attendance:')) {
                  const leadId = id.split(':').pop();
                  console.log('🟢 Botão iniciar atendimento recebido:', {
                    id,
                    title,
                    from,
                  });

                  const claimedLead = await LeadWorkflowService.claimLead(
                    leadId,
                    'nextcar',
                    context,
                  );

                  if (claimedLead) {
                    await LeadWorkflowService.openCustomerConversation(
                      leadId,
                      context,
                    );
                  }
                  continue;
                }
                console.log('🔘 Button reply recebido:', { id, title, from });
              }

              if (interactive?.type === 'list_reply') {
                const id = interactive?.list_reply?.id || '';
                const title = interactive?.list_reply?.title || '';

                console.log('📋 List reply recebido:', { id, title, from });
              }
            }

            if (msg?.type === 'text') {
              console.log(
                `📩 Mensagem recebida de ${from}: ${msg?.text?.body || ''}`,
              );
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
            }, context);

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
