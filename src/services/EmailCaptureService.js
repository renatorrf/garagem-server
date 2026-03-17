/**
 * services/EmailCaptureService.js
 * Serviço unificado para:
 * 1. Captura automática de emails IMAP
 * 2. API REST para gerenciamento de leads
 * 3. Processamento e salvamento no PostgreSQL
 */

const Imap = require('imap');
const { simpleParser } = require('mailparser');
const cheerio = require('cheerio');
const cron = require('node-cron');
const Lead = require('../models/leads');
const LeadWorkflowService = require('./LeadWorkflowService');

class EmailCaptureService {
  constructor() {
    this.imap = null;
    this.isConnected = false;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;

    this.config = {
      user: process.env.EMAIL_USER || 'leads.nextcaruberlandia@gmail.com',
      password: process.env.EMAIL_PASSWORD || '',
      host: 'imap.gmail.com',
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
      if (!this.config.user || !this.config.password || this.config.password === '') {
        console.log('⚠️  IMAP: Credenciais não configuradas no .env');
        return reject(new Error('Credenciais de email não configuradas'));
      }

      if (this.imap && this.isConnected) {
        return resolve();
      }

      this.imap = new Imap(this.config);

      this.imap.on('ready', () => {
        console.log('✅ IMAP conectado');
        this.isConnected = true;
        this.reconnectAttempts = 0;
        resolve();
      });

      this.imap.on('error', (err) => {
        console.error('❌ Erro IMAP:', err.message);
        this.isConnected = false;
        reject(err);
      });

      this.imap.on('end', () => {
        console.log('🔌 Conexão IMAP finalizada');
        this.isConnected = false;
        this.scheduleReconnect();
      });

      this.imap.connect();
    });
  }

  scheduleReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('🚫 Máximo de tentativas de reconexão IMAP atingido');
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
      console.error('❌ Erro ao buscar emails:', error.message);
      return {
        success: false,
        error: error.message,
        processed: 0,
      };
    }
  }

  async fetchUnreadEmails() {
    return new Promise((resolve, reject) => {
      this.imap.openBox('INBOX', false, async (err) => {
        if (err) return reject(err);

        const sinceDate = new Date();
        sinceDate.setDate(sinceDate.getDate() - 7);

        this.imap.search(
          ['UNSEEN', ['SINCE', sinceDate.toLocaleDateString('en-CA')]],
          async (err, results) => {
            if (err) return reject(err);

            if (!results || results.length === 0) {
              console.log('📭 Nenhum email novo encontrado');
              return resolve([]);
            }

            console.log(`📨 ${results.length} novos emails encontrados`);

            const leads = [];
            const fetch = this.imap.fetch(results, {
              bodies: '',
              markSeen: true,
              struct: true,
            });

            const messagePromises = [];

            fetch.on('message', (msg) => {
              const promise = new Promise((resolveMsg) => {
                this.processMessage(msg, leads)
                  .then(() => resolveMsg())
                  .catch((error) => {
                    console.error('Erro ao processar mensagem:', error);
                    resolveMsg();
                  });
              });

              messagePromises.push(promise);
            });

            fetch.on('error', (err) => reject(err));

            fetch.on('end', async () => {
              try {
                await Promise.all(messagePromises);
                console.log(`✅ ${leads.length} emails processados com sucesso`);
                resolve(leads);
              } catch (error) {
                console.error('Erro ao finalizar processamento:', error);
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
        buffer: '',
      };

      msg.on('attributes', (attrs) => {
        messageData.attributes = attrs;
      });

      msg.on('body', (stream) => {
        stream.on('data', (chunk) => {
          messageData.buffer += chunk.toString('utf8');
        });
      });

      msg.once('end', async () => {
        try {
          if (!messageData.buffer) {
            console.warn('⚠️ Mensagem sem conteúdo');
            return resolve();
          }

          const parsed = await simpleParser(messageData.buffer);
          const lead = await this.saveLeadFromEmail(parsed, messageData.attributes || {});

          if (lead) {
            leads.push(lead);
            console.log(`📝 Processado: ${lead.emailRemetente}`);
          }

          resolve();
        } catch (error) {
          console.error('❌ Erro ao processar mensagem:', error.message);
          reject(error);
        }
      });

      setTimeout(() => {
        console.warn('⏰ Timeout no processamento de mensagem');
        resolve();
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
        console.warn('⚠️ Email sem messageId, ignorando');
        return null;
      }

      const existingLead = await Lead.findByEmailId(messageId);
      if (existingLead) {
        console.log(`⚠️ Lead já existe: ${messageId}`);
        return null;
      }

      const senderEmail =
        from?.value?.[0]?.address || 'nao-informado@origem.local';
      const senderName = from?.text || 'Remetente desconhecido';

      const fallbackText = [text || '', this.htmlToText(html || '')]
        .filter(Boolean)
        .join('\n')
        .trim();

      const platformData = this.detectAndParsePlatform(emailData);

      let leadData;

      if (platformData.platform && platformData.parsed) {
        console.log(`📊 Plataforma detectada: ${platformData.platform}`);

        const score = this.calculateLeadScore(platformData.parsed);
        const tags = this.extractLeadTags(
          platformData.parsed.veiculo,
          platformData.parsed.mensagem,
        );

        leadData = {
          emailId: messageId,
          remetente: platformData.parsed.nome || senderName || 'Cliente',
          emailRemetente: platformData.parsed.email || senderEmail,
          assunto: subject || `Proposta recebida via ${platformData.platform}`,
          telefone: platformData.parsed.telefone || null,
          nome: platformData.parsed.nome || 'Não informado',
          veiculoInteresse:
            platformData.parsed.veiculo ||
            this.extractVehicleInfo(subject, fallbackText),
          mensagem: platformData.parsed.mensagem || fallbackText || '',
          origem: platformData.platform,
          status: 'novo',
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

        console.log('📋 Dados do lead preparados:');
        console.log(`   Score: ${score}`);
        console.log(`   Tags: ${tags.join(', ')}`);
        console.log(`   Prioridade: ${leadData.prioridade}`);
      } else {
        console.log('🔧 Usando parser genérico...');
        const extractedData = this.extractLeadData(emailData);

        leadData = {
          emailId: messageId,
          remetente: senderName || 'Remetente desconhecido',
          emailRemetente: senderEmail,
          assunto: subject || 'Sem assunto',
          telefone: extractedData.telefone,
          nome: extractedData.nome || senderName || 'Não informado',
          veiculoInteresse: extractedData.veiculo || 'Veículo não especificado',
          mensagem: fallbackText || '',
          origem: this.detectClassifiedOrigin(emailData),
          status: 'novo',
          prioridade: 'media',
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
          if (typeof LeadWorkflowService?.onNewLead !== 'function') {
            throw new Error('LeadWorkflowService.onNewLead indisponível');
          }

          await LeadWorkflowService.onNewLead(savedLead);
        } catch (e) {
          console.error('⚠️ Falha ao notificar WhatsApp:', e.message);
        }
      }

      this.invalidateCache();
      return savedLead;
    } catch (error) {
      console.error('❌ ERRO CRÍTICO ao salvar lead:', error.message);
      console.error('Stack trace:', error.stack);
      return null;
    }
  }

  detectAndParsePlatform(emailData) {
    const { subject, from, text, html } = emailData;
    const fullText = text || this.htmlToText(html || '');
    const senderEmail = from?.value?.[0]?.address || '';
    const senderName = from?.text || '';

    console.log(`🔍 Analisando email de: ${senderEmail}`);
    console.log(`   Assunto: "${subject || ''}"`);

    if (
      senderEmail.includes('mobiauto.com.br') ||
      senderEmail.includes('contato@mobiauto') ||
      fullText.toLowerCase().includes('mobiauto')
    ) {
      console.log('🎯 Detectado: Mobiauto');
      return {
        platform: 'Mobiauto',
        parsed: this.parseMobiautoEmail(fullText, subject || ''),
        rawData: { subject, senderEmail, senderName },
      };
    }

    if (
      senderEmail.includes('olx.com.br') ||
      senderEmail.includes('email@email.olx.com.br') ||
      fullText.toLowerCase().includes('olx')
    ) {
      console.log('🎯 Detectado: OLX');
      return {
        platform: 'OLX',
        parsed: this.parseOlxEmail(fullText, subject || ''),
        rawData: { subject, senderEmail, senderName },
      };
    }

    if (
      senderEmail.includes('webmotors.com.br') ||
      fullText.toLowerCase().includes('webmotors')
    ) {
      console.log('🎯 Detectado: Webmotors');
      return {
        platform: 'Webmotors',
        parsed: this.parseWebmotorsEmail(fullText, subject || ''),
        rawData: { subject, senderEmail, senderName },
      };
    }

    if (
      senderEmail.includes('facebookmail.com') ||
      senderEmail.includes('facebook.com') ||
      fullText.toLowerCase().includes('marketplace')
    ) {
      console.log('🎯 Detectado: Facebook Marketplace');
      return {
        platform: 'Facebook Marketplace',
        parsed: this.parseFacebookEmail(fullText, subject || ''),
        rawData: { subject, senderEmail, senderName },
      };
    }

    if (
      senderEmail.includes('instagram.com') ||
      fullText.toLowerCase().includes('instagram')
    ) {
      console.log('🎯 Detectado: Instagram');
      return {
        platform: 'Instagram',
        parsed: this.parseInstagramEmail(fullText, subject || ''),
        rawData: { subject, senderEmail, senderName },
      };
    }

    if (
      senderEmail.includes('whatsapp.com') ||
      fullText.toLowerCase().includes('whatsapp')
    ) {
      console.log('🎯 Detectado: WhatsApp Business');
      return {
        platform: 'WhatsApp Business',
        parsed: this.parseWhatsAppEmail(fullText, subject || ''),
        rawData: { subject, senderEmail, senderName },
      };
    }

    console.log('🔧 Nenhuma plataforma específica detectada, usando parser genérico');
    return { platform: null, parsed: null };
  }

  parseMobiautoEmail(text, subject) {
    console.log('📝 Parseando email do Mobiauto...');

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
        text.match(/(\d{2}\s?9?\d{4}\s?\d{4})/);
      if (telefoneMatch) result.telefone = telefoneMatch[1].replace(/\D/g, '');

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
    } catch (error) {
      console.error('❌ Erro ao parsear email do Mobiauto:', error.message);
    }

    return result;
  }

  parseOlxEmail(text, subject) {
    return this.parseGenericPlatformEmail(text, subject, 'OLX');
  }

  parseWebmotorsEmail(text, subject) {
    return this.parseGenericPlatformEmail(text, subject, 'Webmotors');
  }

  parseFacebookEmail(text, subject) {
    return this.parseGenericPlatformEmail(text, subject, 'Facebook Marketplace');
  }

  parseInstagramEmail(text, subject) {
    return this.parseGenericPlatformEmail(text, subject, 'Instagram');
  }

  parseWhatsAppEmail(text, subject) {
    return this.parseGenericPlatformEmail(text, subject, 'WhatsApp Business');
  }

  parseGenericPlatformEmail(text, subject, platform) {
    console.log(`📝 Parseando email genérico da plataforma: ${platform}`);

    const extractedData = this.extractLeadData({
      text,
      subject,
      html: '',
    });

    return {
      nome: extractedData.nome || null,
      email: this.extractEmail(text),
      telefone: extractedData.telefone || null,
      veiculo: extractedData.veiculo || null,
      mensagem: text || subject || '',
      preco: this.extractPrice(text),
      placa: this.extractPlate(text),
      extras: {
        plataformaDetectada: platform,
      },
    };
  }

  calculateLeadScore(parsedData) {
    let score = 0;

    if (parsedData.telefone && parsedData.telefone.length >= 10) {
      score += 25;
    }

    if (parsedData.nome && parsedData.nome.includes(' ')) {
      score += 15;
    }

    if (parsedData.veiculo) {
      score += 20;
    }

    if (parsedData.mensagem && parsedData.mensagem.length > 50) {
      score += 10;
    }

    if (parsedData.email && /\S+@\S+\.\S+/.test(parsedData.email)) {
      score += 10;
    }

    const urgentKeywords = [
      'urgente',
      'hoje',
      'imediato',
      'rápido',
      'agora',
      'urgentemente',
    ];
    const text = (parsedData.mensagem || '').toLowerCase();

    if (urgentKeywords.some((keyword) => text.includes(keyword))) {
      score += 20;
    }

    return Math.min(score, 100);
  }

  extractLeadTags(veiculo, mensagem) {
    const tags = [];
    const text = ((veiculo || '') + ' ' + (mensagem || '')).toLowerCase();

    const marcas = [
      'chevrolet',
      'fiat',
      'volkswagen',
      'ford',
      'toyota',
      'hyundai',
      'honda',
      'nissan',
      'jeep',
      'renault',
      'bmw',
      'mercedes',
      'audi',
    ];

    for (const marca of marcas) {
      if (text.includes(marca)) {
        tags.push(marca);
        break;
      }
    }

    if (text.includes('financiamento') || text.includes('parcelamento')) {
      tags.push('financiamento');
    }

    if (text.includes('troca') || text.includes('permuta')) {
      tags.push('troca');
    }

    if (text.includes('consórcio') || text.includes('carta')) {
      tags.push('consórcio');
    }

    if (text.includes('test drive') || text.includes('experimentar')) {
      tags.push('test-drive');
    }

    if (text.includes('urgente') || text.includes('imediato')) {
      tags.push('urgente');
    }

    return tags;
  }

  determinePriority(mensagem) {
    if (!mensagem) return 'media';

    const text = mensagem.toLowerCase();
    const urgentKeywords = ['urgente', 'hoje', 'imediato', 'imediatamente', 'agora'];
    const highPriorityKeywords = ['interesse', 'gostaria', 'dúvida', 'informação'];

    if (urgentKeywords.some((keyword) => text.includes(keyword))) {
      return 'alta';
    }

    if (highPriorityKeywords.some((keyword) => text.includes(keyword))) {
      return 'media';
    }

    return 'baixa';
  }

  extractLeadData(emailData) {
    const text = emailData.text || this.htmlToText(emailData.html || '');
    const subject = emailData.subject || '';

    const phoneRegexes = [
      /(\+55)?\s?(\(?\d{2}\)?\s?)?(9?\d{4}[-.\s]?\d{4})/g,
      /(\d{2})\s?9?\d{4}[-\s]?\d{4}/g,
      /WhatsApp[:\s]*([\d\s()\-.+]+)/gi,
      /Telefone[:\s]*([\d\s()\-.+]+)/gi,
      /Celular[:\s]*([\d\s()\-.+]+)/gi,
    ];

    let telefone = null;
    for (const regex of phoneRegexes) {
      const matches = text.match(regex);
      if (matches && matches[0]) {
        telefone = matches[0].replace(/\D/g, '');
        if (telefone.length >= 10) break;
      }
    }

    let nome = '';
    const nomeRegexes = [
      /Nome[:\s]*([A-Za-zÀ-ÿ\s]{3,})/i,
      /Meu nome é\s*([A-Za-zÀ-ÿ\s]{3,})/i,
      /Sou o\s*([A-Za-zÀ-ÿ\s]{3,})/i,
      /Sou a\s*([A-Za-zÀ-ÿ\s]{3,})/i,
    ];

    for (const regex of nomeRegexes) {
      const match = text.match(regex);
      if (match && match[1]) {
        nome = match[1].trim();
        break;
      }
    }

    const veiculo = this.extractVehicleInfo(subject, text);

    return { telefone, nome, veiculo };
  }

  extractVehicleInfo(subject, text) {
    const combinedText = `${subject || ''} ${text || ''}`.toUpperCase();

    const marcas = {
      CHEVROLET: ['CHEVROLET', 'CHEVY', 'GM', 'ONIX', 'TRACKER', 'S10'],
      FIAT: ['FIAT', 'UNO', 'ARGO', 'TORO'],
      VOLKSWAGEN: ['VOLKSWAGEN', 'VW', 'GOL', 'POLO', 'T-CROSS'],
      FORD: ['FORD', 'RANGER', 'KA', 'ECOSPORT'],
      TOYOTA: ['TOYOTA', 'COROLLA', 'HILUX'],
      JEEP: ['JEEP', 'RENEGADE', 'COMPASS'],
      NISSAN: ['NISSAN', 'VERSA', 'KICKS', 'SENTRA'],
      HYUNDAI: ['HYUNDAI', 'HB20', 'CRETA'],
      HONDA: ['HONDA', 'CIVIC', 'HR-V', 'FIT'],
    };

    for (const [marca, keywords] of Object.entries(marcas)) {
      if (keywords.some((keyword) => combinedText.includes(keyword))) {
        return marca;
      }
    }

    return (subject || '').substring(0, 120) || null;
  }

  detectClassifiedOrigin(emailData) {
    const { subject, text, html } = emailData;
    const fullText = (
      `${subject || ''} ${text || ''} ${this.htmlToText(html || '')}`
    ).toLowerCase();

    const origemMap = [
      { pattern: /mobiauto/i, origem: 'Mobiauto' },
      { pattern: /olx\.com\.br|anuncio olx|anúncio olx/i, origem: 'OLX' },
      { pattern: /webmotors|anuncio webmotors/i, origem: 'Webmotors' },
      { pattern: /seminovos\.com|icarros/i, origem: 'Seminovos' },
      { pattern: /facebook\.com|facebook market|marketplace/i, origem: 'Facebook Marketplace' },
      { pattern: /instagram\.com|direct instagram/i, origem: 'Instagram' },
      { pattern: /whatsapp business|wa\.me|whatsapp/i, origem: 'WhatsApp Business' },
      { pattern: /mercado livre|mercadolivre/i, origem: 'Mercado Livre' },
    ];

    for (const { pattern, origem } of origemMap) {
      if (pattern.test(fullText)) {
        return origem;
      }
    }

    return 'Email Direto';
  }

  htmlToText(html) {
    if (!html) return '';

    try {
      const $ = cheerio.load(html);
      $('script, style').remove();

      return (
        $('body').text() ||
        $.text() ||
        ''
      )
        .replace(/\s+/g, ' ')
        .trim();
    } catch {
      return String(html)
        .replace(/<[^>]*>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    }
  }

  extractEmail(text) {
    if (!text) return null;
    const match = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
    return match ? match[0] : null;
  }

  extractPrice(text) {
    if (!text) return null;
    const match = text.match(/R\$\s*([\d\.,]+)/i);
    return match ? match[1].trim() : null;
  }

  extractPlate(text) {
    if (!text) return null;
    const match = text.match(/\b([A-Z]{3}\d[A-Z0-9]\d{2})\b/i);
    return match ? match[1].toUpperCase() : null;
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
        throw new Error('Lead não encontrado');
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
      this.invalidateCache();
      return savedLead;
    } catch (error) {
      throw new Error(`Erro ao criar lead: ${error.message}`);
    }
  }

  async updateLead(id, updates) {
    try {
      const lead = await Lead.findById(id);
      if (!lead) {
        throw new Error('Lead não encontrado');
      }

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
      if (!lead) {
        throw new Error('Lead não encontrado');
      }

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
        this.imap.openBox('INBOX', false, (err) => {
          if (err) return reject(err);

          this.imap.search(
            [['SINCE', sinceDate.toLocaleDateString('en-CA')]],
            async (err, results) => {
              if (err) return reject(err);

              console.log(
                `🔄 Encontrados ${results.length} emails históricos (últimos ${days} dias)`,
              );

              const leads = [];
              const fetch = this.imap.fetch(results, {
                bodies: '',
                struct: true,
              });

              const messagePromises = [];

              fetch.on('message', (msg) => {
                const promise = new Promise((resolveMsg) => {
                  this.processMessage(msg, leads)
                    .then(() => resolveMsg())
                    .catch(() => resolveMsg());
                });
                messagePromises.push(promise);
              });

              fetch.on('error', reject);

              fetch.on('end', async () => {
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
      console.log('⚠️  Agendador não iniciado: Credenciais de email não configuradas');
      return;
    }

    cron.schedule('*/2 * * * *', async () => {
      try {
        await this.fetchAndProcessEmails();
      } catch (error) {
        console.error('Erro na captura agendada:', error.message);
      }
    });

    console.log('⏰ Agendador de captura iniciado (verificação a cada 2 minutos)');

    cron.schedule('0 2 * * *', () => {
      this.statsCache.data = null;
      this.statsCache.lastUpdate = null;
      console.log('🧹 Cache de estatísticas limpo');
    });
  }

  stopScheduledCapture() {
    const tasks = cron.getTasks();
    tasks.forEach((task) => task.stop());
    console.log('⏹️  Agendador de captura parado');
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
      console.log('🔌 Conexão IMAP finalizada manualmente');
    }
  }

  async testConnection() {
    try {
      await this.connect();
      return {
        success: true,
        message: 'Conexão IMAP estabelecida com sucesso',
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
    console.log('🧹 Cache invalidado');
  }
}

module.exports = new EmailCaptureService();