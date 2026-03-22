/**
 * services/EmailCaptureService.js
 * Serviço unificado para:
 * 1. Captura automática de emails IMAP
 * 2. API REST para gerenciamento de leads
 * 3. Processamento e salvamento no PostgreSQL
 */

const Imap = require("imap");
const { simpleParser } = require("mailparser");
const cheerio = require("cheerio");
const cron = require("node-cron");
const Lead = require("../models/leads");
const LeadWorkflowService = require("./LeadWorkflowService");

class EmailCaptureService {
  constructor() {
    this.imap = null;
    this.isConnected = false;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
    this.captureTask = null;
    this.cacheCleanupTask = null;
    this.reconnectTimer = null;

    this.config = {
      user: process.env.EMAIL_USER || "leads.nextcaruberlandia@gmail.com",
      password: process.env.EMAIL_PASSWORD || "",
      host: "imap.gmail.com",
      port: 993,
      tls: true,
      tlsOptions: { rejectUnauthorized: false },
      authTimeout: 10000,
      connTimeout: 30000,
    };

    this.statsCache = {
      data: null,
      lastUpdate: null,
      ttl: 5 * 60 * 1000,
    };
  }

  /**
   * ============================================
   * PARTE 1: CONEXÃO IMAP E CAPTURA AUTOMÁTICA
   * ============================================
   */

  async connect() {
    return new Promise((resolve, reject) => {
      if (
        !this.config.user ||
        !this.config.password ||
        this.config.password === ""
      ) {
        console.log("⚠️ IMAP: Credenciais não configuradas no .env");
        return reject(new Error("Credenciais de email não configuradas"));
      }

      if (this.imap && this.isConnected) {
        return resolve();
      }

      this.imap = new Imap(this.config);

      this.imap.on("ready", () => {
        console.log("✅ IMAP conectado");
        this.isConnected = true;
        this.reconnectAttempts = 0;
        resolve();
      });

      this.imap.on("error", (err) => {
        console.error("❌ Erro IMAP:", err.message);
        this.isConnected = false;
        reject(err);
      });

      this.imap.on("end", () => {
        console.log("🔌 Conexão IMAP finalizada");
        this.isConnected = false;
        this.scheduleReconnect();
      });

      this.imap.connect();
    });
  }

  scheduleReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error("🚫 Máximo de tentativas de reconexão IMAP atingido");
      return;
    }

    const delay = Math.min(
      30000 * Math.pow(2, this.reconnectAttempts),
      300000,
    );
    console.log(`🔄 Tentando reconectar IMAP em ${delay / 1000} segundos...`);

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }

    this.reconnectTimer = setTimeout(() => {
      this.reconnectAttempts++;
      this.connect().catch(() => {
        this.scheduleReconnect();
      });
    }, delay);
  }

  async fetchAndProcessEmails() {
    try {
      if (!this.isConnected) {
        await this.connect();
      }

      const emails = await this.fetchUnreadEmails();

      if (emails.length > 0) {
        console.log(`📨 Processados ${emails.length} novos emails`);
      }

      return {
        success: true,
        processed: emails.length,
        emails,
      };
    } catch (error) {
      console.error("❌ Erro ao buscar emails:", error.message);
      return {
        success: false,
        error: error.message,
        processed: 0,
      };
    }
  }

  async fetchUnreadEmails() {
    return new Promise((resolve, reject) => {
      this.imap.openBox("INBOX", false, async (err) => {
        if (err) return reject(err);

        const sinceDate = new Date();
        sinceDate.setDate(sinceDate.getDate() - 7);

        this.imap.search(
          ["UNSEEN", ["SINCE", sinceDate.toLocaleDateString("en-CA")]],
          async (err, results) => {
            if (err) return reject(err);

            if (!results || results.length === 0) {
              console.log("📭 Nenhum email novo encontrado");
              return resolve([]);
            }

            console.log(`📨 ${results.length} novos emails encontrados`);

            const leads = [];
            const fetch = this.imap.fetch(results, {
              bodies: "",
              markSeen: true,
              struct: true,
            });

            const messagePromises = [];

            fetch.on("message", (msg) => {
              const promise = new Promise((resolveMsg) => {
                this.processMessage(msg, leads)
                  .then(() => resolveMsg())
                  .catch((error) => {
                    console.error("Erro ao processar mensagem:", error);
                    resolveMsg();
                  });
              });

              messagePromises.push(promise);
            });

            fetch.on("error", (err) => reject(err));

            fetch.on("end", async () => {
              try {
                await Promise.all(messagePromises);
                console.log(
                  `✅ ${leads.length} emails processados com sucesso`,
                );
                resolve(leads);
              } catch (error) {
                console.error("Erro ao finalizar processamento:", error);
                resolve(leads);
              }
            });
          },
        );
      });
    });
  }

  async processMessage(msg, leads) {
    return new Promise((resolve, reject) => {
      const messageData = {
        attributes: null,
        buffer: "",
      };

      let finished = false;

      const finishResolve = () => {
        if (finished) return;
        finished = true;
        resolve();
      };

      const finishReject = (error) => {
        if (finished) return;
        finished = true;
        reject(error);
      };

      msg.on("attributes", (attrs) => {
        messageData.attributes = attrs;
      });

      msg.on("body", (stream) => {
        stream.on("data", (chunk) => {
          messageData.buffer += chunk.toString("utf8");
        });
      });

      msg.once("end", async () => {
        try {
          if (!messageData.buffer) {
            console.warn("⚠️ Mensagem sem conteúdo");
            return finishResolve();
          }

          const parsed = await simpleParser(messageData.buffer);
          const lead = await this.saveLeadFromEmail(
            parsed,
            messageData.attributes || {},
          );

          if (lead) {
            leads.push(lead);
            console.log(`📝 Processado: ${lead.emailRemetente}`);
          }

          finishResolve();
        } catch (error) {
          console.error("❌ Erro ao processar mensagem:", error.message);
          finishReject(error);
        }
      });

      setTimeout(() => {
        console.warn("⏰ Timeout no processamento de mensagem");
        finishResolve();
      }, 30000);
    });
  }

  /**
   * ============================================
   * PARTE 2: PROCESSAMENTO DE DADOS
   * ============================================
   */

  async saveLeadFromEmail(emailData, attributes) {
    try {
      const { subject, from, text, html, messageId, date } = emailData;

      if (!messageId) {
        console.warn("⚠️ Email sem messageId, ignorando");
        return null;
      }

      const existingLead = await Lead.findByEmailId(messageId);
      if (existingLead) {
        console.log(`⚠️ Lead já existe: ${messageId}`);
        return null;
      }

      const fallbackText = text || this.htmlToText(html) || "";
      const platformData = this.detectAndParsePlatform(emailData);

      let leadData;

      if (platformData.platform && platformData.parsed) {
        console.log(`📊 Plataforma detectada: ${platformData.platform}`);

        const classification = this.shouldTreatAsRegularEmail(
          emailData,
          platformData.platform,
        );

        const treatAsRegularEmail = classification === "email";
        const isChatEvent = classification === "chat_event";

        const score = this.calculateLeadScore(platformData.parsed);
        const tags = this.extractLeadTags(
          platformData.parsed.veiculo,
          platformData.parsed.mensagem,
        );

        const finalOrigin = treatAsRegularEmail
          ? "Email"
          : isChatEvent
            ? "OLX Chat"
            : platformData.platform;

        const finalMensagem =
          platformData.parsed.mensagem ||
          fallbackText ||
          subject ||
          "Contato recebido";

        leadData = {
          emailId: messageId,
          remetente:
            platformData.parsed.nome || from?.text || "Remetente desconhecido",
          emailRemetente:
            platformData.parsed.email || from?.value?.[0]?.address || null,
          assunto: subject || "Email recebido",
          telefone: platformData.parsed.telefone || null,
          nome: platformData.parsed.nome || "Não informado",
          veiculoInteresse:
            platformData.parsed.veiculo ||
            this.extractVehicleInfo(subject, fallbackText),
          mensagem: finalMensagem,
          origem: finalOrigin,
          status: "novo",
          prioridade: treatAsRegularEmail
            ? "baixa"
            : this.determinePriority(
                platformData.parsed.mensagem,
                platformData.platform,
                platformData.parsed.extras || {},
              ),
          dataRecebimento: date || new Date(),
          dataContato: null,
          observacoes: null,
          vendedorId: null,
          metadata: {
            headers: emailData.headers || {},
            attachments:
              emailData.attachments?.map((a) => ({
                filename: a.filename,
                contentType: a.contentType,
                size: a.size,
              })) || [],
            imapUid: attributes.uid || 0,
            plataforma: platformData.platform,
            classificadoComo: finalOrigin,
            tratadoComoEmailComum: treatAsRegularEmail,
            dadosBrutos: platformData.rawData || {},
            preco: platformData.parsed.preco || null,
            placa: platformData.parsed.placa || null,
            extras: platformData.parsed.extras || {},
            tipoClassificacao: classification,
            isChatEvent,
          },
          score: treatAsRegularEmail ? 0 : score,
          tags: treatAsRegularEmail
            ? ["email-comum"]
            : isChatEvent
              ? ["chat-event"]
              : tags,
        };

        console.log("📋 Dados do lead preparados:");
        console.log(`   Score: ${leadData.score}`);
        console.log(`   Tags: ${leadData.tags.join(", ")}`);
        console.log(`   Prioridade: ${leadData.prioridade}`);
        console.log(`   Classificação: ${classification}`);
      } else {
        console.log("🔧 Usando parser genérico...");
        const extractedData = this.extractLeadData(emailData);

        leadData = {
          emailId: messageId,
          remetente: from?.text || "Remetente desconhecido",
          emailRemetente: from?.value?.[0]?.address || null,
          assunto: subject || "Sem assunto",
          telefone: extractedData.telefone,
          nome: extractedData.nome || from?.text || "Não informado",
          veiculoInteresse: extractedData.veiculo || "Veículo não especificado",
          mensagem: fallbackText,
          origem: this.detectClassifiedOrigin(emailData),
          status: "novo",
          prioridade: "media",
          dataRecebimento: date || new Date(),
          dataContato: null,
          observacoes: null,
          vendedorId: null,
          metadata: {
            headers: emailData.headers || {},
            attachments:
              emailData.attachments?.map((a) => ({
                filename: a.filename,
                contentType: a.contentType,
                size: a.size,
              })) || [],
            imapUid: attributes.uid || 0,
            tipoClassificacao: "lead",
            tratadoComoEmailComum: false,
          },
          score: 0,
          tags: [],
        };
      }

      const lead = new Lead(leadData);
      const savedLead = await lead.save();

      if (savedLead) {
        console.log(`✅ Lead ${savedLead.id} salvo com sucesso!`);
        console.log(`   Nome: ${savedLead.nome}`);
        console.log(`   Origem: ${savedLead.origem}`);
        console.log(`   Veículo: ${savedLead.veiculoInteresse}`);
        console.log(`   Status: ${savedLead.status}`);

        try {
          const classification =
            savedLead?.metadata?.tipoClassificacao || "lead";

          if (classification === "lead") {
            await LeadWorkflowService.onNewLead(savedLead);
          } else if (classification === "chat_event") {
            await LeadWorkflowService.onChatEvent(savedLead);
          } else {
            console.log("📧 Email comum, sem disparo de WhatsApp");
          }
        } catch (e) {
          console.error("⚠️ Falha ao processar workflow do lead:", e.message);
        }
      }

      return savedLead;
    } catch (error) {
      console.error("❌ ERRO CRÍTICO ao salvar lead:", error.message);
      console.error("Stack trace:", error.stack);
      return null;
    }
  }

  detectAndParsePlatform(emailData) {
    const { subject, from, text, html } = emailData;
    const fullText = text || this.htmlToText(html);
    const senderEmail = (from?.value?.[0]?.address || "").toLowerCase();
    const senderName = from?.text || "";

    console.log(`🔍 Analisando email de: ${senderEmail}`);
    console.log(`   Assunto: "${subject}"`);

    if (
      senderEmail.includes("mobiauto.com.br") ||
      senderEmail.includes("contato@mobiauto") ||
      text?.includes("mobiauto.com.br") ||
      html?.includes("mobiauto.com.br")
    ) {
      console.log("🎯 Detectado: Mobiauto");
      return {
        platform: "Mobiauto",
        parsed: this.parseMobiautoEmail(fullText, subject),
        rawData: { subject, senderEmail, senderName },
      };
    }

    if (
      senderEmail.includes("olx.com.br") ||
      senderEmail.includes("email@email.olx.com.br") ||
      senderEmail.includes("newsolx.com.br") ||
      text?.includes("olx.com.br") ||
      html?.includes("olx.com.br") ||
      subject?.toLowerCase().includes("olx")
    ) {
      console.log("🎯 Detectado: OLX");
      return {
        platform: "OLX",
        parsed: this.parseOlxEmail(fullText, subject, emailData),
        rawData: { subject, senderEmail, senderName },
      };
    }

    if (
      senderEmail.includes("webmotors.com.br") ||
      text?.includes("webmotors.com.br") ||
      html?.includes("webmotors.com.br") ||
      subject?.toLowerCase().includes("webmotors")
    ) {
      console.log("🎯 Detectado: Webmotors");
      return {
        platform: "Webmotors",
        parsed: this.parseWebmotorsEmail(fullText, subject),
        rawData: { subject, senderEmail, senderName },
      };
    }

    if (
      senderEmail.includes("icarros.com.br") ||
      senderEmail.includes("em.icarros.com.br") ||
      text?.toLowerCase().includes("icarros") ||
      html?.toLowerCase().includes("icarros")
    ) {
      console.log("🎯 Detectado: iCarros");
      return {
        platform: "iCarros",
        parsed: this.parseIcarrosEmail(fullText, subject, emailData),
        rawData: { subject, senderEmail, senderName },
      };
    }

    if (
      senderEmail.includes("mercadolivre") ||
      text?.includes("mercadolivre") ||
      html?.includes("mercadolivre")
    ) {
      const isPergunta =
        /Pergunta feita no an/i.test(fullText) ||
        /perguntas\/vendedor/i.test(fullText);

      const isFinanciamento =
        /quer financiar seu carro/i.test(fullText) ||
        /financiamento-veiculos/i.test(fullText);

      const parsed = isPergunta
        ? this.parseMercadoLivreQuestionEmail(fullText, subject)
        : isFinanciamento
          ? this.parseMercadoLivreFinancingLeadEmail(fullText, subject)
          : null;

      return parsed
        ? {
            platform: "MercadoLivre",
            parsed,
            rawData: { subject, senderEmail, senderName },
          }
        : { platform: null, parsed: null };
    }

    if (
      senderEmail.includes("facebookmail.com") ||
      senderEmail.includes("facebook.com") ||
      text?.includes("facebook.com/marketplace") ||
      html?.includes("facebook.com/marketplace") ||
      subject?.toLowerCase().includes("marketplace")
    ) {
      console.log("🎯 Detectado: Facebook Marketplace");
      return {
        platform: "Facebook Marketplace",
        parsed: this.parseFacebookEmail(fullText, subject),
        rawData: { subject, senderEmail, senderName },
      };
    }

    if (
      senderEmail.includes("instagram.com") ||
      text?.includes("instagram.com") ||
      html?.includes("instagram.com") ||
      subject?.toLowerCase().includes("instagram")
    ) {
      console.log("🎯 Detectado: Instagram");
      return {
        platform: "Instagram",
        parsed: this.parseInstagramEmail(fullText, subject),
        rawData: { subject, senderEmail, senderName },
      };
    }

    if (
      senderEmail.includes("whatsapp.com") ||
      text?.includes("whatsapp") ||
      html?.includes("whatsapp") ||
      subject?.toLowerCase().includes("whatsapp")
    ) {
      console.log("🎯 Detectado: WhatsApp Business");
      return {
        platform: "WhatsApp Business",
        parsed: this.parseWhatsAppEmail(fullText, subject),
        rawData: { subject, senderEmail, senderName },
      };
    }

    console.log("🔧 Nenhuma plataforma específica detectada");
    return { platform: null, parsed: null };
  }

  shouldTreatAsRegularEmail(emailData, platform) {
    const subject = String(emailData?.subject || "").toLowerCase();
    const senderEmail = String(
      emailData?.from?.value?.[0]?.address || "",
    ).toLowerCase();

    if (platform === "OLX") {
      if (senderEmail === "dicas@newsolx.com.br") {
        return "email";
      }

      const regularSubjects = [
        "anúncio excluído",
        "oba! tem mensagem nova para você sobre:",
        "falta pouco! o seu anúncio estará ativo em breve!",
        "falta pouco! sua edição estará ativa em breve!",
        "parabéns, o seu anúncio está ativo!",
        "seu anúncio vai expirar em breve",
      ];

      if (regularSubjects.some((s) => subject.includes(s))) {
        return "email";
      }

      const chatSubjects = [
        "tem mensagem te esperando no chat!",
        "tem mensagem nova para você sobre",
      ];

      if (chatSubjects.some((s) => subject.includes(s))) {
        return "chat_event";
      }
    }

    if (platform === "iCarros") {
      if (subject.includes("seu anúncio foi desativado")) {
        return "email";
      }
    }

    return "lead";
  }

  parseMobiautoEmail(text, subject) {
    const result = {
      nome: null,
      email: null,
      telefone: null,
      veiculo: null,
      mensagem: null,
      preco: null,
      placa: null,
      extras: {},
    };

    try {
      const nomeMatch =
        text.match(/Nome\s*\n\s*([^\n]+)/i) ||
        text.match(/Nome[:\s]*([^\n]+)/i);

      if (nomeMatch) result.nome = nomeMatch[1].trim();

      const emailMatch =
        text.match(/E-mail\s*\n\s*([^\n@]+@[^\n]+)/i) ||
        text.match(/Email[:\s]*([^\n@]+@[^\n]+)/i);

      if (emailMatch) result.email = emailMatch[1].trim();

      const telefoneMatch =
        text.match(/Telefone\s*\n\s*(\d{10,11})/i) ||
        text.match(/Telefone[:\s]*(\d{10,11})/i) ||
        text.match(/(\d{2}\s?\d{4,5}\s?\d{4})/);

      if (telefoneMatch) {
        result.telefone = telefoneMatch[1].replace(/\D/g, "");
      }

      const veiculoMatch =
        subject?.match(/Proposta Recebida:\s*(.+)/i) ||
        subject?.match(/Interesse[:\s]*(.+)/i);

      if (veiculoMatch) result.veiculo = veiculoMatch[1].trim();

      const mensagemMatch =
        text.match(/Mensagem\s*\n\s*["']([^"']+)["']/i) ||
        text.match(/["']([^"']+)["']/);

      if (mensagemMatch) result.mensagem = mensagemMatch[1].trim();

      const precoMatch = text.match(/R\$\s*([\d\.,]+)/i);
      if (precoMatch) result.preco = precoMatch[1].trim();

      const placaMatch = text.match(/placa[:\s]*([A-Z]{3}\d[A-Z0-9]\d{2})/i);
      if (placaMatch) result.placa = placaMatch[1].toUpperCase();
    } catch (error) {
      console.error("❌ Erro ao parsear email do Mobiauto:", error.message);
    }

    return result;
  }

  parseOlxEmail(text, subject, emailData = {}) {
    const clean = String(text || "")
      .replace(/\r/g, "")
      .replace(/=\n/g, "")
      .replace(/=20/g, " ")
      .replace(/=09/g, " ")
      .replace(/=3D/g, "=")
      .replace(/\u00A0/g, " ")
      .replace(/[ \t]+/g, " ")
      .replace(/\n\s+/g, "\n")
      .replace(/\n{2,}/g, "\n")
      .trim();

    const html = String(emailData?.html || "");

    const htmlValue = (label) => {
      const re = new RegExp(
        `<strong[^>]*>\\s*${label}:\\s*<\\/strong>\\s*<span[^>]*>\\s*([^<]+?)\\s*<\\/span>`,
        "i",
      );
      return html.match(re)?.[1]?.trim() || null;
    };

    const nome =
      htmlValue("Nome") ||
      clean.match(/Nome:\s*\n?\s*([^\n]+)/i)?.[1]?.trim() ||
      null;

    const email =
      htmlValue("Email") ||
      clean.match(/Email:\s*\n?\s*([^\s]+@[^\s]+)/i)?.[1]?.trim() ||
      null;

    const telefoneRaw =
      htmlValue("Telefone") ||
      htmlValue("WhatsApp") ||
      clean.match(/Telefone:\s*\n?\s*([^\n]+)/i)?.[1] ||
      clean.match(/WhatsApp:\s*\n?\s*([^\n]+)/i)?.[1] ||
      null;

    const telefone = telefoneRaw ? telefoneRaw.replace(/\D/g, "") : null;

    let veiculo = null;

    const priceLineIdx = clean.search(/R\$\s*[\d\.\,]+/i);
    if (priceLineIdx >= 0) {
      const window = clean.slice(
        Math.max(0, priceLineIdx - 400),
        priceLineIdx + 200,
      );
      const lines = window
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean);

      for (let i = 0; i < lines.length; i++) {
        const l = lines[i];
        if (/^R\$\s*/i.test(l)) {
          const prev = lines[i - 1];
          if (
            prev &&
            prev.length > 6 &&
            prev.length < 120 &&
            !prev.includes("http") &&
            !/nome|telefone|email/i.test(prev)
          ) {
            veiculo = prev;
            break;
          }
        }
      }
    }

    if (!veiculo && subject) veiculo = subject;

    const preco =
      clean
        .match(/R\$\s*([\d\.\,]+)/i)?.[1]
        ?.replace(/\./g, "")
        .replace(",", ".") || null;

    const lowerSubject = String(subject || "").toLowerCase();

    let mensagem = null;
    const isChatEvent =
      lowerSubject.includes("tem mensagem te esperando no chat!") ||
      lowerSubject.includes("tem mensagem nova para você sobre");

    if (isChatEvent) {
      mensagem =
        "Cliente com mensagem no chat da OLX. Acesse: https://chat.olx.com.br/";
    }

    return {
      nome,
      email,
      telefone,
      veiculo,
      mensagem,
      preco,
      placa: null,
      extras: {
        fonte: "olx",
        isChatEvent,
        chatUrl: isChatEvent ? "https://chat.olx.com.br/" : null,
      },
    };
  }

  parseIcarrosEmail(text, subject, emailData = {}) {
    const clean = String(text || "")
      .replace(/\r/g, "")
      .replace(/=\n/g, "")
      .replace(/=20/g, " ")
      .replace(/=09/g, " ")
      .replace(/=3D/g, "=")
      .replace(/\u00A0/g, " ")
      .replace(/[ \t]+/g, " ")
      .replace(/\n\s+/g, "\n")
      .replace(/\n{2,}/g, "\n")
      .trim();

    const html = String(emailData?.html || "");
    const subjectNorm = String(subject || "").replace(/\s+/g, " ").trim();
    const lowerSubject = subjectNorm.toLowerCase();
    const replyToEmail = emailData?.replyTo?.value?.[0]?.address || null;
    const replyToName = emailData?.replyTo?.text || null;

    const pickLabelValue = (label) => {
      const re = new RegExp(`${label}\\s*\\n\\s*([^\\n]+)`, "i");
      const m = clean.match(re);
      return m ? m[1].trim() : null;
    };

    const decodeBasic = (str = "") =>
      String(str)
        .replace(/=C3=81/gi, "Á")
        .replace(/=C3=89/gi, "É")
        .replace(/=C3=8D/gi, "Í")
        .replace(/=C3=93/gi, "Ó")
        .replace(/=C3=9A/gi, "Ú")
        .replace(/=C3=A1/gi, "á")
        .replace(/=C3=A9/gi, "é")
        .replace(/=C3=AD/gi, "í")
        .replace(/=C3=B3/gi, "ó")
        .replace(/=C3=BA/gi, "ú")
        .replace(/=C3=A2/gi, "â")
        .replace(/=C3=AA/gi, "ê")
        .replace(/=C3=B4/gi, "ô")
        .replace(/=C3=A3/gi, "ã")
        .replace(/=C3=B5/gi, "õ")
        .replace(/=C3=A7/gi, "ç")
        .replace(/=E2=80=93/gi, "–")
        .replace(/=E2=80=94/gi, "—")
        .replace(/=E2=80=A2/gi, "•")
        .replace(/=F0=9F=98=89/gi, "😉")
        .replace(/=F0=9F=9A=98/gi, "🚘")
        .replace(/=E2=8F=B0/gi, "⏰");

    const cleanedDecoded = decodeBasic(clean);
    const htmlText = this.htmlToText(html);
    const combined = [cleanedDecoded, htmlText, clean].join("\n");

    const isPossibleProposal =
      lowerSubject.includes("temos uma possível proposta pra você") ||
      lowerSubject.includes("temos uma possivel proposta pra você");

    const isReminderBV =
      lowerSubject.includes("pode ser aprovado no banco bv") ||
      lowerSubject.includes("já falou com") ||
      lowerSubject.includes("está interessado na sua oferta.") ||
      lowerSubject.includes("interesse na sua oferta") ||
      lowerSubject.includes("ja falou com");

    const isPreAnalise =
      /pré-analisado/i.test(subjectNorm) || /pre-analisado/i.test(subjectNorm);

    const isRegularMarketing =
      lowerSubject.includes("seu anúncio foi desativado") ||
      lowerSubject.includes("seu anuncio foi desativado");

    if (isPossibleProposal) {
      const lines = combined
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean);

      let blockStart = -1;
      let blockEnd = -1;

      for (let i = 0; i < lines.length; i++) {
        if (/Separamos as informa/i.test(lines[i])) {
          blockStart = i;
          break;
        }
      }

      if (blockStart >= 0) {
        for (let i = blockStart + 1; i < lines.length; i++) {
          if (/Esse lead ainda não converteu/i.test(lines[i])) {
            blockEnd = i;
            break;
          }
        }
      }

      const block =
        blockStart >= 0 && blockEnd > blockStart
          ? lines.slice(blockStart + 1, blockEnd)
          : lines;

      const email =
        block.find((l) => /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(l)) ||
        null;

      let nome = null;
      if (email) {
        const emailIdx = block.findIndex((l) => l === email);
        if (emailIdx > 0) {
          nome = block[emailIdx - 1] || null;
        }
      }

      const telefoneLine =
        block.find((l) => /\b\d{2}\s?9?\d{4,5}\s?\d{4}\b/.test(l)) || null;
      const telefone = telefoneLine
        ? telefoneLine.replace(/\D/g, "")
        : null;

      let cidade = null;
      if (telefoneLine) {
        const telIdx = block.findIndex((l) => l === telefoneLine);
        if (telIdx >= 0 && block[telIdx + 1]) {
          cidade = block[telIdx + 1];
        }
      }

      let veiculo = null;
      let mensagem =
        "Cliente do iCarros com possível proposta. Entre em contato rapidamente.";

      const markerIdx = block.findIndex((l) =>
        /Conferir an[uú]ncio/i.test(l),
      );

      if (markerIdx >= 2) {
        const linha1 = block[markerIdx - 2] || "";
        const linha2 = block[markerIdx - 1] || "";
        veiculo = `${linha1} ${linha2}`.replace(/\s+/g, " ").trim();
      }

      return {
        nome: nome || "Não informado",
        email: email || replyToEmail || null,
        telefone,
        veiculo: veiculo || "Veículo não especificado",
        mensagem,
        preco: null,
        placa: null,
        extras: {
          fonte: "icarros",
          tipoLead: "possivel-proposta",
          cidade,
          superQuente: false,
          preAnalisado: false,
        },
      };
    }

    if (isReminderBV) {
      const nome =
        combined.match(/CPF:\s*[\d\.\-]+\s*\n\s*([A-Za-zÀ-ÿ\s]+)$/im)?.[1]?.trim() ||
        combined.match(/CPF:\s*[\d\.\-]+[\s\S]*?\n([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ\s]+)\s*$/im)?.[1]?.trim() ||
        combined.match(/([A-Za-zÀ-ÿ]+\s+[A-Za-zÀ-ÿ\s]+)\s+pode ser aprovado no banco BV/i)?.[1]?.trim() ||
        null;

      const cpf =
        combined.match(/\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/)?.[0] || null;

      const telefone =
        combined
          .match(/api\.whatsapp\.com.*?phone=55(\d{10,11})/i)?.[1]
          ?.replace(/\D/g, "") || null;

      const financiamento = combined.match(
        /R\$\s*([\d\.\,]+)\s*\+\s*(\d{1,3})x\s*de\s*R\$\s*([\d\.\,]+)/i,
      );

      let veiculo = null;
      const blocoVeiculo =
        combined.match(
          /Simula(?:ç|c)[aã]o de financiamento[\s\S]*?([A-Z0-9À-ÿ][^\n]+)\n([^\n]+(?:R\$[^\n]+)?)/i,
        ) || null;

      if (blocoVeiculo) {
        veiculo = `${blocoVeiculo[1]} ${blocoVeiculo[2]}`
          .replace(/\s+/g, " ")
          .trim();
      }

      return {
        nome: nome || "Não informado",
        email: null,
        telefone,
        veiculo: veiculo || "Veículo não especificado",
        mensagem:
          "Lead BV/NaPista com possibilidade de aprovação de financiamento.",
        preco: null,
        placa: null,
        extras: {
          fonte: "icarros-bv-reminder",
          cpf,
          entrada: financiamento ? financiamento[1] : null,
          parcelas: financiamento
            ? { qtd: financiamento[2], valor: financiamento[3] }
            : null,
          superQuente: false,
          preAnalisado: false,
        },
      };
    }

    let nome =
      pickLabelValue("Nome") ||
      cleanedDecoded
        .match(
          /Nome\s+([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ\s]+?)(?:\n|CPF|E-mail|Telefone)/i,
        )?.[1]
        ?.trim() ||
      replyToName ||
      null;

    let email =
      pickLabelValue("E-mail") ||
      pickLabelValue("Email") ||
      replyToEmail ||
      cleanedDecoded.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] ||
      null;

    let telefoneRaw =
      pickLabelValue("Telefone") ||
      cleanedDecoded.match(/Telefone\s+(\(?\d{2}\)?\s*\d{4,5}-?\d{4})/i)?.[1] ||
      null;

    const telefone = telefoneRaw ? telefoneRaw.replace(/\D/g, "") : null;

    const cpf =
      pickLabelValue("CPF") ||
      cleanedDecoded.match(/\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/)?.[0] ||
      null;

    const veiculo =
      subjectNorm.match(/Pré-Analisado:\s*(.+)$/i)?.[1]?.trim() ||
      subjectNorm.match(/Proposta.*?:\s*(.+)$/i)?.[1]?.trim() ||
      cleanedDecoded.match(/Anúncio:\s+([^\n]+)/i)?.[1]?.trim() ||
      null;

    const mensagem =
      cleanedDecoded.match(/Mensagem\s+[“"']?([^"”'\n]+)[”"']?/i)?.[1]?.trim() ||
      "Você ainda não recebeu uma mensagem, mas a pessoa se interessou pelo carro. Aproveite o contato!";

    const preco =
      cleanedDecoded
        .match(/R\$\s*([\d\.\,]+)/i)?.[1]
        ?.replace(/\./g, "")
        .replace(",", ".") || null;

    const entrada =
      cleanedDecoded
        .match(/Entrada de R\$\s*([\d\.\,]+)/i)?.[1]
        ?.replace(/\./g, "")
        .replace(",", ".") || null;

    const superQuente = /SUPER QUENTE/i.test(cleanedDecoded);
    const preAnalisado =
      /PR[ÉE]\s*ANALISADO/i.test(cleanedDecoded) || isPreAnalise;

    if (isRegularMarketing) {
      return {
        nome,
        email,
        telefone,
        veiculo,
        mensagem: "Email informativo do iCarros.",
        preco,
        placa: null,
        extras: {
          fonte: "icarros",
          cpf,
          entrada,
          superQuente,
          preAnalisado,
          isRegularMarketing: true,
        },
      };
    }

    return {
      nome,
      email,
      telefone,
      veiculo,
      mensagem,
      preco,
      placa: null,
      extras: {
        fonte: "icarros",
        cpf,
        entrada,
        superQuente,
        preAnalisado,
      },
    };
  }

  parseMercadoLivreQuestionEmail(text, subject) {
    const clean = String(text || "")
      .replace(/\r/g, "")
      .replace(/=\n/g, "")
      .replace(/=20/g, " ")
      .replace(/=09/g, " ")
      .replace(/=3D/g, "=");

    const nome =
      clean.match(/Responda para\s+([^\n]+?)\s+o quanto antes/i)?.[1]?.trim() ||
      null;

    const veiculo =
      clean.match(/Pergunta feita no anúncio\s+([^\n<]+)/i)?.[1]?.trim() ||
      clean
        .match(/Pergunta feita no an\w+ncio\s+.*?>\s*([^<]+)\s*</i)?.[1]
        ?.trim() ||
      null;

    const questionId =
      clean.match(/question_id=3D(\d+)/i)?.[1] ||
      clean.match(/question_id=(\d+)/i)?.[1] ||
      null;

    const anuncioUrl =
      clean.match(
        /href=3D"(https?:\/\/carro\.mercadolivre\.com\.br\/[^"]+)/i,
      )?.[1] ||
      clean.match(/https?:\/\/carro\.mercadolivre\.com\.br\/\S+/i)?.[0] ||
      null;

    return {
      nome,
      email: null,
      telefone: null,
      veiculo,
      mensagem: subject || null,
      preco: null,
      placa: null,
      extras: { questionId, anuncioUrl, fonte: "mercadolivre-pergunta" },
    };
  }

  parseMercadoLivreFinancingLeadEmail(text, subject) {
    const clean = String(text || "")
      .replace(/\r/g, "")
      .replace(/=\n/g, "")
      .replace(/=20/g, " ")
      .replace(/=09/g, " ")
      .replace(/=3D/g, "=")
      .replace(/\u00A0/g, " ")
      .replace(/[ \t]+/g, " ")
      .replace(/\n\s+/g, "\n")
      .replace(/\n{2,}/g, "\n")
      .trim();

    const nome =
      clean
        .match(/([A-ZÀ-Ú][A-Za-zÀ-ÿ\s]+) quer financiar seu carro/i)?.[1]
        ?.trim() || null;

    const veiculo =
      clean.match(/financiar seu carro\s*\n\s*([^\n]+)/i)?.[1]?.trim() ||
      subject?.match(/financiamento[:\s-]*(.+)$/i)?.[1]?.trim() ||
      null;

    const telefone =
      clean.match(/\(?\d{2}\)?\s*9?\d{4,5}-?\d{4}/)?.[0]?.replace(/\D/g, "") ||
      null;

    const email =
      clean.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] || null;

    const cpf = clean.match(/\b(\d{3}\.\d{3}\.\d{3}-\d{2})\b/)?.[1] || null;

    const entrada =
      clean.match(/Entrada\s+de\s+R\$\s*=?\s*([0-9\.\,]+)/i)?.[1] || null;

    const parcelas = clean.match(
      /\b(\d{1,3})x\s+de\s+R\$\s*=?\s*([0-9\.\,]+)/i,
    );

    const leadId =
      clean.match(/lead_id=3D([a-f0-9\-]+)/i)?.[1] ||
      clean.match(/lead_id=([a-f0-9\-]+)/i)?.[1] ||
      null;

    return {
      nome,
      email,
      telefone,
      veiculo,
      mensagem: text || subject || "",
      preco: null,
      placa: null,
      extras: {
        cpf,
        entrada,
        parcelas: parcelas ? { qtd: parcelas[1], valor: parcelas[2] } : null,
        leadId,
        fonte: "mercadolivre-financiamento",
      },
    };
  }

  parseWebmotorsEmail(text, subject) {
    const veiculo =
      subject?.match(/interesse.*?:\s*(.+)$/i)?.[1]?.trim() ||
      this.extractVehicleInfo(subject, text);

    return {
      nome: null,
      email: null,
      telefone: null,
      veiculo,
      mensagem: text || subject || "",
      preco: null,
      placa: null,
      extras: { fonte: "webmotors" },
    };
  }

  parseFacebookEmail(text, subject) {
    return {
      nome: null,
      email: null,
      telefone: null,
      veiculo: this.extractVehicleInfo(subject, text),
      mensagem: text || subject || "",
      preco: null,
      placa: null,
      extras: { fonte: "facebook-marketplace" },
    };
  }

  parseInstagramEmail(text, subject) {
    return {
      nome: null,
      email: null,
      telefone: null,
      veiculo: this.extractVehicleInfo(subject, text),
      mensagem: text || subject || "",
      preco: null,
      placa: null,
      extras: { fonte: "instagram" },
    };
  }

  parseWhatsAppEmail(text, subject) {
    return {
      nome: null,
      email: null,
      telefone: null,
      veiculo: this.extractVehicleInfo(subject, text),
      mensagem: text || subject || "",
      preco: null,
      placa: null,
      extras: { fonte: "whatsapp-business" },
    };
  }

  calculateLeadScore(parsedData) {
    let score = 0;

    if (parsedData.telefone && parsedData.telefone.length >= 10) score += 25;
    if (parsedData.nome && parsedData.nome.includes(" ")) score += 15;
    if (parsedData.veiculo) score += 20;
    if (parsedData.mensagem && parsedData.mensagem.length > 50) score += 10;
    if (parsedData.email && /\S+@\S+\.\S+/.test(parsedData.email)) score += 10;

    const urgentKeywords = [
      "urgente",
      "hoje",
      "imediato",
      "rápido",
      "agora",
      "urgentemente",
    ];
    const text = (parsedData.mensagem || "").toLowerCase();
    if (urgentKeywords.some((keyword) => text.includes(keyword))) score += 20;

    return Math.min(score, 100);
  }

  extractLeadTags(veiculo, mensagem) {
    const tags = [];
    const text = ((veiculo || "") + " " + (mensagem || "")).toLowerCase();

    const marcas = [
      "chevrolet",
      "fiat",
      "volkswagen",
      "ford",
      "toyota",
      "hyundai",
      "honda",
      "nissan",
      "jeep",
      "renault",
      "bmw",
      "mercedes",
      "audi",
      "chery",
      "citroen",
      "peugeot",
    ];

    for (const marca of marcas) {
      if (text.includes(marca)) {
        tags.push(marca);
        break;
      }
    }

    if (text.includes("financiamento") || text.includes("parcelamento")) {
      tags.push("financiamento");
    }

    if (text.includes("troca") || text.includes("permuta")) {
      tags.push("troca");
    }

    if (text.includes("consórcio") || text.includes("carta")) {
      tags.push("consorcio");
    }

    if (text.includes("test drive") || text.includes("experimentar")) {
      tags.push("test-drive");
    }

    if (text.includes("urgente") || text.includes("imediato")) {
      tags.push("urgente");
    }

    return [...new Set(tags)];
  }

  determinePriority(mensagem, origem = "", extras = {}) {
    const text = String(mensagem || "").toLowerCase();
    const source = String(origem || "").toLowerCase();

    if (extras?.superQuente || extras?.preAnalisado) return "alta";
    if (source.includes("bv")) return "alta";

    const urgentKeywords = [
      "urgente",
      "hoje",
      "imediato",
      "imediatamente",
      "agora",
      "aprovado",
      "pré-analisado",
      "pre-analisado",
      "super quente",
    ];

    const mediumKeywords = [
      "interesse",
      "gostaria",
      "dúvida",
      "duvida",
      "informação",
      "informacao",
      "proposta",
      "financiamento",
    ];

    if (urgentKeywords.some((keyword) => text.includes(keyword))) {
      return "alta";
    }

    if (mediumKeywords.some((keyword) => text.includes(keyword))) {
      return "media";
    }

    return "baixa";
  }

  htmlToText(html) {
    if (!html) return "";
    try {
      const $ = cheerio.load(html);
      $("script, style, noscript").remove();
      return $("body").text().replace(/\s+/g, " ").trim();
    } catch {
      return String(html)
        .replace(/<[^>]*>/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    }
  }

  extractVehicleInfo(subject = "", text = "") {
    const combined = `${subject || ""} ${text || ""}`.trim();

    const patterns = [
      /\b(chevrolet|fiat|volkswagen|vw|ford|toyota|hyundai|honda|nissan|jeep|renault|bmw|mercedes|audi|chery|citroen|peugeot)\b[^\n]{0,80}/i,
      /\b(onix|uno|gol|polo|corolla|hilux|t-cross|compass|renegade|argo|tracker|versa|civic|hb20|tiggo)\b[^\n]{0,80}/i,
    ];

    for (const re of patterns) {
      const m = combined.match(re);
      if (m) return m[0].replace(/\s+/g, " ").trim();
    }

    return combined ? combined.substring(0, 120) : "Veículo não especificado";
  }

  extractLeadData(emailData) {
    const text = emailData.text || this.htmlToText(emailData.html);
    const subject = emailData.subject || "";

    const phone = (
      text.match(/(\+55)?\s?\(?\d{2}\)?\s?9?\d{4}[-\s]?\d{4}/)?.[0] || ""
    ).replace(/\D/g, "");

    return {
      telefone: phone.length >= 10 ? phone : null,
      nome: null,
      veiculo: this.extractVehicleInfo(subject, text),
    };
  }

  detectClassifiedOrigin(emailData) {
    const { subject, text, html } = emailData;
    const fullText = (
      `${subject || ""} ${text || ""} ${this.htmlToText(html || "")}`
    ).toLowerCase();

    if (fullText.includes("olx")) return "OLX";
    if (fullText.includes("webmotors")) return "Webmotors";
    if (fullText.includes("icarros")) return "iCarros";
    if (fullText.includes("mercadolivre")) return "MercadoLivre";
    if (fullText.includes("facebook")) return "Facebook";
    if (fullText.includes("instagram")) return "Instagram";
    if (fullText.includes("mobiauto")) return "Mobiauto";
    return "Email";
  }

  /**
   * ============================================
   * PARTE 3: API REST - ENDPOINTS PÚBLICOS
   * ============================================
   */

  async getStatus() {
    return {
      imap: {
        connected: this.isConnected,
        user: this.config.user,
        lastReconnectAttempt: this.reconnectAttempts,
      },
      service: {
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
      },
    };
  }

  async getLeads(filters = {}) {
    try {
      return await Lead.findAll(filters);
    } catch (error) {
      throw new Error(`Erro ao buscar leads: ${error.message}`);
    }
  }

  async getLeadById(id) {
    try {
      const lead = await Lead.findById(id);
      if (!lead) {
        throw new Error("Lead não encontrado");
      }
      return lead;
    } catch (error) {
      throw new Error(`Erro ao buscar lead: ${error.message}`);
    }
  }

  async createLead(leadData) {
    try {
      const lead = new Lead(leadData);
      const savedLead = await lead.save();
      this.statsCache.data = null;
      return savedLead;
    } catch (error) {
      throw new Error(`Erro ao criar lead: ${error.message}`);
    }
  }

  async updateLead(id, updates) {
    try {
      const lead = await Lead.findById(id);
      if (!lead) {
        throw new Error("Lead não encontrado");
      }

      const updatedLead = await lead.update(updates);
      this.statsCache.data = null;
      return updatedLead;
    } catch (error) {
      throw new Error(`Erro ao atualizar lead: ${error.message}`);
    }
  }

  async deleteLead(id) {
    try {
      const lead = await Lead.delete(id);
      if (!lead) {
        throw new Error("Lead não encontrado");
      }

      this.statsCache.data = null;
      return lead;
    } catch (error) {
      throw new Error(`Erro ao deletar lead: ${error.message}`);
    }
  }

  async getDashboardStats(dataInicio, dataFim) {
    const now = Date.now();
    if (
      this.statsCache.data &&
      this.statsCache.lastUpdate &&
      now - this.statsCache.lastUpdate < this.statsCache.ttl
    ) {
      return this.statsCache.data;
    }

    try {
      const stats = await Lead.getDashboardStats(dataInicio, dataFim);
      this.statsCache.data = stats;
      this.statsCache.lastUpdate = now;
      return stats;
    } catch (error) {
      throw new Error(`Erro ao buscar estatísticas: ${error.message}`);
    }
  }

  async assignLeadsToSeller(ids, vendedorId) {
    try {
      return await Lead.assignToSeller(ids, vendedorId);
    } catch (error) {
      throw new Error(`Erro ao atribuir leads: ${error.message}`);
    }
  }

  async exportLeads(filters = {}) {
    try {
      return await Lead.export(filters);
    } catch (error) {
      throw new Error(`Erro ao exportar leads: ${error.message}`);
    }
  }

  async fetchHistoricalEmails(days = 30) {
    try {
      if (!this.isConnected) {
        await this.connect();
      }

      const sinceDate = new Date();
      sinceDate.setDate(sinceDate.getDate() - days);

      return new Promise((resolve, reject) => {
        this.imap.openBox("INBOX", false, (err) => {
          if (err) return reject(err);

          this.imap.search(
            [["SINCE", sinceDate.toLocaleDateString("en-CA")]],
            async (err, results) => {
              if (err) return reject(err);

              console.log(
                `🔄 Encontrados ${results.length} emails históricos (últimos ${days} dias)`,
              );

              const leads = [];
              const fetch = this.imap.fetch(results, {
                bodies: "",
                struct: true,
              });

              fetch.on("message", (msg) => {
                this.processMessage(msg, leads).catch((e) => {
                  console.error("Erro no backfill:", e.message);
                });
              });

              fetch.on("error", reject);

              fetch.on("end", () => {
                console.log(`✅ Processados ${leads.length} emails históricos`);
                resolve({
                  success: true,
                  processed: leads.length,
                  days,
                });
              });
            },
          );
        });
      });
    } catch (error) {
      throw new Error(`Erro no backfill: ${error.message}`);
    }
  }

  async checkNow() {
    return await this.fetchAndProcessEmails();
  }

  /**
   * ============================================
   * PARTE 4: CONTROLE DE AGENDAMENTO
   * ============================================
   */

  startScheduledCapture() {
    if (!this.config.user || !this.config.password) {
      console.log(
        "⚠️ Agendador não iniciado: Credenciais de email não configuradas",
      );
      return;
    }

    if (!this.captureTask) {
      this.captureTask = cron.schedule("*/2 * * * *", async () => {
        try {
          await this.fetchAndProcessEmails();
        } catch (error) {
          console.error("Erro na captura agendada:", error.message);
        }
      });
    }

    console.log("⏰ Agendador de captura iniciado (verificação a cada 2 minutos)");

    if (!this.cacheCleanupTask) {
      this.cacheCleanupTask = cron.schedule("0 2 * * *", () => {
        this.statsCache.data = null;
        this.statsCache.lastUpdate = null;
        console.log("🧹 Cache de estatísticas limpo");
      });
    }
  }

  stopScheduledCapture() {
    if (this.captureTask) {
      this.captureTask.stop();
      this.captureTask = null;
    }

    if (this.cacheCleanupTask) {
      this.cacheCleanupTask.stop();
      this.cacheCleanupTask = null;
    }

    console.log("⏹️ Agendador de captura parado");
  }

  /**
   * ============================================
   * PARTE 5: UTILITÁRIOS
   * ============================================
   */

  disconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.imap) {
      this.imap.end();
      this.isConnected = false;
      console.log("🔌 Conexão IMAP finalizada manualmente");
    }
  }

  async testConnection() {
    try {
      await this.connect();
      return {
        success: true,
        message: "Conexão IMAP estabelecida com sucesso",
        user: this.config.user,
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        user: this.config.user,
      };
    }
  }

  invalidateCache() {
    this.statsCache.data = null;
    this.statsCache.lastUpdate = null;
    console.log("🧹 Cache invalidado");
  }
}

module.exports = new EmailCaptureService();