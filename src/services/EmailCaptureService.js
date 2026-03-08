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
      if (!this.config.user || !this.config.password) {
        console.log("⚠️ IMAP: Credenciais não configuradas no .env");
        return reject(new Error("Credenciais de email não configuradas"));
      }

      if (this.imap && this.isConnected) {
        return resolve();
      }

      // encerra instância anterior se existir
      if (this.imap) {
        try {
          this.imap.removeAllListeners();
          this.imap.end();
        } catch (_) {}
      }

      this.imap = new Imap(this.config);

      const onReady = () => {
        console.log("✅ IMAP conectado");
        this.isConnected = true;
        this.reconnectAttempts = 0;
        cleanup();
        resolve();
      };

      const onError = (err) => {
        console.error("❌ Erro IMAP:", err.message);
        this.isConnected = false;
        cleanup();
        reject(err);
      };

      const onEnd = () => {
        console.log("🔌 Conexão IMAP finalizada");
        this.isConnected = false;
        this.scheduleReconnect();
      };

      const cleanup = () => {
        this.imap.removeListener("ready", onReady);
        this.imap.removeListener("error", onError);
      };

      this.imap.on("ready", onReady);
      this.imap.on("error", onError);
      this.imap.on("end", onEnd);

      this.imap.connect();
    });
  }

  scheduleReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error("🚫 Máximo de tentativas de reconexão IMAP atingido");
      return;
    }

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    const delay = Math.min(30000 * Math.pow(2, this.reconnectAttempts), 300000);
    console.log(`🔄 Tentando reconectar IMAP em ${delay / 1000} segundos...`);

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
      this.imap.openBox("INBOX", false, (err) => {
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
              const promise = this.processMessage(msg, leads).catch((error) => {
                console.error("❌ Erro ao processar mensagem:", error.message);
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
                console.error(
                  "❌ Erro ao finalizar processamento:",
                  error.message,
                );
                resolve(leads);
              }
            });
          },
        );
      });
    });
  }

  async processMessage(msg, leads) {
    return new Promise((resolve) => {
      let done = false;

      const finish = () => {
        if (done) return;
        done = true;
        resolve();
      };

      const timeout = setTimeout(() => {
        console.warn("⏰ Timeout no processamento de mensagem");
        finish();
      }, 30000);

      const messageData = {
        attributes: null,
        buffer: "",
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
        clearTimeout(timeout);

        try {
          if (!messageData.buffer) {
            console.warn("⚠️ Mensagem sem conteúdo");
            return finish();
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

          finish();
        } catch (error) {
          console.error("❌ Erro ao processar mensagem:", error.message);
          finish();
        }
      });
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

      const senderEmail =
        from?.value?.[0]?.address || "nao-informado@origem.local";
      const senderName = from?.text || "Remetente desconhecido";
      const fallbackText = [text || "", this.htmlToText(html || "")]
        .filter(Boolean)
        .join("\n")
        .trim();

      const platformData = this.detectAndParsePlatform(emailData);

      let leadData;

      if (platformData.platform && platformData.parsed) {
        console.log(`📊 Plataforma detectada: ${platformData.platform}`);

        const score = this.calculateLeadScore(platformData.parsed);
        const tags = this.extractLeadTags(
          platformData.parsed.veiculo,
          platformData.parsed.mensagem,
          platformData.parsed.extras,
        );

        leadData = {
          emailId: messageId,
          remetente: platformData.parsed.nome || senderName || "Cliente",
          emailRemetente: platformData.parsed.email || senderEmail,
          assunto: subject || `Proposta recebida via ${platformData.platform}`,
          telefone: platformData.parsed.telefone || null,
          nome: platformData.parsed.nome || "Não informado",
          veiculoInteresse:
            platformData.parsed.veiculo ||
            this.extractVehicleInfo(subject, fallbackText),
          mensagem: platformData.parsed.mensagem || fallbackText || "",
          origem: platformData.platform,
          status: "novo",
          prioridade: this.determinePriority(platformData.parsed.mensagem),
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
            dadosBrutos: platformData.rawData || {},
            preco: platformData.parsed.preco || null,
            placa: platformData.parsed.placa || null,
            extras: platformData.parsed.extras || {},
          },
          score,
          tags,
        };

        console.log("📋 Dados do lead preparados:");
        console.log(`   Score: ${score}`);
        console.log(`   Tags: ${tags.join(", ")}`);
        console.log(`   Prioridade: ${leadData.prioridade}`);
      } else {
        console.log("🔧 Usando parser genérico...");
        const extractedData = this.extractLeadData(emailData);

        leadData = {
          emailId: messageId,
          remetente: senderName || "Remetente desconhecido",
          emailRemetente: senderEmail,
          assunto: subject || "Sem assunto",
          telefone: extractedData.telefone,
          nome: extractedData.nome || senderName || "Não informado",
          veiculoInteresse: extractedData.veiculo || "Veículo não especificado",
          mensagem: fallbackText || "",
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
          const LeadWorkflowService = require("./LeadWorkflowService");
          await LeadWorkflowService.onNewLead(savedLead);
        } catch (e) {
          console.error("⚠️ Falha ao notificar WhatsApp:", e.message);
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
    const textContent = text || "";
    const htmlContent = html || "";
    const fullText = [textContent, this.htmlToText(htmlContent)]
      .filter(Boolean)
      .join("\n");
    const senderEmail = from?.value?.[0]?.address || "";
    const senderName = from?.text || "";

    console.log(`🔍 Analisando email de: ${senderEmail}`);
    console.log(`   Assunto: "${subject}"`);

    // 1. MOBIAUTO
    if (
      senderEmail.includes("mobiauto.com.br") ||
      senderEmail.includes("contato@mobiauto") ||
      textContent.includes("mobiauto.com.br") ||
      htmlContent.includes("mobiauto.com.br")
    ) {
      console.log("🎯 Detectado: Mobiauto");
      return {
        platform: "Mobiauto",
        parsed: this.parseMobiautoEmail(fullText, subject || ""),
        rawData: { subject, senderEmail, senderName },
      };
    }

    // 2. OLX
    if (
      senderEmail.includes("olx.com.br") ||
      senderEmail.includes("email@email.olx.com.br") ||
      textContent.includes("olx.com.br") ||
      htmlContent.includes("olx.com.br") ||
      subject?.toLowerCase().includes("olx")
    ) {
      console.log("🎯 Detectado: OLX");
      return {
        platform: "OLX",
        parsed: this.parseOlxEmail(fullText, subject || ""),
        rawData: { subject, senderEmail, senderName },
      };
    }

    // 3. WEBMOTORS
    if (
      senderEmail.includes("webmotors.com.br") ||
      textContent.includes("webmotors.com.br") ||
      htmlContent.includes("webmotors.com.br") ||
      subject?.toLowerCase().includes("webmotors")
    ) {
      console.log("🎯 Detectado: Webmotors");
      return {
        platform: "Webmotors",
        parsed: this.parseWebmotorsEmail(fullText, subject || ""),
        rawData: { subject, senderEmail, senderName },
      };
    }

    // 4. ICARROS
    if (
      senderEmail.includes("icarros.com.br") ||
      textContent.toLowerCase().includes("icarros") ||
      htmlContent.toLowerCase().includes("icarros")
    ) {
      console.log("🎯 Detectado: iCarros");
      return {
        platform: "iCarros",
        parsed: this.parseIcarrosEmail(fullText, subject || "", emailData),
        rawData: { subject, senderEmail, senderName },
      };
    }

    // 5. MERCADOLIVRE
    if (
      senderEmail.includes("mercadolivre") ||
      textContent.toLowerCase().includes("mercadolivre") ||
      htmlContent.toLowerCase().includes("mercadolivre")
    ) {
      const isPergunta =
        /Pergunta feita no an/i.test(fullText) ||
        /perguntas\/vendedor/i.test(fullText);

      const isFinanciamento =
        /quer financiar seu carro/i.test(fullText) ||
        /financiamento-veiculos/i.test(fullText);

      const parsed = isPergunta
        ? this.parseMercadoLivreQuestionEmail(fullText, subject || "")
        : isFinanciamento
          ? this.parseMercadoLivreFinancingLeadEmail(fullText, subject || "")
          : null;

      return parsed
        ? {
            platform: "MercadoLivre",
            parsed,
            rawData: { subject, senderEmail, senderName },
          }
        : { platform: null, parsed: null };
    }

    // 6. FACEBOOK MARKETPLACE
    if (
      senderEmail.includes("facebookmail.com") ||
      senderEmail.includes("facebook.com") ||
      textContent.includes("facebook.com/marketplace") ||
      htmlContent.includes("facebook.com/marketplace") ||
      subject?.toLowerCase().includes("marketplace")
    ) {
      console.log("🎯 Detectado: Facebook Marketplace");
      return {
        platform: "Facebook Marketplace",
        parsed: this.parseFacebookEmail(fullText, subject || ""),
        rawData: { subject, senderEmail, senderName },
      };
    }

    // 7. INSTAGRAM
    if (
      senderEmail.includes("instagram.com") ||
      textContent.includes("instagram.com") ||
      htmlContent.includes("instagram.com") ||
      subject?.toLowerCase().includes("instagram")
    ) {
      console.log("🎯 Detectado: Instagram");
      return {
        platform: "Instagram",
        parsed: this.parseInstagramEmail(fullText, subject || ""),
        rawData: { subject, senderEmail, senderName },
      };
    }

    // 8. WHATSAPP BUSINESS
    if (
      senderEmail.includes("whatsapp.com") ||
      textContent.toLowerCase().includes("whatsapp") ||
      htmlContent.toLowerCase().includes("whatsapp") ||
      subject?.toLowerCase().includes("whatsapp")
    ) {
      console.log("🎯 Detectado: WhatsApp Business");
      return {
        platform: "WhatsApp Business",
        parsed: this.parseWhatsAppEmail(fullText, subject || ""),
        rawData: { subject, senderEmail, senderName },
      };
    }

    console.log(
      "🔧 Nenhuma plataforma específica detectada, usando parser genérico",
    );
    return { platform: null, parsed: null };
  }

  parseMobiautoEmail(text, subject) {
    console.log("📝 Parseando email do Mobiauto...");

    const result = {
      nome: null,
      email: null,
      telefone: null,
      veiculo: null,
      mensagem: null,
      preco: null,
      placa: null,
      extras: { fonte: "mobiauto" },
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

      if (telefoneMatch) result.telefone = telefoneMatch[1].replace(/\D/g, "");

      const veiculoMatch =
        subject.match(/Proposta Recebida:\s*(.+)/i) ||
        subject.match(/Interesse[:\s]*(.+)/i);

      if (veiculoMatch) result.veiculo = veiculoMatch[1].trim();

      const mensagemMatch =
        text.match(/Mensagem\s*\n\s*["']([^"']+)["']/i) ||
        text.match(/["']([^"']+)["']/);

      if (mensagemMatch) result.mensagem = mensagemMatch[1].trim();

      const precoMatch = text.match(/R\$\s*([\d\.,]+)/i);
      if (precoMatch) result.preco = precoMatch[1].trim();

      const placaMatch = text.match(/placa[:\s]*([A-Z]{3}\d[A-Z0-9]\d{2})/i);
      if (placaMatch) result.placa = placaMatch[1].toUpperCase();

      if (!result.nome) {
        const lines = text.split("\n");
        for (let line of lines) {
          line = line.trim();
          if (
            line.length > 3 &&
            line.length < 50 &&
            !line.includes("@") &&
            !line.includes("http") &&
            !line.includes("Telefone") &&
            !line.includes("E-mail") &&
            !line.includes("Mensagem") &&
            !line.includes("Nome")
          ) {
            if (/^[A-ZÀ-ÿ][a-zà-ÿ]+\s+[A-ZÀ-ÿ][a-zà-ÿ]+/.test(line)) {
              result.nome = line;
              break;
            }
          }
        }
      }
    } catch (error) {
      console.error("❌ Erro ao parsear email do Mobiauto:", error.message);
    }

    return result;
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

    const pickLabelValue = (label) => {
      const re = new RegExp(`${label}\\s*\\n\\s*([^\\n]+)`, "i");
      const m = clean.match(re);
      return m ? m[1].trim() : null;
    };

    const replyToEmail = emailData?.replyTo?.value?.[0]?.address || null;
    const replyToName = emailData?.replyTo?.text || null;

    let nome =
      pickLabelValue("Nome") ||
      clean
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
      clean.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] ||
      null;

    let telefoneRaw =
      pickLabelValue("Telefone") ||
      clean.match(/Telefone\s+(\(?\d{2}\)?\s*\d{4,5}-?\d{4})/i)?.[1] ||
      null;

    const telefone = telefoneRaw ? telefoneRaw.replace(/\D/g, "") : null;

    const cpf =
      pickLabelValue("CPF") ||
      clean.match(/\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/)?.[0] ||
      null;

    const subj = String(subject || "")
      .replace(/\s+/g, " ")
      .trim();

    const veiculo =
      subj.match(/Pré-Analisado:\s*(.+)$/i)?.[1]?.trim() ||
      subj.match(/Proposta.*?:\s*(.+)$/i)?.[1]?.trim() ||
      clean.match(/Anúncio:\s+([^\n]+)/i)?.[1]?.trim() ||
      null;

    const mensagem =
      clean.match(/Mensagem\s+[“"']?([^"”'\n]+)[”"']?/i)?.[1]?.trim() ||
      "Você ainda não recebeu uma mensagem, mas a pessoa se interessou pelo carro. Aproveite o contato!";

    const preco =
      clean
        .match(/R\$\s*([\d\.\,]+)/i)?.[1]
        ?.replace(/\./g, "")
        .replace(",", ".") || null;

    const entrada =
      clean
        .match(/Entrada de R\$\s*([\d\.\,]+)/i)?.[1]
        ?.replace(/\./g, "")
        .replace(",", ".") || null;

    const superQuente = /SUPER QUENTE/i.test(clean);
    const preAnalisado = /PR[ÉE]\s*ANALISADO/i.test(clean);

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

  parseOlxEmail(text, subject) {
    const clean = String(text || "")
      .replace(/\r/g, "")
      .replace(/=\n/g, "") // quoted-printable soft break
      .replace(/=20/g, " ")
      .replace(/=09/g, " ")
      .replace(/=3D/g, "=")
      .replace(/\u00A0/g, " ")
      .replace(/[ \t]+/g, " ")
      .replace(/\n\s+/g, "\n")
      .replace(/\n{2,}/g, "\n")
      .trim();

    const pickHtmlField = (label) => {
      const re = new RegExp(
        `<strong\\s*>\\s*${label}\\s*:?\\s*<\\/strong>\\s*<span>\\s*([^<]+?)\\s*<\\/span>`,
        "i",
      );
      return clean.match(re)?.[1]?.trim() || null;
    };

    const pickTextField = (label) => {
      return (
        clean
          .match(new RegExp(`${label}:\\s*\\n\\s*([^\\n]+)`, "i"))?.[1]
          ?.trim() ||
        clean.match(new RegExp(`${label}:\\s*([^\\n<]+)`, "i"))?.[1]?.trim() ||
        null
      );
    };

    const nome = pickHtmlField("Nome") || pickTextField("Nome") || null;

    const email =
      pickHtmlField("Email") ||
      pickTextField("Email") ||
      clean.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] ||
      null;

    const telefoneRaw =
      pickHtmlField("Telefone") ||
      pickHtmlField("WhatsApp") ||
      pickTextField("Telefone") ||
      pickTextField("WhatsApp") ||
      clean.match(/(\(?\d{2}\)?\s*9?\d{4,5}-?\d{4})/)?.[1] ||
      null;

    const telefone = telefoneRaw ? telefoneRaw.replace(/\D/g, "") : null;

    let veiculo = null;

    const priceLineIdx = clean.search(/R\$\s*[\d\.\,]+/i);
    if (priceLineIdx >= 0) {
      const window = clean.slice(
        Math.max(0, priceLineIdx - 500),
        priceLineIdx + 250,
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
            prev.length < 140 &&
            !prev.includes("http") &&
            !/nome|telefone|email|whatsapp/i.test(prev)
          ) {
            veiculo = prev;
            break;
          }
        }
      }
    }

    if (!veiculo && subject) {
      veiculo = subject
        .replace(/\s+/g, " ")
        .replace(/^.*?(interesse|proposta|contato)[:\-\s]*/i, "")
        .trim();
    }

    const preco =
      clean
        .match(/R\$\s*([\d\.\,]+)/i)?.[1]
        ?.replace(/\./g, "")
        .replace(",", ".") || null;

    return {
      nome,
      email,
      telefone,
      veiculo,
      mensagem: null,
      preco,
      placa: null,
      extras: { fonte: "olx" },
    };
  }

  parseMercadoLivreQuestionEmail(text, subject) {
    const clean = text.replace(/\r/g, "");

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
    const clean = text.replace(/\r/g, "");

    const nome =
      clean
        .match(
          /([A-Za-zÀ-ÿ]+\s+[A-Za-zÀ-ÿ]\.)\s+quer\s+financiar\s+seu\s+carro/i,
        )?.[1]
        ?.trim() ||
      clean.match(/<h5[^>]*>\s*([^<]+)\s*<\/h5>/i)?.[1]?.trim() ||
      null;

    const veiculo =
      clean
        .match(
          /quer financiar seu carro\s*<\/h3>\s*<h5[^>]*>\s*([^<]+)\s*</i,
        )?.[1]
        ?.trim() ||
      clean
        .match(/<h5 class=3D"card-main-subtitle"[^>]*>\s*([^<]+)\s*</i)?.[1]
        ?.trim() ||
      null;

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
      email: null,
      telefone: null,
      veiculo,
      mensagem: subject || null,
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

  // stubs defensivos para plataformas ainda não implementadas
  parseWebmotorsEmail(text, subject) {
    return {
      nome: null,
      email: null,
      telefone: null,
      veiculo: this.extractVehicleInfo(subject, text),
      mensagem: null,
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
      mensagem: null,
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
      mensagem: null,
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
      mensagem: text || null,
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

    if (parsedData.extras?.preAnalisado) score += 10;
    if (parsedData.extras?.superQuente) score += 10;

    return Math.min(score, 100);
  }

  extractLeadTags(veiculo, mensagem, extras = {}) {
    const tags = [];
    const text = `${veiculo || ""} ${mensagem || ""}`.toLowerCase();

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
    ];

    for (const marca of marcas) {
      if (text.includes(marca)) {
        tags.push(marca);
        break;
      }
    }

    if (
      text.includes("financiamento") ||
      text.includes("parcelamento") ||
      extras?.entrada
    ) {
      tags.push("financiamento");
    }

    if (text.includes("troca") || text.includes("permuta")) tags.push("troca");
    if (
      text.includes("consórcio") ||
      text.includes("consorcio") ||
      text.includes("carta")
    ) {
      tags.push("consorcio");
    }
    if (text.includes("test drive") || text.includes("experimentar"))
      tags.push("test-drive");
    if (text.includes("urgente") || text.includes("imediato"))
      tags.push("urgente");
    if (extras?.preAnalisado) tags.push("pre-analisado");
    if (extras?.superQuente) tags.push("super-quente");

    return [...new Set(tags)];
  }

  determinePriority(mensagem) {
    if (!mensagem) return "media";

    const text = mensagem.toLowerCase();
    const urgentKeywords = [
      "urgente",
      "hoje",
      "imediato",
      "imediatamente",
      "agora",
    ];
    const highPriorityKeywords = [
      "interesse",
      "gostaria",
      "dúvida",
      "duvida",
      "informação",
      "informacao",
    ];

    if (urgentKeywords.some((keyword) => text.includes(keyword))) return "alta";
    if (highPriorityKeywords.some((keyword) => text.includes(keyword)))
      return "media";
    return "baixa";
  }

  htmlToText(html) {
    if (!html) return "";

    try {
      const $ = cheerio.load(html);
      $("script, style").remove();

      $("br").replaceWith("\n");
      $("p, div, tr, li, td, th, h1, h2, h3, h4, h5, h6").append("\n");

      return $("body")
        .text()
        .replace(/\r/g, "")
        .replace(/[ \t]+\n/g, "\n")
        .replace(/\n{2,}/g, "\n")
        .trim();
    } catch {
      return String(html)
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<\/(p|div|tr|li|td|th|h[1-6])>/gi, "\n")
        .replace(/<[^>]*>/g, " ")
        .replace(/\r/g, "")
        .replace(/[ \t]+\n/g, "\n")
        .replace(/\n{2,}/g, "\n")
        .trim();
    }
  }

  extractVehicleInfo(subject = "", text = "") {
    const combined = `${subject || ""} ${text || ""}`.trim();
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
    const fullText =
      `${subject || ""} ${text || ""} ${this.htmlToText(html || "")}`.toLowerCase();

    if (fullText.includes("olx")) return "OLX";
    if (fullText.includes("webmotors")) return "Webmotors";
    if (fullText.includes("icarros")) return "iCarros";
    if (fullText.includes("mercadolivre")) return "MercadoLivre";
    if (fullText.includes("facebook")) return "Facebook";
    if (fullText.includes("instagram")) return "Instagram";
    if (fullText.includes("whatsapp")) return "WhatsApp";
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
      if (!lead) throw new Error("Lead não encontrado");
      return lead;
    } catch (error) {
      throw new Error(`Erro ao buscar lead: ${error.message}`);
    }
  }

  async createLead(leadData) {
    try {
      const lead = new Lead(leadData);
      const savedLead = await lead.save();
      this.invalidateCache();
      return savedLead;
    } catch (error) {
      throw new Error(`Erro ao criar lead: ${error.message}`);
    }
  }

  async updateLead(id, updates) {
    try {
      const lead = await Lead.findById(id);
      if (!lead) throw new Error("Lead não encontrado");

      const updatedLead = await lead.update(updates);
      this.invalidateCache();
      return updatedLead;
    } catch (error) {
      throw new Error(`Erro ao atualizar lead: ${error.message}`);
    }
  }

  async deleteLead(id) {
    try {
      const lead = await Lead.delete(id);
      if (!lead) throw new Error("Lead não encontrado");

      this.invalidateCache();
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
            (err, results) => {
              if (err) return reject(err);

              const total = results?.length || 0;
              console.log(
                `🔄 Encontrados ${total} emails históricos (últimos ${days} dias)`,
              );

              if (!results || results.length === 0) {
                return resolve({
                  success: true,
                  processed: 0,
                  days,
                });
              }

              const leads = [];
              const fetch = this.imap.fetch(results, {
                bodies: "",
                struct: true,
              });

              const messagePromises = [];

              fetch.on("message", (msg) => {
                const promise = this.processMessage(msg, leads).catch(
                  (error) => {
                    console.error(
                      "❌ Erro ao processar histórico:",
                      error.message,
                    );
                  },
                );
                messagePromises.push(promise);
              });

              fetch.on("error", reject);

              fetch.on("end", async () => {
                await Promise.all(messagePromises);
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
          console.error("❌ Erro na captura agendada:", error.message);
        }
      });

      console.log(
        "⏰ Agendador de captura iniciado (verificação a cada 2 minutos)",
      );
    }

    if (!this.cacheCleanupTask) {
      this.cacheCleanupTask = cron.schedule("0 2 * * *", () => {
        this.invalidateCache();
        console.log("🧹 Cache de estatísticas limpo");
      });
    }
  }

  stopScheduledCapture() {
    this.captureTask?.stop();
    this.cacheCleanupTask?.stop();
    this.captureTask = null;
    this.cacheCleanupTask = null;
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
      try {
        this.imap.end();
      } catch (_) {}
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
