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

    // Configuração com fallback seguro
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

    // Cache para estatísticas
    this.statsCache = {
      data: null,
      lastUpdate: null,
      ttl: 5 * 60 * 1000, // 5 minutos
    };
  }

  /**
   * ============================================
   * PARTE 1: CONEXÃO IMAP E CAPTURA AUTOMÁTICA
   * ============================================
   */

  async connect() {
    return new Promise((resolve, reject) => {
      // Verificar se credenciais estão configuradas
      if (
        !this.config.user ||
        !this.config.password ||
        this.config.password === ""
      ) {
        console.log("⚠️  IMAP: Credenciais não configuradas no .env");
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

    const delay = Math.min(30000 * Math.pow(2, this.reconnectAttempts), 300000);
    console.log(`🔄 Tentando reconectar IMAP em ${delay / 1000} segundos...`);

    setTimeout(() => {
      this.reconnectAttempts++;
      this.connect().catch(() => {
        this.scheduleReconnect();
      });
    }, delay);
  }

  /**
   * Busca emails não lidos e salva como leads
   */
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
        emails: emails,
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
      this.imap.openBox("INBOX", false, async (err, box) => {
        if (err) return reject(err);

        // Buscar emails não lidos dos últimos 7 dias
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

            // Criar array de promessas para processar cada mensagem
            const messagePromises = [];

            fetch.on("message", (msg) => {
              const promise = new Promise((resolveMsg, rejectMsg) => {
                this.processMessage(msg, leads)
                  .then(() => resolveMsg())
                  .catch((error) => {
                    console.error("Erro ao processar mensagem:", error);
                    resolveMsg(); // Continua mesmo com erro
                  });
              });
              messagePromises.push(promise);
            });

            fetch.on("error", (err) => {
              reject(err);
            });

            fetch.on("end", async () => {
              try {
                // Aguardar todas as mensagens serem processadas
                await Promise.all(messagePromises);
                console.log(
                  `✅ ${leads.length} emails processados com sucesso`,
                );
                resolve(leads);
              } catch (error) {
                console.error("Erro ao finalizar processamento:", error);
                resolve(leads); // Retorna o que foi processado mesmo com erro
              }
            });
          },
        );
      });
    });
  }

  async processMessage(msg, leads) {
    return new Promise((resolve, reject) => {
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

      // ...
      msg.once("end", async () => {
        clearTimeout(timeout);
        try {
          // processa
          finish();
        } catch (e) {
          finish(); // ou reject(e) se quiser falhar
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

      // Verificar se lead já existe
      const existingLead = await Lead.findByEmailId(messageId);
      if (existingLead) {
        console.log(`⚠️ Lead já existe: ${messageId}`);
        return null;
      }

      // Detectar plataforma e extrair dados específicos
      const platformData = this.detectAndParsePlatform(emailData);

      let leadData;

      if (platformData.platform && platformData.parsed) {
        console.log(`📊 Plataforma detectada: ${platformData.platform}`);

        // Calcular score baseado nos dados extraídos
        const score = this.calculateLeadScore(platformData.parsed);

        // Extrair tags do veículo e mensagem
        const tags = this.extractLeadTags(
          platformData.parsed.veiculo,
          platformData.parsed.mensagem,
        );

        leadData = {
          emailId: messageId,
          remetente:
            platformData.parsed.nome || from.text || "Cliente Mobiauto",
          emailRemetente: platformData.parsed.email || from.value[0].address,
          assunto: subject || "Proposta recebida via Mobiauto",
          telefone: platformData.parsed.telefone || null,
          nome: platformData.parsed.nome || "Não informado",
          veiculoInteresse:
            platformData.parsed.veiculo ||
            this.extractVehicleInfo(subject, text || ""),
          mensagem: subject,
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
          },
          score: score,
          tags: tags,
        };

        console.log("📋 Dados do lead preparados:");
        console.log(`   Score: ${score}`);
        console.log(`   Tags: ${tags.join(", ")}`);
        console.log(`   Prioridade: ${leadData.prioridade}`);
      } else {
        // Fallback para processamento genérico
        console.log("🔧 Usando parser genérico...");
        const extractedData = this.extractLeadData(emailData);

        leadData = {
          emailId: messageId,
          remetente: from.text || "Remetente desconhecido",
          emailRemetente: from.value[0].address,
          assunto: subject || "Sem assunto",
          telefone: extractedData.telefone,
          nome: extractedData.nome || from.text || "Não informado",
          veiculoInteresse: extractedData.veiculo || "Veículo não especificado",
          mensagem: text || this.htmlToText(html) || "",
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
    const fullText = text || this.htmlToText(html);
    const senderEmail = from.value[0].address;
    const senderName = from.text;

    console.log(`🔍 Analisando email de: ${senderEmail}`);
    console.log(`   Assunto: "${subject}"`);

    // 1. MOBIAUTO
    if (
      senderEmail.includes("mobiauto.com.br") ||
      senderEmail.includes("contato@mobiauto") ||
      text?.includes("mobiauto.com.br") ||
      html?.includes("mobiauto.com.br")
    ) {
      console.log("🎯 Detectado: Mobiauto");
      const parsed = this.parseMobiautoEmail(fullText, subject);
      return {
        platform: "Mobiauto",
        parsed: parsed,
        rawData: { subject, senderEmail, senderName },
      };
    }

    // 2. OLX
    if (
      senderEmail.includes("olx.com.br") ||
      senderEmail.includes("email@email.olx.com.br") ||
      text?.includes("olx.com.br") ||
      html?.includes("olx.com.br") ||
      subject?.toLowerCase().includes("olx")
    ) {
      console.log("🎯 Detectado: OLX");
      const parsed = this.parseOlxEmail(fullText, subject);
      return {
        platform: "OLX",
        parsed: parsed,
        rawData: { subject, senderEmail, senderName },
      };
    }

    // 3. WEBMOTORS
    if (
      senderEmail.includes("webmotors.com.br") ||
      text?.includes("webmotors.com.br") ||
      html?.includes("webmotors.com.br") ||
      subject?.toLowerCase().includes("webmotors")
    ) {
      console.log("🎯 Detectado: Webmotors");
      const parsed = this.parseWebmotorsEmail(fullText, subject);
      return {
        platform: "Webmotors",
        parsed: parsed,
        rawData: { subject, senderEmail, senderName },
      };
    }

    // 4. ICARROS
    if (
      senderEmail.includes("icarros.com.br") ||
      text?.includes("icarros") ||
      html?.includes("icarros")
    ) {
      const parsed = this.parseIcarrosEmail(fullText, subject);
      return {
        platform: "iCarros",
        parsed,
        rawData: { subject, senderEmail, senderName },
      };
    }

    // 4. MERCADOLIVRE (perguntas e financiamento)
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

    // 4. FACEBOOK MARKETPLACE
    if (
      senderEmail.includes("facebookmail.com") ||
      senderEmail.includes("facebook.com") ||
      text?.includes("facebook.com/marketplace") ||
      html?.includes("facebook.com/marketplace") ||
      subject?.toLowerCase().includes("marketplace")
    ) {
      console.log("🎯 Detectado: Facebook Marketplace");
      const parsed = this.parseFacebookEmail(fullText, subject);
      return {
        platform: "Facebook Marketplace",
        parsed: parsed,
        rawData: { subject, senderEmail, senderName },
      };
    }

    // 5. INSTAGRAM
    if (
      senderEmail.includes("instagram.com") ||
      text?.includes("instagram.com") ||
      html?.includes("instagram.com") ||
      subject?.toLowerCase().includes("instagram")
    ) {
      console.log("🎯 Detectado: Instagram");
      const parsed = this.parseInstagramEmail(fullText, subject);
      return {
        platform: "Instagram",
        parsed: parsed,
        rawData: { subject, senderEmail, senderName },
      };
    }

    // 6. WHATSAPP BUSINESS
    if (
      senderEmail.includes("whatsapp.com") ||
      text?.includes("whatsapp") ||
      html?.includes("whatsapp") ||
      subject?.toLowerCase().includes("whatsapp")
    ) {
      console.log("🎯 Detectado: WhatsApp Business");
      const parsed = this.parseWhatsAppEmail(fullText, subject);
      return {
        platform: "WhatsApp Business",
        parsed: parsed,
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
    };

    try {
      // Extrair nome
      const nomeMatch =
        text.match(/Nome\s*\n\s*([^\n]+)/i) ||
        text.match(/Nome[:\s]*([^\n]+)/i);
      if (nomeMatch) {
        result.nome = nomeMatch[1].trim();
        console.log(`   👤 Nome: ${result.nome}`);
      }

      // Extrair email
      const emailMatch =
        text.match(/E-mail\s*\n\s*([^\n@]+@[^\n]+)/i) ||
        text.match(/Email[:\s]*([^\n@]+@[^\n]+)/i);
      if (emailMatch) {
        result.email = emailMatch[1].trim();
        console.log(`   📧 Email: ${result.email}`);
      }

      // Extrair telefone (formato do Mobiauto)
      const telefoneMatch =
        text.match(/Telefone\s*\n\s*(\d{10,11})/i) ||
        text.match(/Telefone[:\s]*(\d{10,11})/i) ||
        text.match(/(\d{2}\s?\d{4,5}\s?\d{4})/);
      if (telefoneMatch) {
        result.telefone = telefoneMatch[1].replace(/\D/g, "");
        console.log(`   📱 Telefone: ${result.telefone}`);
      }

      // Extrair veículo do assunto
      const veiculoMatch =
        subject.match(/Proposta Recebida:\s*(.+)/i) ||
        subject.match(/Interesse[:\s]*(.+)/i);
      if (veiculoMatch) {
        result.veiculo = veiculoMatch[1].trim();
        console.log(`   🚗 Veículo: ${result.veiculo}`);
      }

      // Extrair mensagem (está entre aspas no Mobiauto)
      const mensagemMatch =
        text.match(/Mensagem\s*\n\s*["']([^"']+)["']/i) ||
        text.match(/["']([^"']+)["']/);
      if (mensagemMatch) {
        result.mensagem = mensagemMatch[1].trim();
        console.log(`   💬 Mensagem: ${result.mensagem.substring(0, 50)}...`);
      }

      // Extrair preço (R$ X.XXX,XX)
      const precoMatch = text.match(/R\$\s*([\d\.,]+)/i);
      if (precoMatch) {
        result.preco = precoMatch[1].trim();
        console.log(`   💰 Preço: R$ ${result.preco}`);
      }

      // Extrair placa (padrão brasileiro)
      const placaMatch = text.match(/placa[:\s]*([A-Z]{3}\d[A-Z0-9]\d{2})/i);
      if (placaMatch) {
        result.placa = placaMatch[1].toUpperCase();
        console.log(`   🚘 Placa: ${result.placa}`);
      }

      // Se não encontrou nome no formato padrão, tenta extrair do início
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
            // Verifica se parece um nome (tem espaço, começa com maiúscula)
            if (/^[A-ZÀ-ÿ][a-zà-ÿ]+\s+[A-ZÀ-ÿ][a-zà-ÿ]+/.test(line)) {
              result.nome = line;
              break;
            }
          }
        }
      }
    } catch (error) {
      console.error("❌ Erro ao parsear email do Mobiauto:", error);
    }

    return result;
  }

  parseIcarrosEmail(text, subject, emailData = {}) {
    // Normaliza texto bruto
    const clean = String(text || "")
      .replace(/\r/g, "")
      .replace(/=\n/g, "") // quoted-printable soft line break
      .replace(/=20/g, " ")
      .replace(/=09/g, " ")
      .replace(/=3D/g, "=")
      .replace(/\u00A0/g, " ")
      .replace(/[ \t]+/g, " ")
      .replace(/\n\s+/g, "\n")
      .replace(/\n{2,}/g, "\n")
      .trim();

      try {
        
      } catch (error) {
        
      }

    const pickLabelValue = (label) => {
      const re = new RegExp(`${label}\\s*\\n\\s*([^\\n]+)`, "i");
      const m = clean.match(re);
      return m ? m[1].trim() : null;
    };

    // Nome / email / telefone / cpf
    let nome =
      pickLabelValue("Nome") ||
      clean
        .match(
          /Nome\s+([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ\s]+?)(?:\n|CPF|E-mail|Telefone)/i,
        )?.[1]
        ?.trim() ||
      null;

    let email =
      pickLabelValue("E-mail") ||
      pickLabelValue("Email") ||
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

    // Veículo: tenta subject primeiro
    let veiculo = null;
    const subj = String(subject || "")
      .replace(/\s+/g, " ")
      .trim();

    veiculo =
      subj.match(/Pré-Analisado:\s*(.+)$/i)?.[1]?.trim() ||
      subj.match(/Proposta.*?:\s*(.+)$/i)?.[1]?.trim() ||
      clean.match(/Anúncio:\s+([^\n]+)/i)?.[1]?.trim() ||
      clean.match(/Ford .*? \(Aut\).*?R\$\s*[\d\.\,]+/i)?.[0]?.trim() ||
      null;

    // Mensagem
    const mensagem =
      clean.match(/Mensagem\s+[“"']?([^"”'\n]+)[”"']?/i)?.[1]?.trim() || null;

    // Preço
    const preco =
      clean
        .match(/R\$\s*([\d\.\,]+)/i)?.[1]
        ?.replace(/\./g, "")
        .replace(",", ".") || null;

    // Entrada / condição
    const entrada =
      clean
        .match(/Entrada de R\$\s*([\d\.\,]+)/i)?.[1]
        ?.replace(/\./g, "")
        .replace(",", ".") || null;

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
      },
    };
  }

  parseOlxEmail(text, subject) {
    const clean = text.replace(/\r/g, "");

    const nome = (clean.match(/Nome:\s*\n\s*([^\n]+)/i)?.[1] || null)?.trim();

    const telefoneRaw =
      clean.match(/Telefone:\s*\n\s*([^\n]+)/i)?.[1] ||
      clean.match(/WhatsApp:\s*\n\s*([^\n]+)/i)?.[1] ||
      null;

    const telefone = telefoneRaw ? telefoneRaw.replace(/\D/g, "") : null;

    // Veículo / anúncio: tente achar uma linha “boa” perto de R$
    let veiculo = null;

    // Heurística: procurar a primeira linha "curta" que tenha marca/modelo (ou vem do subject)
    // Se seu subject já tiver o nome do anúncio, use também.
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

      // pega a linha anterior ao preço que pareça título (não seja "Nome/Telefone/..." e não seja URL)
      for (let i = 0; i < lines.length; i++) {
        const l = lines[i];
        if (/^R\$\s*/i.test(l)) {
          const prev = lines[i - 1];
          if (
            prev &&
            prev.length > 6 &&
            prev.length < 120 &&
            !prev.includes("http") &&
            !/nome|telefone/i.test(prev)
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

    return {
      nome,
      email: null,
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

  calculateLeadScore(parsedData) {
    let score = 0;

    // Telefone presente: +25 pontos
    if (parsedData.telefone && parsedData.telefone.length >= 10) {
      score += 25;
    }

    // Nome completo (tem espaço): +15 pontos
    if (parsedData.nome && parsedData.nome.includes(" ")) {
      score += 15;
    }

    // Veículo especificado: +20 pontos
    if (parsedData.veiculo) {
      score += 20;
    }

    // Mensagem longa (> 50 chars): +10 pontos
    if (parsedData.mensagem && parsedData.mensagem.length > 50) {
      score += 10;
    }

    // Email válido: +10 pontos
    if (parsedData.email && /\S+@\S+\.\S+/.test(parsedData.email)) {
      score += 10;
    }

    // Palavras-chave de urgência: +20 pontos
    const urgentKeywords = [
      "urgente",
      "hoje",
      "imediato",
      "rápido",
      "agora",
      "urgentemente",
    ];
    const text = (parsedData.mensagem || "").toLowerCase();
    if (urgentKeywords.some((keyword) => text.includes(keyword))) {
      score += 20;
    }

    return Math.min(score, 100);
  }

  extractLeadTags(veiculo, mensagem) {
    const tags = [];
    const text = ((veiculo || "") + " " + (mensagem || "")).toLowerCase();

    // Marca do veículo
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

    // Tipo de interesse
    if (text.includes("financiamento") || text.includes("parcelamento")) {
      tags.push("financiamento");
    }

    if (text.includes("troca") || text.includes("permuta")) {
      tags.push("troca");
    }

    if (text.includes("consórcio") || text.includes("carta")) {
      tags.push("consórcio");
    }

    if (text.includes("test drive") || text.includes("experimentar")) {
      tags.push("test-drive");
    }

    // Urgência
    if (text.includes("urgente") || text.includes("imediato")) {
      tags.push("urgente");
    }

    return tags;
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
      "informação",
    ];

    if (urgentKeywords.some((keyword) => text.includes(keyword))) {
      return "alta";
    }

    if (highPriorityKeywords.some((keyword) => text.includes(keyword))) {
      return "media";
    }

    return "baixa";
  }

  htmlToText(html) {
    if (!html) return "";
    try {
      const $ = cheerio.load(html);
      $("script, style").remove();
      return $("body").text().replace(/\s+/g, " ").trim();
    } catch {
      return String(html)
        .replace(/<[^>]*>/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    }
  }

  extractVehicleInfo(subject = "", text = "") {
    const combined = (subject + " " + text).trim();
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
      subject +
      " " +
      (text || "") +
      " " +
      this.htmlToText(html || "")
    ).toLowerCase();

    if (fullText.includes("olx")) return "OLX";
    if (fullText.includes("webmotors")) return "Webmotors";
    if (fullText.includes("icarros")) return "iCarros";
    if (fullText.includes("mercadolivre")) return "MercadoLivre";
    if (fullText.includes("facebook")) return "Facebook";
    if (fullText.includes("instagram")) return "Instagram";
    return "Email";
  }

  // extractLeadData(emailData) {
  //   const text = emailData.text || this.htmlToText(emailData.html);
  //   const subject = emailData.subject || '';

  //   // Telefone
  //   const phoneRegexes = [
  //     /(\+55)?\s?(\(?\d{2}\)?\s?)?(9?\d{4}[-\.\s]?\d{4})/g,
  //     /(\d{2})\s?9?\d{4}[-\s]?\d{4}/g,
  //     /WhatsApp[:\s]*([\d\s\(\)\-\.\+]+)/gi,
  //     /Telefone[:\s]*([\d\s\(\)\-\.\+]+)/gi,
  //     /Celular[:\s]*([\d\s\(\)\-\.\+]+)/gi
  //   ];

  //   let telefone = null;
  //   for (const regex of phoneRegexes) {
  //     const matches = text.match(regex);
  //     if (matches && matches[0]) {
  //       telefone = matches[0].replace(/\D/g, '');
  //       if (telefone.length >= 10) break;
  //     }
  //   }

  //   // Nome
  //   let nome = '';
  //   const nomeRegexes = [
  //     /Nome[:\s]*([A-Za-zÀ-ÿ\s]{3,})/i,
  //     /Meu nome é\s*([A-Za-zÀ-ÿ\s]{3,})/i,
  //     /Sou o\s*([A-Za-zÀ-ÿ\s]{3,})/i,
  //     /Sou a\s*([A-Za-zÀ-ÿ\s]{3,})/i
  //   ];

  //   for (const regex of nomeRegexes) {
  //     const match = text.match(regex);
  //     if (match && match[1]) {
  //       nome = match[1].trim();
  //       break;
  //     }
  //   }

  //   // Veículo
  //   const veiculo = this.extractVehicleInfo(subject, text);

  //   return { telefone, nome, veiculo };
  // }

  // extractVehicleInfo(subject, text) {
  //   const combinedText = (subject + ' ' + text).toUpperCase();

  //   const marcas = {
  //     'CHEVROLET': ['CHEVROLET', 'CHEVY', 'GM', 'ONIX', 'TRACKER', 'S10'],
  //     'FIAT': ['FIAT', 'UNO', 'ARGO', 'TORO'],
  //     'VOLKSWAGEN': ['VOLKSWAGEN', 'VW', 'GOL', 'POLO', 'T-CROSS'],
  //     'FORD': ['FORD', 'RANGER', 'KA', 'ECOSPORT'],
  //     'TOYOTA': ['TOYOTA', 'COROLLA', 'HILUX'],
  //     'JEEP': ['JEEP', 'RENEGADE', 'COMPASS']
  //   };

  //   let marcaEncontrada = null;

  //   for (const [marca, keywords] of Object.entries(marcas)) {
  //     if (keywords.some(keyword => combinedText.includes(keyword))) {
  //       marcaEncontrada = marca;
  //       break;
  //     }
  //   }

  //   return marcaEncontrada || subject.substring(0, 100);
  // }

  // detectClassifiedOrigin(emailData) {
  //   const { subject, text, html } = emailData;
  //   const fullText = (subject + ' ' + (text || '') + ' ' + this.htmlToText(html || '')).toLowerCase();

  //   const origemMap = [
  //     { pattern: /olx\.com\.br|anuncio olx|anúncio olx/i, origem: 'OLX' },
  //     { pattern: /webmotors|anuncio webmotors/i, origem: 'Webmotors' },
  //     { pattern: /seminovos\.com|icarros/i, origem: 'Seminovos' },
  //     { pattern: /facebook\.com|facebook market|marketplace/i, origem: 'Facebook' },
  //     { pattern: /instagram\.com|direct instagram/i, origem: 'Instagram' },
  //     { pattern: /whatsapp business|wa\.me/i, origem: 'WhatsApp' },
  //     { pattern: /mercado livre|mercadolivre/i, origem: 'Mercado Livre' }
  //   ];

  //   for (const { pattern, origem } of origemMap) {
  //     if (pattern.test(fullText)) {
  //       return origem;
  //     }
  //   }

  //   return 'Email Direto';
  // }

  // htmlToText(html) {
  //   if (!html) return '';
  //   try {
  //     const $ = cheerio.load(html);
  //     $('script, style').remove();
  //     return $('body').text().replace(/\s+/g, ' ').trim();
  //   } catch {
  //     return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  //   }
  // }

  /**
   * ============================================
   * PARTE 3: API REST - ENDPOINTS PÚBLICOS
   * ============================================
   */

  /**
   * Métodos da API REST
   */

  // 1. Status do serviço
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

  // 2. Buscar leads com filtros
  async getLeads(filters = {}) {
    try {
      return await Lead.findAll(filters);
    } catch (error) {
      throw new Error(`Erro ao buscar leads: ${error.message}`);
    }
  }

  // 3. Buscar lead por ID
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

  // 4. Criar lead manualmente
  async createLead(leadData) {
    try {
      const lead = new Lead(leadData);
      const savedLead = await lead.save();

      // Invalidar cache
      this.statsCache.data = null;

      return savedLead;
    } catch (error) {
      throw new Error(`Erro ao criar lead: ${error.message}`);
    }
  }

  // 5. Atualizar lead
  async updateLead(id, updates) {
    try {
      const lead = await Lead.findById(id);
      if (!lead) {
        throw new Error("Lead não encontrado");
      }

      const updatedLead = await lead.update(updates);

      // Invalidar cache
      this.statsCache.data = null;

      return updatedLead;
    } catch (error) {
      throw new Error(`Erro ao atualizar lead: ${error.message}`);
    }
  }

  // 6. Deletar lead (soft delete)
  async deleteLead(id) {
    try {
      const lead = await Lead.delete(id);
      if (!lead) {
        throw new Error("Lead não encontrado");
      }

      // Invalidar cache
      this.statsCache.data = null;

      return lead;
    } catch (error) {
      throw new Error(`Erro ao deletar lead: ${error.message}`);
    }
  }

  // 7. Estatísticas (com cache)
  async getDashboardStats(dataInicio, dataFim) {
    // Verificar cache
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

      // Atualizar cache
      this.statsCache.data = stats;
      this.statsCache.lastUpdate = now;

      return stats;
    } catch (error) {
      throw new Error(`Erro ao buscar estatísticas: ${error.message}`);
    }
  }

  // 8. Atribuir leads a vendedor
  async assignLeadsToSeller(ids, vendedorId) {
    try {
      return await Lead.assignToSeller(ids, vendedorId);
    } catch (error) {
      throw new Error(`Erro ao atribuir leads: ${error.message}`);
    }
  }

  // 9. Exportar leads
  async exportLeads(filters = {}) {
    try {
      const leads = await Lead.export(filters);
      return leads;
    } catch (error) {
      throw new Error(`Erro ao exportar leads: ${error.message}`);
    }
  }

  // 10. Buscar emails antigos (backfill)
  async fetchHistoricalEmails(days = 30) {
    try {
      if (!this.isConnected) {
        await this.connect();
      }

      const sinceDate = new Date();
      sinceDate.setDate(sinceDate.getDate() - days);

      return new Promise((resolve, reject) => {
        this.imap.openBox("INBOX", false, (err, box) => {
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
                this.processMessage(msg, leads);
              });

              fetch.on("error", reject);

              fetch.on("end", () => {
                console.log(`✅ Processados ${leads.length} emails históricos`);
                resolve({
                  success: true,
                  processed: leads.length,
                  days: days,
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

  // 11. Forçar verificação agora
  async checkNow() {
    return await this.fetchAndProcessEmails();
  }

  /**
   * ============================================
   * PARTE 4: CONTROLE DE AGENDAMENTO
   * ============================================
   */

  startScheduledCapture() {
    // Verificar se email está configurado
    if (!this.config.user || !this.config.password) {
      console.log(
        "⚠️  Agendador não iniciado: Credenciais de email não configuradas",
      );
      return;
    }

    // Agendar captura a cada 2 minutos
    cron.schedule("*/2 * * * *", async () => {
      try {
        await this.fetchAndProcessEmails();
      } catch (error) {
        console.error("Erro na captura agendada:", error.message);
      }
    });

    console.log(
      "⏰ Agendador de captura iniciado (verificação a cada 2 minutos)",
    );

    // Agendar limpeza de cache diária
    cron.schedule("0 2 * * *", () => {
      this.statsCache.data = null;
      this.statsCache.lastUpdate = null;
      console.log("🧹 Cache de estatísticas limpo");
    });
  }

  stopScheduledCapture() {
    // Parar todos os agendamentos
    const tasks = cron.getTasks();
    tasks.forEach((task) => task.stop());
    console.log("⏹️  Agendador de captura parado");
  }

  /**
   * ============================================
   * PARTE 5: UTILITÁRIOS
   * ============================================
   */

  disconnect() {
    if (this.imap) {
      this.imap.end();
      this.isConnected = false;
      console.log("🔌 Conexão IMAP finalizada manualmente");
    }
  }

  // Testar conexão com email
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

  // Invalidar cache
  invalidateCache() {
    this.statsCache.data = null;
    this.statsCache.lastUpdate = null;
    console.log("🧹 Cache invalidado");
  }
}

// Exportar singleton
module.exports = new EmailCaptureService();
