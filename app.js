/**
 * arquivo: app.js
 * descrição: configuração do servidor Express
 */

const express = require("express");
const cors = require("cors");
require("dotenv").config();

const app = express();

/**
 * CORS
 */
const corsOptions = {
  origin: [
    "https://localhost:8100",
    "http://localhost:8100",
    "https://nextcarltda.web.app",
    "http://localhost:3000",
    "http://localhost:4200",
    "http://localhost:8080",
    "https://primecarapp-465cd.web.app",
    "https://primecarapp-465cd.firebaseapp.com",
  ].filter(Boolean),
  methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
  allowedHeaders: [
    "Content-Type",
    "Authorization",
    "schema",
    "X-Requested-With",
    "Accept",
    "Origin",
  ],
  credentials: true,
  optionsSuccessStatus: 200,
};

/**
 * Middlewares
 */
app.use(cors(corsOptions));
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));
app.use(express.json({ type: "application/vnd.api+json" }));

if (process.env.NODE_ENV === "development") {
  const morgan = require("morgan");
  app.use(morgan("dev"));
}

/**
 * Health endpoints
 * Devem ficar no topo para responder mesmo se algo mais falhar depois.
 */
app.get("/healthz", (req, res) => {
  return res.status(200).send("ok");
});

app.get("/health", async (req, res) => {
  try {
    const db = require("./src/config/database");
    const EmailCaptureService = require("./src/services/EmailCaptureService");

    const dbHealth = await db.healthCheck();
    const emailStatus = EmailCaptureService.isConnected
      ? "connected"
      : "disconnected";

    return res.status(200).json({
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
    return res.status(500).json({
      status: "ERROR",
      timestamp: new Date().toISOString(),
      error: error.message,
    });
  }
});

app.get("/ready", async (req, res) => {
  try {
    const db = require("./src/config/database");
    await db.query("SELECT 1", []);
    return res.status(200).send("ready");
  } catch (error) {
    return res.status(503).send("db not ready");
  }
});

app.get("/api/email/status", (req, res) => {
  const EmailCaptureService = require("./src/services/EmailCaptureService");

  return res.json({
    connected: EmailCaptureService.isConnected,
    lastCheck: new Date().toISOString(),
    emailAccount: process.env.EMAIL_USER || "not configured",
  });
});

/**
 * Rotas
 */
const index = require("./src/routes/index");
const garagemWeb = require("./src/routes/garagemweb.router");
const integrador = require("./src/routes/integradores.router");
const emailCaptureRoutes = require("./src/routes/lead.router");
const whatsappWebhookRoutes = require("./src/routes/whatsappWebhookRoutes");
const importadorGaraje = require("./src/controllers/importadorGaraje.controller");

app.use(index);
app.use("/garagemweb", garagemWeb);
app.use("/garagemweb/integradores", integrador);

// Mantém compatibilidade com rotas antigas e novas
app.use("/garagemweb/api", emailCaptureRoutes);
app.use("/garagemweb/leads", emailCaptureRoutes);

// WhatsApp webhook
app.use("/webhooks/whatsapp", whatsappWebhookRoutes);
app.use("/garagemweb/webhooks/whatsapp", whatsappWebhookRoutes);

// Importação manualf
app.post("/importar-garaje", importadorGaraje.importarGarajeManual);

/**
 * Inicializações que não devem matar o app
 */
try {
  const LeadWorkflowService = require("./src/services/LeadWorkflowService");
  LeadWorkflowService.start();
  console.log("✅ LeadWorkflowService iniciado");
} catch (error) {
  console.error("❌ Falha ao iniciar LeadWorkflowService:", error.message);
}

try {
  importadorGaraje.startGarajeCron({
    schema: process.env.SCHEMA_PADRAO,
    url: process.env.GARAJE_URL,
  });
  console.log("✅ Cron do Garaje iniciado");
} catch (error) {
  console.error("❌ Falha ao iniciar cron do Garaje:", error.message);
}

/**
 * 404
 */
app.use((req, res) => {
  return res.status(404).json({
    success: false,
    error: "Rota não encontrada",
    path: req.path,
    timestamp: new Date().toISOString(),
  });
});

/**
 * Tratamento global de erros
 */
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

  return res.status(err.status || 500).json(errorResponse);
});

module.exports = app;