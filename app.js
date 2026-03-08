/**
 * arquivo: app.js
 * descrição: arquivo responsável por fazer a configuração do servidor Express
 * ATUALIZADO: Mantém apenas configuração do Express
 */

const express = require("express");
const cors = require("cors");
require("dotenv").config();

const app = express();

// Configuração CORS
const corsOptions = {
  origin: [
    "https://localhost:8100",
    "http://localhost:8100",
    "https://nextcarltda.firebaseapp.com",
    "http://localhost:3000",
    "http://localhost:4200",
    "http://localhost:8080",
    "https://primecarapp-465cd.web.app",
    "https://primecarapp-465cd.firebaseapp.com",
    "http://localhost:3000",
  ].filter(Boolean),
  methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
  allowedHeaders: [
    "Content-Type",
    "Authorization",
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, schema",
    "X-Requested-With",
    "Accept",
    "Origin",
  ],
  credentials: true,
  optionsSuccessStatus: 200,
};

// Middlewares
app.use(cors(corsOptions));
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));
app.use(express.json({ type: "application/vnd.api+json" }));

// Log de requisições (opcional para desenvolvimento)
if (process.env.NODE_ENV === "development") {
  const morgan = require("morgan");
  app.use(morgan("dev"));
}

/**
 * ✅ WhatsApp Webhook
 * Importante: mantenha antes do middleware 404
 */
const whatsappWebhookRoutes = require('./src/routes/whatsappWebhookRoutes');
const LeadWorkflowService = require('./src/services/LeadWorkflowService');

// expõe sem prefixo
app.use("/webhooks/whatsapp", whatsappWebhookRoutes);

// expõe com prefixo (caso seu deploy use /garagemweb como base path)
app.use("/garagemweb/webhooks/whatsapp", whatsappWebhookRoutes);

/**
 * ✅ Iniciar workflow (crons)
 */
LeadWorkflowService.start();

app.get("/healthz", (req, res) => res.status(200).send("ok"));

// Health Check aprimorado
app.get("/health", async (req, res) => {
  try {
    const db = require("./src/config/database");
    const EmailCaptureService = require("./src/services/EmailCaptureService");

    const dbHealth = await db.healthCheck();
    const emailStatus = EmailCaptureService.isConnected
      ? "connected"
      : "disconnected";

    res.status(200).json({
      status: "OK",
      timestamp: new Date().toISOString(),
      service: "NextCar Leads API",
      version: "1.0.0",
      environment: process.env.NODE_ENV || "development",
      database: dbHealth.status,
      email_capture: emailStatus,
      uptime: process.uptime(),
    });
  } catch (error) {
    res.status(500).json({
      status: "ERROR",
      timestamp: new Date().toISOString(),
      error: error.message,
    });
  }
});

/**
 * ✅ Corrigido: /ready (db era undefined)
 */
app.get("/ready", async (req, res) => {
  try {
    const db = require('./src/config/database');
    await db.query("SELECT 1");
    res.status(200).send("ready");
  } catch {
    res.status(503).send("db not ready");
  }
});

app.get("/healthz", (req, res) => res.status(200).send("ok"));

// Status da captura de email
app.get("/api/email/status", (req, res) => {
  const EmailCaptureService = require("./src/services/EmailCaptureService");

  res.json({
    connected: EmailCaptureService.isConnected,
    lastCheck: new Date().toISOString(),
    emailAccount: process.env.EMAIL_USER || "not configured",
  });
});

// Importar rotas existentes
const index = require("./src/routes/index");
const garagemWeb = require("./src/routes/garagemweb.router");
const integrador = require("./src/routes/integradores.router");
const importadorGaraje = require("./src/controllers/importadorGaraje.controller");

// Importar rotas de leads
const emailCaptureRoutes = require("./src/routes/lead.router");

// Usar rotas
app.use(index);
app.use("/garagemweb/", garagemWeb);
app.use("/garagemweb/integradores", integrador);
app.use("/garagemweb/leads", emailCaptureRoutes); // Rotas de leads em /garagemweb/api/leads
app.post("/importar-garaje", importadorGaraje.importarGarajeManual);

//inicia o cron ao subir o servidor
importadorGaraje.startGarajeCron({
  schema: process.env.SCHEMA_PADRAO, // obrigatório
  url: process.env.GARAJE_URL
});

// Middleware para 404
app.use((req, res, next) => {
  res.status(404).json({
    success: false,
    error: "Rota não encontrada",
    path: req.path,
    timestamp: new Date().toISOString(),
  });
});

// Middleware para erros globais
app.use((err, req, res, next) => {
  console.error("Erro:", err.stack);

  const errorResponse = {
    success: false,
    error:
      process.env.NODE_ENV === "production"
        ? "Erro interno do servidor"
        : err.message,
    timestamp: new Date().toISOString(),
  };

  if (process.env.NODE_ENV === "development") {
    errorResponse.stack = err.stack;
    errorResponse.details = err.details;
  }

  res.status(err.status || 500).json(errorResponse);
});

module.exports = app;
