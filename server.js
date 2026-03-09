// server.js
require("dotenv").config();

const app = require("./app");
const http = require("http");
const axios = require("axios");
const { Server: SocketIOServer } = require("socket.io");

let Sandbox;
try {
  const SandboxSDK = require("@koyeb/sandbox-sdk");
  Sandbox = SandboxSDK?.Sandbox || SandboxSDK;
} catch (_) {
  // SDK opcional
}

const token = process.env.KOYEB_API_TOKEN;

let EmailCaptureService = null;
let leadsInitialized = false;

const PORT = Number(process.env.PORT) || 4000;

// HTTP server
const server = http.createServer(app);

// Socket.io
const io = new SocketIOServer(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

io.on("connection", (socket) => {
  socket.on("disconnect", () => {});
});

/**
 * Teste opcional da API Koyeb
 */
async function testKoyebAPI() {
  try {
    if (!token) throw new Error("KOYEB_API_TOKEN não definido");

    const resp = await axios.get("https://app.koyeb.com/v1/services", {
      headers: { Authorization: `Bearer ${token}` },
    });

    console.log("Koyeb Services:", resp.data);
  } catch (error) {
    const msg = error?.response?.data
      ? JSON.stringify(error.response.data)
      : error?.message || error;
    console.error("Erro ao acessar Koyeb API:", msg);
  }
}

/**
 * Inicializa captura de leads
 */
async function initializeLeadsSystem() {
  try {
    if (!process.env.EMAIL_USER || !process.env.EMAIL_PASSWORD) {
      console.log("⚠️ Sistema de leads desativado (EMAIL_USER / EMAIL_PASSWORD ausentes)");
      return false;
    }

    EmailCaptureService = require("./src/services/EmailCaptureService");
    const db = require("./src/config/database");

    const dbHealth = await db.healthCheck();

    if (dbHealth.status !== "healthy") {
      console.log("⚠️ Banco não está saudável, leads não iniciados");
      return false;
    }

    console.log("🚗 Inicializando sistema de leads...");

    await EmailCaptureService.connect();
    EmailCaptureService.startScheduledCapture();

    console.log(`✅ Leads ativos para: ${process.env.EMAIL_USER}`);

    return true;
  } catch (error) {
    console.error("❌ Falha ao iniciar sistema de leads:", error.message);
    return false;
  }
}

/**
 * Graceful shutdown
 */
function setupGracefulShutdown() {
  const shutdown = async (signal) => {
    console.log(`\n${signal} recebido - encerrando servidor...`);

    if (leadsInitialized && EmailCaptureService) {
      try {
        await EmailCaptureService.disconnect();
        console.log("📧 IMAP desconectado");
      } catch (e) {
        console.error("Erro ao desconectar IMAP:", e.message);
      }
    }

    try {
      io.close();
    } catch (_) {}

    server.close(() => {
      console.log("👋 Servidor HTTP encerrado");
      process.exit(0);
    });

    setTimeout(() => {
      console.log("⚠️ Timeout de encerramento");
      process.exit(1);
    }, 10000);
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

/**
 * Tratamento de erros globais
 */
process.on("uncaughtException", (error) => {
  console.error("💥 uncaughtException:", error);
});

process.on("unhandledRejection", (reason) => {
  console.error("💥 unhandledRejection:", reason);
});

/**
 * Startup
 */
async function startServer() {
  console.log("🚀 Iniciando Garagem Web API...");
  console.log(`🌍 Ambiente: ${process.env.NODE_ENV || "development"}`);

  if (process.env.DATABASE_URL) {
    console.log(`🗄️ DB host: ${process.env.DATABASE_URL.split("@")[1]}`);
  }

  leadsInitialized = await initializeLeadsSystem();

  server.listen(PORT, "0.0.0.0", () => {
    console.log("\n==============================");
    console.log("✅ SERVIDOR ATIVO");
    console.log("==============================");

    console.log(`📡 Porta: ${PORT}`);
    console.log(`🏥 Health: http://localhost:${PORT}/health`);
    console.log(`🏥 Healthz: http://localhost:${PORT}/healthz`);

    if (leadsInitialized) {
      console.log(`🚗 Leads: http://localhost:${PORT}/garagemweb/api/leads`);
    } else {
      console.log("🚗 Leads: desativado");
    }

    console.log("==============================\n");
  });

  setupGracefulShutdown();
}

if (require.main === module) {
  startServer().catch((err) => {
    console.error("Startup error:", err);
    process.exit(1);
  });
}

module.exports = { server, startServer, io };